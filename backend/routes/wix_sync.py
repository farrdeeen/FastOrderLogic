# routes/wix_sync.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text
import requests
from datetime import datetime
from dateutil import parser
import json
import os
import re
import time
from typing import Any, Dict, Optional

from database import SessionLocal

router = APIRouter(prefix="/sync", tags=["Wix Sync"])

WIX_API_KEY = os.getenv("WIX_API_KEY")
WIX_SITE_ID = os.getenv("WIX_SITE_ID")

# config: only auto-create products when SKU looks valid
DEFAULT_CATEGORY_ID = int(os.getenv("DEFAULT_AUTO_CATEGORY_ID", 26))  # your "Test / Uncategorized"
MIN_VALID_SKU_LEN = 2

# ---------------------
# DB dependency
# ---------------------
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# ---------------------
# helpers
# ---------------------
def sanitize_scalar(value: Any):
    if value is None:
        return None
    if isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, datetime):
        return value
    try:
        return json.dumps(value, ensure_ascii=False)
    except Exception:
        return str(value)

def safe_str(v: Any) -> str:
    return "" if v is None else str(v)

def is_valid_sku(sku: Optional[str]) -> bool:
    if not sku:
        return False
    s = str(sku).strip()
    # Must be reasonable length and not generic 'SKU' placeholders
    return len(s) >= MIN_VALID_SKU_LEN and not re.match(r'^(unknown|misc|test)$', s, re.I)

# ---------------------
# product mapping / creation
# ---------------------
def find_product_by_sku(db: Session, sku: str) -> Optional[Dict]:
    if not sku:
        return None
    r = db.execute(text("SELECT * FROM products WHERE sku_id = :s LIMIT 1"), {"s": sku}).first()
    return dict(r._mapping) if r else None

def find_product_by_wix_product_id(db: Session, wix_pid: str) -> Optional[Dict]:
    if not wix_pid:
        return None
    # Some setups store external id in sku or an external_id column; try both
    r = db.execute(text("""
        SELECT * FROM products
        WHERE sku_id = :wixpid
           OR product_id = :tryid
        LIMIT 1
    """), {"wixpid": wix_pid, "tryid": wix_pid}).first()
    return dict(r._mapping) if r else None

def find_product_by_name(db: Session, name: str) -> Optional[Dict]:
    if not name:
        return None
    r = db.execute(text("SELECT * FROM products WHERE LOWER(name)=:n LIMIT 1"), {"n": name.lower()}).first()
    if r:
        return dict(r._mapping)
    # fuzzy fallback
    r2 = db.execute(text("SELECT * FROM products WHERE LOWER(name) LIKE :n LIMIT 1"), {"n": f"%{name.lower()}%"}).first()
    return dict(r2._mapping) if r2 else None

def create_product_from_sku(db: Session, sku: str, title: str = "Auto Product (from Wix)"):
    """
    Create a minimal product entry for a valid SKU. Only used when SKU exists and no product found.
    """
    now = datetime.utcnow()
    name = f"{title} ({sku})"
    db.execute(text("""
        INSERT INTO products (name, description, category_id, product_type, created_at, sku_id)
        VALUES (:name, :description, :category_id, 'auto', :created_at, :sku)
    """), {
        "name": sanitize_scalar(name),
        "description": "Auto-created from Wix order (mapping)",
        "category_id": DEFAULT_CATEGORY_ID,
        "created_at": now,
        "sku": sku
    })
    pid = db.execute(text("SELECT LAST_INSERT_ID()")).scalar()
    # return product object
    r = db.execute(text("SELECT * FROM products WHERE product_id=:pid"), {"pid": pid}).first()
    return dict(r._mapping) if r else {"product_id": pid, "sku_id": sku, "name": name}

# ---------------------
# customer / offline customer
# ---------------------
def find_customer(db: Session, mobile=None, email=None):
    if mobile:
        r = db.execute(text("SELECT * FROM customer WHERE mobile=:m LIMIT 1"), {"m": mobile}).first()
        if r:
            return dict(r._mapping)
    if email:
        r = db.execute(text("SELECT * FROM customer WHERE email=:e LIMIT 1"), {"e": email}).first()
        if r:
            return dict(r._mapping)
    return None

