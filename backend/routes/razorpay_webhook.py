from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import PlainTextResponse, RedirectResponse
import hmac
import hashlib
import logging
import os
from urllib.parse import unquote
from sqlalchemy import text
from database import SessionLocal
from services.payment_service import (
    PaymentLinkError,
    create_payment_link_details,
    decode_payment_order_token,
)
from services.razorpay_confirmation_service import (
    extract_razorpay_payment_details,
    record_confirmed_razorpay_payment,
)

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
        details = extract_razorpay_payment_details(payload, event)
        order_id = details["reference_id"]

        if not order_id:
            logger.error("Razorpay %s webhook missing order_id: %s", event, details["entity"])
            return {"status": "missing_order_id"}

        db = SessionLocal()
        try:
            result = await record_confirmed_razorpay_payment(
                db,
                order_id,
                details["amount"],
                utr_number=details["utr_number"],
                razorpay_payment_id=details["razorpay_payment_id"],
            )
            if result.get("status") == "order_not_found":
                logger.warning("Razorpay payment received but order not found: %s", order_id)
                return result

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
