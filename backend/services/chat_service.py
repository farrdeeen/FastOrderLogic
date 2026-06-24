"""
services/chat_service.py
────────────────────────
Orchestrates: DB session/message management, AI calls, WhatsApp dispatch.
Order placement delegates entirely to ai_order_service.place_ai_order.

Routing uses LLM-based classify_intent — no hardcoded keyword checks.
"""

import re
import logging
from datetime import datetime
from typing import Optional
import asyncio
import os

from sqlalchemy.orm import Session
from sqlalchemy import text

from services.ai_service import (
    classify_intent,
    is_order_management_intent,
    is_product_intent,
    is_service_intent,
    generate_reply,
    get_last_ai_failure_context,
    generate_product_reply,
    extract_order_json,
    is_address_confirmed,
    analyze_media,
)
from services.whatsapp_service import (
    download_media_bytes,
    get_media_url,
    send_text_message,
    send_order_confirmation,
    send_template_message,
    send_image_message,
)
from services.order_preferences import order_allows_whatsapp
from services.chat_media_service import save_media_bytes
from services.payment_service import (
    PaymentLinkError,
    build_payment_qr_url,
    build_payment_template_button_value,
    create_payment_qr_details,
    create_payment_link_details,
)
from services.ai_order_service import (
    place_ai_order,
    build_order_confirmation_message,
)
from services.order_status_service import (
    build_status_reply_for_order_id,
    build_status_reply_for_phone,
)

logger = logging.getLogger(__name__)

_TEMPLATE_ORDER_CONFIRMED = "order_confirmation"
_TEMPLATE_PAYMENT_PENDING = "payment_pending"
_RAZORPAY_BASE = os.getenv("RAZORPAY_BASE_URL", "https://rzp.io/l")
# Delay (seconds) before sending the pay-link text + QR image, AFTER the order
# confirmation + payment_pending template — avoids bombarding the customer.
_PAYMENT_ASSETS_DELAY = int(os.getenv("PAYMENT_LINK_DELAY_SECONDS", "600"))

# Debounce window (seconds) to batch a customer's rapid consecutive messages so the
# AI reads them together. Tracks the latest wa_message_id per session.
_INBOUND_DEBOUNCE = float(os.getenv("INBOUND_DEBOUNCE_SECONDS", "6"))
_INBOUND_LATEST: dict[int, str] = {}


def _emit_typing(session_id: int) -> None:
    """Broadcast an 'AI is typing' hint to the dashboard while the AI composes."""
    try:
        from routes.chat import notify_chat_change
        notify_chat_change(session_id, "ai_typing")
    except Exception:
        pass


def _collect_unanswered_user_text(db: Session, session_id: int) -> str:
    """Concatenate all customer messages received since our last AI/system reply —
    i.e. the current burst — so the AI answers them as one."""
    rows = db.execute(
        text("""
            SELECT message FROM chat_messages
            WHERE session_id = :s AND sender = 'user'
              AND timestamp > COALESCE(
                  (SELECT MAX(timestamp) FROM chat_messages
                   WHERE session_id = :s AND sender IN ('ai','system')), '2000-01-01')
            ORDER BY timestamp ASC
        """),
        {"s": session_id},
    ).fetchall()
    parts = [
        r[0] for r in rows
        if r[0] and not r[0].startswith("[media") and not r[0].startswith("[image")
    ]
    return "\n".join(parts).strip()
# Flat delivery charge shown to the customer — mirrors products.delivery_cost,
# which the order flow actually charges (currently a uniform ₹90 across products).
_DELIVERY_CHARGE = os.getenv("AI_DELIVERY_CHARGE", "90")
_CHAT_SESSION_COLUMNS_READY = False


def _wa_message_id(response: Optional[dict]) -> Optional[str]:
    try:
        return (response or {}).get("messages", [{}])[0].get("id")
    except (IndexError, AttributeError, TypeError):
        return None


def parse_amount(amount):
    if not amount:
        return 0.0
    clean = re.sub(r"[^\d.]", "", str(amount))
    try:
        return float(clean)
    except Exception:
        return 0.0


def normalize_local_phone(phone: str) -> str:
    if not phone:
        return ""
    digits = re.sub(r"\D", "", str(phone)).lstrip("0")
    if digits.startswith("91") and len(digits) > 10:
        digits = digits[-10:]
    elif len(digits) > 10:
        digits = digits[-10:]
    if len(digits) == 10:
        return digits
    logger.warning("Local phone normalization fallback used: %s", phone)
    return digits


def normalize_phone(phone: str) -> str:
    local_phone = normalize_local_phone(phone)
    if not local_phone:
        return ""
    if len(local_phone) == 10:
        return "91" + local_phone
    return local_phone


def ensure_chat_session_columns(db: Session) -> None:
    global _CHAT_SESSION_COLUMNS_READY
    if _CHAT_SESSION_COLUMNS_READY:
        return
    try:
        rows = db.execute(text("SHOW COLUMNS FROM chat_sessions")).fetchall()
        existing = {row[0] for row in rows}
    except Exception as exc:
        logger.debug("Could not inspect chat_sessions columns: %s", exc)
        existing = set()

    columns = {
        "is_human": "BOOLEAN NOT NULL DEFAULT FALSE",
        "flag": "VARCHAR(20) NULL",
        "preferred_language": "VARCHAR(10) NULL",
        "last_followup_at": "DATETIME NULL",
    }
    for name, definition in columns.items():
        if name in existing:
            continue
        try:
            db.execute(text(f"ALTER TABLE chat_sessions ADD COLUMN {name} {definition}"))
            db.commit()
        except Exception as exc:
            logger.debug("Optional chat_sessions migration skipped for %s: %s", name, exc)
            db.rollback()
    _CHAT_SESSION_COLUMNS_READY = True


# Supported languages for the WhatsApp agent (code -> display name).
SUPPORTED_LANGUAGES = {
    "en": "English", "hi": "Hindi", "bn": "Bangla", "or": "Odia",
    "ta": "Tamil", "pa": "Punjabi", "as": "Assamese",
}

# Numbered menu shown to the customer on first contact.
_LANGUAGE_MENU = [
    ("en", "English"),
    ("hi", "हिंदी (Hindi)"),
    ("bn", "বাংলা (Bangla)"),
    ("or", "ଓଡ଼ିଆ (Odia)"),
    ("ta", "தமிழ் (Tamil)"),
    ("pa", "ਪੰਜਾਬੀ (Punjabi)"),
    ("as", "অসমীয়া (Assamese)"),
]

