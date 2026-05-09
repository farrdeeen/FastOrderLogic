from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import PlainTextResponse, RedirectResponse
import hmac
import hashlib
import logging
import os
from datetime import datetime
from urllib.parse import unquote
from sqlalchemy import text
from database import SessionLocal
from services.chat_service import normalize_phone
from services.payment_service import (
    PaymentLinkError,
    create_payment_link_details,
    decode_payment_order_token,
)
from services.whatsapp_service import send_order_confirmation, send_text_message

router = APIRouter()

SECRET = os.getenv("RAZORPAY_WEBHOOK_SECRET")
RAZORPAY_SHORT_URL_BASE = os.getenv("RAZORPAY_SHORT_URL_BASE", "https://rzp.io/i").rstrip("/")
logger = logging.getLogger(__name__)


@router.post("/webhook/razorpay")
async def razorpay_webhook(request: Request):
    body = await request.body()
    signature = request.headers.get("x-razorpay-signature")

    if not SECRET:
        logger.error("RAZORPAY_WEBHOOK_SECRET is not configured.")
        raise HTTPException(status_code=500, detail="webhook secret missing")
    if not signature:
        logger.warning("Razorpay webhook missing signature header.")
        raise HTTPException(status_code=400, detail="missing signature")

    # ── Verify signature ─────────────────────────
    expected = hmac.new(
        SECRET.encode(),
        body,
        hashlib.sha256
    ).hexdigest()

    if not hmac.compare_digest(expected, signature):
        logger.warning("Razorpay webhook invalid signature.")
        raise HTTPException(status_code=400, detail="invalid signature")

    payload = await request.json()
    event = payload.get("event")

    # ── Handle payment success ───────────────────
    if event in ("payment_link.paid", "qr_code.credited"):
        payment_entity = {}
        if event == "payment_link.paid":
            entity = (
                ((payload.get("payload") or {}).get("payment_link") or {}).get("entity")
                or {}
            )
            order_id = entity.get("reference_id") or (entity.get("notes") or {}).get("order_id")
            raw_amount = entity.get("amount_paid") or entity.get("amount") or 0
            utr_number = None
        else:
            entity = (
                ((payload.get("payload") or {}).get("qr_code") or {}).get("entity")
                or {}
            )
            payment_entity = (
                ((payload.get("payload") or {}).get("payment") or {}).get("entity")
                or {}
            )
            notes = entity.get("notes") or payment_entity.get("notes") or {}
            order_id = notes.get("order_id")
            raw_amount = payment_entity.get("amount") or entity.get("payment_amount") or 0
            utr_number = (payment_entity.get("acquirer_data") or {}).get("rrn")

        try:
            amount = float(raw_amount or 0) / 100
        except (TypeError, ValueError):
            amount = 0

        if not order_id:
            logger.error("Razorpay %s webhook missing order_id: %s", event, entity)
            return {"status": "missing_order_id"}

        db = SessionLocal()
        try:
            # ✅ Update DB
            result = db.execute(
                text("""
                    UPDATE orders
                    SET payment_status = 'paid',
                        order_status = 'APPR',
                        utr_number = COALESCE(:utr_number, utr_number),
                        updated_at = :updated_at
                    WHERE order_id = :oid
                """),
                {"oid": order_id, "utr_number": utr_number, "updated_at": datetime.now()},
            )
            db.commit()

            if result.rowcount == 0:
                logger.warning("Razorpay payment received but order not found: %s", order_id)
                return {"status": "order_not_found", "order_id": order_id}

            try:
                from routes.orders import notify_order_change

                notify_order_change(order_id, "updated")
            except Exception as exc:
                logger.debug("Order websocket notify failed after Razorpay webhook: %s", exc)

            # ✅ Get phone
            row = db.execute(
                text("""
                    SELECT
                        COALESCE(c.mobile, oc.mobile) AS mobile,
                        COALESCE(c.name, oc.name) AS customer_name
                    FROM orders o
                    LEFT JOIN customer c ON c.customer_id = o.customer_id
                    LEFT JOIN offline_customer oc ON oc.customer_id = o.offline_customer_id
                    WHERE o.order_id = :oid
                """),
                {"oid": order_id},
            ).fetchone()

            if row and row.mobile:
                phone = normalize_phone(row.mobile)
                customer_name = row.customer_name or "Customer"
                amount_text = f"₹{amount:,.0f}" if amount else "—"

                # Use the approved template first; fallback to text only if template fails.
                try:
                    await send_order_confirmation(phone, customer_name, order_id, amount_text)
                except Exception as exc:
                    logger.error("Razorpay paid template WhatsApp send failed for %s: %s", phone, exc)
                    try:
                        await send_text_message(
                            phone,
                            f"✅ Payment received for Order {order_id}!\n\n"
                            "Your order is now confirmed and will be shipped soon 🚚",
                        )
                    except Exception as fallback_exc:
                        logger.error("Razorpay paid text WhatsApp send failed for %s: %s", phone, fallback_exc)
            else:
                logger.warning("Razorpay paid order has no customer phone: %s", order_id)

        finally:
            db.close()

    return {"status": "ok"}


