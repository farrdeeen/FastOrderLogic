import asyncio
import logging
import os
from typing import Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from database import SessionLocal
from services.order_preferences import ensure_order_preference_columns

logger = logging.getLogger(__name__)

_COLUMN_READY = False
_POLLER_TASK: Optional[asyncio.Task] = None

_IN_PROGRESS = 2
_SENT_OR_SKIPPED = 1
_PENDING = 0


def _env_bool(name: str, default: bool = True) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int, minimum: int = 1) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default
    return max(minimum, value)


def ensure_order_notification_columns(db: Session) -> bool:
    """Ensure idempotency columns exist and backfill historical orders as notified."""
    global _COLUMN_READY
    ensure_order_preference_columns(db)
    if _COLUMN_READY:
        return True

    try:
        row = db.execute(text("SHOW COLUMNS FROM orders LIKE 'whatsapp_notified'")).fetchone()
    except Exception as exc:
        logger.warning("Could not inspect orders.whatsapp_notified: %s", exc)
        return False

    if row:
        _COLUMN_READY = True
        return True

    try:
        db.execute(
            text(
                "ALTER TABLE orders "
                "ADD COLUMN whatsapp_notified TINYINT(1) NOT NULL DEFAULT 0"
            )
        )
        db.execute(text("UPDATE orders SET whatsapp_notified = 1"))
        db.commit()
        _COLUMN_READY = True
        logger.info("Added orders.whatsapp_notified and backfilled historical orders to 1")
        return True
    except Exception as exc:
        db.rollback()
        # A second Gunicorn worker may have added it first. Re-check before giving up.
        try:
            row = db.execute(text("SHOW COLUMNS FROM orders LIKE 'whatsapp_notified'")).fetchone()
            _COLUMN_READY = bool(row)
            if _COLUMN_READY:
                return True
        except Exception:
            pass
        logger.warning("Could not add orders.whatsapp_notified: %s", exc)
        return False


def _claim_order(db: Session, order_id: str) -> bool:
    ensure_order_notification_columns(db)
    result = db.execute(
        text("""
            UPDATE orders
            SET whatsapp_notified = :in_progress
            WHERE order_id = :oid
              AND whatsapp_notified = :pending
              AND send_whatsapp = 1
        """),
        {"oid": order_id, "in_progress": _IN_PROGRESS, "pending": _PENDING},
    )
    db.commit()
    return result.rowcount == 1


def _mark_order_sent(db: Session, order_id: str) -> None:
    db.execute(
        text("UPDATE orders SET whatsapp_notified = :done WHERE order_id = :oid"),
        {"oid": order_id, "done": _SENT_OR_SKIPPED},
    )
    db.commit()


def _release_order_claim(db: Session, order_id: str) -> None:
    db.execute(
        text("""
            UPDATE orders
            SET whatsapp_notified = :pending
            WHERE order_id = :oid
              AND whatsapp_notified = :in_progress
        """),
        {"oid": order_id, "pending": _PENDING, "in_progress": _IN_PROGRESS},
    )
    db.commit()


def _template_from_report(report: dict) -> str:
    if report.get("order_template_sent"):
        return "order_confirmation"
    if report.get("payment_template_sent"):
        return "payment_pending"
    return ""


def _report_template_success(report: Optional[dict]) -> bool:
    if not report or not _template_from_report(report):
        return False

    fatal_tokens = (
        "order_confirmation_template",
        "payment_pending_template",
        "payment_pending_template_button",
        "payment_link_create",
        "payment_link_prepare",
    )
    errors = report.get("errors") or []
    return not any(
        any(token in str(error) for token in fatal_tokens)
        for error in errors
    )


def _format_amount(value) -> str:
    try:
        return f"₹{float(value or 0):,.0f}"
    except (TypeError, ValueError):
        return "₹0"


def _load_order_context(db: Session, order_id: str) -> Optional[dict]:
    row = db.execute(
        text("""
            SELECT
                o.order_id,
                o.total_amount,
                o.payment_status,
                COALESCE(NULLIF(a.name, ''), NULLIF(c.name, ''), NULLIF(oc.name, ''), 'Customer') AS customer_name,
                COALESCE(NULLIF(a.mobile, ''), NULLIF(c.mobile, ''), NULLIF(oc.mobile, '')) AS phone,
                CONCAT_WS(
                    ', ',
                    NULLIF(a.address_line, ''),
                    NULLIF(a.locality, ''),
                    NULLIF(a.city, ''),
                    NULLIF(s.name, ''),
                    NULLIF(a.pincode, '')
                ) AS address_line
            FROM orders o
            LEFT JOIN address a ON a.address_id = o.address_id
            LEFT JOIN state s ON s.state_id = a.state_id
            LEFT JOIN customer c ON c.customer_id = o.customer_id
            LEFT JOIN offline_customer oc ON oc.customer_id = o.offline_customer_id
            WHERE o.order_id = :oid
            LIMIT 1
        """),
        {"oid": order_id},
    ).mappings().first()
    return dict(row) if row else None


