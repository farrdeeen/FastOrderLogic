from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text
import requests
from datetime import datetime
from dateutil import parser
import json
import os
from typing import Any

from database import SessionLocal

router = APIRouter(prefix="/sync", tags=["Wix Sync"])

WIX_API_KEY = os.getenv("WIX_API_KEY")
WIX_SITE_ID = os.getenv("WIX_SITE_ID")


# =====================================================================
# DB SESSION
# =====================================================================
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# =====================================================================
# SANITIZER - FIXES dict, list, object serialization issues
# =====================================================================
def sanitize_scalar(value: Any):
    if value is None:
        return None
    if isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, datetime):
        return value
    try:
        return json.dumps(value, ensure_ascii=False)
    except:
        return str(value)


# =====================================================================
# CUSTOMER HELPERS
# =====================================================================
def find_customer(db, mobile=None, email=None):
    if mobile:
        r = db.execute(
            text("SELECT * FROM customer WHERE mobile=:m LIMIT 1"),
            {"m": mobile}
        ).first()
        if r:
            return dict(r._mapping)

    if email:
        r = db.execute(
            text("SELECT * FROM customer WHERE email=:e LIMIT 1"),
            {"e": email}
        ).first()
        if r:
            return dict(r._mapping)

    return None



def upsert_customer(db, name, mobile, email):
    existing = find_customer(db, mobile, email)
    if existing:
        updates = {}

        if name and not existing.get("name"):
            updates["name"] = sanitize_scalar(name)

        if mobile and not existing.get("mobile"):
            updates["mobile"] = sanitize_scalar(mobile)

        if email and not existing.get("email"):
            updates["email"] = sanitize_scalar(email)

        if updates:
            updates["cid"] = existing["customer_id"]
            set_sql = ", ".join([f"{k}=:{k}" for k in updates])
            db.execute(
                text(f"UPDATE customer SET {set_sql} WHERE customer_id=:cid"),
                updates
            )

        return existing["customer_id"]

    return None  # Not found → offline customer


# =====================================================================
# OFFLINE CUSTOMER FIX (duplicate mobile solved)
# =====================================================================
def find_offline_customer_by_mobile(db, mobile: str):
    if not mobile:
        return None
    r = db.execute(
        text("SELECT * FROM offline_customer WHERE mobile=:m LIMIT 1"),
        {"m": mobile}
    ).first()
    return dict(r._mapping) if r else None


def create_or_get_offline_customer(db, name=None, mobile=None, email=None):
    # Wix sometimes sends garbage phone numbers → treat short ones as None
    if mobile and len(str(mobile)) < 7:
        mobile = None

    # If mobile exists, reuse
    if mobile:
        existing = find_offline_customer_by_mobile(db, mobile)
        if existing:
            return existing["customer_id"]

    # Insert new offline customer
    db.execute(
        text("""
            INSERT INTO offline_customer (name, mobile, email)
            VALUES (:name, :mobile, :email)
        """),
        {
            "name": sanitize_scalar(name),
            "mobile": sanitize_scalar(mobile),
            "email": sanitize_scalar(email)
        }
    )
    return db.execute(text("SELECT LAST_INSERT_ID()")).scalar()


# =====================================================================
# PRODUCT / SKU HANDLING
# =====================================================================
def find_product_by_sku(db, sku):
    r = db.execute(
        text("SELECT * FROM products WHERE sku_id=:s LIMIT 1"),
        {"s": sku}
    ).first()
    return dict(r._mapping) if r else None


def create_product_from_sku(db, sku):
    if not sku:
        return {"product_id": None, "auto_created": False}

    DEFAULT_CATEGORY_ID = 26  # Your "Test / Uncategorized"

    now = datetime.utcnow()

    db.execute(
        text("""
            INSERT INTO products
            (name, description, category_id, product_type, created_at, sku_id)
            VALUES
            (:name, :description, :category_id, 'auto', :created_at, :sku)
        """),
        {
            "name": f"Auto Product ({sku})",
            "description": "Auto created from Wix order",
            "category_id": DEFAULT_CATEGORY_ID,
            "created_at": now,
            "sku": sku
        }
    )

    pid = db.execute(text("SELECT LAST_INSERT_ID()")).scalar()

    return {"product_id": pid, "auto_created": True}


# =====================================================================
# ADDRESS
# =====================================================================
def find_state_id(db, state_name: str):
    if not state_name:
        return None
    r = db.execute(
        text("SELECT state_id FROM state WHERE LOWER(name)=:n LIMIT 1"),
        {"n": state_name.lower()}
    ).first()
    return r["state_id"] if r else None


def create_address(db, payload):
    cols = ", ".join(payload.keys())
    vals = ", ".join([f":{c}" for c in payload])
    db.execute(text(f"INSERT INTO address ({cols}) VALUES ({vals})"), payload)
    return db.execute(text("SELECT LAST_INSERT_ID()")).scalar()