# Number / word -> language code.
_LANGUAGE_CHOICE_WORDS = {
    "1": "en", "english": "en", "eng": "en", "en": "en",
    "2": "hi", "hindi": "hi", "hin": "hi", "हिंदी": "hi", "हिन्दी": "hi",
    "3": "bn", "bangla": "bn", "bengali": "bn", "বাংলা": "bn",
    "4": "or", "odia": "or", "oriya": "or", "ଓଡ଼ିଆ": "or",
    "5": "ta", "tamil": "ta", "தமிழ்": "ta",
    "6": "pa", "punjabi": "pa", "panjabi": "pa", "ਪੰਜਾਬੀ": "pa",
    "7": "as", "assamese": "as", "অসমীয়া": "as",
}


def _detect_language_choice(message: str) -> Optional[str]:
    compact = re.sub(r"\s+", " ", (message or "").strip().lower())
    return _LANGUAGE_CHOICE_WORDS.get(compact)

def _looks_like_greeting(message: str) -> bool:
    compact = re.sub(r"[\s!.?,]+", " ", (message or "").strip().lower()).strip()
    greetings = {
        "hi", "hello", "hey", "hii", "hiii", "namaste", "नमस्ते",
        "good morning", "good afternoon", "good evening", "kaise ho",
    }
    return compact in greetings


def _history_asked_for_order_id(history: list[dict]) -> bool:
    for turn in history[-3:]:
        content = (turn.get("content") or "").lower()
        if "order id" in content or "order id" in content.replace("-", " "):
            return True
    return False


# Phrases the AI uses when it is asking for a specific PERSONAL detail. If the
# last AI message was one of these, the customer's next message is the answer to
# that field (a name/number/address/"haan") — NOT a product request — so we must
# not re-route it to product browse or order status. Note: product-choice
# questions ("kaunsa device?") are deliberately NOT here, so naming a product
# still shows its photo + link.
_PERSONAL_FIELD_MARKERS = (
    "naam kya", "your name", "full name", "naam bata", "naam bataye",
    "mobile number", "mobile kya", "phone number", "contact number",
    "address", "pincode", "pin code", "aapka city", "aapka state",
    "ye sahi hai", "yeh sahi hai", "sahi hai", "confirm", "order summary",
    "house/flat",
)


def _looks_like_address_block(message: str) -> bool:
    """True when the message is a name/address/mobile block (often pasted at once)
    — must go to order collection, NOT product browse."""
    t = (message or "").lower()
    if not re.search(r"\b\d{6}\b", t):   # needs a 6-digit pincode
        return False
    keys = ("address", "village", "gaon", "post", "district", "tehsil", "pin", "pincode",
            "mohalla", "near", "mobile", "father", "name", "ganj", "pur", "nagar", "colony", "street")
    hits = sum(1 for k in keys if k in t)
    return hits >= 2 or t.count("\n") >= 3


_AFFIRMATIVE = {
    "haan", "han", "ha", "ji", "ji haan", "haan ji", "yes", "y", "ya", "yep", "yeah",
    "ok", "okay", "sahi", "sahi hai", "theek", "thik", "bilkul", "confirm", "correct",
    "right", "हाँ", "हां", "हा", "जी",
}


def _is_affirmative(message: str) -> bool:
    t = re.sub(r"[^a-zऀ-ॿ ]", "", (message or "").lower()).strip()
    if not t:
        return False
    if t in _AFFIRMATIVE:
        return True
    toks = t.split()
    return any(w in toks for w in ("haan", "yes", "confirm", "bilkul", "sahi", "ok", "okay", "theek", "bhejo", "bhej"))


def _looks_confirmation(message: str) -> bool:
    """Broader than _is_affirmative — also catches 'address confirmed', 'yes correct',
    'confirmed', 'done' etc. used when replying to a template/confirm prompt."""
    t = (message or "").lower()
    if _is_affirmative(message):
        return True
    return any(w in t for w in ("confirm", "correct", "address", "right", "done", "sahi", "thik", "theek"))


def _template_reply_context(db: Session, session_id: int) -> Optional[str]:
    """If the customer is replying inside a recently-sent template/confirmation
    context, return 'confirmed_dispatch' (order/address confirmation already done →
    reassure that dispatch is coming) or 'payment_pending' (nudge to pay). Returns
    None if the recent context is a normal chat. Scans the last few outbound turns
    because a system note (e.g. payment_received) may sit between the template and
    the customer's reply."""
    import json as _json
    rows = db.execute(
        text("SELECT meta FROM chat_messages WHERE session_id=:s AND sender IN ('ai','system') "
             "ORDER BY timestamp DESC LIMIT 5"),
        {"s": session_id},
    ).fetchall()
    for row in rows:
        if not row[0]:
            continue
        try:
            meta = _json.loads(row[0]) if isinstance(row[0], str) else row[0]
        except Exception:
            continue
        flow = (meta.get("flow") or "") if isinstance(meta, dict) else ""
        if flow in ("order_confirmation_template", "address_confirm", "payment_received", "order_confirmation"):
            return "confirmed_dispatch"
        if flow in ("payment_pending_template", "payment_link", "payment_qr"):
            return "payment_pending"
        # A fresh product card / model-confirm means the context has moved on.
        if flow in ("product_confirm", "product_confirm_share", "product_image", "order_cta"):
            return None
    return None


_SUPPORT_HINTS = (
    "rd service", "rd serive", "rd registration", "driver", "install", "setup", "set up",
    "activation", "activate", "configure", "configuration", "management client", "how to use",
    "kaise use", "kaise chalau", "kaise install", "not registering", "rd app",
)


def _is_support_query(message: str) -> bool:
    """Driver/RD-service/installation help — the AI should ANSWER from the training
    doc (not show a product card, not escalate)."""
    return any(h in (message or "").lower() for h in _SUPPORT_HINTS)


def _asks_for_media(message: str) -> bool:
    t = (message or "").lower()
    return any(w in t for w in ("photo", "foto", "pic", "image", "picture", "dikha", "dekh", "bhej", "send", "share"))


def _pending_product_confirm(db: Session, session_id: int) -> Optional[dict]:
    """If the last AI message asked the customer to confirm a model, return its sku/name."""
    import json as _json
    row = db.execute(
        text("SELECT meta FROM chat_messages WHERE session_id = :sid AND sender IN ('ai','system') ORDER BY timestamp DESC LIMIT 1"),
        {"sid": session_id},
    ).first()
    if not row or not row[0]:
        return None
    try:
        meta = _json.loads(row[0]) if isinstance(row[0], str) else row[0]
    except Exception:
        return None
    if isinstance(meta, dict) and meta.get("flow") == "product_confirm" and meta.get("sku"):
        return {"sku": meta.get("sku"), "product": meta.get("product", "")}
    return None


