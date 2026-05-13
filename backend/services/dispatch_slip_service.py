import logging
from datetime import datetime
from io import BytesIO
from typing import Optional

from PIL import Image, ImageDraw, ImageFont
from sqlalchemy import text

from services.chat_media_service import is_public_http_url, save_media_bytes
from services.chat_service import (
    _wa_message_id,
    get_or_create_session,
    normalize_phone,
    save_message,
)
from services.order_preferences import ensure_order_preference_columns
from services.whatsapp_service import send_document_message, send_text_message

logger = logging.getLogger(__name__)


def _font(size: int, bold: bool = False):
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/Library/Fonts/Arial Bold.ttf" if bold else "/Library/Fonts/Arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for path in candidates:
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            continue
    return ImageFont.load_default()


def _money(value) -> str:
    try:
        return f"Rs. {float(value):,.0f}"
    except Exception:
        return "Rs. -"


def _wrap(draw: ImageDraw.ImageDraw, text_value: str, font, width: int) -> list[str]:
    words = str(text_value or "").split()
    lines = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        bbox = draw.textbbox((0, 0), candidate, font=font)
        if bbox[2] - bbox[0] <= width or not current:
            current = candidate
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines or [""]


def get_dispatch_pod_data(db, order_id: str) -> Optional[dict]:
    send_whatsapp_expr = (
        "COALESCE(o.send_whatsapp, 1)"
        if ensure_order_preference_columns(db)
        else "1"
    )
    order = db.execute(
        text(f"""
            SELECT
                o.order_id,
                o.created_at,
                o.invoice_number,
                o.payment_type,
                o.payment_status,
                o.total_amount,
                o.awb_number,
                o.channel,
                o.address_id,
                {send_whatsapp_expr} AS send_whatsapp,
                COALESCE(c.name, oc.name) AS customer_name,
                COALESCE(c.mobile, oc.mobile) AS customer_mobile,
                COALESCE(c.email, oc.email) AS customer_email
            FROM orders o
            LEFT JOIN customer c ON c.customer_id = o.customer_id
            LEFT JOIN offline_customer oc ON oc.customer_id = o.offline_customer_id
            WHERE o.order_id = :oid
            LIMIT 1
        """),
        {"oid": order_id},
    ).mappings().first()
    if not order:
        return None

    address = db.execute(
        text("""
            SELECT a.*, s.name AS state_name
            FROM address a
            LEFT JOIN state s ON s.state_id = a.state_id
            WHERE a.address_id = :aid
        """),
        {"aid": order["address_id"]},
    ).mappings().first()

    items = db.execute(
        text("""
            SELECT p.name AS product_name, p.sku_id, oi.quantity, oi.unit_price, oi.total_price
            FROM order_items oi
            LEFT JOIN products p ON p.product_id = oi.product_id
            WHERE oi.order_id = :oid
        """),
        {"oid": order_id},
    ).mappings().all()

    return {
        "order": dict(order),
        "address": dict(address) if address else {},
        "items": [dict(row) for row in items],
    }


def build_dispatch_slip_pdf(db, order_id: str) -> Optional[dict]:
    data = get_dispatch_pod_data(db, order_id)
    if not data:
        return None

    order = data["order"]
    address = data["address"]
    items = data["items"]
    awb = order.get("awb_number") or "To be assigned"
    tracking_link = f"https://www.delhivery.com/track-v2/package/{awb}" if awb and awb != "To be assigned" else ""

    image = Image.new("RGB", (1240, 1754), "white")
    draw = ImageDraw.Draw(image)
    title_font = _font(42, bold=True)
    head_font = _font(25, bold=True)
    body_font = _font(23)
    small_font = _font(19)

    x, y = 90, 80
    draw.text((x, y), "Dispatch Slip", fill="#111111", font=title_font)
    y += 62
    draw.line((x, y, 1150, y), fill="#111111", width=3)
    y += 32

    def line(label, value, font=body_font):
        nonlocal y
        draw.text((x, y), f"{label}: ", fill="#111111", font=head_font)
        draw.text((x + 230, y), str(value or "-"), fill="#111111", font=font)
        y += 42

    line("Order ID", order.get("order_id"))
    line("AWB", awb)
    line("Amount", _money(order.get("total_amount")))
    line("Payment", order.get("payment_status"))
    if tracking_link:
        line("Tracking", tracking_link, font=small_font)

    y += 22
    draw.text((x, y), "Ship To", fill="#111111", font=head_font)
    y += 40
    address_parts = [
        order.get("customer_name"),
        order.get("customer_mobile"),
        address.get("address_line"),
        address.get("locality"),
        ", ".join(part for part in [address.get("city"), address.get("state_name"), str(address.get("pincode") or "")] if part),
    ]
    for part in address_parts:
        if not part:
            continue
        for wrapped in _wrap(draw, part, body_font, 980):
            draw.text((x, y), wrapped, fill="#111111", font=body_font)
            y += 34

    y += 28
    draw.text((x, y), "Items", fill="#111111", font=head_font)
    y += 44
    draw.line((x, y, 1150, y), fill="#888888", width=2)
    y += 18
    for item in items[:12]:
        name = item.get("product_name") or "Product"
        sku = item.get("sku_id") or "-"
        qty = item.get("quantity") or 1
        total = _money(item.get("total_price"))
        for idx, wrapped in enumerate(_wrap(draw, f"{name} | SKU: {sku}", body_font, 760)):
            draw.text((x, y), wrapped, fill="#111111", font=body_font)
            if idx == 0:
                draw.text((920, y), f"x{qty}", fill="#111111", font=body_font)
                draw.text((1010, y), total, fill="#111111", font=body_font)
            y += 34
        y += 12
        if y > 1500:
            draw.text((x, y), "...", fill="#111111", font=body_font)
            break

    draw.line((x, 1600, 1150, 1600), fill="#cccccc", width=2)
    draw.text((x, 1625), f"Generated {datetime.now().strftime('%d %b %Y, %I:%M %p')}", fill="#555555", font=small_font)

    buf = BytesIO()
    image.save(buf, format="PDF", resolution=150)
    filename = f"dispatch-slip-{order_id.replace('/', '-')}.pdf"
    return save_media_bytes(
        buf.getvalue(),
        filename=filename,
        folder=f"dispatch/{order_id.replace('/', '-')}",
        content_type="application/pdf",
    )


