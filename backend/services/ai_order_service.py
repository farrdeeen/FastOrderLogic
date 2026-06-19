"""
services/ai_order_service.py
─────────────────────────────
Creates orders from AI WhatsApp chat, matching the OFFLINE create-order flow
(routes/orders.py create_order): same order_id format "{ocid:05d}#{suffix:05d}",
order_index = unix timestamp, gst = 18% of subtotal, and
order_status/fulfillment_status/delivery_method/tax_percent left NULL.
payment_status stays 'pending' and payment_type='online' until Razorpay confirms
payment (the webhook flips it to 'paid') — AI orders are NEVER auto-marked paid.
channel = "AI_ASSISTANT" (for attribution).

Schema facts (from actual CREATE TABLE):
- offline_customer cols: customer_id, name, mobile, email (NO address/city/state/pincode)
- orders.address_id    : NOT NULL (FK → address.address_id) — must always create an address row
- orders.order_index   : NOT NULL UNIQUE INT
- order_items cols     : item_id, order_id, product_id, model_id, color_id,
                         quantity, unit_price, total_price, extra_item_discount_percent
                         (NO sku, NO product_name)
- products SKU column  : sku_id  (NOT sku)
- address requires     : customer_id OR offline_customer_id (CHECK constraint)
"""

from __future__ import annotations

import os
import re
import logging
from datetime import datetime
from decimal import Decimal
from typing import Optional, Dict

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

AI_CHANNEL = "AI_ASSISTANT"
_STORE_URL = (os.getenv("MTM_STORE_URL") or os.getenv("STORE_BASE_URL") or "https://mtm-store.com").rstrip("/")


# ─── Public entry point ───────────────────────────────────────────────────────

