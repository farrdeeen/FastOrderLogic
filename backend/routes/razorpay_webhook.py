from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import PlainTextResponse, RedirectResponse
import hmac
import hashlib
import logging
import os
from datetime import datetime
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


@router.get("/pay/{order_token}")
async def redirect_to_payment(order_token: str):
    try:
        order_id = decode_payment_order_token(order_token)
    except PaymentLinkError:
        raise HTTPException(status_code=400, detail="Invalid payment link")

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