async def send_order_dispatch_update(db, order_id: str, session_id: Optional[int] = None) -> dict:
    data = get_dispatch_pod_data(db, order_id)
    if not data:
        return {"success": False, "error": "order_not_found"}

    order = data["order"]
    if str(order.get("send_whatsapp", 1)).strip().lower() in {"0", "false", "no", "off"}:
        return {
            "success": True,
            "order_id": order_id,
            "skipped": True,
            "reason": "whatsapp_disabled_for_order",
            "errors": [],
        }

    awb = order.get("awb_number") or ""
    if not awb or awb == "To be assigned":
        return {"success": False, "error": "awb_missing"}

    if session_id:
        session = db.execute(
            text("SELECT id, phone_number FROM chat_sessions WHERE id = :sid"),
            {"sid": session_id},
        ).mappings().first()
        phone = normalize_phone(session["phone_number"]) if session else ""
    else:
        phone = normalize_phone(order.get("customer_mobile") or "")
        session = None

    if not phone:
        return {"success": False, "error": "phone_missing"}

    chat_session = get_or_create_session(db, phone, order.get("customer_name") or "")
    session_id = session_id or chat_session["id"]
    tracking_link = f"https://www.delhivery.com/track-v2/package/{awb}"
    msg = (
        f"Your order {order_id} has been dispatched.\n"
        f"AWB: {awb}\n"
        f"Track here: {tracking_link}"
    )

    result = {"success": True, "order_id": order_id, "tracking_link": tracking_link, "errors": []}
    try:
        wa_resp = await send_text_message(phone, msg, preview_url=True)
        save_message(
            db,
            session_id,
            "system",
            msg,
            wa_message_id=_wa_message_id(wa_resp),
            meta={"flow": "dispatch_tracking", "order_id": order_id, "awb": awb, "tracking_link": tracking_link},
        )
    except Exception as exc:
        logger.error("Dispatch tracking send failed for %s: %s", phone, exc)
        result["errors"].append(f"tracking:{exc}")
        save_message(
            db,
            session_id,
            "system",
            f"[dispatch_tracking_failed] {order_id}: {exc}",
            meta={"flow": "dispatch_tracking_failed", "order_id": order_id, "awb": awb, "error": str(exc)},
        )

    slip = build_dispatch_slip_pdf(db, order_id)
    if not slip:
        result["errors"].append("dispatch_slip_generate_failed")
        return result

    caption = f"Dispatch slip for order {order_id}"
    try:
        if not is_public_http_url(slip["public_url"]):
            raise RuntimeError(
                "Public media URL missing. Set CHAT_MEDIA_PUBLIC_BASE_URL or PUBLIC_BACKEND_URL on the server."
            )
        wa_resp = await send_document_message(phone, slip["public_url"], slip["filename"], caption=caption)
        save_message(
            db,
            session_id,
            "system",
            caption,
            wa_message_id=_wa_message_id(wa_resp),
            meta={
                "flow": "dispatch_slip",
                "order_id": order_id,
                "awb": awb,
                "media_type": "document",
                "mime_type": "application/pdf",
                "media_url": slip["public_url"],
                "download_url": slip["download_url"],
                "file_name": slip["filename"],
                "file_size": slip["size"],
            },
        )
    except Exception as exc:
        logger.error("Dispatch slip send failed for %s: %s", phone, exc)
        result["errors"].append(f"slip:{exc}")
        save_message(
            db,
            session_id,
            "system",
            f"[dispatch_slip_send_failed] {order_id}: {exc}",
            meta={
                "flow": "dispatch_slip_send_failed",
                "order_id": order_id,
                "media_url": slip["public_url"],
                "download_url": slip["download_url"],
                "file_name": slip["filename"],
                "error": str(exc),
            },
        )

    result["slip_url"] = slip["public_url"]
    return result
