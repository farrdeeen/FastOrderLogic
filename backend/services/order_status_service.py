import logging
import os
import re
from typing import Optional

import httpx
from sqlalchemy import text

logger = logging.getLogger(__name__)

DELHIVERY_TOKEN = os.getenv("DELHIVERY_TOKEN", "")
DELHIVERY_ENV = os.getenv("DELHIVERY_ENV", "staging").lower()
DELHIVERY_BASE_URL = (
    "https://track.delhivery.com"
    if DELHIVERY_ENV == "production"
    else "https://staging-express.delhivery.com"
)


def _phone_tail(phone: str) -> str:
    digits = re.sub(r"\D", "", str(phone or ""))
    if digits.startswith("91") and len(digits) > 10:
        digits = digits[-10:]
    elif len(digits) > 10:
        digits = digits[-10:]
    return digits


def _mapping(row) -> Optional[dict]:
    return dict(row._mapping) if row else None


def _order_select_sql(where_clause: str) -> str:
    return f"""
        SELECT
            o.order_id,
            o.payment_status,
            o.delivery_status,
            o.order_status,
            o.awb_number,
            o.total_amount,
            o.created_at,
            COALESCE(c.name, oc.name) AS customer_name,
            COALESCE(c.mobile, oc.mobile) AS mobile
        FROM orders o
        LEFT JOIN customer c ON c.customer_id = o.customer_id
        LEFT JOIN offline_customer oc ON oc.customer_id = o.offline_customer_id
        WHERE {where_clause}
    """


def find_orders_by_phone(db, phone: str, limit: int = 3) -> list[dict]:
    tail = _phone_tail(phone)
    if len(tail) < 7:
        return []

    rows = db.execute(
        text(_order_select_sql("(c.mobile LIKE :tail OR oc.mobile LIKE :tail)") + """
            ORDER BY o.created_at DESC
            LIMIT :limit
        """),
        {"tail": f"%{tail}", "limit": limit},
    ).fetchall()
    return [dict(row._mapping) for row in rows]


def find_order_by_id(db, order_id: str) -> Optional[dict]:
    candidate = (order_id or "").strip()
    if not candidate:
        return None
    row = db.execute(
        text(_order_select_sql("""
            o.order_id = :oid
            OR UPPER(o.order_id) = UPPER(:oid)
            OR REPLACE(UPPER(o.order_id), 'WIX#', '') = REPLACE(UPPER(:oid), 'WIX#', '')
        """) + " LIMIT 1"),
        {"oid": candidate},
    ).fetchone()
    return _mapping(row)


async def fetch_delhivery_status(awb_number: str) -> Optional[dict]:
    awb = str(awb_number or "").strip()
    if not awb or awb.lower() == "to be assigned":
        return None
    if not DELHIVERY_TOKEN:
        logger.warning("Delhivery token not set; using local AWB fallback for %s", awb)
        return None

    url = f"{DELHIVERY_BASE_URL}/api/v1/packages/json/"
    try:
        async with httpx.AsyncClient(timeout=12) as client:
            resp = await client.get(
                url,
                params={"waybill": awb},
                headers={"Authorization": f"Token {DELHIVERY_TOKEN}"},
            )
        if resp.status_code != 200:
            logger.warning("Delhivery tracking HTTP %s for AWB %s: %s", resp.status_code, awb, resp.text[:200])
            return None

        data = resp.json()
        shipment = (data.get("ShipmentData") or [{}])[0].get("Shipment") or {}
        if not shipment:
            return None

        scans = shipment.get("Scans") or []
        latest_scan = {}
        if scans:
            latest_scan = (scans[-1] or {}).get("ScanDetail") or {}

        return {
            "status": (shipment.get("Status") or {}).get("Status") or "",
            "expected_date": shipment.get("ExpectedDeliveryDate") or "",
            "destination": shipment.get("DestinationCity") or "",
            "latest_scan": latest_scan.get("Scan") or "",
            "latest_location": latest_scan.get("ScannedLocation") or "",
            "latest_remark": latest_scan.get("Instructions") or "",
        }
    except Exception as exc:
        logger.warning("Delhivery tracking failed for AWB %s: %s", awb, exc)
        return None


def _money(value) -> str:
    try:
        return f"₹{float(value):,.0f}"
    except (TypeError, ValueError):
        return "—"


def _local_delivery_label(order: dict, language: str) -> str:
    delivery = (order.get("delivery_status") or "NOT_SHIPPED").upper()
    awb = order.get("awb_number") or ""
    dispatched = delivery in ("SHIPPED", "READY", "COMPLETED") or bool(awb)
    if language == "hi":
        if dispatched:
            return f"Dispatch ho chuka hai. AWB: {awb}" if awb else "Dispatch ho chuka hai."
        return "Abhi dispatch nahi hua hai."
    if dispatched:
        return f"Dispatched. AWB: {awb}" if awb else "Dispatched."
    return "Not dispatched yet."


def _format_order_status(order: dict, tracking: Optional[dict], language: str = "en") -> str:
    oid = order.get("order_id") or "—"
    pay = (order.get("payment_status") or "pending").title()
    amount = _money(order.get("total_amount"))
    awb = order.get("awb_number") or ""

    if language == "hi":
        lines = [
            f"Order: {oid}",
            f"Payment: {pay} ({amount})",
        ]
        if tracking and tracking.get("status"):
            lines.append(f"Delhivery status: {tracking['status']}")
            if tracking.get("expected_date"):
                lines.append(f"Expected delivery: {tracking['expected_date']}")
            if tracking.get("latest_location"):
                lines.append(f"Last update: {tracking.get('latest_scan') or 'Update'} - {tracking['latest_location']}")
            if awb:
                lines.append(f"AWB: {awb}")
        else:
            lines.append(f"Delivery: {_local_delivery_label(order, language)}")
        return "\n".join(lines)

    lines = [
        f"Order: {oid}",
        f"Payment: {pay} ({amount})",
    ]
    if tracking and tracking.get("status"):
        lines.append(f"Delhivery status: {tracking['status']}")
        if tracking.get("expected_date"):
            lines.append(f"Expected delivery: {tracking['expected_date']}")
        if tracking.get("latest_location"):
            lines.append(f"Last update: {tracking.get('latest_scan') or 'Update'} - {tracking['latest_location']}")
        if awb:
            lines.append(f"AWB: {awb}")
    else:
        lines.append(f"Delivery: {_local_delivery_label(order, language)}")
    return "\n".join(lines)


async def build_status_reply_for_phone(db, phone: str, language: str = "en") -> str:
    orders = find_orders_by_phone(db, phone)
    if not orders:
        if language == "hi":
            return "Mujhe is number se koi order nahi mila. Please apna Order ID bhej dein, jaise WIX#14923 ya AI-00001."
        return "I couldn't find an order linked to this number. Please share your Order ID, for example WIX#14923 or AI-00001."

    parts = []
    for order in orders:
        tracking = await fetch_delhivery_status(order.get("awb_number") or "")
        parts.append(_format_order_status(order, tracking, language))
    intro = "Aapke recent order status:" if language == "hi" else "Your recent order status:"
    return intro + "\n\n" + "\n\n".join(parts)


async def build_status_reply_for_order_id(db, order_id: str, language: str = "en") -> Optional[str]:
    order = find_order_by_id(db, order_id)
    if not order:
        return None
    tracking = await fetch_delhivery_status(order.get("awb_number") or "")
    return _format_order_status(order, tracking, language)
