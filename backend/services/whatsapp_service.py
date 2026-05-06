"""
services/whatsapp_service.py
────────────────────────────
Thin async wrapper around Meta WhatsApp Cloud API v20.
All tokens / IDs come from environment — never hardcoded.
"""

import os
import httpx
import logging
from typing import Optional

logger = logging.getLogger(__name__)

_WA_TOKEN    = os.getenv("WHATSAPP_ACCESS_TOKEN", "")
_WA_PHONE_ID = os.getenv("WHATSAPP_PHONE_ID", "")
_WA_VERSION  = os.getenv("WHATSAPP_API_VERSION", "v20.0")
_WA_BASE     = f"https://graph.facebook.com/{_WA_VERSION}/{_WA_PHONE_ID}/messages"

_HEADERS = {
    "Authorization": f"Bearer {_WA_TOKEN}",
    "Content-Type": "application/json",
}


def _check_credentials() -> bool:
    """Return True if credentials look present; log clearly if not."""
    if not _WA_TOKEN:
        logger.error("WHATSAPP_ACCESS_TOKEN is not set in environment.")
        return False
    if not _WA_PHONE_ID:
        logger.error("WHATSAPP_PHONE_ID is not set in environment.")
        return False
    return True


async def _post(payload: dict) -> dict:
    """
    Internal: POST to WA messages endpoint.
    Logs the full response body on any non-200 so you can see Meta's error code.
    """
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(_WA_BASE, json=payload, headers=_HEADERS)

        if resp.status_code != 200:
            # Always log the body — this is where Meta tells you exactly what's wrong
            logger.error(
                "WA API error %s for %s | body: %s",
                resp.status_code,
                _WA_BASE,
                resp.text,
            )
            resp.raise_for_status()   # still raise so callers know it failed

        data = resp.json()
        msg_id = data.get("messages", [{}])[0].get("id", "?")
        logger.info("WA message sent | phone_id=%s msg_id=%s", _WA_PHONE_ID, msg_id)
        return data


async def send_text_message(to: str, body: str, preview_url: bool = False) -> dict:
    """Send a plain-text WhatsApp message. Returns the API response JSON."""
    if not _check_credentials():
        return {"status": "skipped", "reason": "credentials_missing"}

    payload = {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": _normalise_phone(to),
        "type": "text",
        "text": {"preview_url": bool(preview_url), "body": body},
    }
    return await _post(payload)


async def send_template_message(
    to: str,
    template_name: str,
    language: str = "en_US",
    components: Optional[list] = None,
) -> dict:
    """
    Send a pre-approved WhatsApp template message.

    Example — order_confirmation template with 3 body params:
        await send_template_message(
            to="919311886444",
            template_name="order_confirmation",
            components=[{
                "type": "body",
                "parameters": [
                    {"type": "text", "text": customer_name},
                    {"type": "text", "text": order_id},
                    {"type": "text", "text": amount},
                ]
            }]
        )
    """
    if not _check_credentials():
        return {"status": "skipped", "reason": "credentials_missing"}

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
    return await _post(payload)


async def send_order_confirmation(
    to: str,
    customer_name: str,
    order_id: str,
    amount: str,
) -> dict:
    """
    Convenience wrapper for the 'order_confirmation' template.
    Matches the 3-parameter body you have approved on WhatsApp Manager.
    """
    return await send_template_message(
        to=to,
        template_name="order_confirmation",
        language="en_US",
        components=[{
            "type": "body",
            "parameters": [
                {"type": "text", "text": customer_name},
                {"type": "text", "text": order_id},
                {"type": "text", "text": amount},
            ],
        }],
    )


async def mark_message_read(wa_message_id: str) -> None:
    """Mark an incoming WA message as read (shows double-blue ticks)."""
    if not _check_credentials():
        return

    payload = {
        "messaging_product": "whatsapp",
        "status": "read",
        "message_id": wa_message_id,
    }
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            resp = await client.post(_WA_BASE, json=payload, headers=_HEADERS)
            if resp.status_code != 200:
                logger.warning("mark_message_read failed: %s", resp.text)
        except Exception as exc:
            logger.warning("mark_message_read exception: %s", exc)


# ─── helpers ──────────────────────────────────────────────────────────────────

def _normalise_phone(phone: str) -> str:
    """
    Strip leading + or spaces; WhatsApp expects E.164 without '+'.
    e.g. '+91 93118 86444' → '919311886444'
    """
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
            "phone":         msg["from"],
            "wa_message_id": msg["id"],
            "text":          msg["text"]["body"],
            "contact_name":  contact_name,
            "timestamp":     int(msg.get("timestamp", 0)),
        }
    except (KeyError, IndexError, TypeError):
        return None
async def send_image_message(to: str, image_url: str, caption: str = "") -> dict:
    """Send an image by URL via WhatsApp Cloud API."""
    if not _check_credentials():
        return {"status": "skipped", "reason": "credentials_missing"}
    payload = {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": _normalise_phone(to),
        "type": "image",
        "image": {"link": image_url, "caption": caption},
    }
    return await _post(payload)
