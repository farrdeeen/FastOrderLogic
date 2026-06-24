"""
services/email_service.py
─────────────────────────
Sends a new-order email to the CUSTOMER and the ADMIN (sales@mtm-store.com) with
the order summary + paid/unpaid status. Guarded: if SMTP isn't configured it logs
and no-ops (never crashes order placement).

Required .env to enable:
  SMTP_HOST, SMTP_PORT (default 587), SMTP_USER, SMTP_PASS
  SMTP_FROM (default = SMTP_USER), SMTP_USE_TLS (default true)
  ORDER_EMAIL_ADMIN (default sales@mtm-store.com)
"""

import os
import logging
import smtplib
import ssl
from email.message import EmailMessage

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

_PAID = ("paid", "success", "accepted")
_ADMIN_EMAIL = os.getenv("ORDER_EMAIL_ADMIN", "sales@mtm-store.com")
_STORE = (os.getenv("MTM_STORE_URL") or "https://mtm-store.com").rstrip("/")


def _smtp_config() -> dict | None:
    host = os.getenv("SMTP_HOST", "").strip()
    user = os.getenv("SMTP_USER", "").strip()
    pwd = os.getenv("SMTP_PASS", "").strip()
    if not (host and user and pwd):
        return None
    return {
        "host": host,
        "port": int(os.getenv("SMTP_PORT", "587")),
        "user": user,
        "pwd": pwd,
        "from": os.getenv("SMTP_FROM", "").strip() or user,
        "tls": os.getenv("SMTP_USE_TLS", "true").lower() == "true",
    }


def _send(cfg: dict, to_list: list[str], subject: str, body: str) -> None:
    msg = EmailMessage()
    msg["From"] = cfg["from"]
    msg["To"] = ", ".join(to_list)
    msg["Subject"] = subject
    msg.set_content(body)
    if cfg["tls"]:
        ctx = ssl.create_default_context()
        with smtplib.SMTP(cfg["host"], cfg["port"], timeout=20) as s:
            s.starttls(context=ctx)
            s.login(cfg["user"], cfg["pwd"])
            s.send_message(msg)
    else:
        with smtplib.SMTP_SSL(cfg["host"], cfg["port"], timeout=20) as s:
            s.login(cfg["user"], cfg["pwd"])
            s.send_message(msg)


def send_order_email(db: Session, order_id: str) -> bool:
    """Email the customer + admin about a newly-placed order. Returns True if sent."""
    cfg = _smtp_config()
    if not cfg:
        logger.info("send_order_email: SMTP not configured — skipping email for %s", order_id)
        return False
    try:
        row = db.execute(
            text("""
                SELECT o.order_id, o.total_amount, o.payment_status, o.created_at,
                       COALESCE(c.name, oc.name)     AS cust_name,
                       COALESCE(c.email, oc.email)   AS cust_email,
                       COALESCE(c.mobile, oc.mobile) AS cust_mobile,
                       a.address_line, a.locality, a.landmark, a.city, a.pincode, s.name AS state_name
                FROM orders o
                LEFT JOIN customer         c  ON c.customer_id  = o.customer_id
                LEFT JOIN offline_customer oc ON oc.customer_id = o.offline_customer_id
                LEFT JOIN address          a  ON a.address_id   = o.address_id
                LEFT JOIN states           s  ON s.id           = a.state_id
                WHERE o.order_id = :oid LIMIT 1
            """),
            {"oid": order_id},
        ).mappings().first()
        if not row:
            logger.warning("send_order_email: order %s not found", order_id)
            return False

        items = db.execute(
            text("""
                SELECT p.name AS name, oi.quantity AS qty, oi.total_price AS total
                FROM order_items oi LEFT JOIN products p ON p.product_id = oi.product_id
                WHERE oi.order_id = :oid
            """),
            {"oid": order_id},
        ).mappings().all()

        paid = str(row.get("payment_status") or "").lower() in _PAID
        status_label = "PAID ✅" if paid else "PAYMENT PENDING ⏳"
        amount = f"₹{float(row['total_amount']):,.0f}" if row.get("total_amount") else "—"
        name = row.get("cust_name") or "Customer"
        addr = ", ".join(str(p).strip() for p in (
            row.get("address_line"), row.get("locality"), row.get("landmark"),
            row.get("city"), row.get("state_name"), row.get("pincode")) if p and str(p).strip())
        item_lines = "\n".join(
            f"  • {it.get('name') or 'Item'} × {it.get('qty') or 1}"
            + (f"  (₹{float(it['total']):,.0f})" if it.get("total") else "")
            for it in items
        ) or "  • (items not listed)"

        body = (
            f"New order {order_id}\n\n"
            f"Status:   {status_label}\n"
            f"Amount:   {amount}\n"
            f"Customer: {name} ({row.get('cust_mobile') or '—'})\n"
            f"Address:  {addr or '—'}\n\n"
            f"Items:\n{item_lines}\n\n"
            f"Store: {_STORE}\n"
        )

        # Admin always; customer if we have a plausible email.
        cust_email = (row.get("cust_email") or "").strip()
        admin_subject = f"[{status_label}] New order {order_id} — {amount}"
        _send(cfg, [_ADMIN_EMAIL], admin_subject, body)
        logger.info("send_order_email: admin email sent for %s", order_id)

        if "@" in cust_email and "." in cust_email:
            cust_subject = f"Your mTm Store order {order_id} — {status_label}"
            cust_body = (
                f"Hi {name},\n\nThank you for your order!\n\n" + body
                + ("\nWe have received your payment and will dispatch soon. 🙏"
                   if paid else
                   "\nPlease complete the payment to confirm same-day dispatch. 🙏")
            )
            try:
                _send(cfg, [cust_email], cust_subject, cust_body)
                logger.info("send_order_email: customer email sent for %s", order_id)
            except Exception as exc:
                logger.warning("send_order_email: customer send failed for %s: %s", order_id, exc)
        return True
    except Exception as exc:
        logger.warning("send_order_email failed for %s: %s", order_id, exc)
        return False