def place_ai_order(order_data: dict, db: Session) -> dict:
    """
    Create an order in the database from AI-collected customer details.

    order_data keys (from AI JSON block):
        name, mobile, address, city, state, pincode,
        product_name, sku, quantity (defaults to 1)

    Returns dict:
        success, order_id, message, total,
        product_name, unit_price, quantity  (on success)
    """
    try:
        v = _validate_order_data(order_data)
    except ValueError as exc:
        return {"success": False, "order_id": None, "message": str(exc), "total": None}

    name     = v["name"]
    mobile   = v["mobile"]
    address  = v["address"]
    city     = v["city"]
    state    = v["state"]
    pincode  = v["pincode"]
    sku      = v["sku"]
    quantity = v["quantity"]

    # ── 1. Product lookup (mirrors wix_sync: sku_id first, then name) ─────────
    product = _fetch_product_by_sku(sku, db)
    if not product and v.get("product_name"):
        product = _fetch_product_by_name(v["product_name"], db)

    if not product:
        # Fallback to misc product if one is configured
        misc_row = db.execute(
            text(_PRODUCT_PRICE_SELECT + " WHERE p.sku_id = 'misc' LIMIT 1")
        ).fetchone()
        if misc_row:
            product = {
                "product_id": misc_row.product_id,
                "name":       misc_row.name,
                "price":      float(misc_row.price or 0),
                "sale_price": float(misc_row.sale_price or 0),
            }
            logger.warning(
                "AI order: SKU '%s' / name '%s' not found — assigned misc product (product_id=%s)",
                sku, v.get("product_name"), product["product_id"],
            )
        else:
            logger.warning("AI order: SKU '%s' / name '%s' not found in DB.", sku, v.get("product_name"))
            return {
                "success":  False,
                "order_id": None,
                "message":  f"Product with SKU '{sku}' not found. Please verify the SKU.",
                "total":    None,
            }

    product_id   = product["product_id"]
    product_name = product["name"]
    unit_price   = Decimal(str(product["sale_price"] or product["price"] or 0))

    if unit_price <= 0:
        logger.error("AI order: product '%s' has zero/invalid price.", sku)
        return {
            "success":  False,
            "order_id": None,
            "message":  "Product price is not set correctly. Please contact support.",
            "total":    None,
        }

    total_amount = unit_price * quantity
    # GST shown the same way as the offline create-order flow: 18% of subtotal,
    # with subtotal == total_amount (catalogue price is GST-inclusive).
    subtotal = total_amount
    gst_amount = (subtotal * Decimal("0.18")).quantize(Decimal("0.01"))

    # ── 2. Offline customer (name + mobile only — matches schema) ──────────────
    offline_customer_id = _get_or_create_offline_customer(name=name, mobile=mobile, db=db)

    # ── 3. State lookup (mirrors wix_sync find_state_id) ──────────────────────
    state_id = _find_state_id(state, db) or 1

    # ── 4. Address row — find existing or create new (mirrors wix_sync) ────────
    address_id = _find_or_create_address(
        offline_customer_id=offline_customer_id,
        name=name,
        mobile=mobile,
        address_line=address,
        city=city,
        state_id=state_id,
        pincode=pincode,
        db=db,
    )

    # ── 5. Order ID + order_index (mirror the offline create-order flow) ───────
    now         = datetime.now()
    order_id    = _generate_order_id(db, offline_customer_id)
    order_index = int(now.timestamp())

    # ── 6. Insert orders row FIRST (order_items FK depends on it) ─────────────
    try:
        # Column set mirrors routes/orders.py create_order (offline flow):
        # order_status / fulfillment_status / delivery_method / tax_percent are
        # left NULL at creation, gst is stored as 18% of subtotal, and the order
        # is a prepaid order that is still pending payment (pay link follows).
        db.execute(
            text("""
                INSERT INTO orders (
                    order_id,
                    offline_customer_id,
                    address_id,
                    channel,
                    payment_status,
                    delivery_status,
                    total_items,
                    subtotal,
                    discount_percent,
                    delivery_charge,
                    total_amount,
                    payment_type,
                    gst,
                    order_index,
                    created_at,
                    updated_at
                ) VALUES (
                    :order_id,
                    :offline_customer_id,
                    :address_id,
                    :channel,
                    'pending',
                    'NOT_SHIPPED',
                    :total_items,
                    :subtotal,
                    0.00,
                    0.00,
                    :total_amount,
                    'online',
                    :gst,
                    :order_index,
                    :now,
                    :now
                )
            """),
            {
                "order_id":            order_id,
                "offline_customer_id": offline_customer_id,
                "address_id":          address_id,
                "channel":             AI_CHANNEL,
                "total_items":         quantity,
                "subtotal":            float(subtotal),
                "total_amount":        float(total_amount),
                "gst":                 float(gst_amount),
                "order_index":         order_index,
                "now":                 now,
            },
        )
        db.commit()
        logger.debug("Committed orders row for %s", order_id)
    except Exception as exc:
        db.rollback()
        logger.exception("AI order INSERT orders failed for %s: %s", order_id, exc)
        return {
            "success":  False,
            "order_id": None,
            "message":  "Failed to create order record. Please try again.",
            "total":    None,
        }

    # ── 7. Insert order_items row (only schema columns) ────────────────────────
    try:
        result = db.execute(
            text("""
                INSERT INTO order_items (
                    order_id,
                    product_id,
                    model_id,
                    color_id,
                    quantity,
                    unit_price,
                    total_price
                ) VALUES (
                    :order_id,
                    :product_id,
                    NULL,
                    NULL,
                    :quantity,
                    :unit_price,
                    :total_price
                )
            """),
            {
                "order_id":    order_id,
                "product_id":  product_id,
                "quantity":    quantity,
                "unit_price":  float(unit_price),
                "total_price": float(total_amount),
            },
        )
        item_id = result.lastrowid

        # ── 8. order_details (legacy required — mirrors wix_sync) ──────────────
        db.execute(
            text("""
                INSERT INTO order_details (item_id, order_id, product_id, sr_no)
                VALUES (:item_id, :order_id, :product_id, NULL)
            """),
            {"item_id": item_id, "order_id": order_id, "product_id": product_id},
        )
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.exception("AI order INSERT order_items failed for %s: %s", order_id, exc)
        return {
            "success":  False,
            "order_id": order_id,
            "message":  "Order header created but line items failed. Contact support.",
            "total":    float(total_amount),
        }

    logger.info(
        "AI order placed: order_id=%s | customer=%s | SKU=%s | qty=%d | total=₹%.0f",
        order_id, name, sku, quantity, total_amount,
    )

    return {
        "success":      True,
        "order_id":     order_id,
        "product_name": product_name,
        "unit_price":   float(unit_price),
        "quantity":     quantity,
        "total":        float(total_amount),
        "message": (
            f"Order {order_id} placed successfully! "
            f"{product_name} x{quantity} = ₹{total_amount:,.0f}. "
            f"Payment pending."
        ),
    }


# ─── WhatsApp confirmation ────────────────────────────────────────────────────

def build_order_confirmation_message(result: dict, customer_name: str) -> str:
    if not result.get("success"):
        return (
            f"Sorry {customer_name}, I couldn't place your order. "
            f"{result.get('message', 'Please try again or contact our team.')} "
            f"Powered by mTm AI Assistant[DāSh Store]"
        )

    order_id     = result["order_id"]
    product_name = result.get("product_name", "your item")
    quantity     = result.get("quantity", 1)
    total        = result.get("total", 0)

    return (
        f"✅ Order confirmed, {customer_name}!\n\n"
        f"📦 Order ID: *{order_id}*\n"
        f"🛒 {product_name} × {quantity}\n"
        f"💰 Total: ₹{total:,.0f}\n"
        f"💳 Payment: Pending\n\n"
        f"Please complete your payment at {_STORE_URL} to confirm shipment.\n"
        f"Once paid, we'll ship within 1–2 business days 🚀\n\n"
        f"Powered by mTm AI Assistant[DāSh Store]"
    )


