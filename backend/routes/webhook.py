"""
routers/webhook.py
──────────────────
Meta WhatsApp Cloud API webhook endpoints.

GET  /webhook/whatsapp  — verification challenge (Meta calls once on registration)
POST /webhook/whatsapp  — inbound messages & status updates

⚠️  IMPORTANT — DB session lifetime:
    FastAPI BackgroundTasks run AFTER the response is sent, but the `db` session
    injected via Depends() is closed as soon as the response goes out.
    We therefore open a *fresh* DB session inside _process_inbound so the
    background work doesn't touch a closed session.
"""

import os
import logging
from fastapi import APIRouter, Request, Response, HTTPException, Depends, BackgroundTasks
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import Optional

from database import SessionLocal
from services.whatsapp_service import extract_incoming_message, mark_message_read
from services.chat_service import handle_inbound_message, save_message

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/webhook", tags=["Webhook"])

_VERIFY_TOKEN = os.getenv("WHATSAPP_VERIFY_TOKEN", "")


# ─── Verification handshake (GET) ────────────────────────────────────────────

@router.get("/whatsapp")
async def verify_webhook(request: Request):
    """
    Meta calls this once when you register (or update) the webhook URL.
    Must respond with hub.challenge as plain text within a few seconds.
    """
    params    = dict(request.query_params)
    mode      = params.get("hub.mode")
    token     = params.get("hub.verify_token")
    challenge = params.get("hub.challenge")

    logger.info("Webhook verification attempt | mode=%s token_match=%s", mode, token == _VERIFY_TOKEN)

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
):
    """
    Receives all WhatsApp events.
    We MUST return 200 to Meta within ~5 s or it will retry.
    All heavy work (AI, DB writes) runs in a background task with its own DB session.
    """
    try:
        body = await request.json()
    except Exception:
        # Malformed body — still return 200 so Meta doesn't retry forever
        logger.warning("Webhook received non-JSON body")
        return {"status": "ok"}

    logger.debug("WA webhook payload: %s", body)

    incoming = extract_incoming_message(body)
 
    # Text message
    if incoming:
        background.add_task(mark_message_read, incoming["wa_message_id"])
        background.add_task(_process_inbound, incoming)
        return {"status": "ok"}

    # Media message (image / PDF)
    media = extract_incoming_media(body)
    if media:
        background.add_task(mark_message_read, media["wa_message_id"])
        background.add_task(_process_inbound_media, media)
        return {"status": "ok"}

    statuses = extract_status_updates(body)
    if statuses:
        background.add_task(_process_status_updates, statuses)

    return {"status": "ok"}



async def _process_inbound(incoming: dict):
    """
    Background task — opens its own DB session so it isn't affected
    by the request-scoped session being closed after the 200 response.
    """
    db = SessionLocal()
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
    finally:
        db.close()

async def _process_inbound_media(media: dict):
    from services.chat_service import handle_inbound_media
    db = SessionLocal()
    try:
        await handle_inbound_media(
            db=db,
            phone=media["phone"],
            media_url=media["media_url"],
            media_type=media["media_type"],
            contact_name=media.get("contact_name", ""),
            wa_message_id=media["wa_message_id"],
        )
    except Exception:
        logger.exception("Error processing media from %s", media.get("phone"))
    finally:
        db.close()


def extract_status_updates(webhook_body: dict) -> list[dict]:
    """Extract WhatsApp delivery/read/failed statuses from Meta webhook payloads."""
    try:
        value = webhook_body["entry"][0]["changes"][0]["value"]
        statuses = value.get("statuses") or []
        updates = []
        for status in statuses:
            message_id = status.get("id")
            status_name = status.get("status")
            if not message_id or not status_name:
                continue
            errors = status.get("errors") or []
            updates.append({
                "id": message_id,
                "status": status_name,
                "timestamp": status.get("timestamp"),
                "recipient_id": status.get("recipient_id"),
                "conversation": status.get("conversation"),
                "pricing": status.get("pricing"),
                "errors": errors,
            })
        return updates
    except (KeyError, IndexError, TypeError):
        return []


async def _process_status_updates(statuses: list[dict]):
    db = SessionLocal()
    try:
        for status in statuses:
            message_id = status["id"]
            status_name = status["status"]
            row = db.execute(
                text("""
                    SELECT id, session_id, message, meta
                    FROM chat_messages
                    WHERE wa_message_id = :wid
                    LIMIT 1
                """),
                {"wid": message_id},
            ).fetchone()

            result = db.execute(
                text("UPDATE chat_messages SET status = :status WHERE wa_message_id = :wid"),
                {"status": status_name, "wid": message_id},
            )
            db.commit()

            if result.rowcount:
                logger.info("WA status update %s for message %s", status_name, message_id)
            else:
                logger.debug("WA status update for unknown message %s: %s", message_id, status_name)

            errors = status.get("errors") or []
            if errors:
                logger.warning("WA delivery failure for %s: %s", message_id, errors)
                if row:
                    first_error = errors[0] if isinstance(errors[0], dict) else {}
                    error_text = (
                        first_error.get("message")
                        or first_error.get("title")
                        or first_error.get("details")
                        or str(errors[0])
                    )
                    save_message(
                        db,
                        row.session_id,
                        "system",
                        f"[wa_delivery_failed] {status_name}: {error_text}",
                        meta={
                            "flow": "wa_delivery_failed",
                            "wa_message_id": message_id,
                            "status": status_name,
                            "errors": errors,
                        },
                    )
    except Exception:
        logger.exception("Error processing WA status updates")
    finally:
        db.close()

def extract_incoming_media(webhook_body: dict) -> Optional[dict]:
    """
    Extract media (image/document) from a WhatsApp webhook payload.
    Returns dict with phone, wa_message_id, media_url, media_type, contact_name
    or None if not a media message.
    """
    try:
        value    = webhook_body["entry"][0]["changes"][0]["value"]
        messages = value.get("messages", [])
        if not messages:
            return None
        msg      = messages[0]
        msg_type = msg.get("type", "")
        if msg_type not in ("image", "document", "audio"):
            return None
        media_obj  = msg.get(msg_type) or {}
        media_url  = media_obj.get("url") or media_obj.get("link") or ""
        media_mime = media_obj.get("mime_type") or msg_type
        contacts   = value.get("contacts", [{}])
        return {
            "phone":        msg["from"],
            "wa_message_id": msg["id"],
            "media_url":    media_url,
            "media_type":   media_mime,
            "contact_name": contacts[0].get("profile", {}).get("name", ""),
            "timestamp":    int(msg.get("timestamp", 0)),
        }
    except (KeyError, IndexError, TypeError):
        return None