def _awaiting_personal_field(history: list[dict]) -> bool:
    """True when the last substantive AI turn asked for a personal order field."""
    for turn in reversed(history):
        if turn.get("role") != "assistant":
            continue
        content = (turn.get("content") or "").strip().lower()
        if not content:
            continue
        # Skip image stubs and product cards — they are not field prompts.
        if content.startswith("[image]") or "product photo" in content or "🔗" in content:
            return False
        return any(marker in content for marker in _PERSONAL_FIELD_MARKERS)
    return False


def _extract_order_id_candidate(message: str, history: list[dict]) -> Optional[str]:
    match = re.search(
        r"\b(\d{5}#\d{5}|WIX#\d+|ORD-\d+|AI-\d{5})\b",
        message or "",
        re.IGNORECASE,
    )
    if match:
        return match.group(1)
    if _history_asked_for_order_id(history):
        raw_match = re.search(r"\b(\d{4,8})\b", message or "")
        if raw_match:
            return raw_match.group(1)
    return None


def _infer_language(message: str, fallback: str = "en") -> str:
    text_value = message or ""
    if re.search(r"[\u0980-\u09FF]", text_value):   # Bengali / Assamese script
        return "bn"
    if re.search(r"[\u0A00-\u0A7F]", text_value):   # Gurmukhi (Punjabi)
        return "pa"
    if re.search(r"[\u0B00-\u0B7F]", text_value):   # Odia
        return "or"
    if re.search(r"[\u0B80-\u0BFF]", text_value):   # Tamil
        return "ta"
    if re.search(r"[\u0900-\u097F]", text_value):   # Devanagari (Hindi)
        return "hi"
    return fallback or "en"


def _language_prompt() -> str:
    lines = ["Hello! Please choose your language / \u0905\u092a\u0928\u0940 \u092d\u093e\u0937\u093e \u091a\u0941\u0928\u0947\u0902:", ""]
    for idx, (_code, label) in enumerate(_LANGUAGE_MENU, start=1):
        lines.append(f"{idx}. {label}")
    return "\n".join(lines)


_LANGUAGE_SELECTED_REPLY = {
    "en": "Great! How can I help you today? You can ask about a product or your order.",
    "hi": "Bahut accha! Main aapki kaise madad karun? Aap product ya apne order ke baare me pooch sakte hain.",
    "bn": "\u09a7\u09a8\u09cd\u09af\u09ac\u09be\u09a6! \u0986\u09ae\u09bf \u0995\u09c0\u09ad\u09be\u09ac\u09c7 \u09b8\u09be\u09b9\u09be\u09af\u09cd\u09af \u0995\u09b0\u09a4\u09c7 \u09aa\u09be\u09b0\u09bf? \u09aa\u09a3\u09cd\u09af \u09ac\u09be \u0985\u09b0\u09cd\u09a1\u09be\u09b0 \u09b8\u09ae\u09cd\u09aa\u09b0\u09cd\u0995\u09c7 \u099c\u09bf\u099c\u09cd\u099e\u09be\u09b8\u09be \u0995\u09b0\u09c1\u09a8\u0964",
    "or": "\u0927\u0928\u09cd\u09af\u0986\u0926! \u09ae\u09c1\u0901 \u0995\u09c7\u09ae\u09bf\u09a4\u09bf \u09b8\u09be\u09b9\u09be\u09af\u09cd\u09af \u0995\u09b0\u09bf\u09aa\u09be\u09b0\u09bf\u09ac\u09bf? \u0986\u09aa\u09a3 \u09aa\u09cd\u09b0\u09a1\u0995\u09cd\u099f \u0995\u09bf\u0982\u09ac\u09be \u0985\u09b0\u09cd\u09a1\u09b0 \u09ac\u09bf\u09b7\u09af\u09b0\u09c7 \u09aa\u099a\u09be\u09b0\u09bf\u09aa\u09be\u09b0\u09bf\u09b2\u09c7\u0964",
    "ta": "\u0BA8\u0BA9\u0BCD\u0BB1\u0BBF! \u0BA8\u0BBE\u0BA9\u0BCD \u0B8E\u0BAA\u0BCD\u0BAA\u0B9F\u0BBF \u0B89\u0BA4\u0BB5\u0BB2\u0BBE\u0BAE\u0BCD? \u0BAE\u0BB1\u0BCD\u0BB1\u0BC1\u0BAE\u0BCD \u0B89\u0B99\u0BCD\u0B95\u0BB3\u0BCD \u0B86\u0BB0\u0BCD\u0B9F\u0BB0\u0BCD \u0BAA\u0BB1\u0BCD\u0BB1\u0BBF \u0B95\u0BC7\u0B9F\u0BCD\u0B95\u0BB2\u0BBE\u0BAE\u0BCD.",
    "pa": "\u0a35\u0a27\u0a40\u0a06! \u0a2e\u0a48\u0a02 \u0a24\u0a41\u0a39\u0a3e\u0a21\u0a40 \u0a15\u0a3f\u0a35\u0a47\u0a02 \u0a2e\u0a26\u0a26 \u0a15\u0a30 \u0a38\u0a15\u0a26\u0a3e/\u0a38\u0a15\u0a26\u0a40 \u0a39\u0a3e\u0a02? \u0a24\u0a41\u0a38\u0a40\u0a02 \u0a09\u0a24\u0a2a\u0a3e\u0a26 \u0a1c\u0a3e\u0a02 \u0a06\u0a30\u0a21\u0a30 \u0a2c\u0a3e\u0a30\u0a47 \u0a2a\u0a41\u0a1b \u0a38\u0a15\u0a26\u0a47 \u0a39\u0a4b\u0964",
    "as": "\u09a7\u09a8\u09cd\u09af\u09ac\u09be\u09a6! \u09ae\u0987 \u0995\u09c7\u09a8\u09c7\u0995\u09c8 \u09b8\u09be\u09b9\u09be\u09af\u09cd\u09af \u0995\u09b0\u09bf\u09ac \u09aa\u09be\u09b0\u09cb\u0981? \u0986\u09aa\u09c1\u09a8\u09bf \u09aa\u09a3\u09cd\u09af \u09ac\u09be \u0985\u09b0\u09cd\u09a1\u09be\u09b0\u09b0 \u09ac\u09bf\u09b7\u09af\u09c7 \u09b8\u09cb\u09a7\u09bf\u09ac \u09aa\u09be\u09b0\u09c7\u0964",
}


def _language_selected_reply(language: str) -> str:
    return _LANGUAGE_SELECTED_REPLY.get(language, _LANGUAGE_SELECTED_REPLY["en"])