# =====================================================================
# WIX SYNC MAIN ENDPOINT
# =====================================================================
@router.get("/wix")
def sync_wix_orders(db: Session = Depends(get_db)):

    if not WIX_API_KEY or not WIX_SITE_ID:
        raise HTTPException(500, "Missing Wix credentials")

    # Fetch orders from Wix
    res = requests.post(
        "https://www.wixapis.com/stores/v2/orders/query",
        headers={
            "Authorization": WIX_API_KEY,
            "wix-site-id": WIX_SITE_ID,
            "Content-Type": "application/json"
        },
        json={"paging": {"limit": 100}}
    )

    if res.status_code != 200:
        raise HTTPException(500, "Failed to fetch orders from Wix")

    wix_orders = res.json().get("orders", [])
    inserted, skipped = 0, 0
    response_details = []

    for w in wix_orders:
        order_id = w.get("id")

        # skip duplicates
        if db.execute(
            text("SELECT 1 FROM orders WHERE order_id=:oid"),
            {"oid": order_id}
        ).first():
            skipped += 1
            continue

        # Parse date
        dt = (
            w.get("createdDate")
            or w.get("dateCreated")
            or w.get("paidDate")
            or w.get("updatedDate")
        )
        try:
            created_at = parser.parse(dt)
        except:
            created_at = datetime.utcnow()

        # Extract structured contact info
        shipping = w.get("shippingInfo") or {}
        billing = w.get("billingInfo") or {}
        buyer = w.get("buyerInfo") or {}

        contact = (
            shipping.get("address")
            or billing.get("address")
            or buyer
            or {}
        )

        # Proper fullName parsing
        full = contact.get("fullName")
        if isinstance(full, dict):
            name = f"{full.get('firstName','')} {full.get('lastName','')}".strip()
        else:
            name = full or contact.get("name")

        phone = contact.get("phone")
        email = contact.get("email") or contact.get("emailAddress")

        addr_line = contact.get("addressLine1")
        pincode = contact.get("postalCode")
        city = contact.get("city")
        state_name = contact.get("region")

        # state lookup
        state_id = find_state_id(db, state_name) or 1

        # Determine customer
        customer_id = upsert_customer(db, name, phone, email)
        offline_customer_id = None

        if not customer_id:
            offline_customer_id = create_or_get_offline_customer(db, name, phone, email)

        # Address creation
        addr_payload = {
            "name": sanitize_scalar(name or "Wix Customer"),
            "mobile": sanitize_scalar(phone or ""),
            "pincode": sanitize_scalar(pincode or ""),
            "locality": "",
            "address_line": sanitize_scalar(addr_line or ""),
            "city": sanitize_scalar(city or ""),
            "state_id": state_id,
            "address_type": "shipping",
            "created_at": created_at,
            "updated_at": created_at
        }

        if customer_id:
            addr_payload["customer_id"] = customer_id
        else:
            addr_payload["offline_customer_id"] = offline_customer_id

        address_id = create_address(db, addr_payload)

        # LINE ITEMS
        subtotal_sum = 0
        items_output = []

        for li in w.get("lineItems", []):
            sku = (li.get("sku") or "").strip()
            qty = int(li.get("quantity") or 1)
            price = float(li.get("price") or 0)
            total_price = qty * price

            subtotal_sum += total_price

            if not sku:
                items_output.append({
                    "sku": "",
                    "product_id": None,
                    "quantity": qty,
                    "unit_price": price
                })
                continue

            product = find_product_by_sku(db, sku)
            if not product:
                product = create_product_from_sku(db, sku)

            pid = product["product_id"]

            # Insert order_item matching your schema
            db.execute(
                text("""
                    INSERT INTO order_items
                    (order_id, product_id, model_id, color_id, quantity, unit_price, total_price)
                    VALUES
                    (:oid, :pid, NULL, NULL, :qty, :unit_price, :total_price)
                """),
                {
                    "oid": order_id,
                    "pid": pid,
                    "qty": qty,
                    "unit_price": price,
                    "total_price": total_price
                }
            )

            items_output.append({
                "sku": sku,
                "product_id": pid,
                "quantity": qty,
                "unit_price": price
            })

        # INSERT ORDER
        db.execute(
            text("""
                INSERT INTO orders
                (order_id, customer_id, offline_customer_id, address_id,
                 total_items, subtotal, total_amount, channel, payment_status,
                 delivery_status, created_at, updated_at, order_index, payment_type, gst)
                VALUES
                (:order_id, :customer_id, :offline_customer_id, :address_id,
                 :total_items, :subtotal, :total_amount, 'wix', :payment_status,
                 'NOT_SHIPPED', :created_at, :updated_at, :order_index, 'online', 0.0)
            """),
            {
                "order_id": order_id,
                "customer_id": customer_id,
                "offline_customer_id": offline_customer_id,
                "address_id": address_id,
                "total_items": len(w.get("lineItems", [])),
                "subtotal": subtotal_sum,
                "total_amount": subtotal_sum,
                "payment_status": "paid" if w.get("paymentStatus") == "PAID" else "pending",
                "created_at": created_at,
                "updated_at": created_at,
                "order_index": int(created_at.timestamp())  # SAFE INT
            }
        )

        db.commit()
        inserted += 1

        response_details.append({
            "order_id": order_id,
            "customer_id": customer_id,
            "offline_customer_id": offline_customer_id,
            "address_id": address_id,
            "items": items_output
        })

    return {
        "message": "Wix sync completed",
        "inserted": inserted,
        "skipped": skipped,
        "details": response_details
    }
