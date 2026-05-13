import logging

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

_ORDERS_COLUMNS_READY = False
_SEND_WHATSAPP_COLUMN_READY = False


def ensure_order_preference_columns(db: Session) -> bool:
    """Add optional order preference columns without blocking older databases."""
    global _ORDERS_COLUMNS_READY, _SEND_WHATSAPP_COLUMN_READY
    if _ORDERS_COLUMNS_READY:
        return _SEND_WHATSAPP_COLUMN_READY

    try:
        rows = db.execute(text("SHOW COLUMNS FROM orders")).fetchall()
        existing = {row[0] for row in rows}
    except Exception as exc:
        logger.debug("Could not inspect orders columns: %s", exc)
        existing = set()

    if "send_whatsapp" not in existing:
        try:
            db.execute(
                text("ALTER TABLE orders ADD COLUMN send_whatsapp TINYINT(1) NOT NULL DEFAULT 1")
            )
            db.commit()
            _SEND_WHATSAPP_COLUMN_READY = True
        except Exception as exc:
            logger.debug("Optional orders migration skipped for send_whatsapp: %s", exc)
            db.rollback()
            _SEND_WHATSAPP_COLUMN_READY = False
    else:
        _SEND_WHATSAPP_COLUMN_READY = True

    _ORDERS_COLUMNS_READY = True
    return _SEND_WHATSAPP_COLUMN_READY


def order_allows_whatsapp(db: Session, order_id: str) -> bool:
    if not ensure_order_preference_columns(db):
        return True
    try:
        value = db.execute(
            text("SELECT COALESCE(send_whatsapp, 1) FROM orders WHERE order_id = :oid"),
            {"oid": order_id},
        ).scalar()
    except Exception as exc:
        logger.debug("Could not read send_whatsapp for %s: %s", order_id, exc)
        return True

    return str(value).strip().lower() not in {"0", "false", "no", "off"}