def _service_escalation_reply(language: str) -> str:
    if language == "hi":
        return "Maine aapki chat urgent mark kar di hai. Hamari team jald hi yahin reply karegi."
    return "I've marked this chat as urgent. Our team will reply here shortly."


def _mark_session_urgent_for_human(db: Session, session_id: int) -> None:
    ensure_chat_session_columns(db)
    db.execute(
        text("""
            UPDATE chat_sessions
            SET flag = 'urgent', is_human = TRUE, updated_at = :now
            WHERE id = :sid
        """),
        {"sid": session_id, "now": datetime.now()},
    )
    db.commit()


# ─────────────────────────────────────────────────────────────────────────────
# Session helpers
# ─────────────────────────────────────────────────────────────────────────────

def get_or_create_session(db: Session, phone: str, contact_name: str = "") -> dict:
    ensure_chat_session_columns(db)
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
    message_id = result.lastrowid
    try:
        from routes.chat import notify_chat_change
        notify_chat_change(
            session_id,
            "message",
            message_id=message_id,
            sender=sender,
            message=message,
        )
    except Exception:
        logger.debug("Chat websocket notify failed for session %s", session_id, exc_info=True)
    if sender == "user":
        try:
            from services.web_push_service import queue_chat_push_notification

            queue_chat_push_notification(session_id, message_id, message)
        except Exception:
            logger.debug("Chat web push queue failed for session %s", session_id, exc_info=True)
    return message_id


def get_conversation_history(db: Session, session_id: int, limit: int = 40) -> list[dict]:
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
        msg = r.message or ""
        # Skip image/media stubs — they have no text value and crowd the context
        # window, which made the AI forget the product / re-ask the address.
        if msg.startswith("[image]") or msg.startswith("[media:"):
            continue
        role = "user" if r.sender == "user" else "assistant"
        history.append({"role": role, "content": msg})
    return history


# ─────────────────────────────────────────────────────────────────────────────
# Media handler
# ─────────────────────────────────────────────────────────────────────────────

async def handle_inbound_media(
    db: Session,
    phone: str,
    media_url: str,
    media_type: str,
    media_id: str = "",
    filename: str = "",
    contact_name: str = "",
    wa_message_id: Optional[str] = None,
) -> str:
    phone      = normalize_phone(phone)
    session    = get_or_create_session(db, phone, contact_name)
    session_id = session["id"]

    if wa_message_id:
        existing = db.execute(
            text("SELECT id FROM chat_messages WHERE wa_message_id = :wid"),
            {"wid": wa_message_id},
        ).fetchone()
        if existing:
            return ""

    local_media_url = media_url or ""
    local_download_url = local_media_url
    local_mime_type = media_type or "application/octet-stream"
    local_file_name = filename or f"whatsapp-{local_mime_type.split('/')[0]}"
    local_file_size = None

    if media_id:
        try:
            resolved_url = await get_media_url(media_id)
            media_bytes, downloaded_type = await download_media_bytes(resolved_url)
            if media_bytes:
                saved = save_media_bytes(
                    media_bytes,
                    filename=local_file_name,
                    folder=f"chat/{session_id}/inbound",
                    content_type=downloaded_type or local_mime_type,
                )
                local_media_url = saved["public_url"]
                local_download_url = saved["download_url"]
                local_mime_type = saved["content_type"]
                local_file_name = saved["filename"]
                local_file_size = saved["size"]
        except Exception as exc:
            logger.warning("Could not store inbound WA media %s: %s", media_id, exc)
    media_kind = "image" if str(local_mime_type).startswith("image/") else "document"
    meta = {
        "flow": "customer_media",
        "media_type": media_kind,
        "mime_type": local_mime_type,
        "media_url": local_media_url,
        "download_url": local_download_url,
        "file_name": local_file_name,
        "file_size": local_file_size,
        "wa_media_id": media_id,
    }
    save_message(
        db,
        session_id,
        "user",
        f"[media:{media_kind}] {local_file_name}",
        wa_message_id=wa_message_id,
        meta=meta,
    )

    # Payment screenshot? Acknowledge it and flag the chat so the team verifies —
    # don't let a payment proof fall through to a generic "thanks for the image".
    if media_kind == "image":
        try:
            from services.ai_service import detect_payment_screenshot
            if await detect_payment_screenshot(local_media_url or media_url):
                reply = ("Payment screenshot ke liye dhanyavaad 🙏 Hamari team ise verify karke "
                         "aapko jaldi confirm karegi. Confirm hote hi order dispatch ho jayega.")
                _mark_session_urgent_for_human(db, session_id)
                save_message(db, session_id, "ai", reply, meta={"flow": "payment_proof", "flag": "urgent"})
                try:
                    await send_text_message(phone, reply)
                except Exception as exc:
                    logger.error("payment-proof ack send failed %s: %s", phone, exc)
                return reply
        except Exception as exc:
            logger.warning("payment screenshot check failed for %s: %s", phone, exc)

    reply = await analyze_media(local_media_url or media_url, local_mime_type)
    save_message(db, session_id, "ai", reply)

    try:
        await send_text_message(phone, reply)
    except Exception as exc:
        logger.error("Media reply send failed %s: %s", phone, exc)

    return reply


# ─────────────────────────────────────────────────────────────────────────────
# Main inbound handler
# ─────────────────────────────────────────────────────────────────────────────

