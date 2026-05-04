"""
routers/chat_router.py
──────────────────────
Chat session management endpoints.
"""
import logging
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
    phone: str
    is_human: bool


@router.post("/toggle-human")
def toggle_human_mode(payload: HumanTogglePayload, db: Session = Depends(get_db)):
    """Switch a chat session between AI mode and Human mode."""
    from services.chat_service import normalize_phone
    phone = normalize_phone(payload.phone)

    row = db.execute(
        text("SELECT id FROM chat_sessions WHERE phone_number = :ph"),
        {"ph": phone},
    ).fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Session not found")

    # Add column if it doesn't exist yet (safe — idempotent)
    try:
        db.execute(text(
            "ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS "
            "is_human BOOLEAN NOT NULL DEFAULT FALSE"
        ))
        db.commit()
    except Exception:
        pass  # Column already exists

    db.execute(
        text("UPDATE chat_sessions SET is_human = :val, updated_at = NOW() WHERE phone_number = :ph"),
        {"val": payload.is_human, "ph": phone},
    )
    db.commit()

    logger.info("Human mode set to %s for phone=%s", payload.is_human, phone)
    return {
        "success": True,
        "phone": phone,
        "is_human": payload.is_human,
        "mode": "human" if payload.is_human else "ai",
    }


@router.get("/session/{phone}")
def get_session_info(phone: str, db: Session = Depends(get_db)):
    from services.chat_service import normalize_phone
    phone = normalize_phone(phone)
    row = db.execute(
        text("SELECT id, phone_number, status, is_human, last_message, last_message_at FROM chat_sessions WHERE phone_number = :ph"),
        {"ph": phone},
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Session not found")
    return dict(row._mapping)