# ─── Internal helpers ─────────────────────────────────────────────────────────

def _validate_order_data(data: dict) -> dict:
    required = ["name", "mobile", "address", "city", "state", "pincode", "sku"]
    missing = [f for f in required if not str(data.get(f, "")).strip()]
    if missing:
        raise ValueError(f"Missing required order fields: {', '.join(missing)}")

    mobile = re.sub(r"\D", "", str(data["mobile"]))
    if len(mobile) < 10:
        raise ValueError(f"Invalid mobile number: {data['mobile']}")

    pincode = str(data["pincode"]).strip()
    if not pincode.isdigit() or len(pincode) != 6:
        raise ValueError(f"Invalid pincode: {pincode}. Must be 6 digits.")

    try:
        quantity = int(data.get("quantity") or 1)
        if quantity < 1:
            quantity = 1
    except (TypeError, ValueError):
        quantity = 1

    return {
        "name":         str(data["name"]).strip(),
        "mobile":       mobile[-10:],
        "address":      str(data["address"]).strip(),
        "city":         str(data["city"]).strip(),
        "state":        str(data["state"]).strip(),
        "pincode":      pincode,
        "sku":          str(data["sku"]).strip(),
        "quantity":     quantity,
        "product_name": str(data.get("product_name") or "").strip(),
    }


# Prices live in product_colors (price = selling price, original_price = MRP),
# NOT on the products table. Each product has at least one product_colors row.
_PRODUCT_PRICE_SELECT = """
    SELECT
        p.product_id,
        p.name,
        pc.original_price AS price,
        pc.price          AS sale_price
    FROM products p
    JOIN product_colors pc ON pc.product_id = p.product_id
"""


def _fetch_product_by_sku(sku: str, db: Session) -> Optional[Dict]:
    """Look up product (+ price from product_colors) by exact sku_id."""
    if not sku:
        return None
    row = db.execute(
        text(_PRODUCT_PRICE_SELECT + """
            WHERE p.sku_id = :sku
            ORDER BY pc.price ASC
            LIMIT 1
        """),
        {"sku": sku},
    ).fetchone()

    if not row:
        return None
    return {
        "product_id": row.product_id,
        "name":       row.name,
        "price":      float(row.price or 0),
        "sale_price": float(row.sale_price or 0),
    }


def _fetch_product_by_name(name: str, db: Session) -> Optional[Dict]:
    """Fallback name lookup (+ price from product_colors)."""
    if not name:
        return None
    row = db.execute(
        text(_PRODUCT_PRICE_SELECT + """
            WHERE LOWER(p.name) = :n
            ORDER BY pc.price ASC
            LIMIT 1
        """),
        {"n": name.lower()},
    ).fetchone()
    if not row:
        row = db.execute(
            text(_PRODUCT_PRICE_SELECT + """
                WHERE LOWER(p.name) LIKE :n
                ORDER BY pc.price ASC
                LIMIT 1
            """),
            {"n": f"%{name.lower()}%"},
        ).fetchone()
    if not row:
        return None
    return {
        "product_id": row.product_id,
        "name":       row.name,
        "price":      float(row.price or 0),
        "sale_price": float(row.sale_price or 0),
    }


def _get_or_create_offline_customer(name: str, mobile: str, db: Session) -> int:
    """
    Mirrors wix_sync create_or_get_offline_customer.
    offline_customer schema: customer_id, name, mobile, email — no address cols.
    """
    row = db.execute(
        text("SELECT customer_id FROM offline_customer WHERE mobile = :mobile LIMIT 1"),
        {"mobile": mobile},
    ).fetchone()

    if row:
        return row.customer_id

    db.execute(
        text("INSERT INTO offline_customer (name, mobile) VALUES (:name, :mobile)"),
        {"name": name, "mobile": mobile},
    )
    db.flush()
    return db.execute(text("SELECT LAST_INSERT_ID()")).scalar()


