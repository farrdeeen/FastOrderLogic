from fastapi import APIRouter, Request
import hmac
import hashlib
import os
from sqlalchemy import text
from database import SessionLocal
from services.whatsapp_service import send_text_message

router = APIRouter()

SECRET = os.getenv("RAZORPAY_WEBHOOK_SECRET")


@router.post("/webhook/razorpay")
async def razorpay_webhook(request: Request):
    body = await request.body()
    signature = request.headers.get("x-razorpay-signature")

    # ── Verify signature ─────────────────────────
    expected = hmac.new(
        SECRET.encode(),
        body,
        hashlib.sha256
    ).hexdigest()

    if not hmac.compare_digest(expected, signature):
        return {"status": "invalid signature"}

    payload = await request.json()
    event = payload.get("event")

    # ── Handle payment success ───────────────────
    if event == "payment_link.paid":
        entity = payload["payload"]["payment_link"]["entity"]

        order_id = entity.get("reference_id")   # 🔥 IMPORTANT
        amount   = entity.get("amount_paid") / 100

        db = SessionLocal()
        try:
            # ✅ Update DB
            db.execute(
                text("""
                    UPDATE orders
                    SET payment_status = 'paid'
                    WHERE order_id = :oid
                """),
                {"oid": order_id},
            )
            db.commit()

            # ✅ Get phone
            row = db.execute(
                text("SELECT phone FROM orders WHERE order_id = :oid"),
                {"oid": order_id},
            ).fetchone()

            if row:
                phone = row.phone

                # ✅ WhatsApp confirmation
                await send_text_message(
                    phone,
                    f"✅ Payment received for Order {order_id}!\n\n"
                    "Your order is now confirmed and will be shipped soon 🚚"
                )

        finally:
            db.close()

    return {"status": "ok"}