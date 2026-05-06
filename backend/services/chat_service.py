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
    generate_reply,
    generate_product_reply,
    get_order_status_text,
    get_orders_by_phone,
    format_orders_status_for_customer,
    extract_order_json,
    is_address_confirmed,
    analyze_media,
)
from services.whatsapp_service import (
    send_text_message,
    send_order_confirmation,
    send_template_message,
    send_image_message,
)
from services.payment_service import (
    PaymentLinkError,
    build_payment_qr_url,
    create_payment_qr_details,
    create_payment_link_details,
    encode_payment_order_token,
)
from services.ai_order_service import (
    place_ai_order,
    build_order_confirmation_message,
)

logger = logging.getLogger(__name__)

_TEMPLATE_ORDER_CONFIRMED = "order_confirmation"
_TEMPLATE_PAYMENT_PENDING = "payment_pending"
_RAZORPAY_BASE = os.getenv("RAZORPAY_BASE_URL", "https://rzp.io/l")


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


# ─────────────────────────────────────────────────────────────────────────────
# Session helpers
# ─────────────────────────────────────────────────────────────────────────────

def get_or_create_session(db: Session, phone: str, contact_name: str = "") -> dict:
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
    return result.lastrowid


def get_conversation_history(db: Session, session_id: int, limit: int = 20) -> list[dict]:
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
        role = "user" if r.sender == "user" else "assistant"
        history.append({"role": role, "content": r.message})
    return history


# ─────────────────────────────────────────────────────────────────────────────
# Media handler
# ─────────────────────────────────────────────────────────────────────────────