def _find_state_id(state_text: Optional[str], db: Session) -> Optional[int]:
    """Mirrors wix_sync find_state_id with abbreviation map."""
    if not state_text:
        return None

    s = state_text.strip().lower()

    # Handle ISO codes like "IN-UP"
    if "-" in s:
        parts = s.split("-", 1)
        if len(parts) == 2:
            s = parts[1]

    abbrev = {
        "ap": "andhra pradesh", "ar": "arunachal pradesh", "as": "assam",
        "br": "bihar", "ct": "chhattisgarh", "ga": "goa", "gj": "gujarat",
        "hr": "haryana", "hp": "himachal pradesh", "jh": "jharkhand",
        "jk": "jammu and kashmir", "ka": "karnataka", "kl": "kerala",
        "mp": "madhya pradesh", "mh": "maharashtra", "mn": "manipur",
        "ml": "meghalaya", "mz": "mizoram", "nl": "nagaland",
        "or": "odisha", "pb": "punjab", "rj": "rajasthan", "sk": "sikkim",
        "tn": "tamil nadu", "tg": "telangana", "tr": "tripura",
        "up": "uttar pradesh", "ut": "uttarakhand", "wb": "west bengal",
        "an": "andaman and nicobar islands", "ch": "chandigarh",
        "dn": "dadra and nagar haveli and daman and diu",
        "dd": "daman and diu", "dh": "dadra and nagar haveli",
        "dl": "delhi", "la": "ladakh", "ld": "lakshadweep", "py": "puducherry",
    }
    if s in abbrev:
        s = abbrev[s]

    row = db.execute(
        text("SELECT state_id FROM state WHERE LOWER(name) = :n LIMIT 1"),
        {"n": s},
    ).fetchone()
    if row:
        return int(row[0])

    if len(s) > 2:
        row2 = db.execute(
            text("SELECT state_id FROM state WHERE LOWER(name) LIKE :n LIMIT 1"),
            {"n": f"%{s}%"},
        ).fetchone()
        return int(row2[0]) if row2 else None

    return None


def _find_or_create_address(
    offline_customer_id: int,
    name: str,
    mobile: str,
    address_line: str,
    city: str,
    state_id: int,
    pincode: str,
    db: Session,
) -> int:
    """
    Mirrors wix_sync: reuse existing address if found, else create.
    address table CHECK constraint requires customer_id OR offline_customer_id.
    """
    # Try to reuse an existing address for this customer+line+pincode+city
    try:
        existing = db.execute(
            text("""
                SELECT address_id FROM address
                WHERE offline_customer_id = :ocid
                  AND (address_line = :addr OR address_line LIKE :addr_like)
                  AND (pincode = :pin OR :pin = '')
                  AND (city = :city OR :city = '')
                LIMIT 1
            """),
            {
                "ocid":      offline_customer_id,
                "addr":      address_line,
                "addr_like": f"%{address_line}%",
                "pin":       pincode,
                "city":      city,
            },
        ).fetchone()
        if existing:
            logger.debug("Reused address %s for offline_customer %s", existing.address_id, offline_customer_id)
            return existing.address_id
    except Exception as exc:
        logger.warning("Address lookup failed, will create new: %s", exc)

    now = datetime.now()
    db.execute(
        text("""
            INSERT INTO address (
                offline_customer_id,
                name,
                mobile,
                pincode,
                locality,
                address_line,
                city,
                state_id,
                address_type,
                created_at,
                updated_at,
                is_available
            ) VALUES (
                :offline_customer_id,
                :name,
                :mobile,
                :pincode,
                '',
                :address_line,
                :city,
                :state_id,
                'shipping',
                :now,
                :now,
                1
            )
        """),
        {
            "offline_customer_id": offline_customer_id,
            "name":                name,
            "mobile":              mobile,
            "pincode":             pincode,
            "address_line":        address_line,
            "city":                city,
            "state_id":            state_id,
            "now":                 now,
        },
    )
    db.flush()
    return db.execute(text("SELECT LAST_INSERT_ID()")).scalar()


def _generate_order_id(db: Session, offline_customer_id: int) -> str:
    """
    Build an order_id in the SAME format as the offline create-order flow
    (routes/orders.py): "{offline_customer_id:05d}#{global_suffix+1:05d}",
    e.g. "02701#05113". This keeps AI orders structurally identical to offline
    orders so dashboards, serial search, invoicing and payment webhooks treat
    them the same way.
    """
    prefix = str(offline_customer_id).zfill(5)
    last_suffix = db.execute(
        text("""
            SELECT CAST(SUBSTRING_INDEX(order_id, '#', -1) AS UNSIGNED) AS suffix
            FROM orders
            WHERE order_id REGEXP '^[0-9]{5}#[0-9]{5}$'
            ORDER BY suffix DESC
            LIMIT 1
        """)
    ).scalar()
    next_suffix = (int(last_suffix) + 1) if last_suffix else 1
    return f"{prefix}#{next_suffix:05d}"