async def handle_inbound_message(
    db: Session,
    phone: str,
    text_body: str,
    contact_name: str = "",
    wa_message_id: Optional[str] = None,
) -> str:
    phone      = normalize_phone(phone)
    session    = get_or_create_session(db, phone, contact_name)
    session_id = session["id"]

    # ── Dedup ──────────────────────────────────────────────────────────────────
    if wa_message_id:
        existing = db.execute(
            text("SELECT id FROM chat_messages WHERE wa_message_id = :wid"),
            {"wid": wa_message_id},
        ).fetchone()
        if existing:
            logger.info("Duplicate WA message %s — skipping", wa_message_id)
            return ""

    save_message(db, session_id, "user", text_body, wa_message_id=wa_message_id)

    if session.get("is_human"):
        logger.info("Human mode ON for session %s — skipping AI", session_id)
        return ""

    # ── Debounce: wait for the customer to finish typing a burst of 2-3 messages
    #    so the AI reads them together and replies once. Each incoming message
    #    registers as the latest and waits; only the LAST one proceeds, the rest
    #    return after saving. The winner rebuilds text_body from all the unanswered
    #    user messages. (WhatsApp doesn't deliver typing events, so this is how we
    #    "wait for typing".)
    if _INBOUND_DEBOUNCE > 0 and wa_message_id:
        _INBOUND_LATEST[session_id] = wa_message_id
        # Tell the dashboard the AI is about to respond (typing bubble).
        _emit_typing(session_id)
        await asyncio.sleep(_INBOUND_DEBOUNCE)
        if _INBOUND_LATEST.get(session_id) != wa_message_id:
            return ""   # a newer message in the burst will handle the batch
        batched = _collect_unanswered_user_text(db, session_id)
        if batched:
            text_body = batched

    # ── Build history for context (exclude the user turn we just saved) ────────
    history = get_conversation_history(db, session_id, limit=40)
    if history and history[-1]["role"] == "user" and history[-1]["content"] == text_body:
        history_for_context = history[:-1]
    else:
        history_for_context = history

    # NOTE: no language menu anymore — language is auto-detected. (Previously a
    # bare number like a quantity "2" was misread as a language choice.)

    # Auto-detect language from the customer's message (script + typed words) —
    # no language menu is shown.
    preferred_language = session.get("preferred_language") or ""
    language = preferred_language or _infer_language(text_body)

    # ── Explicit order ID shortcut (structural regex is fine here) ─────────────
    order_id = _extract_order_id_candidate(text_body, history_for_context)
    if order_id:
        status_text = await build_status_reply_for_order_id(db, order_id, language=language)
        if status_text:
            save_message(db, session_id, "ai", status_text)
            try:
                await send_text_message(phone, status_text)
            except Exception as exc:
                logger.error("Failed to send order status to %s: %s", phone, exc)
            return status_text
        not_found = (
            "Mujhe ye Order ID nahi mila. Please Order ID dobara check karke bhej dein."
            if language == "hi"
            else "I couldn't find that Order ID. Please check it once and send it again."
        )
        save_message(db, session_id, "ai", not_found)
        try:
            await send_text_message(phone, not_found)
        except Exception as exc:
            logger.error("Order ID not-found reply failed %s: %s", phone, exc)
        return not_found

    # ── Greeting → personalised, language-aware welcome (recognises returning
    #    customers from the orders DB; mirrors Hinglish/Hindi/English style) ──────
    if _looks_like_greeting(text_body):
        try:
            from services.customer_rag import get_customer_context
            cust_ctx = get_customer_context(db, phone)
        except Exception:
            cust_ctx = ""
        from services.ai_service import generate_greeting
        first_contact = not any(t.get("role") == "assistant" for t in history_for_context)
        greeting = await generate_greeting(history_for_context, language=language,
                                           customer_context=cust_ctx, include_catalogue=first_contact)
        save_message(db, session_id, "ai", greeting, meta={"flow": "greeting"})
        try:
            await send_text_message(phone, greeting)
        except Exception as exc:
            logger.error("Greeting send failed %s: %s", phone, exc)
        return greeting

    # ── LLM intent classification ──────────────────────────────────────────────
    intent = await classify_intent(text_body, history_for_context[-5:])
    # When the last AI message asked for a personal field (name/mobile/address/
    # pincode/confirm), this message is the ANSWER — don't divert it to product
    # browse or order status. A product-CHOICE answer ("Mantra iris") is NOT a
    # personal field, so naming a product still shows its photo + link.
    awaiting_field = _awaiting_personal_field(history_for_context)
    logger.info(
        "handle_inbound: session=%s phone=%s intent=%s awaiting_field=%s msg=%r",
        session_id, phone, intent, awaiting_field, text_body[:60],
    )

    support_query = _is_support_query(text_body)

    # ── Route: service / complaint — hand over to human urgently ───────────────
    if is_service_intent(intent) and not support_query:
        _mark_session_urgent_for_human(db, session_id)
        reply = _service_escalation_reply(language)
        save_message(db, session_id, "ai", reply, meta={"flow": "service_escalation", "flag": "urgent"})
        try:
            await send_text_message(phone, reply)
        except Exception as exc:
            logger.error("Service escalation reply send failed %s: %s", phone, exc)
        return reply

    # ── Confirmed model → share photo + card + CTA ─────────────────────────────
    # Runs regardless of intent: a bare "yes"/"haan"/"photo bhejo" often classifies
    # as general, which previously skipped the share after a model confirmation.
    # NOTE: we deliberately do NOT gate this on `awaiting_field`. The model-confirm
    # prompt itself says "Confirm karein…", and "confirm" is a personal-field
    # marker, so `_awaiting_personal_field` falsely returns True here — which used
    # to skip the share and let the LLM reply with a text-only card (no photo).
    # A truthy `pending` (meta.flow == "product_confirm" + sku) is a precise signal
    # that we're confirming a model, so an affirmative MUST trigger the photo share.
    pending = _pending_product_confirm(db, session_id)
    if pending and (_is_affirmative(text_body) or _asks_for_media(text_body)):
        from services.ai_service import product_card_by_sku, generate_order_cta
        share = await product_card_by_sku(pending.get("sku"))
        if share:
            # ONE primary photo, with a caption carrying the price, the ₹delivery
            # charge and a style-matched order-confirmation CTA.
            primary = next(iter(share.get("images") or []), None)
            name    = share.get("product", "")
            price   = share.get("price", "")
            try:
                cta = await generate_order_cta(history_for_context, language=language, product_name=name)
            except Exception as exc:
                logger.warning("confirmed product cta failed (%s) — using fallback", exc)
                cta = ""
            if not cta:
                cta = ("Aapke liye order place kar dun? Confirm karein 🙂"
                       if (language or "en").lower() != "en"
                       else "Shall I place your order? Please confirm 🙂")

            caption_lines = [f"📦 *{name}*", ""]
            if price:
                caption_lines.append(f"💰 Price: {price}")
            caption_lines.append(f"🚚 Delivery: ₹{_DELIVERY_CHARGE}")
            caption_lines += ["", cta]
            caption = "\n".join(caption_lines)

            sku_meta = pending.get("sku")
            if primary:
                try:
                    wa_resp = await asyncio.wait_for(
                        send_image_message(phone, primary, caption=caption), timeout=12.0
                    )
                    save_message(
                        db, session_id, "ai", caption,
                        wa_message_id=_wa_message_id(wa_resp),
                        meta={"flow": "product_confirm_share", "sku": sku_meta,
                              "media_type": "image", "mime_type": "image/jpeg",
                              "media_url": primary, "download_url": primary},
                    )
                    return caption
                except Exception as exc:
                    logger.error("confirmed product image+caption send failed %s: %s", phone, exc)
            # No image (or send failed) → still deliver the caption as text.
            try:
                wa_resp = await send_text_message(phone, caption)
                save_message(db, session_id, "ai", caption,
                             wa_message_id=_wa_message_id(wa_resp),
                             meta={"flow": "product_confirm_share", "sku": sku_meta})
            except Exception as exc:
                logger.error("confirmed product caption send failed %s: %s", phone, exc)
            return caption

    # ── Route: reply to a sent template (order_confirmation / payment_pending) ──
    # The customer is responding inside an existing order's context — do NOT start
    # or re-place an order. Confirm + reassure, or nudge payment.
    if not awaiting_field and _looks_confirmation(text_body):
        tctx = _template_reply_context(db, session_id)
        if tctx == "confirmed_dispatch":
            reply = ("Dhanyavaad! Aapka order aur address confirm ho gaya hai ✅ "
                     "Kripya thodi der pratiksha karein — hamari dispatch team jald hi "
                     "aapko dispatch aur tracking details yahin bhej degi. 🙏"
                     if (language or "en").lower() != "en"
                     else "Thank you! Your order and address are confirmed ✅ "
                          "Please wait a little while — our dispatch team will share your "
                          "dispatch and tracking details here shortly. 🙏")
            save_message(db, session_id, "ai", reply, meta={"flow": "address_confirmed_ack"})
            try:
                await send_text_message(phone, reply)
            except Exception as exc:
                logger.error("confirmed-dispatch ack send failed %s: %s", phone, exc)
            return reply
        if tctx == "payment_pending":
            reply = ("Aapka order place ho chuka hai 🙏 Kripya payment complete kar dein "
                     "taaki hum aaj hi aapka hardware dispatch kar sakein."
                     if (language or "en").lower() != "en"
                     else "Your order is placed 🙏 Please complete the payment so we can "
                          "dispatch your hardware the same day.")
            save_message(db, session_id, "ai", reply, meta={"flow": "payment_nudge"})
            try:
                await send_text_message(phone, reply)
            except Exception as exc:
                logger.error("payment-nudge send failed %s: %s", phone, exc)
            return reply

    # ── Route: order management ────────────────────────────────────────────────
    if not awaiting_field and is_order_management_intent(intent):
        status_reply = await build_status_reply_for_phone(db, phone, language=language)

        save_message(db, session_id, "ai", status_reply)
        try:
            await send_text_message(phone, status_reply)
        except Exception as exc:
            logger.error("Order status reply send failed %s: %s", phone, exc)
        return status_reply

    # ── Route: product recognised → share photo + link + order CTA ─────────────
    # Fires for both "product_browse" and "place_order" intents: as soon as the
    # customer names a specific catalogue product, we share it like the manual
    # product share (card + photo + link) and invite them to order. If the
    # message names no real product (a detail answer / "haan"), generate_product_reply
    # returns None and we fall through to the AI to continue/place the order.
    address_block = _looks_like_address_block(text_body)
    if not awaiting_field and not address_block and not support_query and intent in ("product_browse", "place_order"):
        logger.info("handle_inbound: %s intent — trying product card+photo for %r", intent, text_body[:60])
        share = None
        if share is None:
            product_result = await generate_product_reply(text_body)
            if product_result and product_result.get("sku"):
                # Specific model named → CONFIRM the model before sharing photo+card.
                from services.ai_service import generate_model_confirm
                confirm = await generate_model_confirm(history_for_context, product_result.get("product", ""))
                save_message(db, session_id, "ai", confirm,
                             meta={"flow": "product_confirm", "sku": product_result["sku"],
                                   "product": product_result.get("product", "")})
                try:
                    await send_text_message(phone, confirm)
                except Exception as exc:
                    logger.error("Model confirm send failed %s: %s", phone, exc)
                return confirm
            if product_result:
                share = product_result   # category list (no sku) → show directly

        if share:
            text_msg = share["text"]
            images   = share.get("images") or []

            logger.info(
                "handle_inbound: product reply ready — %d image(s) to send for phone=%s",
                len(images), phone,
            )

            # PHOTO(S) FIRST, then details + purchase link. Customers were
            # ignoring the link when it arrived before the photo.
            for img_url in images[:3]:
                try:
                    logger.debug("handle_inbound: sending image url=%s to phone=%s", img_url[:80], phone)
                    wa_resp = await asyncio.wait_for(
                        send_image_message(phone, img_url),
                        timeout=10.0,
                    )
                    save_message(
                        db,
                        session_id,
                        "ai",
                        "[image] Product photo",
                        wa_message_id=_wa_message_id(wa_resp),
                        meta={
                            "flow": "product_image",
                            "media_type": "image",
                            "mime_type": "image/jpeg",
                            "media_url": img_url,
                            "download_url": img_url,
                        },
                    )
                    await asyncio.sleep(0.3)
                except asyncio.TimeoutError:
                    logger.warning("handle_inbound: image send timeout phone=%s url=%s", phone, img_url[:60])
                except Exception as exc:
                    logger.error("handle_inbound: image send failed phone=%s url=%s err=%s", phone, img_url[:60], exc)

            # Now the details + purchase link (after the photo).
            save_message(db, session_id, "ai", text_msg)
            try:
                await send_text_message(phone, text_msg, preview_url=True)
            except Exception as exc:
                logger.error("Product text send failed %s: %s", phone, exc)

            # Separate, style + language matched message asking them to order
            # (only for a single-product share, not the category list).
            if images:
                try:
                    from services.ai_service import generate_order_cta
                    cta = await generate_order_cta(history_for_context, language=language,
                                                   product_name=share.get("product", ""))
                    if cta:
                        wa_resp = await send_text_message(phone, cta)
                        save_message(db, session_id, "ai", cta,
                                     wa_message_id=_wa_message_id(wa_resp), meta={"flow": "order_cta"})
                except Exception as exc:
                    logger.error("Order CTA send failed %s: %s", phone, exc)

            return text_msg

        logger.info("handle_inbound: product intent had no usable search term, falling through to AI reply")

    # ── Route: everything else → full AI reply (with customer + knowledge RAG) ──
    try:
        from services.customer_rag import build_rag_context
        rag_context = build_rag_context(db, phone, text_body)
    except Exception as exc:
        logger.warning("RAG context build failed: %s", exc)
        rag_context = ""
    ai_reply = await generate_reply(history_for_context, text_body, language=language, extra_context=rag_context)
    ai_failure_context = get_last_ai_failure_context()
    if ai_failure_context:
        _mark_session_urgent_for_human(db, session_id)

    # ── Check if AI produced a complete order JSON ─────────────────────────────
    order_data = extract_order_json(ai_reply)
    if order_data:
        logger.info("handle_inbound: AI order JSON detected for session=%s", session_id)
        # Mobile sanitisation: customers often reply "same number" / "same" /
        # "is number pe" instead of typing it, and the AI copies that text into the
        # JSON. Any value that isn't a clean 10-digit number falls back to the
        # customer's own WhatsApp number.
        wa_digits = re.sub(r"\D", "", phone)[-10:]
        mob_digits = re.sub(r"\D", "", str(order_data.get("mobile") or ""))
        if len(mob_digits) > 10:
            mob_digits = mob_digits[-10:]
        if len(mob_digits) != 10:
            order_data["mobile"] = wa_digits
        else:
            order_data["mobile"] = mob_digits

        # Wrap the whole placement so a failure NEVER leaves the customer with no
        # reply — they always get a confirmation or a graceful fallback message.
        try:
            result        = place_ai_order(order_data, db)
            customer_name = order_data.get("name", "Customer")
            # A duplicate (order already exists) gets the dedup reminder, not a
            # fresh "order confirmed" message.
            confirm_msg   = (
                result.get("message")
                if result.get("duplicate")
                else build_order_confirmation_message(result, customer_name)
            )
            order_id      = result.get("order_id")
            raw_total     = result.get("total") or result.get("total_amount") or 0
            amount_str    = f"₹{float(raw_total):,.0f}" if raw_total else "—"

            if result.get("success") and order_id:
                try:
                    from routes.orders import notify_order_change
                    notify_order_change(order_id, "created")
                except Exception:
                    logger.debug("Order websocket notify failed for AI order %s", order_id, exc_info=True)

            # Store the raw order JSON as an INTERNAL system note (never as an "ai"
            # bubble) so the JSON is never shown to / sent to the customer. The
            # customer only ever sees the clean confirmation message below.
            save_message(
                db, session_id, "system",
                f"[ai_order_json] {result.get('order_id') or 'order'}",
                meta={
                    "flow":             "ai_order_json",
                    "order_data":       order_data,
                    "created_order_id": result.get("order_id"),
                    "order_success":    result.get("success"),
                },
            )
            if result.get("success"):
                confirm_meta = {"order_id": result.get("order_id"), "flow": "ai_order_placed"}
            else:
                # Failed placement (e.g. product not found) — surface on the
                # dashboard AI-failure log and hand off to a human.
                confirm_meta = {
                    "flow": "ai_failure",
                    "ai_failure": True,
                    "error_response": result.get("message") or "AI order placement failed",
                    "order_data": order_data,
                }
                _mark_session_urgent_for_human(db, session_id)
            save_message(db, session_id, "system", confirm_msg, meta=confirm_meta)

            try:
                await send_text_message(phone, confirm_msg)
            except Exception as exc:
                logger.error("Order confirm send failed %s: %s", phone, exc)

            if result.get("success") and order_id and not result.get("duplicate"):
                try:
                    from services.order_notification_poller import notify_order_created_and_mark

                    await notify_order_created_and_mark(
                        order_id=order_id,
                        phone=phone,
                        customer_name=customer_name,
                        amount=amount_str,
                        address_line=order_data.get("address", ""),
                        payment_status=result.get("payment_status", "pending"),
                        source="ai_order",
                        # True → also send the payment link text + payment QR image
                        # after the pending template (customer can pay immediately).
                        send_followup_messages=True,
                    )
                except Exception as exc:
                    logger.error("notify_order_created failed %s: %s", phone, exc)

            return confirm_msg

        except Exception as exc:
            db.rollback()
            logger.exception("handle_inbound: AI order placement crashed for session=%s: %s", session_id, exc)
            _mark_session_urgent_for_human(db, session_id)
            fallback = (
                "Aapki details mil gayi hain 🙏 Order place karne me ek choti si dikkat aa gayi — "
                "hamari team turant aapse yahin connect karegi."
            )
            # Tag with ai_failure markers so it shows on the dashboard AI-failure log.
            save_message(
                db, session_id, "ai", fallback,
                meta={
                    "flow": "ai_failure",
                    "ai_failure": True,
                    "error_response": f"AI order placement crashed: {exc}",
                    "order_data": order_data,
                },
            )
            try:
                await send_text_message(phone, fallback)
            except Exception as send_exc:
                logger.error("AI order fallback send failed %s: %s", phone, send_exc)
            return fallback

    # ── Normal AI reply ────────────────────────────────────────────────────────
    save_message(db, session_id, "ai", ai_reply, meta=ai_failure_context)

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
    send_followup_messages: bool = True,
) -> dict:
    report = {
        "order_id": order_id,
        "payment_status": payment_status,
        "order_template_sent": False,
        "payment_template_sent": False,
        "payment_template_button_sent": False,
        "payment_link_sent": False,
        "payment_qr_sent": False,
        "errors": [],
    }
    phone = normalize_phone(phone)
    if not phone:
        logger.warning("notify_order_created skipped — missing phone for order %s", order_id)
        report["skipped"] = "missing_phone"
        return report

    session    = get_or_create_session(db, phone)
    session_id = session["id"]
    # Only a confirmed payment skips the payment-pending template. Everything else
    # — including "pending" and "pending_verification" (customer claims paid but
    # not yet verified) — gets the payment-pending template + pay link/QR.
    status_norm = (payment_status or "").lower()
    is_paid     = status_norm in ("paid", "success", "accepted")

    if is_paid:
        try:
            wa_resp = await send_order_confirmation(
                to=phone,
                customer_name=customer_name or "Customer",
                order_id=order_id,
                amount=amount or "—",
            )
            save_message(
                db, session_id, "system",
                f"[template:order_confirmation] {customer_name} / {order_id} / {amount}",
                wa_message_id=_wa_message_id(wa_resp),
                meta={"order_id": order_id, "flow": "order_confirmation_template", "payment": "paid"},
            )
            report["order_template_sent"] = True
        except Exception as exc:
            logger.error("order_confirmation template failed for %s: %s", phone, exc)
            report["errors"].append(f"order_confirmation_template:{exc}")

        if send_followup_messages and address_line:
            body = (
                f"📦 Delivery address on file:\n{address_line}\n\n"
                "Reply *YES* to confirm, or send your corrected address."
            )
            save_message(
                db, session_id, "system", body,
                meta={"order_id": order_id, "flow": "address_confirm"},
            )
            try:
                await send_text_message(phone, body)
            except Exception as exc:
                logger.error("Address nudge failed for %s: %s", phone, exc)
                report["errors"].append(f"address_nudge:{exc}")

    else:
        payment_link = None
        pay_link = ""
        payment_button_value = ""
        try:
            payment_link = await create_payment_link_details(
                order_id=order_id,
                amount=parse_amount(amount),
                name=customer_name or "Customer",
                phone=phone,
            )
            pay_link = payment_link.get("short_url") or ""
            if not pay_link:
                raise PaymentLinkError("No payment link returned")
            payment_button_value = build_payment_template_button_value(order_id, pay_link)
            report["payment_url"] = pay_link
            report["razorpay_payment_link_id"] = payment_link.get("id")
            report["payment_button_value"] = payment_button_value
        except PaymentLinkError as exc:
            logger.error("Razorpay payment link creation failed for %s order %s: %s", phone, order_id, exc)
            report["errors"].append(f"payment_link_create:{exc}")
            save_message(
                db, session_id, "system",
                f"[payment_link_create_failed] {order_id}: {exc}",
                meta={"order_id": order_id, "flow": "payment_link_create_failed", "error": str(exc)},
            )
        except Exception as exc:
            logger.error("Payment link preparation failed for %s order %s: %s", phone, order_id, exc)
            report["errors"].append(f"payment_link_prepare:{exc}")
            save_message(
                db, session_id, "system",
                f"[payment_link_prepare_failed] {order_id}: {exc}",
                meta={"order_id": order_id, "flow": "payment_link_prepare_failed", "error": str(exc)},
            )

        payment_template_components = [{
            "type": "body",
            "parameters": [
                {"type": "text", "text": customer_name or "Customer"},
                {"type": "text", "text": order_id},
                {"type": "text", "text": "your order"},
                {"type": "text", "text": amount or "—"},
            ],
        }]
        payment_template_components_with_button = payment_template_components
        if payment_button_value:
            payment_template_components_with_button = [
                *payment_template_components,
                {
                    "type": "button",
                    "sub_type": "url",
                    "index": "0",
                    "parameters": [{"type": "text", "text": payment_button_value}],
                },
            ]

        try:
            wa_resp = await send_template_message(
                to=phone,
                template_name=_TEMPLATE_PAYMENT_PENDING,
                language="en",
                components=payment_template_components_with_button,
            )
            save_message(
                db, session_id, "system",
                f"[template:payment_pending] {customer_name} / {order_id} / {amount}",
                wa_message_id=_wa_message_id(wa_resp),
                meta={
                    "order_id": order_id,
                    "flow": "payment_pending_template",
                    "payment": "pending",
                    "payment_url": pay_link,
                    "payment_button_value": payment_button_value,
                    "payment_button": bool(payment_button_value),
                },
            )
            report["payment_template_sent"] = True
            report["payment_template_button_sent"] = bool(payment_button_value)
        except Exception as exc:
            logger.error("payment_pending template with pay button failed for %s: %s", phone, exc)
            report["errors"].append(f"payment_pending_template_button:{exc}")
            try:
                wa_resp = await send_template_message(
                    to=phone,
                    template_name=_TEMPLATE_PAYMENT_PENDING,
                    language="en",
                    components=payment_template_components,
                )
                save_message(
                    db, session_id, "system",
                    f"[template:payment_pending] {customer_name} / {order_id} / {amount}",
                    wa_message_id=_wa_message_id(wa_resp),
                    meta={"order_id": order_id, "flow": "payment_pending_template", "payment": "pending"},
                )
                report["payment_template_sent"] = True
            except Exception as fallback_exc:
                logger.error("payment_pending template fallback failed for %s: %s", phone, fallback_exc)
                report["errors"].append(f"payment_pending_template:{fallback_exc}")

        if not send_followup_messages:
            return report

        # The template (with pay button) is the immediate pay path. The pay-link
        # TEXT + QR image are sent after a delay so we don't bombard the customer
        # with 3-4 messages at once (confirmation + template + link + QR).
        if pay_link:
            asyncio.create_task(_send_payment_assets_later(
                phone, order_id, customer_name, amount, pay_link,
                payment_link.get("id"), _PAYMENT_ASSETS_DELAY,
            ))
            report["payment_assets_scheduled_in"] = _PAYMENT_ASSETS_DELAY

    return report


