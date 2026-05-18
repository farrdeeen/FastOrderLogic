import logging
import re
from datetime import datetime
from typing import Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from services.chat_service import get_or_create_session, normalize_phone, save_message
from services.whatsapp_service import send_order_confirmation, send_text_message

logger = logging.getLogger(__name__)


def _amount_label(amount: float) -> str:
    try:
        value = float(amount or 0)
    except (TypeError, ValueError):
        value = 0
    return f"Rs. {value:,.0f}" if value else "the requested amount"


def _payment_reference_from_entity(payment_entity: dict, fallback_entity: dict) -> tuple[Optional[str], Optional[str]]:
    acquirer = payment_entity.get("acquirer_data") or {}
    utr_number = (
        acquirer.get("rrn")
        or acquirer.get("upi_transaction_id")
        or acquirer.get("bank_transaction_id")
    )
    payment_id = (
        payment_entity.get("id")
        or fallback_entity.get("payment_id")
    )
    return utr_number, payment_id


def extract_razorpay_payment_details(payload: dict, event: str) -> dict:
    body = payload.get("payload") or {}
    payment_entity = ((body.get("payment") or {}).get("entity") or {})

    if event == "payment_link.paid":
        entity = ((body.get("payment_link") or {}).get("entity") or {})
        reference_id = entity.get("reference_id") or (entity.get("notes") or {}).get("order_id")
        raw_amount = entity.get("amount_paid") or payment_entity.get("amount") or entity.get("amount") or 0
    else:
        entity = ((body.get("qr_code") or {}).get("entity") or {})
        notes = entity.get("notes") or payment_entity.get("notes") or {}
        reference_id = notes.get("order_id")
        raw_amount = payment_entity.get("amount") or entity.get("payment_amount") or 0

    try:
        amount = float(raw_amount or 0) / 100
    except (TypeError, ValueError):
        amount = 0

    utr_number, payment_id = _payment_reference_from_entity(payment_entity, entity)
    return {
        "reference_id": reference_id,
        "amount": amount,
        "utr_number": utr_number,
        "razorpay_payment_id": payment_id,
        "entity": entity,
        "payment_entity": payment_entity,
    }


def _chat_payment_session_id(reference_id: str) -> Optional[int]:
    match = re.match(r"^CHAT-(\d+)-", str(reference_id or ""), re.IGNORECASE)
    if not match:
        return None
    try:
        return int(match.group(1))
    except ValueError:
        return None


def _payment_note_exists(db: Session, session_id: int, reference_id: str) -> bool:
    row = db.execute(
        text("""
            SELECT id
            FROM chat_messages
            WHERE session_id = :sid
              AND sender = 'system'
              AND meta LIKE :reference
              AND meta LIKE '%"flow": "payment_received"%'
            LIMIT 1
        """),
        {"sid": session_id, "reference": f"%{reference_id}%"},
    ).first()
    return bool(row)


async def _record_chat_payment(
    db: Session,
    session_id: int,
    reference_id: str,
    amount: float,
    utr_number: Optional[str],
    razorpay_payment_id: Optional[str],
) -> dict:
    session = db.execute(
        text("SELECT id, phone_number, wa_contact_name FROM chat_sessions WHERE id = :sid"),
        {"sid": session_id},
    ).mappings().first()
    if not session:
        return {"status": "chat_session_not_found", "reference_id": reference_id}

    if _payment_note_exists(db, session_id, reference_id):
        return {"status": "already_notified", "session_id": session_id, "reference_id": reference_id}

    amount_text = _amount_label(amount)
    ref_line = f"UTR: {utr_number}" if utr_number else f"Razorpay ID: {razorpay_payment_id or 'available in Razorpay'}"
    note = f"Payment received: {amount_text}. {ref_line}. Confirmed by Razorpay."
    save_message(
        db,
        session_id,
        "system",
        note,
        meta={
            "flow": "payment_received",
            "reference_id": reference_id,
            "amount": amount,
            "utr_number": utr_number,
            "razorpay_payment_id": razorpay_payment_id,
            "confirmed_by": "razorpay",
            "confirmed_at": datetime.now().isoformat(),
        },
    )

    try:
        await send_text_message(
            session["phone_number"],
            f"Payment received for {amount_text}. Your payment is confirmed by Razorpay. Thank you.",
        )
    except Exception as exc:
        logger.warning("Payment received WhatsApp text failed for chat session %s: %s", session_id, exc)

    return {"status": "chat_payment_recorded", "session_id": session_id, "reference_id": reference_id}


