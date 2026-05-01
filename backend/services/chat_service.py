"""
services/chat_service.py
────────────────────────
Orchestrates: DB session/message management, AI calls, WhatsApp dispatch.
Order placement delegates entirely to ai_order_service.place_ai_order
— no duplicate DB logic here.
"""

import re
import logging
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session
from sqlalchemy import text

from services.ai_service import (
    generate_reply,
    generate_product_reply,
    get_order_status_text,
    extract_order_json,
    is_address_confirmed,
)
from services.whatsapp_service import (
    send_text_message,
    send_order_confirmation,
    send_template_message,
)
from services.ai_order_service import (
    place_ai_order,
    build_order_confirmation_message,
)

logger = logging.getLogger(__name__)

_TEMPLATE_ORDER_CONFIRMED = "order_confirmation"
_TEMPLATE_PAYMENT_PENDING = "payment_pending"

def normalize_phone(phone: str) -> str:
    """
    Ensure phone is in E.164 format for WhatsApp.
    Default country: India (+91)
    """
    if not phone:
        return ""
    # remove spaces, +, -, etc
    digits = re.sub(r"\D", "", phone)
    # Already correct (91XXXXXXXXXX)
    if digits.startswith("91") and len(digits) == 12:
        return digits
    # Local 10 digit → add 91
    if len(digits) == 10:
        return "91" + digits
    # Fallback: return as-is (but log it)
    logger.warning("Phone normalization fallback used: %s", phone)
    return digits

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


def save_message(
    db: Session,
    session_id: int,
    sender: str,
    message: str,
    wa_message_id: Optional[str] = None,
    meta: Optional[dict] = None,
) -> int:
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
    for r in reversed(rows):
        role = "user" if r.sender == "user" else "assistant"
        history.append({"role": role, "content": r.message})
    return history


# ─────────────────────────────────────────────────────────────────────────────
# Inbound message handler
# ─────────────────────────────────────────────────────────────────────────────

async def handle_inbound_message(
    db: Session,
    phone: str,
    text_body: str,
    contact_name: str = "",
    wa_message_id: Optional[str] = None,
) -> str:
    phone = normalize_phone(phone)   # 🔥 ADD THIS
    session = get_or_create_session(db, phone)
    session_id = session["id"]

    # Dedup
    if wa_message_id:
        existing = db.execute(
            text("SELECT id FROM chat_messages WHERE wa_message_id = :wid"),
            {"wid": wa_message_id},
        ).fetchone()
        if existing:
            logger.info("Duplicate WA message %s — skipping", wa_message_id)
            return ""

    save_message(db, session_id, "user", text_body, wa_message_id=wa_message_id)

    # ── Order-status shortcut (supports WIX#, ORD-, AI- formats) ─────────────
    order_id_match = re.search(
        r"\b(\d{5}#\d{5}|WIX#\d+|ORD-\d+|AI-\d{5})\b",
        text_body,
        re.IGNORECASE,
    )
    if order_id_match:
        order_id    = order_id_match.group(1)
        status_text = get_order_status_text(order_id, db)
        if status_text:
            save_message(db, session_id, "ai", status_text)
            try:
                await send_text_message(phone, status_text)
            except Exception as exc:
                logger.error("Failed to send order status to %s: %s", phone, exc)
            return status_text

    # ── Product catalogue shortcut ────────────────────────────────────────────
    product_reply = await generate_product_reply(text_body)
    if product_reply:
        save_message(db, session_id, "ai", product_reply)
        try:
            await send_text_message(phone, product_reply)
        except Exception as exc:
            logger.error("Failed to send product reply to %s: %s", phone, exc)
        return product_reply

    # ── AI reply ──────────────────────────────────────────────────────────────
    history = get_conversation_history(db, session_id, limit=18)
    # Drop last entry if it's the user message we just saved
    if history and history[-1]["role"] == "user":
        history = history[:-1]

    ai_reply = await generate_reply(history, text_body)

    # ── Order JSON detected → place order via ai_order_service ───────────────
    order_data = extract_order_json(ai_reply)
    if order_data:
        logger.info("AI collected order data for session %s: %s", session_id, order_data)

        # Fill mobile from caller's phone if AI didn't capture it
        if not order_data.get("mobile"):
            order_data["mobile"] = re.sub(r"\D", "", phone)[-10:]

        result        = place_ai_order(order_data, db)
        customer_name = order_data.get("name", "Customer")
        confirm_msg   = build_order_confirmation_message(result, customer_name)

        save_message(
            db, session_id, "ai", ai_reply,
            meta={
                "order_data":       order_data,
                "created_order_id": result.get("order_id"),
                "order_success":    result.get("success"),
            },
        )
        save_message(
            db, session_id, "system", confirm_msg,
            meta={"order_id": result.get("order_id"), "flow": "ai_order_placed"},
        )

        try:
            await send_text_message(phone, confirm_msg)
        except Exception as exc:
            logger.error("Failed to send order confirmation to %s: %s", phone, exc)

        return ai_reply

    # ── Normal reply ──────────────────────────────────────────────────────────
    save_message(db, session_id, "ai", ai_reply)

    clean_reply = ai_reply.strip()
    if "CONFIRMED_ADDRESS" in clean_reply:
        clean_reply = "✅ Address confirmed! Your order is being processed."

    try:
        await send_text_message(phone, clean_reply)
    except Exception as exc:
        logger.error("Failed to send WA reply to %s: %s", phone, exc)

    return ai_reply