async def handle_inbound_media(
    db: Session,
    phone: str,
    media_url: str,
    media_type: str,
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

    save_message(db, session_id, "user", f"[media:{media_type}]", wa_message_id=wa_message_id)

    reply = await analyze_media(media_url, media_type)
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

    # ── Explicit order ID shortcut (structural regex is fine here) ─────────────
    order_id_match = re.search(
        r"\b(\d{5}#\d{5}|WIX#\d+|ORD-\d+|AI-\d{5})\b",
        text_body,
        re.IGNORECASE,
    )
    if order_id_match:
        order_id    = order_id_match.group(1)
        status_text = get_order_status_text(order_id, db)
        if status_text:
            save_message(db, session_id, "ai", status_text)
            try:
                await send_text_message(phone, status_text)
            except Exception as exc:
                logger.error("Failed to send order status to %s: %s", phone, exc)
            return status_text

    # ── Build history for context (exclude the user turn we just saved) ────────
    history = get_conversation_history(db, session_id, limit=18)
    if history and history[-1]["role"] == "user" and history[-1]["content"] == text_body:
        history_for_context = history[:-1]
    else:
        history_for_context = history

    # ── LLM intent classification ──────────────────────────────────────────────
    intent = await classify_intent(text_body, history_for_context[-5:])
    logger.info(
        "handle_inbound: session=%s phone=%s intent=%s msg=%r",
        session_id, phone, intent, text_body[:60],
    )

    # ── Route: order management ────────────────────────────────────────────────
    if is_order_management_intent(intent):
        orders = get_orders_by_phone(phone, db)

        if orders:
            status_reply = format_orders_status_for_customer(orders)

            if intent == "order_payment":
                pending = [
                    o for o in orders
                    if (o.get("payment_status") or "").lower()
                    not in ("paid", "success", "accepted")
                ]
                if pending:
                    status_reply += (
                        "\n\n⚠️ We can see your order is still showing payment pending on our end. "
                        "If you've already paid, please share your payment screenshot or UTR number "
                        "and we'll verify and dispatch within 1–2 hours. 🙏"
                    )
                else:
                    not_shipped = [
                        o for o in orders
                        if (o.get("delivery_status") or "NOT_SHIPPED").upper()
                        not in ("SHIPPED", "COMPLETED")
                    ]
                    if not_shipped:
                        status_reply += (
                            "\n\n✅ Payment received! Your order is being prepared for dispatch. "
                            "You'll receive a tracking number once it's shipped. 🚀"
                        )

            elif intent == "order_dispatch":
                not_shipped = [
                    o for o in orders
                    if (o.get("delivery_status") or "NOT_SHIPPED").upper()
                    not in ("SHIPPED", "COMPLETED")
                ]
                if not_shipped:
                    status_reply += (
                        "\n\n🚀 Orders are typically dispatched within 1–2 business days after "
                        "payment confirmation. We'll send you the tracking number as soon as it ships!"
                    )
        else:
            status_reply = (
                "I couldn't find any orders linked to your number. 😔\n\n"
                "Could you please share your Order ID (e.g. AI-00123 or WIX#1234)? "
                "Or I'll connect you with our team right away. 🙏"
            )

        save_message(db, session_id, "ai", status_reply)
        try:
            await send_text_message(phone, status_reply)
        except Exception as exc:
            logger.error("Order status reply send failed %s: %s", phone, exc)
        return status_reply

    # ── Route: product browsing — LLM already confirmed intent ─────────────────
    if is_product_intent(intent):
        logger.info("handle_inbound: product_browse intent — calling generate_product_reply")
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

            for img_url in images[:2]:
                try:
                    logger.debug("handle_inbound: sending image url=%s to phone=%s", img_url[:80], phone)
                    await asyncio.wait_for(
                        send_image_message(phone, img_url),
                        timeout=10.0,
                    )
                    await asyncio.sleep(0.3)
                except asyncio.TimeoutError:
                    logger.warning("handle_inbound: image send timeout phone=%s url=%s", phone, img_url[:60])
                except Exception as exc:
                    logger.error("handle_inbound: image send failed phone=%s url=%s err=%s", phone, img_url[:60], exc)

            return text_msg

        # Intent was product_browse but no products matched — fall through to AI
        logger.info("handle_inbound: no products matched, falling through to AI reply")

    # ── Route: everything else → full AI reply ─────────────────────────────────
    ai_reply = await generate_reply(history_for_context, text_body)

    # ── Check if AI produced a complete order JSON ─────────────────────────────
    order_data = extract_order_json(ai_reply)
    if order_data:
        logger.info("handle_inbound: AI order JSON detected for session=%s", session_id)
        if not order_data.get("mobile"):
            order_data["mobile"] = re.sub(r"\D", "", phone)[-10:]

        result        = place_ai_order(order_data, db)
        customer_name = order_data.get("name", "Customer")
        confirm_msg   = build_order_confirmation_message(result, customer_name)
        order_id      = result.get("order_id")
        raw_total     = result.get("total") or result.get("total_amount") or 0
        amount_str    = f"₹{float(raw_total):,.0f}" if raw_total else "—"

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

        try:
            await notify_order_created(
                db=db,
                phone=phone,
                order_id=order_id,
                customer_name=customer_name,
                amount=amount_str,
                address_line=order_data.get("address", ""),
                payment_status=result.get("payment_status", "pending"),
            )
        except Exception as exc:
            logger.error("notify_order_created failed %s: %s", phone, exc)

        return ai_reply

    # ── Normal AI reply ────────────────────────────────────────────────────────
    save_message(db, session_id, "ai", ai_reply)

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
    is_paid    = payment_status.lower() in ("paid", "success", "accepted")

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

        if address_line:
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
        payment_button_token = encode_payment_order_token(order_id)
        payment_template_components = [{
            "type": "body",
            "parameters": [
                {"type": "text", "text": customer_name or "Customer"},
                {"type": "text", "text": order_id},
                {"type": "text", "text": "your order"},
                {"type": "text", "text": amount or "—"},
            ],
        }]
        payment_template_components_with_button = [
            *payment_template_components,
            {
                "type": "button",
                "sub_type": "url",
                "index": "0",
                "parameters": [{"type": "text", "text": payment_button_token}],
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
                    "payment_button_token": payment_button_token,
                    "payment_button": True,
                },
            )
            report["payment_template_sent"] = True
            report["payment_template_button_sent"] = True
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

        # Always send payment link + scannable QR for unpaid orders.
        try:
            payment_link = await create_payment_link_details(
                order_id=order_id,
                amount=parse_amount(amount),
                name=customer_name or "Customer",
                phone=phone,
            )
            pay_link = payment_link.get("short_url")
            if not pay_link:
                raise PaymentLinkError("No payment link returned")

            pay_msg = (
                f"💳 Complete your payment to confirm shipment:\n{pay_link}\n\n"
                "Once paid, we'll dispatch today. Reply here if you need any help! 🙏"
            )
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
        else:
            report["payment_url"] = pay_link
            report["razorpay_payment_link_id"] = payment_link.get("id")
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
