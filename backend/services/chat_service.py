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


def _detect_language_choice(message: str) -> Optional[str]:
    text_value = (message or "").strip().lower()
    compact = re.sub(r"\s+", " ", text_value)
    if compact in ("1", "hindi", "hin", "hi", "हिंदी", "हिन्दी"):
        return "hi"
    if compact in ("2", "english", "eng", "en", "अंग्रेजी", "अंग्रेज़ी"):
        return "en"
    return None


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
    if re.search(r"[\u0900-\u097F]", message or ""):
        return "hi"
    return fallback or "en"


def _language_prompt() -> str:
    return (
        "Namaste! Please choose your preferred language.\n"
        "1. Hindi\n"
        "2. English\n\n"
        "नमस्ते! कृपया भाषा चुनें.\n"
        "1. Hindi\n"
        "2. English"
    )


def _language_selected_reply(language: str) -> str:
    if language == "hi":
        return "Hindi selected. Aap product, service, ya order status ke liye message bhej sakte hain."
    return "English selected. You can ask about products, service, or order status."


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

    # ── Build history for context (exclude the user turn we just saved) ────────
    history = get_conversation_history(db, session_id, limit=40)
    if history and history[-1]["role"] == "user" and history[-1]["content"] == text_body:
        history_for_context = history[:-1]
    else:
        history_for_context = history

    selected_language = _detect_language_choice(text_body)
    if selected_language:
        db.execute(
            text("UPDATE chat_sessions SET preferred_language = :lang, updated_at = :now WHERE id = :sid"),
            {"lang": selected_language, "now": datetime.now(), "sid": session_id},
        )
        db.commit()
        reply = _language_selected_reply(selected_language)
        save_message(db, session_id, "ai", reply, meta={"flow": "language_selected", "language": selected_language})
        try:
            await send_text_message(phone, reply)
        except Exception as exc:
            logger.error("Language selection reply send failed %s: %s", phone, exc)
        return reply

    preferred_language = session.get("preferred_language") or ""
    if not preferred_language and _looks_like_greeting(text_body) and not history_for_context:
        reply = _language_prompt()
        save_message(db, session_id, "ai", reply, meta={"flow": "language_prompt"})
        try:
            await send_text_message(phone, reply)
        except Exception as exc:
            logger.error("Language prompt send failed %s: %s", phone, exc)
        return reply

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

    # ── Route: service / complaint — hand over to human urgently ───────────────
    if is_service_intent(intent):
        _mark_session_urgent_for_human(db, session_id)
        reply = _service_escalation_reply(language)
        save_message(db, session_id, "ai", reply, meta={"flow": "service_escalation", "flag": "urgent"})
        try:
            await send_text_message(phone, reply)
        except Exception as exc:
            logger.error("Service escalation reply send failed %s: %s", phone, exc)
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
    if not awaiting_field and intent in ("product_browse", "place_order"):
        logger.info("handle_inbound: %s intent — trying product card+photo for %r", intent, text_body[:60])
        product_result = await generate_product_reply(text_body)

        if product_result:
            text_msg = product_result["text"]
            images   = product_result.get("images") or []

            logger.info(
                "handle_inbound: product reply ready — %d image(s) to send for phone=%s",
                len(images), phone,
            )

            save_message(db, session_id, "ai", text_msg)
            try:
                await send_text_message(phone, text_msg)
            except Exception as exc:
                logger.error("Product text send failed %s: %s", phone, exc)

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

            return text_msg

        logger.info("handle_inbound: product intent had no usable search term, falling through to AI reply")

    # ── Route: everything else → full AI reply ─────────────────────────────────
    ai_reply = await generate_reply(history_for_context, text_body)
    ai_failure_context = get_last_ai_failure_context()
    if ai_failure_context:
        _mark_session_urgent_for_human(db, session_id)

    # ── Check if AI produced a complete order JSON ─────────────────────────────
    order_data = extract_order_json(ai_reply)
    if order_data:
        logger.info("handle_inbound: AI order JSON detected for session=%s", session_id)
        if not order_data.get("mobile"):
            order_data["mobile"] = re.sub(r"\D", "", phone)[-10:]

        # Wrap the whole placement so a failure NEVER leaves the customer with no
        # reply — they always get a confirmation or a graceful fallback message.
        try:
            result        = place_ai_order(order_data, db)
            customer_name = order_data.get("name", "Customer")
            confirm_msg   = build_order_confirmation_message(result, customer_name)
            order_id      = result.get("order_id")
            raw_total     = result.get("total") or result.get("total_amount") or 0
            amount_str    = f"₹{float(raw_total):,.0f}" if raw_total else "—"

            if result.get("success") and order_id:
                try:
                    from routes.orders import notify_order_change
                    notify_order_change(order_id, "created")
                except Exception:
                    logger.debug("Order websocket notify failed for AI order %s", order_id, exc_info=True)

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
                logger.error("Order confirm send failed %s: %s", phone, exc)

            if result.get("success") and order_id:
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

            return ai_reply

        except Exception as exc:
            db.rollback()
            logger.exception("handle_inbound: AI order placement crashed for session=%s: %s", session_id, exc)
            _mark_session_urgent_for_human(db, session_id)
            fallback = (
                "Aapki details mil gayi hain 🙏 Order place karne me ek choti si dikkat aa gayi — "
                "hamari team turant aapse yahin connect karegi."
            )
            save_message(db, session_id, "ai", fallback, meta={"flow": "ai_order_error", "error": str(exc)})
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

        # Follow-up session messages can fail outside the 24-hour WhatsApp
        # service window, so the template button above is the primary pay path.
        if pay_link:
            pay_msg = (
                f"💳 Complete your payment to confirm shipment:\n{pay_link}\n\n"
                "Once paid, we'll dispatch today. Reply here if you need any help! 🙏"
            )
            try:
                wa_resp = await send_text_message(phone, pay_msg, preview_url=True)
                save_message(
                    db, session_id, "system", pay_msg,
                    wa_message_id=_wa_message_id(wa_resp),
                    meta={
                        "order_id": order_id,
                        "flow": "payment_link",
                        "payment_url": pay_link,
                        "razorpay_payment_link_id": payment_link.get("id"),
                    },
                )
                report["payment_link_sent"] = True
            except Exception as exc:
                logger.error("Payment link WhatsApp text send failed for %s order %s: %s", phone, order_id, exc)
                report["errors"].append(f"payment_link_send:{exc}")
                save_message(
                    db, session_id, "system",
                    f"[payment_link_send_failed] {pay_link}",
                    meta={
                        "order_id": order_id,
                        "flow": "payment_link_send_failed",
                        "payment_url": pay_link,
                        "error": str(exc),
                    },
                )

            qr_url = ""
            razorpay_qr_id = None
            try:
                razorpay_qr = await create_payment_qr_details(
                    order_id=order_id,
                    amount=parse_amount(amount),
                    name=customer_name or "Customer",
                )
                qr_url = razorpay_qr.get("image_url") or ""
                razorpay_qr_id = razorpay_qr.get("id")
                report["razorpay_qr_id"] = razorpay_qr_id
            except PaymentLinkError as exc:
                logger.warning("Razorpay native QR creation failed for %s order %s, using payment-link QR fallback: %s", phone, order_id, exc)
                report["errors"].append(f"razorpay_qr_create_fallback:{exc}")
                qr_url = build_payment_qr_url(pay_link)

            if qr_url:
                qr_caption = f"Scan this QR to pay {amount or 'the pending amount'} for order {order_id}."
                try:
                    wa_resp = await send_image_message(phone, qr_url, caption=qr_caption)
                    save_message(
                        db, session_id, "system",
                        f"[payment_qr] {order_id}",
                        wa_message_id=_wa_message_id(wa_resp),
                        meta={
                            "order_id": order_id,
                            "flow": "payment_qr",
                            "payment_url": pay_link,
                            "qr_url": qr_url,
                            "razorpay_payment_link_id": payment_link.get("id"),
                            "razorpay_qr_id": razorpay_qr_id,
                        },
                    )
                    report["payment_qr_sent"] = True
                except Exception as exc:
                    logger.error("Payment QR WhatsApp image send failed for %s order %s: %s", phone, order_id, exc)
                    report["errors"].append(f"payment_qr_send:{exc}")
                    save_message(
                        db, session_id, "system",
                        f"[payment_qr_send_failed] {order_id}: {exc}",
                        meta={
                            "order_id": order_id,
                            "flow": "payment_qr_send_failed",
                            "payment_url": pay_link,
                            "qr_url": qr_url,
                            "error": str(exc),
                        },
                    )

    return report


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