def upsert_customer(db: Session, name, mobile, email):
    existing = find_customer(db, mobile, email)
    if existing:
        # update missing fields if found
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
            db.execute(text(f"UPDATE customer SET {set_sql} WHERE customer_id=:cid"), updates)
        return existing["customer_id"]
    return None

def find_offline_customer_by_mobile(db: Session, mobile: str):
    if not mobile:
        return None
    r = db.execute(text("SELECT * FROM offline_customer WHERE mobile=:m LIMIT 1"), {"m": mobile}).first()
    return dict(r._mapping) if r else None

def create_or_get_offline_customer(db: Session, name=None, mobile=None, email=None):
    if mobile and len(str(mobile)) < 7:
        mobile = None
    if mobile:
        existing = find_offline_customer_by_mobile(db, mobile)
        if existing:
            return existing["customer_id"]
    db.execute(text("INSERT INTO offline_customer (name, mobile, email) VALUES (:name, :mobile, :email)"),
               {"name": sanitize_scalar(name), "mobile": sanitize_scalar(mobile), "email": sanitize_scalar(email)})
    return db.execute(text("SELECT LAST_INSERT_ID()")).scalar()

# ---------------------
# address
# ---------------------
def find_state_id(db: Session, state_name: Optional[str]):
    if not state_name:
        return None
    r = db.execute(text("SELECT state_id FROM state WHERE LOWER(name)=:n LIMIT 1"), {"n": state_name.lower()}).first()
    return r["state_id"] if r else None

def create_address(db: Session, payload: Dict):
    # ensure required not null columns present: pincode (allow empty string), name & mobile exist
    if "pincode" not in payload or payload["pincode"] is None:
        payload["pincode"] = ""
    cols = ", ".join(payload.keys())
    vals = ", ".join([f":{c}" for c in payload])
    db.execute(text(f"INSERT INTO address ({cols}) VALUES ({vals})"), payload)
    return db.execute(text("SELECT LAST_INSERT_ID()")).scalar()

# ---------------------
# order index generation (avoid duplicates)
# ---------------------
def get_next_order_index(db: Session) -> int:
    """
    Try to obtain next order_index by using MAX(order_index)+1.
    If table empty, use current epoch seconds as seed.
    """
    r = db.execute(text("SELECT MAX(order_index) as mx FROM orders")).first()
    mx = r["mx"] if r and r["mx"] is not None else None
    if not mx:
        # derive a base from current unix seconds
        return int(time.time())
    return int(mx) + 1

