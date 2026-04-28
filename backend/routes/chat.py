"""
routers/chat.py
───────────────
REST endpoints consumed by the React frontend dashboard.

POST /chat/send                          — agent sends a manual message
POST /chat/send-order-confirmation       — trigger order_confirmation template
GET  /chat/conversations                 — list all sessions (sidebar)
GET  /chat/messages/{session_id}         — messages in a session (chat window)
POST /chat/sessions/{session_id}/resolve — mark session resolved
GET  /chat/conversations/count           — total session count
"""

import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import text

from database import SessionLocal
from auth.clerk_auth import get_current_user as require_user
from services.chat_service import save_message, get_or_create_session
from services.whatsapp_service import send_text_message, send_order_confirmation

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chat", tags=["Chat"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ─── Pydantic models ─────────────────────────────────────────────────────────

class SendMessagePayload(BaseModel):
    session_id: int
    message: str


class OrderConfirmationPayload(BaseModel):
    """
    Trigger the 'order_confirmation' WhatsApp template for a customer.
    phone must be E.164 without '+', e.g. '919311886444'.
    """
    phone: str
    customer_name: str
    order_id: str
    amount: str                  # e.g. "₹999"
    session_id: Optional[int] = None   # if provided, message is saved to that session


# ─── GET /chat/conversations ─────────────────────────────────────────────────

@router.get("/conversations")
def list_conversations(
    _=Depends(require_user),
    search: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """Return paginated list of chat sessions with last-message preview."""
    conditions = ["1=1"]
    params: dict = {"lim": limit, "off": offset}

    if status:
        conditions.append("cs.status = :status")
        params["status"] = status

    if search:
        conditions.append("""(
            cs.phone_number    LIKE :search OR
            cs.wa_contact_name LIKE :search OR
            cs.last_message    LIKE :search
        )""")
        params["search"] = f"%{search}%"

    where = " AND ".join(conditions)

    rows = db.execute(text(f"""
        SELECT
            cs.id,
            cs.phone_number,
            cs.wa_contact_name,
            cs.last_message,
            cs.last_message_at,
            cs.status,
            cs.created_at,
            cs.updated_at,
            (
                SELECT COUNT(*) FROM chat_messages cm
                WHERE cm.session_id = cs.id AND cm.sender = 'user'
                  AND cm.timestamp > COALESCE((
                      SELECT MAX(cm2.timestamp) FROM chat_messages cm2
                      WHERE cm2.session_id = cs.id AND cm2.sender IN ('ai','system')
                  ), '2000-01-01')
            ) AS unread_count
        FROM chat_sessions cs
        WHERE {where}
        ORDER BY cs.updated_at DESC
        LIMIT :lim OFFSET :off
    """), params).fetchall()

    return [dict(r._mapping) for r in rows]


# ─── GET /chat/messages/{session_id} ─────────────────────────────────────────

@router.get("/messages/{session_id}")
def get_messages(
    session_id: int,
    _=Depends(require_user),
    limit: int = Query(100, ge=1, le=500),
    before_id: Optional[int] = Query(None, description="Cursor for pagination"),
    db: Session = Depends(get_db),
):
    """Return messages for a session, oldest-first."""
    params: dict = {"sid": session_id, "lim": limit}
    cursor_clause = ""
    if before_id:
        cursor_clause = "AND cm.id < :before_id"
        params["before_id"] = before_id

    rows = db.execute(text(f"""
        SELECT cm.id, cm.session_id, cm.wa_message_id, cm.sender,
               cm.message, cm.meta, cm.status, cm.timestamp
        FROM chat_messages cm
        WHERE cm.session_id = :sid {cursor_clause}
        ORDER BY cm.timestamp ASC
        LIMIT :lim
    """), params).fetchall()

    return [dict(r._mapping) for r in rows]


# ─── POST /chat/send ─────────────────────────────────────────────────────────

@router.post("/send")
async def send_message(
    payload: SendMessagePayload,
    background: BackgroundTasks,
    _=Depends(require_user),
    db: Session = Depends(get_db),
):
    """Dashboard agent manually sends a WhatsApp message to a customer."""
    session = db.execute(
        text("SELECT * FROM chat_sessions WHERE id = :sid"),
        {"sid": payload.session_id},
    ).fetchone()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    phone = session.phone_number
    msg   = payload.message.strip()
    if not msg:
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    save_message(db, payload.session_id, "ai", msg)

    # Dispatch WhatsApp in background so the dashboard doesn't block
    background.add_task(_dispatch_wa, phone, msg)

    return {"success": True, "phone": phone}


async def _dispatch_wa(phone: str, msg: str) -> None:
    try:
        await send_text_message(phone, msg)
    except Exception:
        logger.exception("Failed to dispatch manual WA message to %s", phone)


# ─── POST /chat/send-order-confirmation ──────────────────────────────────────

@router.post("/send-order-confirmation")
async def send_order_confirmation_endpoint(
    payload: OrderConfirmationPayload,
    background: BackgroundTasks,
    _=Depends(require_user),
    db: Session = Depends(get_db),
):
    """
    Send the 'order_confirmation' WhatsApp template to a customer.
    Can be called from the order management UI after an order is placed.

    Example request body:
    {
        "phone": "919311886444",
        "customer_name": "Ashfaq",
        "order_id": "ORD-1001",
        "amount": "₹999",
        "session_id": 12          ← optional
    }
    """
    # If a session_id is provided, log the template send in chat history
    if payload.session_id:
        session = db.execute(
            text("SELECT id FROM chat_sessions WHERE id = :sid"),
            {"sid": payload.session_id},
        ).fetchone()
        if session:
            save_message(
                db, payload.session_id, "system",
                f"[template:order_confirmation] {payload.customer_name} / {payload.order_id} / {payload.amount}",
                meta={
                    "flow": "order_confirmation_template",
                    "order_id": payload.order_id,
                },
            )

    background.add_task(
        _dispatch_order_confirmation,
        payload.phone,
        payload.customer_name,
        payload.order_id,
        payload.amount,
    )

    return {"success": True, "phone": payload.phone, "order_id": payload.order_id}


async def _dispatch_order_confirmation(
    phone: str, customer_name: str, order_id: str, amount: str
) -> None:
    try:
        await send_order_confirmation(
            to=phone,
            customer_name=customer_name,
            order_id=order_id,
            amount=amount,
        )
        logger.info("order_confirmation template sent to %s for %s", phone, order_id)
    except Exception:
        logger.exception("Failed to send order_confirmation template to %s", phone)


# ─── POST /chat/sessions/{session_id}/resolve ────────────────────────────────

@router.post("/sessions/{session_id}/resolve")
def resolve_session(
    session_id: int,
    _=Depends(require_user),
    db: Session = Depends(get_db),
):
    db.execute(
        text("UPDATE chat_sessions SET status = 'resolved', updated_at = :now WHERE id = :sid"),
        {"now": datetime.now(), "sid": session_id},
    )
    db.commit()
    return {"success": True, "session_id": session_id, "status": "resolved"}


# ─── GET /chat/conversations/count ───────────────────────────────────────────

@router.get("/conversations/count")
def count_conversations(
    _=Depends(require_user),
    status: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    q      = "SELECT COUNT(*) FROM chat_sessions"
    params = {}
    if status:
        q += " WHERE status = :status"
        params["status"] = status
    count = db.execute(text(q), params).scalar()
    return {"count": count}