async def _redirect_to_razorpay_for_order(order_id: str):
    db = SessionLocal()
    try:
        row = db.execute(
            text("""
                SELECT
                    o.order_id,
                    o.total_amount,
                    o.payment_status,
                    COALESCE(c.mobile, oc.mobile) AS mobile,
                    COALESCE(c.name, oc.name) AS customer_name
                FROM orders o
                LEFT JOIN customer c ON c.customer_id = o.customer_id
                LEFT JOIN offline_customer oc ON oc.customer_id = o.offline_customer_id
                WHERE o.order_id = :oid
            """),
            {"oid": order_id},
        ).fetchone()
    finally:
        db.close()

    if not row:
        raise HTTPException(status_code=404, detail="Order not found")

    if (row.payment_status or "").lower() in ("paid", "success", "accepted"):
        return PlainTextResponse(f"Payment already received for Order {order_id}.")

    try:
        payment_link = await create_payment_link_details(
            order_id=order_id,
            amount=float(row.total_amount or 0),
            name=row.customer_name or "Customer",
            phone=row.mobile or "",
        )
    except PaymentLinkError as exc:
        logger.error("Pay redirect failed to create Razorpay link for %s: %s", order_id, exc)
        raise HTTPException(status_code=502, detail="Unable to create payment link")

    pay_url = payment_link.get("short_url")
    if not pay_url:
        raise HTTPException(status_code=502, detail="Razorpay did not return a payment URL")

    return RedirectResponse(pay_url, status_code=302)


def _resolve_order_reference(value: str) -> str:
    reference = unquote(str(value or "").strip())
    if reference.startswith("{{1}}"):
        reference = reference[len("{{1}}"):]
    reference = reference.strip()
    if not reference:
        raise HTTPException(status_code=400, detail="Invalid payment link")
    try:
        return decode_payment_order_token(reference)
    except PaymentLinkError:
        return reference


def _strip_template_placeholder(value: str) -> str:
    reference = unquote(str(value or "").strip())
    if reference.startswith("{{1}}"):
        reference = reference[len("{{1}}"):]
    return reference.strip()


def _looks_like_order_reference(value: str) -> bool:
    upper = str(value or "").upper()
    return (
        "#" in upper
        or upper.startswith(("WIX", "ORD", "AI-"))
        or upper.isdigit()
    )


def _redirect_razorpay_short_code(short_code: str):
    clean = str(short_code or "").strip().strip("/")
    if not clean:
        raise HTTPException(status_code=400, detail="Invalid payment link")
    if clean.startswith(("http://", "https://")):
        return RedirectResponse(clean, status_code=302)
    return RedirectResponse(f"{RAZORPAY_SHORT_URL_BASE}/{clean}", status_code=302)


@router.get("/pay/order/{order_id:path}")
async def redirect_order_id_to_payment(order_id: str):
    return await _redirect_to_razorpay_for_order(order_id)


@router.head("/pay/order/{order_id:path}")
async def head_redirect_order_id_to_payment(order_id: str):
    return await _redirect_to_razorpay_for_order(order_id)


@router.get("/pay/{order_token:path}")
async def redirect_to_payment(order_token: str):
    decoded = _strip_template_placeholder(order_token)
    if decoded.startswith(("https://rzp.io/", "https://razorpay.com/")):
        return RedirectResponse(decoded, status_code=302)

    if decoded and not _looks_like_order_reference(decoded):
        try:
            decode_payment_order_token(decoded)
        except PaymentLinkError:
            return _redirect_razorpay_short_code(decoded)

    order_id = _resolve_order_reference(order_token)
    return await _redirect_to_razorpay_for_order(order_id)


@router.head("/pay/{order_token:path}")
async def head_redirect_to_payment(order_token: str):
    return await redirect_to_payment(order_token)
