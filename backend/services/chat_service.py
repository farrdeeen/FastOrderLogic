"""
services/chat_service.py
────────────────────────
Orchestrates: DB session/message management, AI calls, WhatsApp dispatch.
All DB interactions use raw SQL via SQLAlchemy (consistent with existing codebase).
"""

import logging
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session
from sqlalchemy import text

from services.ai_service import generate_reply, extract_order_json, is_address_confirmed
from services.whatsapp_service import send_text_message

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Session helpers
# ─────────────────────────────────────────────────────────────────────────────

def get_or_create_session(db: Session, phone: str, contact_name: str = "") -> dict:
    row = db.execute(
        text("SELECT * FROM chat_sessions WHERE phone_number = :ph"),
        {"ph": phone},
    ).fetchone()

    if row:
        return dict(row._mapping)

    db.execute(
        text("""
            INSERT INTO chat_sessions (phone_number, wa_contact_name, status, created_at, updated_at)
            VALUES (:ph, :name, 'active', :now, :now)
        """),
        {"ph": phone, "name": contact_name, "now": datetime.now()},
    )
    db.commit()

    row = db.execute(
        text("SELECT * FROM chat_sessions WHERE phone_number = :ph"),
        {"ph": phone},
    ).fetchone()
    return dict(row._mapping)


def save_message(db: Session, session_id: int, sender: str,
                 message: str, wa_message_id: Optional[str] = None,
                 meta: Optional[dict] = None) -> int:
    import json as _json
    result = db.execute(
        text("""
            INSERT INTO chat_messages (session_id, wa_message_id, sender, message, meta, timestamp)
            VALUES (:sid, :wid, :sender, :msg, :meta, :ts)
        """),
        {
            "sid":    session_id,
            "wid":    wa_message_id,
            "sender": sender,
            "msg":    message,
            "meta":   _json.dumps(meta) if meta else None,
            "ts":     datetime.now(),
        },
    )
    db.commit()

    # update session last_message
    db.execute(
        text("""
            UPDATE chat_sessions
            SET last_message = :msg, last_message_at = :ts, updated_at = :ts
            WHERE id = :sid
        """),
        {"msg": message[:255], "ts": datetime.now(), "sid": session_id},
    )
    db.commit()
    return result.lastrowid


def get_conversation_history(db: Session, session_id: int, limit: int = 20) -> list[dict]:
    """Return last `limit` messages formatted for OpenRouter (role / content)."""
    rows = db.execute(
        text("""
            SELECT sender, message FROM chat_messages
            WHERE session_id = :sid
            ORDER BY timestamp DESC
            LIMIT :lim
        """),
        {"sid": session_id, "lim": limit},
    ).fetchall()

    history = []
    for r in reversed(rows):  # oldest-first for the LLM
        role = "user" if r.sender == "user" else "assistant"
        history.append({"role": role, "content": r.message})
    return history


# ─────────────────────────────────────────────────────────────────────────────
# Inbound message handler  (called by webhook router)
# ─────────────────────────────────────────────────────────────────────────────

async def handle_inbound_message(
    db: Session,
    phone: str,
    text_body: str,
    contact_name: str = "",
    wa_message_id: Optional[str] = None,
) -> str:
    """
    Full pipeline:
      1. Get/create session
      2. Dedup by wa_message_id
      3. Save user message
      4. Build history & call AI
      5. Save AI reply
      6. Send reply via WhatsApp
      7. Return AI reply text
    """
    session = get_or_create_session(db, phone, contact_name)
    session_id = session["id"]

    # ── dedup: ignore if we already processed this WA message ──
    if wa_message_id:
        existing = db.execute(
            text("SELECT id FROM chat_messages WHERE wa_message_id = :wid"),
            {"wid": wa_message_id},
        ).fetchone()
        if existing:
            logger.info("Duplicate WA message %s — skipping", wa_message_id)
            return ""

    # ── save user message ──
    save_message(db, session_id, "user", text_body, wa_message_id=wa_message_id)

    # ── build history & call AI ──
    history = get_conversation_history(db, session_id, limit=18)
    # remove last entry — it's the user message we just saved, will be passed separately
    if history and history[-1]["role"] == "user":
        history = history[:-1]

    ai_reply = await generate_reply(history, text_body)

    # ── check if AI returned a parseable order JSON ──
    order_data = extract_order_json(ai_reply)
    if order_data:
        logger.info("AI collected order data for session %s: %s", session_id, order_data)
        save_message(db, session_id, "ai", ai_reply, meta={"order_data": order_data})
    else:
        save_message(db, session_id, "ai", ai_reply)

    # ── send reply via WhatsApp ──
    clean_reply = ai_reply.replace("```json", "").replace("```", "").strip()
    if "CONFIRMED_ADDRESS" in clean_reply:
        clean_reply = "✅ Address confirmed! Your order is being processed."

    try:
        await send_text_message(phone, clean_reply)
    except Exception as exc:
        logger.error("Failed to send WA reply to %s: %s", phone, exc)

    return ai_reply


# ─────────────────────────────────────────────────────────────────────────────
# Outbound helpers  (called by order router hooks)
# ─────────────────────────────────────────────────────────────────────────────

async def notify_order_created(db: Session, phone: str, order_id: str, address_line: str = "") -> None:
    """Send order-created notification + ask for address confirmation."""
    session = get_or_create_session(db, phone)
    session_id = session["id"]

    body = (
        f"🛒 *Order Created* — `{order_id}`\n\n"
        f"Delivery address on file:\n_{address_line}_\n\n"
        "Please reply *YES* to confirm, or send your corrected address."
    )
    save_message(db, session_id, "system", body, meta={"order_id": order_id, "flow": "address_confirm"})
    try:
        await send_text_message(phone, body)
    except Exception as exc:
        logger.error("notify_order_created failed for %s: %s", phone, exc)


async def notify_order_shipped(db: Session, phone: str, order_id: str, awb: str) -> None:
    """Send dispatch notification."""
    session = get_or_create_session(db, phone)
    session_id = session["id"]

    body = (
        f"🚚 *Your order has been shipped!*\n\n"
        f"Order ID: `{order_id}`\n"
        f"AWB / Tracking: *{awb}*\n\n"
        "You can track your shipment with the AWB number. Reply here if you need help."
    )
    save_message(db, session_id, "system", body, meta={"order_id": order_id, "awb": awb})
    try:
        await send_text_message(phone, body)
    except Exception as exc:
        logger.error("notify_order_shipped failed for %s: %s", phone, exc)