async def _send_payment_assets_later(
    phone: str, order_id: str, customer_name: str, amount: str,
    pay_link: str, payment_link_id: Optional[str], delay: int,
) -> None:
    """After `delay` seconds, send the pay-link text + QR image on a fresh DB
    session (the request session is long gone). Lost on a process restart, but the
    payment_pending template's pay button already covers the immediate path."""
    try:
        await asyncio.sleep(max(0, int(delay)))
    except Exception:
        pass
    from database import SessionLocal
    db = SessionLocal()
    try:
        session = get_or_create_session(db, phone)
        session_id = session["id"]
        pay_msg = (
            f"💳 Complete your payment to confirm shipment:\n{pay_link}\n\n"
            "Once paid, we'll dispatch today. Reply here if you need any help! 🙏"
        )
        try:
            wa_resp = await send_text_message(phone, pay_msg, preview_url=True)
            save_message(db, session_id, "system", pay_msg, wa_message_id=_wa_message_id(wa_resp),
                         meta={"order_id": order_id, "flow": "payment_link",
                               "payment_url": pay_link, "razorpay_payment_link_id": payment_link_id})
        except Exception as exc:
            logger.error("delayed payment link send failed %s %s: %s", phone, order_id, exc)

        qr_url = ""
        razorpay_qr_id = None
        try:
            razorpay_qr = await create_payment_qr_details(
                order_id=order_id, amount=parse_amount(amount), name=customer_name or "Customer")
            qr_url = razorpay_qr.get("image_url") or ""
            razorpay_qr_id = razorpay_qr.get("id")
        except PaymentLinkError as exc:
            logger.warning("delayed QR create fallback %s: %s", order_id, exc)
            qr_url = build_payment_qr_url(pay_link)
        except Exception as exc:
            logger.warning("delayed QR create failed %s: %s", order_id, exc)
            qr_url = build_payment_qr_url(pay_link)
        if qr_url:
            try:
                wa_resp = await send_image_message(
                    phone, qr_url,
                    caption=f"Scan this QR to pay {amount or 'the pending amount'} for order {order_id}.")
                save_message(db, session_id, "system", f"[payment_qr] {order_id}",
                             wa_message_id=_wa_message_id(wa_resp),
                             meta={"order_id": order_id, "flow": "payment_qr", "payment_url": pay_link,
                                   "qr_url": qr_url, "razorpay_payment_link_id": payment_link_id,
                                   "razorpay_qr_id": razorpay_qr_id})
            except Exception as exc:
                logger.error("delayed QR send failed %s %s: %s", phone, order_id, exc)
    finally:
        db.close()


async def notify_order_shipped(db: Session, phone: str, order_id: str, awb: str) -> None:
    if not order_allows_whatsapp(db, order_id):
        logger.info("notify_order_shipped skipped for %s — WhatsApp disabled on order", order_id)
        return

    phone = normalize_phone(phone)
    if not phone:
        logger.warning("notify_order_shipped skipped — missing phone for order %s", order_id)
        return

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