async def notify_order_created_and_mark(
    order_id: str,
    phone: Optional[str] = None,
    customer_name: str = "",
    amount: str = "",
    address_line: str = "",
    payment_status: str = "pending",
    source: str = "direct",
    send_followup_messages: bool = False,
) -> dict:
    """Claim an order, call the existing WhatsApp template helper, then mark success."""
    db = SessionLocal()
    try:
        if not _claim_order(db, order_id):
            logger.info("Order WhatsApp notify skipped for %s from %s — already claimed/notified", order_id, source)
            return {"order_id": order_id, "skipped": "already_claimed_or_notified"}

        if not phone:
            context = _load_order_context(db, order_id)
            if not context:
                logger.warning("Order WhatsApp notify deferred for %s — order context missing", order_id)
                _release_order_claim(db, order_id)
                return {"order_id": order_id, "skipped": "missing_order_context"}
            phone = context.get("phone") or ""
            customer_name = customer_name or context.get("customer_name") or "Customer"
            amount = amount or _format_amount(context.get("total_amount"))
            address_line = address_line or context.get("address_line") or ""
            payment_status = payment_status or context.get("payment_status") or "pending"

        if not str(phone or "").strip():
            logger.warning("Order WhatsApp notify skipped permanently for %s — no customer phone", order_id)
            _mark_order_sent(db, order_id)
            return {"order_id": order_id, "skipped": "missing_phone"}

        if not str(address_line or "").strip():
            logger.warning("Order WhatsApp notify deferred for %s — delivery address missing", order_id)
            _release_order_claim(db, order_id)
            return {"order_id": order_id, "skipped": "missing_address"}

        from services.chat_service import notify_order_created

        report = await notify_order_created(
            db=db,
            phone=phone,
            order_id=order_id,
            customer_name=customer_name or "Customer",
            amount=amount,
            address_line=address_line,
            payment_status=payment_status or "pending",
            send_followup_messages=send_followup_messages,
        )

        template = _template_from_report(report)
        if _report_template_success(report):
            _mark_order_sent(db, order_id)
            logger.info("Order WhatsApp notified for %s via %s from %s", order_id, template, source)
        else:
            _release_order_claim(db, order_id)
            logger.warning(
                "Order WhatsApp notify failed for %s from %s — report=%s",
                order_id,
                source,
                report,
            )
        return report
    except Exception as exc:
        logger.exception("Order WhatsApp notify exception for %s from %s: %s", order_id, source, exc)
        try:
            _release_order_claim(db, order_id)
        except Exception:
            logger.debug("Could not release WhatsApp notify claim for %s", order_id, exc_info=True)
        return {"order_id": order_id, "errors": [str(exc)]}
    finally:
        db.close()


def _candidate_order_ids(db: Session, batch_size: int) -> list[str]:
    ensure_order_notification_columns(db)
    rows = db.execute(
        text("""
            SELECT order_id
            FROM orders
            WHERE send_whatsapp = 1
              AND whatsapp_notified = 0
              AND order_status = 'PENDING'
            ORDER BY created_at ASC
            LIMIT :lim
        """),
        {"lim": batch_size},
    ).fetchall()
    return [row[0] for row in rows]


async def run_order_notify_poll_once() -> int:
    batch_size = _env_int("ORDER_NOTIFY_BATCH", 20)
    db = SessionLocal()
    try:
        order_ids = _candidate_order_ids(db, batch_size)
    finally:
        db.close()

    logger.info("Order WhatsApp notify poll candidates=%d", len(order_ids))
    for order_id in order_ids:
        await notify_order_created_and_mark(
            order_id=order_id,
            source="poller",
            send_followup_messages=False,
        )
    return len(order_ids)


async def _order_notify_loop() -> None:
    interval = _env_int("ORDER_NOTIFY_POLL_SECONDS", 30)
    while True:
        try:
            await run_order_notify_poll_once()
        except Exception as exc:
            logger.exception("Order WhatsApp notify poll cycle failed: %s", exc)
        await asyncio.sleep(interval)


def start_order_notify_poller() -> Optional[asyncio.Task]:
    global _POLLER_TASK
    db = SessionLocal()
    try:
        ensure_order_notification_columns(db)
    finally:
        db.close()

    if not _env_bool("ORDER_NOTIFY_POLLER_ENABLED", True):
        logger.info("Order WhatsApp notify poller disabled by ORDER_NOTIFY_POLLER_ENABLED")
        return None

    if _POLLER_TASK and not _POLLER_TASK.done():
        return _POLLER_TASK

    _POLLER_TASK = asyncio.create_task(_order_notify_loop())
    logger.info(
        "Order WhatsApp notify poller started interval=%ss batch=%s",
        _env_int("ORDER_NOTIFY_POLL_SECONDS", 30),
        _env_int("ORDER_NOTIFY_BATCH", 20),
    )
    return _POLLER_TASK
