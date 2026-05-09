"""
routers/chat_router.py
──────────────────────
Chat session management endpoints.
"""
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from sqlalchemy import text
from pydantic import BaseModel
from database import SessionLocal

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/chat", tags=["Chat"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class HumanTogglePayload(BaseModel):
    phone: Optional[str] = None
    session_id: Optional[int] = None
    is_human: bool


@router.post("/toggle-human")
def toggle_human_mode(payload: HumanTogglePayload, db: Session = Depends(get_db)):
    """Switch a chat session between AI mode and Human mode."""
    from services.chat_service import ensure_chat_session_columns, normalize_phone

    ensure_chat_session_columns(db)

    if payload.session_id:
        row = db.execute(
            text("SELECT id, phone_number FROM chat_sessions WHERE id = :sid"),
            {"sid": payload.session_id},
        ).fetchone()
    elif payload.phone:
        phone = normalize_phone(payload.phone)
        row = db.execute(
            text("""
                SELECT id, phone_number
                FROM chat_sessions
                WHERE phone_number = :ph
                ORDER BY updated_at DESC, id DESC
                LIMIT 1
            """),
            {"ph": phone},
        ).fetchone()
    else:
        raise HTTPException(status_code=400, detail="session_id or phone is required")

    if not row:
        raise HTTPException(status_code=404, detail="Session not found")

    db.execute(
        text("UPDATE chat_sessions SET is_human = :val, updated_at = NOW() WHERE id = :sid"),
        {"val": payload.is_human, "sid": row.id},
    )
    db.commit()

    logger.info("Human mode set to %s for session=%s", payload.is_human, row.id)
    return {
        "success": True,
        "session_id": row.id,
        "phone": row.phone_number,
        "is_human": payload.is_human,
        "mode": "human" if payload.is_human else "ai",
    }


@router.get("/session/{phone}")
def get_session_info(phone: str, db: Session = Depends(get_db)):
    from services.chat_service import ensure_chat_session_columns, normalize_phone
    ensure_chat_session_columns(db)
    phone = normalize_phone(phone)
    row = db.execute(
        text("""
            SELECT id, phone_number, status, flag, is_human, preferred_language, last_message, last_message_at
            FROM chat_sessions
            WHERE phone_number = :ph
        """),
        {"ph": phone},
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Session not found")
    return dict(row._mapping)