async def record_confirmed_razorpay_payment(
    db: Session,
    reference_id: str,
    amount: float,
    utr_number: Optional[str] = None,
    razorpay_payment_id: Optional[str] = None,
) -> dict:
    reference_id = str(reference_id or "").strip()
    chat_session_id = _chat_payment_session_id(reference_id)
    if chat_session_id:
        return await _record_chat_payment(
            db,
            chat_session_id,
            reference_id,
            amount,
            utr_number,
            razorpay_payment_id,
        )

    row = db.execute(
        text("""
            SELECT
                o.order_id,
                o.payment_status,
                o.utr_number,
                o.total_amount,
                COALESCE(c.mobile, oc.mobile) AS mobile,
                COALESCE(c.name, oc.name) AS customer_name
            FROM orders o
            LEFT JOIN customer c ON c.customer_id = o.customer_id
            LEFT JOIN offline_customer oc ON oc.customer_id = o.offline_customer_id
            WHERE o.order_id = :oid
            LIMIT 1
        """),
        {"oid": reference_id},
    ).mappings().first()
    if not row:
        return {"status": "order_not_found", "order_id": reference_id}

    db.execute(
        text("""
            UPDATE orders
            SET payment_status = 'paid',
                order_status = 'APPR',
                utr_number = COALESCE(:utr_number, utr_number),
                updated_at = :updated_at
            WHERE order_id = :oid
        """),
        {"oid": reference_id, "utr_number": utr_number, "updated_at": datetime.now()},
    )
    db.commit()

    try:
        from routes.orders import notify_order_change

        notify_order_change(reference_id, "updated")
    except Exception as exc:
        logger.debug("Order websocket notify failed after Razorpay webhook: %s", exc)

    if not row["mobile"]:
        return {"status": "order_paid_no_customer_phone", "order_id": reference_id}

    phone = normalize_phone(row["mobile"])
    session = get_or_create_session(db, phone, row["customer_name"] or "Customer")
    already_notified = _payment_note_exists(db, int(session["id"]), reference_id)
    if already_notified:
        return {"status": "already_notified", "order_id": reference_id, "session_id": session["id"]}

    amount_text = _amount_label(amount or row["total_amount"])
    ref_line = f"UTR: {utr_number}" if utr_number else f"Razorpay ID: {razorpay_payment_id or 'available in Razorpay'}"
    save_message(
        db,
        int(session["id"]),
        "system",
        f"Payment received for Order {reference_id}: {amount_text}. {ref_line}. Confirmed by Razorpay.",
        meta={
            "flow": "payment_received",
            "order_id": reference_id,
            "amount": amount or float(row["total_amount"] or 0),
            "utr_number": utr_number,
            "razorpay_payment_id": razorpay_payment_id,
            "confirmed_by": "razorpay",
            "confirmed_at": datetime.now().isoformat(),
        },
    )

    try:
        await send_order_confirmation(phone, row["customer_name"] or "Customer", reference_id, amount_text)
    except Exception as exc:
        logger.error("Razorpay paid template WhatsApp send failed for %s: %s", phone, exc)
        try:
            await send_text_message(
                phone,
                f"Payment received for Order {reference_id}. Your order is now confirmed and will be shipped soon.",
            )
        except Exception as fallback_exc:
            logger.error("Razorpay paid text WhatsApp send failed for %s: %s", phone, fallback_exc)

    return {"status": "order_payment_recorded", "order_id": reference_id, "session_id": session["id"]}
