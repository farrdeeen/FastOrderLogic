"""
services/whatsapp_service.py
────────────────────────────
Thin async wrapper around Meta WhatsApp Cloud API v19.
All tokens / IDs come from environment — never hardcoded.
"""

import os
import httpx
import logging
from typing import Optional

logger = logging.getLogger(__name__)

_WA_TOKEN    = os.getenv("WHATSAPP_ACCESS_TOKEN", "")
_WA_PHONE_ID = os.getenv("WHATSAPP_PHONE_ID", "")
_WA_VERSION  = os.getenv("WHATSAPP_API_VERSION", "v19.0")
_WA_BASE     = f"https://graph.facebook.com/{_WA_VERSION}/{_WA_PHONE_ID}/messages"

_HEADERS = {
    "Authorization": f"Bearer {_WA_TOKEN}",
    "Content-Type": "application/json",
}


async def send_text_message(to: str, body: str) -> dict:
    """Send a plain-text WhatsApp message.  Returns the API response JSON."""
    if not _WA_TOKEN or not _WA_PHONE_ID:
        logger.warning("WhatsApp credentials not configured — message not sent.")
        return {"status": "skipped", "reason": "credentials_missing"}

    payload = {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": _normalise_phone(to),
        "type": "text",
        "text": {"preview_url": False, "body": body},
    }

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(_WA_BASE, json=payload, headers=_HEADERS)
        resp.raise_for_status()
        data = resp.json()
        logger.info("WA sent to %s | msg_id=%s", to, data.get("messages", [{}])[0].get("id"))
        return data


async def send_template_message(to: str, template_name: str, language: str = "en_US",
                                 components: Optional[list] = None) -> dict:
    """Send a pre-approved WhatsApp template message."""
    payload = {
        "messaging_product": "whatsapp",
        "to": _normalise_phone(to),
        "type": "template",
        "template": {
            "name": template_name,
            "language": {"code": language},
            "components": components or [],
        },
    }
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(_WA_BASE, json=payload, headers=_HEADERS)
        resp.raise_for_status()
        return resp.json()


async def mark_message_read(wa_message_id: str) -> None:
    """Mark an incoming WA message as read (shows double-blue ticks)."""
    payload = {
        "messaging_product": "whatsapp",
        "status": "read",
        "message_id": wa_message_id,
    }
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            await client.post(_WA_BASE.replace("/messages", "/messages"), json=payload, headers=_HEADERS)
        except Exception:
            pass  # best-effort


# ─── helpers ──────────────────────────────────────────────────────────────────

def _normalise_phone(phone: str) -> str:
    """Strip leading + or spaces; WhatsApp expects E.164 without '+'."""
    return phone.strip().lstrip("+").replace(" ", "").replace("-", "")


def extract_incoming_message(webhook_body: dict) -> Optional[dict]:
    """
    Parse a WhatsApp Cloud API webhook payload.
    Returns a flat dict:
      { phone, wa_message_id, text, contact_name, timestamp }
    or None if the payload is a status update / not a text message.
    """
    try:
        entry   = webhook_body["entry"][0]
        changes = entry["changes"][0]
        value   = changes["value"]

        # status updates (delivered, read …) — ignore
        if "statuses" in value:
            return None

        messages = value.get("messages", [])
        if not messages:
            return None

        msg = messages[0]
        if msg.get("type") != "text":
            # could extend here for image / audio / interactive
            return None

        contacts = value.get("contacts", [{}])
        contact_name = contacts[0].get("profile", {}).get("name", "")

        return {
            "phone":          msg["from"],
            "wa_message_id":  msg["id"],
            "text":           msg["text"]["body"],
            "contact_name":   contact_name,
            "timestamp":      int(msg.get("timestamp", 0)),
        }
    except (KeyError, IndexError, TypeError):
        return None