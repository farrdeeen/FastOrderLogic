"""
routers/chat.py
───────────────
REST endpoints consumed by the React frontend dashboard.

POST /chat/send                     — agent sends a manual message from dashboard
GET  /chat/conversations            — list all sessions (for sidebar)
GET  /chat/messages/{session_id}    — messages in a session (for chat window)
POST /chat/sessions/{session_id}/resolve  — mark session resolved
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
from services.whatsapp_service import send_text_message

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
            cs.phone_number       LIKE :search OR
            cs.wa_contact_name    LIKE :search OR
            cs.last_message       LIKE :search
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
            -- unread count: messages from 'user' with no subsequent 'ai' reply
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
    """Return messages for a session, newest-first (frontend reverses for display)."""
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
    """
    Dashboard agent manually sends a WhatsApp message to a customer.
    Saved as sender='ai' so it shows on the agent side.
    """
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

    # send WhatsApp in background
    background.add_task(_dispatch_wa, phone, msg)

    return {"success": True, "phone": phone}


async def _dispatch_wa(phone: str, msg: str):
    try:
        await send_text_message(phone, msg)
    except Exception:
        logger.exception("Failed to dispatch manual WA message to %s", phone)


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
    q = "SELECT COUNT(*) FROM chat_sessions"
    params = {}
    if status:
        q += " WHERE status = :status"
        params["status"] = status
    count = db.execute(text(q), params).scalar()
    return {"count": count}