# ---------------------
# main sync endpoint
# ---------------------
@router.get("/wix")
def sync_wix_orders(db: Session = Depends(get_db)):
    if not WIX_API_KEY or not WIX_SITE_ID:
        raise HTTPException(status_code=500, detail="Missing Wix credentials")

    # query Wix (page size 100)
    try:
        res = requests.post(
            "https://www.wixapis.com/stores/v2/orders/query",
            headers={
                "Authorization": WIX_API_KEY,
                "wix-site-id": WIX_SITE_ID,
                "Content-Type": "application/json",
            },
            json={"paging": {"limit": 100}}
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to talk to Wix: {e}")

    if res.status_code != 200:
        raise HTTPException(status_code=500, detail=f"Wix responded: {res.status_code} - {res.text}")
    print("RAW WIX RESPONSE:", json.dumps(res.json(), indent=2))
    wix_orders = res.json().get("orders", [])
    inserted = 0
    skipped = 0
    details = []

    for w in wix_orders:
        wix_order_id = safe_str(w.get("id") or w.get("_id") or w.get("orderNumber"))
        order_result = {"wix_order_id": wix_order_id, "status": None, "reasons": [], "items": []}

        # Skip if no wix id
        if not wix_order_id:
            skipped += 1
            order_result["status"] = "skipped"
            order_result["reasons"].append("missing_wix_id")
            details.append(order_result)
            continue

        # Skip duplicates (if order_id already exists)
        if db.execute(text("SELECT 1 FROM orders WHERE order_id=:oid LIMIT 1"), {"oid": wix_order_id}).first():
            skipped += 1
            order_result["status"] = "skipped"
            order_result["reasons"].append("duplicate_order_id")
            details.append(order_result)
            continue

        # Parse created date (robust)
        dt = w.get("createdDate") or w.get("dateCreated") or w.get("paidDate") or w.get("updatedDate")
        try:
            created_at = parser.parse(dt) if dt else datetime.utcnow()
        except Exception:
            created_at = datetime.utcnow()

        # Choose contact/address source priority
        shipping = w.get("shippingInfo") or {}
        billing = w.get("billingInfo") or {}
        buyer = w.get("buyerInfo") or {}

        contact = (shipping.get("address") or billing.get("address") or buyer or {})
        # some endpoints nest differently: try contact fields at top
        if not contact:
            contact = {
                "fullName": w.get("buyerName") or w.get("contactName"),
                "phone": w.get("buyerPhone"),
                "email": w.get("buyerEmail")
            }

        # name parsing
        full = contact.get("fullName") or contact.get("name")
        if isinstance(full, dict):
            name = f"{full.get('firstName','')} {full.get('lastName','')}".strip()
        else:
            name = safe_str(full).strip()

        phone = safe_str(contact.get("phone") or contact.get("phoneNumber") or contact.get("mobile") or "")
        email = safe_str(contact.get("email") or contact.get("emailAddress") or "")

        addr_line = safe_str(contact.get("addressLine1") or contact.get("address") or contact.get("street") or "")
        pincode = safe_str(contact.get("postalCode") or contact.get("zip") or "")
        city = safe_str(contact.get("city") or "")
        state_name = safe_str(contact.get("region") or "")

        # Normalize some garbage phone (Wix sometimes)
        if phone and len(re.sub(r'\D', '', phone)) < 7:
            phone = ""

        # CUSTOMER resolution
        customer_id = upsert_customer(db, name, phone, email)
        offline_customer_id = None
        if not customer_id:
            offline_customer_id = create_or_get_offline_customer(db, name, phone, email)

        # ADDRESS creation (non-strict: pincode empty string acceptable)
        addr_payload = {
            "name": sanitize_scalar(name or "Wix Customer"),
            "mobile": sanitize_scalar(phone or ""),
            "pincode": sanitize_scalar(pincode or ""),
            "locality": "",
            "address_line": sanitize_scalar(addr_line or ""),
            "city": sanitize_scalar(city or ""),
            "state_id": find_state_id(db, state_name) or 1,
            "address_type": "shipping",
            "created_at": created_at,
            "updated_at": created_at,
        }
        if customer_id:
            addr_payload["customer_id"] = customer_id
        else:
            addr_payload["offline_customer_id"] = offline_customer_id

        try:
            address_id = create_address(db, addr_payload)
        except Exception as e:
            # address insertion error -> still attempt to proceed but log reason
            address_id = None
            order_result["reasons"].append(f"address_insert_failed: {e}")

        # LINE ITEMS - attempt robust mapping
        subtotal_sum = 0.0
        items_out = []
        line_items = w.get("lineItems") or w.get("items") or []
        for li in line_items:
            # unify shape
            sku = safe_str(li.get("sku") or li.get("skuId") or li.get("variantSku") or "")
            wix_product_id = safe_str(li.get("productId") or li.get("product_id") or li.get("productId") or "")
            title = safe_str(li.get("title") or li.get("name") or li.get("productName") or li.get("name"))
            qty = int(li.get("quantity") or li.get("qty") or 1)
            # price: try multiple keys
            raw_price = li.get("price") or li.get("unitPrice") or li.get("sellingPrice") or li.get("total") or 0
            try:
                price = float(raw_price)
            except Exception:
                price = 0.0

            total_price = qty * price
            subtotal_sum += total_price

            # Try mapping order of precedence:
            # 1) SKU exact match in products.sku_id
            # 2) Wix product id mapping if stored in sku or product external id
            # 3) Exact product name
            # 4) Fuzzy product name (LIKE)
            product = None
            mapping_reason = None

            if is_valid_sku(sku):
                product = find_product_by_sku(db, sku)
                if product:
                    mapping_reason = f"mapped_by_sku:{sku}"
            if not product and wix_product_id:
                product = find_product_by_wix_product_id(db, wix_product_id)
                if product:
                    mapping_reason = f"mapped_by_wix_product_id:{wix_product_id}"
            if not product and title:
                product = find_product_by_name(db, title)
                if product:
                    mapping_reason = f"mapped_by_name:{title}"

            # If still not found, only auto-create when sku looks valid (to avoid junk)
            created_product = None
            if not product and is_valid_sku(sku):
                try:
                    created_product = create_product_from_sku(db, sku, title or "Auto Product")
                    product = created_product
                    mapping_reason = f"auto_created_by_sku:{sku}"
                except Exception as e:
                    order_result["reasons"].append(f"product_auto_create_failed:{sku}:{e}")

            # If after all we did not find product, record and continue but still insert an order_item
            if product:
                pid = product.get("product_id") or product.get("productId")
            else:
                pid = None

            # insert order_items row (product_id may be NULL if completely unknown)
            try:
                db.execute(text("""
                    INSERT INTO order_items (order_id, product_id, model_id, color_id, quantity, unit_price, total_price)
                    VALUES (:oid, :pid, NULL, NULL, :qty, :unit_price, :total_price)
                """), {
                    "oid": wix_order_id,
                    "pid": pid,
                    "qty": qty,
                    "unit_price": price,
                    "total_price": total_price
                })
            except Exception as e:
                # record error but continue; we'll include in details for this order
                order_result["reasons"].append(f"order_item_insert_failed:{title or sku}:{e}")

            items_out.append({
                "title": title,
                "sku": sku,
                "wix_product_id": wix_product_id,
                "product_id": pid,
                "quantity": qty,
                "unit_price": price,
                "total_price": total_price,
                "mapping": mapping_reason or ("unknown_no_sku" if not sku else "unknown")
            })

        # Build order payload for insert
        try:
            order_index = get_next_order_index(db)
        except Exception:
            order_index = int(time.time())

        order_payload = {
            "order_id": wix_order_id,
            "customer_id": customer_id,
            "offline_customer_id": offline_customer_id,
            "address_id": address_id or 0,
            "total_items": len(line_items),
            "subtotal": subtotal_sum,
            "total_amount": subtotal_sum,
            "payment_status": "paid" if (w.get("paymentStatus") or "").upper() == "PAID" else "pending",
            "created_at": created_at,
            "updated_at": created_at,
            "order_index": order_index,
            "upload_wbn": w.get("wbn") or None
        }

        # Insert order row — handle failures per-order
        try:
            db.execute(text("""
                INSERT INTO orders
                (order_id, customer_id, offline_customer_id, address_id,
                 total_items, subtotal, total_amount, channel, payment_status,
                 delivery_status, created_at, updated_at, order_index, payment_type, gst, upload_wbn)
                VALUES
                (:order_id, :customer_id, :offline_customer_id, :address_id,
                 :total_items, :subtotal, :total_amount, 'wix', :payment_status,
                 'NOT_SHIPPED', :created_at, :updated_at, :order_index, 'online', 0.0, :upload_wbn)
            """), order_payload)
            db.commit()
            inserted += 1
            order_result["status"] = "inserted"
            order_result["items"] = items_out
            # include mapping summary
            order_result["customer_id"] = customer_id
            order_result["offline_customer_id"] = offline_customer_id
            order_result["address_id"] = address_id
        except Exception as e:
            # rollback and report
            db.rollback()
            skipped += 1
            order_result["status"] = "skipped"
            order_result["reasons"].append(f"order_insert_failed:{e}")
            # If order_index duplicate, suggest cause
            if "Duplicate entry" in str(e):
                order_result["reasons"].append("order_index_conflict")
            details.append(order_result)
            continue

        details.append(order_result)

    return {"message": "Wix sync completed", "inserted": inserted, "skipped": skipped, "details": details}