# ─────────────────────────────────────────────────────────────────────────────
# Outbound notification helpers
# ─────────────────────────────────────────────────────────────────────────────

async def notify_order_created(
    db: Session,
    phone: str,
    order_id: str,
    customer_name: str = "",
    amount: str = "",
    address_line: str = "",
    payment_status: str = "pending",
) -> None:
    session    = get_or_create_session(db, phone)
    session_id = session["id"]
    is_paid    = payment_status.lower() in ("paid", "success", "accepted")

    if is_paid:
        try:
            await send_order_confirmation(
                to=phone,
                customer_name=customer_name or "Customer",
                order_id=order_id,
                amount=amount or "—",
            )
            save_message(
                db, session_id, "system",
                f"[template:order_confirmation] {customer_name} / {order_id} / {amount}",
                meta={"order_id": order_id, "flow": "order_confirmation_template", "payment": "paid"},
            )
        except Exception as exc:
            logger.error("order_confirmation template failed for %s: %s", phone, exc)

        if address_line:
            body = (
                f"📦 Delivery address on file:\n{address_line}\n\n"
                "Reply *YES* to confirm, or send your corrected address."
            )
            save_message(db, session_id, "system", body,
                         meta={"order_id": order_id, "flow": "address_confirm"})
            try:
                await send_text_message(phone, body)
            except Exception as exc:
                logger.error("Address nudge failed for %s: %s", phone, exc)
    else:
        try:
            await send_template_message(
                to=normalize_phone(phone),
                template_name=_TEMPLATE_PAYMENT_PENDING,
                language="en",
                components=[{
                    "type": "body",
                    "parameters": [
                        {"type": "text", "text": customer_name or "Customer"},  # {{1}}
                        {"type": "text", "text": order_id},                     # {{2}}
                        {"type": "text", "text": "your order"},                 # {{3}} ✅ ADD THIS
                        {"type": "text", "text": amount or "—"},                # {{4}}
                    ],
                }],
            )
            save_message(
                db, session_id, "system",
                f"[template:payment_pending] {customer_name} / {order_id} / {amount}",
                meta={"order_id": order_id, "flow": "payment_pending_template", "payment": "pending"},
            )
        except Exception as exc:
            logger.error("payment_pending template failed for %s: %s", phone, exc)


async def notify_order_shipped(db: Session, phone: str, order_id: str, awb: str) -> None:
    session    = get_or_create_session(db, phone)
    session_id = session["id"]

    body = (
        f"🚚 *Your order has been shipped!*\n\n"
        f"Order ID: `{order_id}`\n"
        f"AWB / Tracking: *{awb}*\n\n"
        "Track your shipment with the AWB number above. Reply here if you need help."
    )
    save_message(db, session_id, "system", body, meta={"order_id": order_id, "awb": awb})
    try:
        await send_text_message(phone, body)
    except Exception as exc:
        logger.error("notify_order_shipped failed for %s: %s", phone, exc)