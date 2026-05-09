"""
routes/payment_webhook.py
─────────────────────────
ALL routes in this file are PUBLIC — no Clerk auth.
Users arriving from WhatsApp payment buttons must reach Razorpay without logging in.

Registered in main.py BEFORE any auth middleware scope.

WhatsApp button URL configured in Meta as:
    https://mtmdash.com/pay/{{1}}
where {{1}} is substituted by WhatsApp with the encoded order token at send time.

If WhatsApp fails to substitute {{1}} the URL arrives as:
    https://mtmdash.com/pay/{{1}}<token>
_strip_template_placeholder removes the literal "{{1}}" prefix before processing.
"""

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import PlainTextResponse, RedirectResponse, Response
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


# ── HEAD handlers — WhatsApp link preview & curl -I hit these ────────────────

@router.head("/pay/{order_token:path}")
async def pay_head(order_token: str):
    """HEAD handler so WhatsApp link-preview and curl -I don't get 405."""
    return Response(status_code=200)


@router.head("/pay/order/{order_id:path}")
async def pay_order_head(order_id: str):
    return Response(status_code=200)


# ── Razorpay webhook (POST, public) ──────────────────────────────────────────

@router.post("/webhook/razorpay")
async def razorpay_webhook(request: Request):
    body      = await request.body()
    signature = request.headers.get("x-razorpay-signature")

    if not SECRET:
        logger.error("RAZORPAY_WEBHOOK_SECRET is not configured.")
        raise HTTPException(status_code=500, detail="webhook secret missing")
    if not signature:
        logger.warning("Razorpay webhook missing signature header.")
        raise HTTPException(status_code=400, detail="missing signature")

    expected = hmac.new(SECRET.encode(), body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        logger.warning("Razorpay webhook invalid signature.")
        raise HTTPException(status_code=400, detail="invalid signature")

    payload = await request.json()
    event   = payload.get("event")

    if event in ("payment_link.paid", "qr_code.credited"):
        payment_entity = {}
        if event == "payment_link.paid":
            entity     = (((payload.get("payload") or {}).get("payment_link") or {}).get("entity") or {})
            order_id   = entity.get("reference_id") or (entity.get("notes") or {}).get("order_id")
            raw_amount = entity.get("amount_paid") or entity.get("amount") or 0
            utr_number = None
        else:
            entity         = (((payload.get("payload") or {}).get("qr_code") or {}).get("entity") or {})
            payment_entity = (((payload.get("payload") or {}).get("payment") or {}).get("entity") or {})
            notes          = entity.get("notes") or payment_entity.get("notes") or {}
            order_id       = notes.get("order_id")
            raw_amount     = payment_entity.get("amount") or entity.get("payment_amount") or 0
            utr_number     = (payment_entity.get("acquirer_data") or {}).get("rrn")

        try:
            amount = float(raw_amount or 0) / 100
        except (TypeError, ValueError):
            amount = 0

        if not order_id:
            logger.error("Razorpay %s webhook missing order_id: %s", event, entity)
            return {"status": "missing_order_id"}

        db = SessionLocal()
        try:
            result = db.execute(
                text("""
                    UPDATE orders
                    SET payment_status = 'paid',
                        order_status   = 'APPR',
                        utr_number     = COALESCE(:utr_number, utr_number),
                        updated_at     = :updated_at
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
                logger.debug("WS notify failed after Razorpay webhook: %s", exc)

            row = db.execute(
                text("""
                    SELECT
                        COALESCE(c.mobile, oc.mobile)  AS mobile,
                        COALESCE(c.name,   oc.name)    AS customer_name
                    FROM orders o
                    LEFT JOIN customer         c  ON c.customer_id  = o.customer_id
                    LEFT JOIN offline_customer oc ON oc.customer_id = o.offline_customer_id
                    WHERE o.order_id = :oid
                """),
                {"oid": order_id},
            ).fetchone()

            if row and row.mobile:
                phone         = normalize_phone(row.mobile)
                customer_name = row.customer_name or "Customer"
                amount_text   = f"₹{amount:,.0f}" if amount else "—"
                try:
                    await send_order_confirmation(phone, customer_name, order_id, amount_text)
                except Exception as exc:
                    logger.error("Razorpay paid template WA failed for %s: %s", phone, exc)
                    try:
                        await send_text_message(
                            phone,
                            f"✅ Payment received for Order {order_id}!\n\n"
                            "Your order is confirmed and will be shipped soon 🚚",
                        )
                    except Exception as fb_exc:
                        logger.error("Razorpay paid text WA fallback failed for %s: %s", phone, fb_exc)
            else:
                logger.warning("Razorpay paid order has no customer phone: %s", order_id)
        finally:
            db.close()

    return {"status": "ok"}


# ── Payment redirect helpers ──────────────────────────────────────────────────

async def _redirect_to_razorpay_for_order(order_id: str):
    """Look up order, create/reuse a Razorpay payment link, redirect there."""
    db = SessionLocal()
    try:
        row = db.execute(
            text("""
                SELECT
                    o.order_id,
                    o.total_amount,
                    o.payment_status,
                    COALESCE(c.mobile,  oc.mobile) AS mobile,
                    COALESCE(c.name,    oc.name)   AS customer_name
                FROM orders o
                LEFT JOIN customer         c  ON c.customer_id  = o.customer_id
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
        return PlainTextResponse(
            f"✅ Payment already received for Order {order_id}. Thank you!",
            status_code=200,
        )

    try:
        payment_link = await create_payment_link_details(
            order_id=order_id,
            amount=float(row.total_amount or 0),
            name=row.customer_name or "Customer",
            phone=row.mobile or "",
        )
    except PaymentLinkError as exc:
        logger.error("Pay redirect: Razorpay link creation failed for %s: %s", order_id, exc)
        raise HTTPException(status_code=502, detail="Unable to create payment link")

    pay_url = payment_link.get("short_url")
    if not pay_url:
        raise HTTPException(status_code=502, detail="Razorpay did not return a payment URL")

    # 302 → browser follows to Razorpay immediately, no login wall
    return RedirectResponse(pay_url, status_code=302)


def _strip_template_placeholder(value: str) -> str:
    """
    Remove the literal '{{1}}' prefix that WhatsApp leaves when it fails to
    substitute the template variable (e.g. '{{1}}Do1MyP4' → 'Do1MyP4').
    Also URL-decodes the value so %7B%7B1%7D%7D is handled identically.
    """
    reference = unquote(str(value or "").strip())
    if reference.startswith("{{1}}"):
        reference = reference[len("{{1}}"):]
    return reference.strip()


def _looks_like_order_id(value: str) -> bool:
    """
    Return True if value is plausibly a real order ID.
    Extend the prefixes list to match your order ID conventions.
    """
    upper = str(value or "").upper()
    return (
        "#" in upper
        or upper.startswith(("WIX", "ORD", "AI-"))
        or upper.isdigit()
    )


def _redirect_razorpay_short_code(short_code: str):
    """Build a full rzp.io URL from a bare short code and redirect there."""
    clean = str(short_code or "").strip().strip("/")
    if not clean:
        raise HTTPException(status_code=400, detail="Invalid payment link")
    if clean.startswith(("http://", "https://")):
        return RedirectResponse(clean, status_code=302)
    return RedirectResponse(f"{RAZORPAY_SHORT_URL_BASE}/{clean}", status_code=302)


def _try_decode_token(token: str):
    """
    Attempt to base64-decode a token into an order ID.
    Returns the decoded string only if it looks like a real order ID,
    otherwise returns None so the caller can fall back to treating the
    token as a Razorpay short code.

    This guards against random short codes (e.g. 'Do1MyP4') that happen
    to be valid base64 but decode to garbage, not an order ID.
    """
    try:
        candidate = decode_payment_order_token(token)
        if _looks_like_order_id(candidate):
            return candidate
        logger.debug(
            "Token '%s' decoded to '%s' which is not a recognisable order ID — "
            "treating as Razorpay short code.",
            token,
            candidate,
        )
        return None
    except PaymentLinkError:
        return None


# ── Public GET routes (NO auth dependency) ───────────────────────────────────

@router.get("/pay/order/{order_id:path}")
async def redirect_order_id_to_payment(order_id: str):
    """
    Direct order-ID redirect. Used when button URL is:
        https://mtmdash.com/pay/order/{order_id}
    """
    return await _redirect_to_razorpay_for_order(order_id)


@router.get("/pay/{order_token:path}")
async def redirect_to_payment(order_token: str):
    """
    Token-based redirect. WhatsApp button URL configured in Meta as:
        https://mtmdash.com/pay/{{1}}
    where {{1}} is replaced at send time with the encoded order token.

    Decision tree
    ─────────────
    1. Strip any un-substituted '{{1}}' prefix left by WhatsApp.
    2. If the value is already a full Razorpay/rzp.io URL → redirect directly.
    3. If the value looks like an order ID already → look up the order.
    4. Otherwise try to base64-decode it:
       a. Decoded value looks like an order ID → look up the order.
       b. Decoding fails or result is not an order ID → treat as rzp.io short code.

    No login required. No React frontend involved.
    """
    decoded = _strip_template_placeholder(order_token)

    if not decoded:
        raise HTTPException(status_code=400, detail="Invalid payment link")

    # ── Step 2: already a full Razorpay URL ──────────────────────────────────
    if decoded.startswith(("https://rzp.io/", "https://razorpay.com/")):
        logger.debug("Pay redirect: forwarding full Razorpay URL %s", decoded)
        return RedirectResponse(decoded, status_code=302)

    # ── Step 3: plain order ID (no decoding needed) ───────────────────────────
    if _looks_like_order_id(decoded):
        logger.debug("Pay redirect: plain order ID '%s'", decoded)
        return await _redirect_to_razorpay_for_order(decoded)

    # ── Step 4: attempt base64 decode ─────────────────────────────────────────
    order_id = _try_decode_token(decoded)
    if order_id:
        logger.debug("Pay redirect: decoded token '%s' → order '%s'", decoded, order_id)
        return await _redirect_to_razorpay_for_order(order_id)

    # ── Step 4b: not an order token → must be a Razorpay short code ───────────
    logger.debug("Pay redirect: treating '%s' as Razorpay short code", decoded)
    return _redirect_razorpay_short_code(decoded)