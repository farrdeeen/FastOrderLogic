"""
routers/webhook.py
──────────────────
Meta WhatsApp Cloud API webhook endpoints.
GET  /webhook/whatsapp  — verification challenge
POST /webhook/whatsapp  — inbound messages & status updates
"""

import os
import logging
from fastapi import APIRouter, Request, Response, HTTPException, Depends, BackgroundTasks
from sqlalchemy.orm import Session
from database import SessionLocal
from services.whatsapp_service import extract_incoming_message, mark_message_read
from services.chat_service import handle_inbound_message

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/webhook", tags=["Webhook"])

_VERIFY_TOKEN = os.getenv("WHATSAPP_VERIFY_TOKEN", "")


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ─── Verification handshake (GET) ────────────────────────────────────────────

@router.get("/whatsapp")
async def verify_webhook(request: Request):
    """
    Meta calls this once when you register the webhook URL in the dashboard.
    It passes hub.mode, hub.challenge, hub.verify_token as query params.
    """
    params = dict(request.query_params)
    mode      = params.get("hub.mode")
    token     = params.get("hub.verify_token")
    challenge = params.get("hub.challenge")

    if mode == "subscribe" and token == _VERIFY_TOKEN:
        logger.info("WhatsApp webhook verified ✓")
        return Response(content=challenge, media_type="text/plain")

    logger.warning("Webhook verification failed — bad token or mode")
    raise HTTPException(status_code=403, detail="Verification failed")


# ─── Inbound messages (POST) ─────────────────────────────────────────────────

@router.post("/whatsapp")
async def receive_webhook(
    request: Request,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """
    Receives all WhatsApp events.
    We respond 200 immediately; heavy AI work runs in background.
    """
    body = await request.json()
    logger.debug("WA webhook payload: %s", body)

    incoming = extract_incoming_message(body)
    if not incoming:
        # status update or non-text — acknowledge and exit
        return {"status": "ok"}

    # mark message read (fire-and-forget)
    background.add_task(mark_message_read, incoming["wa_message_id"])

    # process in background so we return 200 to Meta immediately
    background.add_task(
        _process_inbound,
        incoming,
        db,
    )

    return {"status": "ok"}


async def _process_inbound(incoming: dict, db: Session):
    try:
        await handle_inbound_message(
            db=db,
            phone=incoming["phone"],
            text_body=incoming["text"],
            contact_name=incoming.get("contact_name", ""),
            wa_message_id=incoming["wa_message_id"],
        )
    except Exception:
        logger.exception("Error processing inbound WA message from %s", incoming.get("phone"))