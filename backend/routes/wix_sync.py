# routes/wix_sync.py
"""
Optimized Wix sync (Option C, final).
- Clean, compact, robust implementation.
- Fixes:
  * Proper Wix order number handling (use number when present; fallback only when missing)
  * Payment status determined from totals.paid
  * Final amount from totals.paymentDue (or totals.total)
  * Subtotal from totals.subtotal when available
  * Ensures customer name is saved (creates customer if absent)
  * Reuses existing addresses where possible
  * force=1 support (recreate order_items)
  * Predictable logging and per-order commit/rollback
- Drop into routes/ and wire router as before.
"""

import os
import re
import json
import logging
from datetime import datetime
from typing import Optional, Dict, Any, List

import requests
from dateutil import parser
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from dotenv import load_dotenv
load_dotenv()

from database import SessionLocal

# Router
router = APIRouter(prefix="/sync", tags=["Wix Sync"])

# Config
WIX_API_KEY = os.getenv("WIX_API_KEY")
WIX_SITE_ID = os.getenv("WIX_SITE_ID")
DEFAULT_CATEGORY_ID = int(os.getenv("DEFAULT_AUTO_CATEGORY_ID", 26))
MIN_VALID_SKU_LEN = 2

# Logging
logger = logging.getLogger("wix_sync")
if not logger.handlers:
    h = logging.StreamHandler()
    fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s")
    h.setFormatter(fmt)
    logger.addHandler(h)
logger.setLevel(logging.DEBUG)

# DB dependency
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# ---------------------------
# Helpers
# ---------------------------
def safe_str(v: Optional[Any]) -> str:
    if v is None:
        return ""
    return str(v)

def sanitize_scalar(value: Any):
    if value is None:
        return ""
    if isinstance(value, (str, int, float, bool, datetime)):
        return value
    try:
        return json.dumps(value, ensure_ascii=False)
    except Exception:
        return str(value)

def is_valid_sku(sku: Optional[str]) -> bool:
    if not sku:
        return False
    s = str(sku).strip()
    if len(s) < MIN_VALID_SKU_LEN:
        return False
    return not re.match(r'^(unknown|misc|test)$', s, re.I)

# ---------------------------
# Synthetic mobile generator
# ---------------------------
def generate_synthetic_mobile(db: Session) -> str:
    try:
        r = db.execute(text("""
            SELECT COALESCE(MAX(CAST(mobile AS UNSIGNED)), 0) FROM offline_customer
            WHERE mobile REGEXP '^[0-9]+$'
        """)).first()
        mx = int(r[0]) if r and r[0] is not None else 0
    except Exception:
        mx = 0
    return str(mx + 1).zfill(10)

# ---------------------------
# Product helpers
# ---------------------------
def find_product_by_sku(db: Session, sku: str) -> Optional[Dict]:
    if not sku:
        return None
    r = db.execute(text("""
        SELECT product_id, name, sku_id, IFNULL(zoho_sku, '') AS zoho_sku
        FROM products WHERE sku_id = :s LIMIT 1
    """), {"s": sku}).first()
    return dict(r._mapping) if r else None

def find_product_by_wix_pid(db: Session, wix_pid: str) -> Optional[Dict]:
    if not wix_pid:
        return None
    r = db.execute(text("""
        SELECT product_id, name, sku_id, IFNULL(zoho_sku,'') AS zoho_sku
        FROM products
        WHERE sku_id = :w OR product_id = :w
        LIMIT 1
    """), {"w": wix_pid}).first()
    return dict(r._mapping) if r else None

def find_product_by_name(db: Session, name: str) -> Optional[Dict]:
    if not name:
        return None
    r = db.execute(text("""
        SELECT product_id, name, sku_id, IFNULL(zoho_sku,'') AS zoho_sku
        FROM products
        WHERE LOWER(name) = :n LIMIT 1
    """), {"n": name.lower()}).first()
    if r:
        return dict(r._mapping)
    r2 = db.execute(text("""
        SELECT product_id, name, sku_id, IFNULL(zoho_sku,'') AS zoho_sku
        FROM products
        WHERE LOWER(name) LIKE :n LIMIT 1
    """), {"n": f"%{name.lower()}%"}).first()
    return dict(r2._mapping) if r2 else None

def create_product_fallback(db: Session, sku: Optional[str], title: str):
    now = datetime.utcnow()
    name = f"{title} ({sku})" if sku else title
    db.execute(text("""
        INSERT INTO products (name, description, category_id, product_type, created_at, sku_id)
        VALUES (:name, :desc, :cat, 'auto', :created_at, :sku)
    """), {"name": sanitize_scalar(name), "desc": "Auto-created from Wix", "cat": DEFAULT_CATEGORY_ID, "created_at": now, "sku": sku})
    pid = db.execute(text("SELECT LAST_INSERT_ID()")).scalar()
    r = db.execute(text("SELECT product_id, name, sku_id, IFNULL(zoho_sku,'') AS zoho_sku FROM products WHERE product_id = :pid LIMIT 1"), {"pid": pid}).first()
    return dict(r._mapping) if r else {"product_id": pid, "name": name, "sku_id": sku or ""}

def ensure_unknown_product(db: Session) -> Dict:
    r = db.execute(text("SELECT product_id, name, sku_id, IFNULL(zoho_sku,'') as zoho_sku FROM products WHERE name = :n LIMIT 1"), {"n": "Unknown Product (auto)"}).first()
    if r:
        return dict(r._mapping)
    db.execute(text("""
        INSERT INTO products (name, description, category_id, product_type, created_at)
        VALUES (:name, :desc, :cat, 'auto', :created_at)
    """), {"name": "Unknown Product (auto)", "desc": "Fallback product", "cat": DEFAULT_CATEGORY_ID, "created_at": datetime.utcnow()})
    pid = db.execute(text("SELECT LAST_INSERT_ID()")).scalar()
    r2 = db.execute(text("SELECT product_id, name, sku_id, IFNULL(zoho_sku,'') as zoho_sku FROM products WHERE product_id = :pid LIMIT 1"), {"pid": pid}).first()
    return dict(r2._mapping) if r2 else {"product_id": pid, "name": "Unknown Product (auto)", "sku_id": ""}

# ---------------------------
# Customer helpers (CREATES if missing)
# ---------------------------
def find_customer(db: Session, mobile=None, email=None):
    if mobile:
        r = db.execute(text("SELECT customer_id, name, mobile, email FROM customer WHERE mobile = :m LIMIT 1"), {"m": mobile}).first()
        if r: return dict(r._mapping)
    if email:
        r = db.execute(text("SELECT customer_id, name, mobile, email FROM customer WHERE email = :e LIMIT 1"), {"e": email}).first()
        if r: return dict(r._mapping)
    return None

def create_customer(db: Session, name: str, mobile: str, email: str):
    try:
        db.execute(text("INSERT INTO customer (name, mobile, email) VALUES (:name, :mobile, :email)"),
                   {"name": sanitize_scalar(name), "mobile": sanitize_scalar(mobile or ""), "email": sanitize_scalar(email or "")})
        cid = db.execute(text("SELECT LAST_INSERT_ID()")).scalar()
        return cid
    except Exception as e:
        logger.exception("create_customer failed: %s", e)
        # fallback: try to find again
        return find_customer(db, mobile=mobile, email=email)

def upsert_customer(db: Session, name, mobile, email):
    """
    Ensure a customer row exists in `customer`. If present, attempt to fill missing name/mobile/email.
    If not present, create it. Returns customer_id or None.
    """
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
            set_sql = ", ".join([f"{k} = :{k}" for k in updates if k != "cid"])
            db.execute(text(f"UPDATE customer SET {set_sql} WHERE customer_id = :cid"), updates)
        return existing["customer_id"]
    # not existing -> create
    try:
        cid = create_customer(db, name or "", mobile or "", email or "")
        return cid
    except Exception as e:
        logger.exception("upsert_customer create failed: %s", e)
        return None

def find_offline_customer_by_mobile(db: Session, mobile: str):
    if not mobile:
        return None
    r = db.execute(text("SELECT customer_id, name, mobile, email FROM offline_customer WHERE mobile = :m LIMIT 1"), {"m": mobile}).first()
    return dict(r._mapping) if r else None

def create_or_get_offline_customer(db: Session, name=None, mobile=None, email=None):
    if mobile and len(str(mobile).strip()) < 7:
        mobile = None
    if mobile:
        existing = find_offline_customer_by_mobile(db, mobile)
        if existing:
            return existing["customer_id"]
    use_mobile = mobile or None
    if not use_mobile:
        for _ in range(5):
            cand = generate_synthetic_mobile(db)
            if not find_offline_customer_by_mobile(db, cand):
                use_mobile = cand
                break
        if not use_mobile:
            use_mobile = datetime.utcnow().strftime("000%y%m%d%H%M%S")[:15]
    try:
        db.execute(text("INSERT INTO offline_customer (name, mobile, email) VALUES (:name, :mobile, :email)"),
                   {"name": sanitize_scalar(name) or "", "mobile": use_mobile, "email": sanitize_scalar(email)})
        cid = db.execute(text("SELECT LAST_INSERT_ID()")).scalar()
        return cid
    except Exception:
        existing = find_offline_customer_by_mobile(db, use_mobile)
        if existing:
            return existing["customer_id"]
        raise

# ---------------------------
# Address helpers
# ---------------------------
def find_state_id(db: Session, state_text: Optional[str]):
    if not state_text:
        return None
    s = state_text.strip().lower()
    s = re.sub(r',.*$', '', s).strip()
    abbrev = {"up": "uttar pradesh", "mh": "maharashtra", "mp": "madhya pradesh", "tn": "tamil nadu", "dl": "delhi"}
    if s in abbrev:
        s = abbrev[s]
    r = db.execute(text("SELECT state_id FROM state WHERE LOWER(name)=:n LIMIT 1"), {"n": s}).first()
    if r:
        return int(r[0])
    r2 = db.execute(text("SELECT state_id FROM state WHERE LOWER(name) LIKE :n LIMIT 1"), {"n": f"%{s}%"}).first()
    return int(r2[0]) if r2 else None

def find_existing_address(db: Session, address_line: str, mobile: str, pincode: str, city: str):
    addr = (address_line or "").strip()
    mob = (mobile or "").strip()
    pin = (pincode or "").strip()
    cty = (city or "").strip()
    try:
        r = db.execute(text("""
            SELECT * FROM address
            WHERE (address_line = :addr OR address_line LIKE :addr_like)
              AND (mobile = :mob OR :mob = '')
              AND (pincode = :pin OR :pin = '')
              AND (city = :cty OR :cty = '')
            LIMIT 1
        """), {"addr": addr, "addr_like": f"%{addr}%", "mob": mob, "pin": pin, "cty": cty}).first()
        return dict(r._mapping) if r else None
    except Exception as e:
        logger.exception("find_existing_address error: %s", e)
        return None

def create_address(db: Session, payload: Dict):
    defaults = {
        "locality": "", "address_line": "", "city": "", "state_id": 1,
        "address_type": "shipping", "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(), "is_available": 1
    }
    for k, v in defaults.items():
        if k not in payload or payload[k] is None:
            payload[k] = v
    cols = ", ".join(payload.keys())
    vals = ", ".join([f":{c}" for c in payload.keys()])
    db.execute(text(f"INSERT INTO address ({cols}) VALUES ({vals})"), payload)
    return db.execute(text("SELECT LAST_INSERT_ID()")).scalar()

# ---------------------------
# Utilities
# ---------------------------
def get_next_order_index(db: Session) -> int:
    r = db.execute(text("SELECT MAX(order_index) FROM orders")).first()
    mx = int(r[0]) if r and r[0] is not None else None
    if not mx:
        return int(datetime.utcnow().timestamp())
    return int(mx) + 1

def extract_price_value(li: Dict) -> float:
    candidates = [
        lambda x: (x.get("price") or {}).get("amount") if isinstance(x.get("price"), dict) else x.get("price"),
        lambda x: (x.get("lineItemPrice") or {}).get("amount"),
        lambda x: (x.get("totalPriceAfterTax") or {}).get("amount"),
        lambda x: x.get("price"),
        lambda x: x.get("unitPrice"),
        lambda x: x.get("sellingPrice"),
        lambda x: x.get("total"),
    ]
    for fn in candidates:
        try:
            v = fn(li)
        except Exception:
            v = None
        if v is None:
            continue
        if isinstance(v, dict) and "amount" in v:
            v = v.get("amount")
        try:
            return float(v)
        except Exception:
            try:
                s = re.sub(r'[^\d.\-]', '', str(v))
                return float(s) if s else 0.0
            except Exception:
                continue
    return 0.0

def invoice_description_for_product(product: Optional[Dict]) -> str:
    if not product:
        return "Item"
    zoho = product.get("zoho_sku") or ""
    if zoho.strip():
        return zoho.strip()
    name = (product.get("name") or "").lower()
    if "gps" in name: return "GPS"
    if "scanner" in name: return "Scanner"
    words = re.findall(r"[A-Za-z0-9]+", product.get("name") or "")
    return " ".join(words[:2]) if words else "Item"

# ---------------------------
# Wix helpers
# ---------------------------
def fetch_wix_order_number(order_id: str):
    if not order_id:
        return None
    try:
        res = requests.post(
            "https://www.wixapis.com/stores/v2/orders/get",
            headers={"Authorization": WIX_API_KEY, "wix-site-id": WIX_SITE_ID, "Content-Type": "application/json"},
            json={"id": order_id},
            timeout=20
        )
        if res.status_code != 200:
            logger.warning("fetch_wix_order_number failed for %s: %s", order_id, res.text[:200])
            return None
        data = res.json()
        return data.get("order", {}).get("number")
    except Exception as e:
        logger.exception("fetch_wix_order_number error: %s", e)
        return None

# ---------------------------
# Main sync endpoint (final optimized)
# ---------------------------
@router.get("/wix")
def sync_wix_orders(request: Request, db: Session = Depends(get_db)):
    """
    Sync Wix orders (single page). Use ?force=1 to force reprocessing (recreate order_items).
    """
    force = request.query_params.get("force") == "1"

    if not WIX_API_KEY or not WIX_SITE_ID:
        logger.error("Missing Wix credentials")
        raise HTTPException(status_code=500, detail="Missing Wix credentials")

    # fetch a single page (limit 100)
    try:
        res = requests.post(
            "https://www.wixapis.com/stores/v2/orders/query",
            headers={"Authorization": WIX_API_KEY, "wix-site-id": WIX_SITE_ID, "Content-Type": "application/json"},
            json={"paging": {"limit": 100}},
            timeout=30
        )
    except Exception as e:
        logger.exception("Failed to call Wix API: %s", e)
        raise HTTPException(status_code=500, detail=f"Wix API error: {e}")

    if res.status_code != 200:
        logger.error("Wix API returned non-200: %s - %s", res.status_code, res.text[:300])
        raise HTTPException(status_code=500, detail=f"Wix responded: {res.status_code}")

    payload = res.json()
    wix_orders = payload.get("orders", []) or []
    logger.debug("Fetched %d orders from Wix", len(wix_orders))

    inserted = 0
    skipped = 0
    details: List[Dict] = []

    for w in wix_orders:
        order_result = {"wix_order_id": None, "status": None, "reasons": [], "items": []}
        try:
            # 1) Determine the wix order number (prefer number; fallback only if missing)
            wix_number = w.get("number")
            if not wix_number:
                wix_number = fetch_wix_order_number(w.get("id")) or w.get("id")
            wix_order_id = safe_str(wix_number)
            order_result["wix_order_id"] = wix_order_id

            if not wix_order_id:
                skipped += 1
                order_result["status"] = "skipped"
                order_result["reasons"].append("missing_order_id")
                details.append(order_result)
                continue

            # duplicate check
            existing_order = db.execute(text("SELECT order_id FROM orders WHERE order_id = :oid LIMIT 1"), {"oid": wix_order_id}).first()
            if existing_order and not force:
                skipped += 1
                order_result["status"] = "skipped"
                order_result["reasons"].append("duplicate_order_id")
                details.append(order_result)
                continue

            # parse created_at
            dt = w.get("createdDate") or w.get("dateCreated") or w.get("purchasedDate") or w.get("updatedDate") or w.get("paidDate")
            try:
                created_at = parser.parse(dt) if dt else datetime.utcnow()
            except Exception:
                created_at = datetime.utcnow()

            # contact extraction (shipping -> billing -> buyer)
            billing = w.get("billingInfo") or {}
            shipping = w.get("shippingInfo") or {}
            buyer = w.get("buyerInfo") or {}

            def _extract_address_info():
                # shipping destination preferred
                ship_dest = (shipping.get("logistics") or {}).get("shippingDestination") or {}
                ship_addr = ship_dest.get("address") or (shipping.get("shipmentDetails") or {}).get("address") or {}
                ship_contact = ship_dest.get("contactDetails") or (shipping.get("shipmentDetails") or {}).get("contactDetails") or {}
                if ship_addr or ship_contact:
                    # attempt many fallbacks for name
                    fn = ship_contact.get("firstName") or ship_addr.get("fullName", {}).get("firstName") or ship_addr.get("firstName")
                    ln = ship_contact.get("lastName") or ship_addr.get("fullName", {}).get("lastName") or ship_addr.get("lastName")
                    full = f"{fn or ''} {ln or ''}".strip()
                    return {
                        "fullName": full or None,
                        "firstName": fn or None,
                        "lastName": ln or None,
                        "phone": ship_contact.get("phone") or ship_addr.get("phone"),
                        "email": ship_addr.get("email") or ship_contact.get("email"),
                        "addressLine1": ship_addr.get("addressLine") or ship_addr.get("addressLine1") or ship_addr.get("addressLine"),
                        "postalCode": ship_addr.get("postalCode") or ship_addr.get("zipCode"),
                        "city": ship_addr.get("city"),
                        "region": ship_addr.get("subdivision") or ship_addr.get("subdivisionFullname")
                    }
                bill_addr = billing.get("address") or {}
                bill_contact = billing.get("contactDetails") or {}
                if bill_addr or bill_contact:
                    fn = bill_contact.get("firstName") or bill_addr.get("fullName", {}).get("firstName") or bill_addr.get("firstName")
                    ln = bill_contact.get("lastName") or bill_addr.get("fullName", {}).get("lastName") or bill_addr.get("lastName")
                    full = f"{fn or ''} {ln or ''}".strip()
                    return {
                        "fullName": full or None,
                        "firstName": fn or None,
                        "lastName": ln or None,
                        "phone": bill_contact.get("phone") or bill_addr.get("phone"),
                        "email": bill_addr.get("email") or bill_contact.get("email"),
                        "addressLine1": bill_addr.get("addressLine") or bill_addr.get("addressLine1") or bill_addr.get("addressLine"),
                        "postalCode": bill_addr.get("postalCode") or bill_addr.get("zipCode"),
                        "city": bill_addr.get("city"),
                        "region": bill_addr.get("subdivision") or bill_addr.get("subdivisionFullname")
                    }
                # buyer fallback
                fn = buyer.get("firstName") or ""
                ln = buyer.get("lastName") or ""
                full = f"{fn} {ln}".strip()
                return {
                    "fullName": full or None,
                    "firstName": fn or None,
                    "lastName": ln or None,
                    "phone": buyer.get("phone"),
                    "email": buyer.get("email"),
                    "addressLine1": buyer.get("addressLine") or buyer.get("address") or "",
                    "postalCode": "",
                    "city": "",
                    "region": ""
                }

            contact = _extract_address_info()
            # Ensure we have a name: prefer fullName then firstName then buyer names
            name = safe_str(contact.get("fullName") or contact.get("firstName") or (buyer.get("firstName") or buyer.get("lastName")) or "")
            phone_raw = safe_str(contact.get("phone") or "")
            phone_digits = re.sub(r'\D', '', phone_raw)
            if phone_digits and len(phone_digits) < 7:
                phone_digits = ""
            email = safe_str(contact.get("email") or "")

            # customer resolution: ensure a customer row exists (create if missing)
            customer_id = None
            offline_customer_id = None
            try:
                customer_id = upsert_customer(db, name, phone_digits, email)
                if not customer_id:
                    offline_customer_id = create_or_get_offline_customer(db, name, phone_digits, email)
            except Exception as e:
                logger.exception("customer resolution failed: %s", e)
                order_result["reasons"].append(f"customer_resolution_failed:{e}")

            # address handling: reuse existing or create new
            addr_line_raw = sanitize_scalar(contact.get("addressLine1") or "")
            pincode_raw = sanitize_scalar(contact.get("postalCode") or "")
            city_raw = sanitize_scalar(contact.get("city") or "")

            address_id = None
            resolved_state_id = None
            try:
                existing_addr = find_existing_address(db, addr_line_raw, phone_digits, pincode_raw, city_raw)
                if existing_addr:
                    address_id = existing_addr.get("address_id")
                    resolved_state_id = existing_addr.get("state_id") or None
                    logger.debug("Reused address %s for order %s", address_id, wix_order_id)
                else:
                    resolved_state_id = find_state_id(db, contact.get("region"))
                    addr_payload = {
                        "name": sanitize_scalar(name or "Wix Customer"),
                        "mobile": sanitize_scalar(phone_digits or ""),
                        "pincode": sanitize_scalar(pincode_raw or ""),
                        "locality": "",
                        "address_line": sanitize_scalar(addr_line_raw or ""),
                        "city": sanitize_scalar(city_raw or ""),
                        "state_id": resolved_state_id or 1,
                        "address_type": "shipping",
                        "created_at": created_at,
                        "updated_at": created_at,
                        "is_available": 1
                    }
                    if customer_id:
                        addr_payload["customer_id"] = customer_id
                    elif offline_customer_id:
                        addr_payload["offline_customer_id"] = offline_customer_id
                    address_id = create_address(db, addr_payload)
                    logger.debug("Created address %s for order %s", address_id, wix_order_id)
            except Exception as e:
                logger.exception("address handling failed for %s: %s", wix_order_id, e)
                order_result["reasons"].append(f"address_handling_failed:{e}")

            if address_id and not resolved_state_id:
                try:
                    rr = db.execute(text("SELECT state_id FROM address WHERE address_id = :aid LIMIT 1"), {"aid": address_id}).first()
                    if rr and rr[0]:
                        resolved_state_id = int(rr[0])
                except Exception:
                    pass

            # Process line items
            subtotal_sum = 0.0
            items_out = []
            line_items = w.get("lineItems") or w.get("items") or []

            # If force and existing order -> delete order_items for recreation
            if existing_order and force:
                try:
                    db.execute(text("DELETE FROM order_items WHERE order_id = :oid"), {"oid": wix_order_id})
                    logger.debug("Deleted previous order_items for %s (force)", wix_order_id)
                except Exception as e:
                    logger.exception("Failed delete order_items for %s: %s", wix_order_id, e)

            for li in line_items:
                try:
                    if not isinstance(li, dict):
                        continue
                    sku = safe_str((li.get("physicalProperties") or {}).get("sku") or li.get("sku") or li.get("variantSku") or li.get("skuId") or "")
                    wix_pid = safe_str((li.get("catalogReference") or {}).get("catalogItemId") if isinstance(li.get("catalogReference"), dict) else li.get("productId") or li.get("product_id") or "")
                    name_field = li.get("productName") or li.get("name") or li.get("title") or ""
                    title = safe_str(name_field.get("original") if isinstance(name_field, dict) else name_field)
                    qty = int(li.get("quantity") or li.get("qty") or 1)
                    price = extract_price_value(li)
                    total_price = round(qty * price, 2)
                    subtotal_sum += total_price

                    product = None
                    mapping = None
                    if is_valid_sku(sku):
                        product = find_product_by_sku(db, sku)
                        mapping = f"sku:{sku}" if product else mapping

                    if not product and wix_pid:
                        product = find_product_by_wix_pid(db, wix_pid)
                        mapping = mapping or (f"wixpid:{wix_pid}" if product else None)

                    if not product and title:
                        product = find_product_by_name(db, title)
                        mapping = mapping or (f"name:{title}" if product else None)

                    if not product and is_valid_sku(sku):
                        product = create_product_fallback(db, sku, title or "Auto Product")
                        mapping = mapping or f"auto_by_sku:{sku}"

                    if not product:
                        product = create_product_fallback(db, None, title or "Auto Product")
                        mapping = mapping or "auto_by_title"

                    pid = product.get("product_id") if product else None
                    invoice_desc = invoice_description_for_product(product)

                    # Insert order_item
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
                        logger.exception("order_item insert failed: %s", e)
                        order_result["reasons"].append(f"order_item_insert_failed:{e}")

                    items_out.append({
                        "title": title,
                        "sku": sku,
                        "wix_product_id": wix_pid,
                        "product_id": pid,
                        "quantity": qty,
                        "unit_price": price,
                        "total_price": total_price,
                        "mapping": mapping or "unknown",
                        "invoice_description": invoice_desc
                    })
                except Exception as e:
                    logger.exception("Failed to process line item: %s", e)
                    order_result["reasons"].append(f"line_item_failed:{e}")

            # PAYMENT & TOTALS: use Wix totals where available
           # ---- PAYMENT STATUS FIX ----
                totals = w.get("totals") or {}
                billing = w.get("billingInfo") or {}

# Extract raw status values Wix may send
                payment_status_raw = (
                    totals.get("paymentStatus")
                    or billing.get("paymentStatus")
                    or w.get("paymentStatus")
                    or ""
                    ).upper()

                gateway_status = (
                    ((billing.get("paymentGateway") or {}).get("transactionStatus"))
                    or ((billing.get("paymentGatewayInfo") or {}).get("status"))
                    or ""
                ).upper()

                paid_amount = float(totals.get("paid") or 0)

# Determine paid/unpaid
                is_paid = False

# Rule 1: Wix recorded money paid
            if paid_amount > 0:
                is_paid = True

# Rule 2: Wix status explicitly marks order as paid
            elif payment_status_raw in ["PAID", "ACCEPTED", "SUCCESS"]:
                is_paid = True

# Rule 3: Gateway reports successful payment
            elif gateway_status in ["SUCCESS", "PAID", "CAPTURED"]:
                is_paid = True

            payment_status = "paid" if is_paid else "pending"

# Keep your existing logic:
            payment_due = totals.get("paymentDue") or totals.get("total") or subtotal_sum
            subtotal_val = float(totals.get("subtotal") or subtotal_sum)
# ---- END FIX ----

            # Prepare order payload
            order_index = get_next_order_index(db)
            total_items = len(line_items)
            order_payload = {
                "order_id": wix_order_id,
                "customer_id": customer_id,
                "offline_customer_id": offline_customer_id,
                "address_id": address_id or 0,
                "total_items": total_items,
                "subtotal": round(subtotal_val, 2),
                "total_amount": float(payment_due),
                "channel": "wix",
                "payment_status": payment_status,
                "delivery_status": "NOT_SHIPPED",
                "created_at": created_at,
                "updated_at": created_at,
                "order_index": order_index,
                "payment_type": "online",
                "gst": 0.0,
                "upload_wbn": w.get("wbn") or None
            }

            # Insert or update order row
            try:
                if not existing_order:
                    db.execute(text("""
                        INSERT INTO orders
                        (order_id, customer_id, offline_customer_id, address_id,
                         total_items, subtotal, total_amount, channel, payment_status,
                         delivery_status, created_at, updated_at, order_index, payment_type, gst, upload_wbn)
                        VALUES
                        (:order_id, :customer_id, :offline_customer_id, :address_id,
                         :total_items, :subtotal, :total_amount, :channel, :payment_status,
                         :delivery_status, :created_at, :updated_at, :order_index, :payment_type, :gst, :upload_wbn)
                    """), order_payload)
                    logger.debug("Inserted order %s", wix_order_id)
                else:
                    db.execute(text("""
                        UPDATE orders SET
                          total_items = :total_items,
                          subtotal = :subtotal,
                          total_amount = :total_amount,
                          payment_status = :payment_status,
                          updated_at = :updated_at
                        WHERE order_id = :order_id
                    """), {
                        "total_items": total_items,
                        "subtotal": round(subtotal_val, 2),
                        "total_amount": float(payment_due),
                        "payment_status": payment_status,
                        "updated_at": created_at,
                        "order_id": wix_order_id
                    })
                    logger.debug("Updated order %s (force mode)", wix_order_id)

                db.commit()
                inserted += 1
                order_result["status"] = "inserted"
                order_result["items"] = items_out
                order_result["customer_id"] = customer_id
                order_result["offline_customer_id"] = offline_customer_id
                order_result["address_id"] = address_id
                logger.info("Processed order %s (items=%d)", wix_order_id, len(items_out))
            except Exception as e:
                try:
                    db.rollback()
                except Exception:
                    logger.exception("Rollback failed for order %s", wix_order_id)
                skipped += 1
                order_result["status"] = "skipped"
                order_result["reasons"].append(f"order_insert_failed:{e}")
                logger.exception("Order insert/update failed for %s: %s", wix_order_id, e)
                details.append(order_result)
                continue

            details.append(order_result)

        except Exception as e:
            logger.exception("Unexpected error processing order: %s", e)
            skipped += 1
            details.append({"wix_order_id": safe_str(w.get("id")), "status": "skipped", "reasons": [f"unexpected:{e}"], "items": []})
            continue

    logger.info("Wix sync done: inserted=%d skipped=%d", inserted, skipped)
    return {"message": "Wix sync completed", "inserted": inserted, "skipped": skipped, "details": details}

# ---------------------------
# Recover endpoint
# ---------------------------
@router.get("/wix/recover")
def recover_missing_orders(db: Session = Depends(get_db)):
    if not WIX_API_KEY or not WIX_SITE_ID:
        raise HTTPException(status_code=500, detail="Missing Wix credentials")
    all_orders = []
    cursor = None
    while True:
        body = {"paging": {"limit": 100}}
        if cursor:
            body["paging"]["cursor"] = cursor
        res = requests.post(
            "https://www.wixapis.com/stores/v2/orders/query",
            headers={"Authorization": WIX_API_KEY, "wix-site-id": WIX_SITE_ID, "Content-Type": "application/json"},
            json=body, timeout=30
        )
        if res.status_code != 200:
            raise HTTPException(status_code=500, detail=f"Wix error: {res.text}")
        data = res.json()
        all_orders.extend(data.get("orders", []) or [])
        cursor = data.get("paging", {}).get("cursors", {}).get("next")
        if not cursor:
            break
    db_orders = {str(r[0]) for r in db.execute(text("SELECT order_id FROM orders")).fetchall()}
    missing = []
    for o in all_orders:
        oid = str(o.get("id") or "")
        num = str(o.get("number") or "")
        if (oid not in db_orders) and (num not in db_orders):
            missing.append(o)
    return {"total_wix_orders": len(all_orders), "orders_in_db": len(db_orders), "missing_count": len(missing), "missing_order_ids": [o.get("id") for o in missing][:50]}

@router.get("/wix/reconcile")
def reconcile_wix_orders(fix: Optional[int] = 0, limit: Optional[int] = 200, db: Session = Depends(get_db)):
    """
    Reconcile Wix orders with local DB.
    Query params:
      - fix=1  -> attempt to auto-fix detected mismatches
      - limit  -> how many Wix orders to fetch/process per run (default 200)
    Returns a JSON list of orders with detected differences and what was fixed.
    """
    if not WIX_API_KEY or not WIX_SITE_ID:
        raise HTTPException(status_code=500, detail="Missing Wix credentials")

    # helper: determine wix payment_status using same rules as sync
    def detect_wix_paid_status(w: Dict) -> str:
        totals = w.get("totals") or {}
        billing = w.get("billingInfo") or {}
        payment_status_raw = (
            (totals.get("paymentStatus") or "")
            or (billing.get("paymentStatus") or "")
            or (w.get("paymentStatus") or "")
        ).upper()
        gateway_status = (
            ((billing.get("paymentGateway") or {}).get("transactionStatus") or "")
            or ((billing.get("paymentGatewayInfo") or {}).get("status") or "")
        ).upper()
        try:
            paid_amount = float(totals.get("paid") or 0)
        except Exception:
            paid_amount = 0.0
        is_paid = False
        if paid_amount > 0:
            is_paid = True
        elif payment_status_raw in ["PAID", "ACCEPTED", "SUCCESS"]:
            is_paid = True
        elif gateway_status in ["SUCCESS", "PAID", "CAPTURED"]:
            is_paid = True
        return "paid" if is_paid else "pending"

    # helper: compute wix subtotal & due (same rules used in sync)
    def wix_amounts(w: Dict, subtotal_sum: float = 0.0):
        totals = w.get("totals") or {}
        payment_due = totals.get("paymentDue") or totals.get("total") or subtotal_sum
        try:
            subtotal_val = float(totals.get("subtotal") or subtotal_sum)
        except Exception:
            subtotal_val = subtotal_sum
        try:
            payment_due = float(payment_due)
        except Exception:
            payment_due = subtotal_sum
        return subtotal_val, payment_due

    # fetch wix orders (single page)
    try:
        res = requests.post(
            "https://www.wixapis.com/stores/v2/orders/query",
            headers={"Authorization": WIX_API_KEY, "wix-site-id": WIX_SITE_ID, "Content-Type": "application/json"},
            json={"paging": {"limit": limit}},
            timeout=30
        )
    except Exception as e:
        logger.exception("Wix reconcile: API call error: %s", e)
        raise HTTPException(status_code=500, detail=f"Wix API error: {e}")

    if res.status_code != 200:
        logger.error("Wix reconcile: non-200 response: %s - %s", res.status_code, res.text[:300])
        raise HTTPException(status_code=500, detail=f"Wix responded: {res.status_code}")

    data = res.json()
    wix_orders = data.get("orders", []) or []

    report = []
    fixes = bool(int(fix))

    for w in wix_orders:
        order_report = {"wix_id": w.get("id"), "wix_number": w.get("number"), "db_order_id": None, "differences": [], "fixed": []}
        try:
            # prefer number, fallback to id
            wix_identifier = w.get("number") or w.get("id")
            wix_order_id = safe_str(wix_identifier)

            order_report["wix_order_id"] = wix_order_id

            # load DB order by order_id (match either number or UUID/id)
            db_order_row = db.execute(text("SELECT * FROM orders WHERE order_id = :oid LIMIT 1"), {"oid": wix_order_id}).first()
            if not db_order_row:
                # not present in DB -> record and continue
                order_report["differences"].append({"type": "missing_in_db"})
                report.append(order_report)
                continue

            o = dict(db_order_row._mapping)
            order_report["db_order_id"] = o.get("order_id")

            # --- compute wix totals & payment
            # compute subtotal_sum from line items for robust comparison
            line_items = w.get("lineItems") or w.get("items") or []
            wix_subtotal_sum = 0.0
            for li in line_items:
                wix_price = 0.0
                try:
                    wix_price = extract_price_value(li)
                except Exception:
                    wix_price = 0.0
                wix_qty = int(li.get("quantity") or li.get("qty") or 1)
                wix_subtotal_sum += round(wix_price * wix_qty, 2)

            wix_subtotal_val, wix_payment_due = wix_amounts(w, subtotal_sum=wix_subtotal_sum)
            wix_payment_status = detect_wix_paid_status(w)

            # --- 1) payment_status
            db_payment_status = (o.get("payment_status") or "").lower()
            if db_payment_status != wix_payment_status:
                order_report["differences"].append({
                    "field": "payment_status",
                    "db": db_payment_status,
                    "wix": wix_payment_status
                })
                if fixes:
                    try:
                        db.execute(text("UPDATE orders SET payment_status = :ps, updated_at = :u WHERE order_id = :oid"),
                                   {"ps": wix_payment_status, "u": datetime.utcnow(), "oid": o.get("order_id")})
                        db.commit()
                        order_report["fixed"].append({"field": "payment_status", "to": wix_payment_status})
                    except Exception as e:
                        db.rollback()
                        order_report["differences"].append({"fix_failed": f"payment_status update failed: {e}"})

            # --- 2) subtotal
            db_sub = float(o.get("subtotal") or 0)
            if round(db_sub, 2) != round(wix_subtotal_val, 2):
                order_report["differences"].append({"field": "subtotal", "db": db_sub, "wix": wix_subtotal_val})
                if fixes:
                    try:
                        db.execute(text("UPDATE orders SET subtotal = :s, updated_at = :u WHERE order_id = :oid"),
                                   {"s": round(wix_subtotal_val, 2), "u": datetime.utcnow(), "oid": o.get("order_id")})
                        db.commit()
                        order_report["fixed"].append({"field": "subtotal", "to": round(wix_subtotal_val, 2)})
                    except Exception as e:
                        db.rollback()
                        order_report["differences"].append({"fix_failed": f"subtotal update failed: {e}"})

            # --- 3) total_amount
            db_total = float(o.get("total_amount") or 0)
            if round(db_total, 2) != round(wix_payment_due, 2):
                order_report["differences"].append({"field": "total_amount", "db": db_total, "wix": wix_payment_due})
                if fixes:
                    try:
                        db.execute(text("UPDATE orders SET total_amount = :t, updated_at = :u WHERE order_id = :oid"),
                                   {"t": float(wix_payment_due), "u": datetime.utcnow(), "oid": o.get("order_id")})
                        db.commit()
                        order_report["fixed"].append({"field": "total_amount", "to": float(wix_payment_due)})
                    except Exception as e:
                        db.rollback()
                        order_report["differences"].append({"fix_failed": f"total_amount update failed: {e}"})

            # --- 4) delivery_status (map common wix shipping states to your DB)
            # determine wix delivery marker
            wix_delivery_status = "NOT_SHIPPED"
            shipping_info = (w.get("shippingInfo") or {})
            # rough mapping - tweak if you use other codes
            if (w.get("status") or "").upper() in ["COMPLETED", "FULFILLED", "SHIPPED"]:
                wix_delivery_status = "SHIPPED"
            elif (shipping_info.get("status") or "").upper() in ["FULFILLED", "SHIPPED", "COMPLETED"]:
                wix_delivery_status = "SHIPPED"
            db_delivery = (o.get("delivery_status") or "").upper()
            if db_delivery != wix_delivery_status:
                order_report["differences"].append({"field": "delivery_status", "db": db_delivery, "wix": wix_delivery_status})
                if fixes:
                    try:
                        db.execute(text("UPDATE orders SET delivery_status = :ds, updated_at = :u WHERE order_id = :oid"),
                                   {"ds": wix_delivery_status, "u": datetime.utcnow(), "oid": o.get("order_id")})
                        db.commit()
                        order_report["fixed"].append({"field": "delivery_status", "to": wix_delivery_status})
                    except Exception as e:
                        db.rollback()
                        order_report["differences"].append({"fix_failed": f"delivery_status update failed: {e}"})

            # --- 5) customer (name, mobile, email)
            db_customer_id = o.get("customer_id")
            db_offline_customer_id = o.get("offline_customer_id")
            wix_contact = None
            # reuse the same address extraction logic used in sync
            billing_info = w.get("billingInfo") or {}
            shipping_info = w.get("shippingInfo") or {}
            buyer_info = w.get("buyerInfo") or {}
            # prefer shipping then billing then buyer
            ship_dest = (shipping_info.get("logistics") or {}).get("shippingDestination") or {}
            ship_addr = ship_dest.get("address") or (shipping_info.get("shipmentDetails") or {}).get("address") or {}
            ship_contact = ship_dest.get("contactDetails") or (shipping_info.get("shipmentDetails") or {}).get("contactDetails") or {}
            if ship_addr or ship_contact:
                wix_contact = {
                    "name": safe_str(ship_contact.get("firstName") or ship_addr.get("fullName", {}).get("firstName") or ship_addr.get("firstName") or "") + " " + safe_str(ship_contact.get("lastName") or ship_addr.get("fullName", {}).get("lastName") or ship_addr.get("lastName") or ""),
                    "mobile": re.sub(r'\D', '', safe_str(ship_contact.get("phone") or ship_addr.get("phone") or "")),
                    "email": safe_str(ship_addr.get("email") or ship_contact.get("email") or "")
                }
            else:
                bill_addr = billing_info.get("address") or {}
                bill_contact = billing_info.get("contactDetails") or {}
                if bill_addr or bill_contact:
                    wix_contact = {
                        "name": safe_str(bill_contact.get("firstName") or bill_addr.get("fullName", {}).get("firstName") or bill_addr.get("firstName") or "") + " " + safe_str(bill_contact.get("lastName") or bill_addr.get("fullName", {}).get("lastName") or bill_addr.get("lastName") or ""),
                        "mobile": re.sub(r'\D', '', safe_str(bill_contact.get("phone") or bill_addr.get("phone") or "")),
                        "email": safe_str(bill_addr.get("email") or bill_contact.get("email") or "")
                    }
                else:
                    wix_contact = {
                        "name": safe_str(buyer_info.get("firstName") or "") + " " + safe_str(buyer_info.get("lastName") or ""),
                        "mobile": re.sub(r'\D', '', safe_str(buyer_info.get("phone") or "")),
                        "email": safe_str(buyer_info.get("email") or "")
                    }

            # compare DB customer fields
            if db_customer_id:
                row = db.execute(text("SELECT name, mobile, email FROM customer WHERE customer_id = :cid LIMIT 1"), {"cid": db_customer_id}).first()
                if row:
                    db_cust = dict(row._mapping)
                    # name/mobile/email differences
                    if (safe_str(db_cust.get("name")) != safe_str(wix_contact.get("name")).strip()) or (safe_str(db_cust.get("mobile")) != safe_str(wix_contact.get("mobile"))) or (safe_str(db_cust.get("email")) != safe_str(wix_contact.get("email"))):
                        order_report["differences"].append({"field": "customer", "db": db_cust, "wix": wix_contact})
                        if fixes:
                            try:
                                db.execute(text("UPDATE customer SET name = :n, mobile = :m, email = :e WHERE customer_id = :cid"),
                                           {"n": sanitize_scalar(wix_contact.get("name").strip()), "m": sanitize_scalar(wix_contact.get("mobile")), "e": sanitize_scalar(wix_contact.get("email")), "cid": db_customer_id})
                                db.commit()
                                order_report["fixed"].append({"field": "customer", "to": wix_contact})
                            except Exception as e:
                                db.rollback()
                                order_report["differences"].append({"fix_failed": f"customer update failed: {e}"})
            elif db_offline_customer_id:
                row = db.execute(text("SELECT name, mobile, email FROM offline_customer WHERE customer_id = :cid LIMIT 1"), {"cid": db_offline_customer_id}).first()
                if row:
                    db_cust = dict(row._mapping)
                    if (safe_str(db_cust.get("name")) != safe_str(wix_contact.get("name")).strip()) or (safe_str(db_cust.get("mobile")) != safe_str(wix_contact.get("mobile"))) or (safe_str(db_cust.get("email")) != safe_str(wix_contact.get("email"))):
                        order_report["differences"].append({"field": "offline_customer", "db": db_cust, "wix": wix_contact})
                        if fixes:
                            try:
                                db.execute(text("UPDATE offline_customer SET name = :n, mobile = :m, email = :e WHERE customer_id = :cid"),
                                           {"n": sanitize_scalar(wix_contact.get("name").strip()), "m": sanitize_scalar(wix_contact.get("mobile")), "e": sanitize_scalar(wix_contact.get("email")), "cid": db_offline_customer_id})
                                db.commit()
                                order_report["fixed"].append({"field": "offline_customer", "to": wix_contact})
                            except Exception as e:
                                db.rollback()
                                order_report["differences"].append({"fix_failed": f"offline_customer update failed: {e}"})
            else:
                # Order has no associated customer rows — if fix requested, create a customer or offline_customer
                order_report["differences"].append({"field": "customer_missing", "wix": wix_contact})
                if fixes:
                    try:
                        new_cid = create_customer(db, wix_contact.get("name").strip(), wix_contact.get("mobile"), wix_contact.get("email"))
                        db.execute(text("UPDATE orders SET customer_id = :cid, updated_at = :u WHERE order_id = :oid"), {"cid": new_cid, "u": datetime.utcnow(), "oid": o.get("order_id")})
                        db.commit()
                        order_report["fixed"].append({"field": "customer_created", "cid": new_cid})
                    except Exception as e:
                        db.rollback()
                        order_report["differences"].append({"fix_failed": f"customer create failed: {e}"})

            # --- 6) address check (compare address_line, pincode, city, state)
            wix_addr_line = sanitize_scalar((ship_addr.get("addressLine") or ship_addr.get("addressLine1") or ship_addr.get("addressLine") or w.get("shippingInfo", {}).get("address", {}) or "")) if isinstance(ship_addr, dict) else sanitize_scalar(w.get("shippingInfo", {}).get("address", "") or "")
            wix_pincode = sanitize_scalar(ship_addr.get("postalCode") or ship_addr.get("zipCode") or "")
            wix_city = sanitize_scalar(ship_addr.get("city") or "")
            # try resolve wix state id using helper
            wix_state_id = find_state_id(db, (ship_addr.get("subdivision") or ship_addr.get("subdivisionFullname") or ""))
            db_addr = db.execute(text("SELECT address_line, pincode, city, state_id FROM address WHERE address_id = :aid LIMIT 1"), {"aid": o.get("address_id")}).first()
            if db_addr:
                db_addr_d = dict(db_addr._mapping)
                addr_mismatch = False
                if sanitize_scalar(db_addr_d.get("address_line") or "") != sanitize_scalar(wix_addr_line or ""):
                    addr_mismatch = True
                if sanitize_scalar(db_addr_d.get("pincode") or "") != sanitize_scalar(wix_pincode or ""):
                    addr_mismatch = True
                if sanitize_scalar(db_addr_d.get("city") or "") != sanitize_scalar(wix_city or ""):
                    addr_mismatch = True
                # compare state_id if wix_state_id resolved
                if wix_state_id and int(db_addr_d.get("state_id") or 0) != int(wix_state_id):
                    addr_mismatch = True
                if addr_mismatch:
                    order_report["differences"].append({"field": "address", "db": db_addr_d, "wix": {"address_line": wix_addr_line, "pincode": wix_pincode, "city": wix_city, "state_id": wix_state_id}})
                    if fixes:
                        try:
                            # create a new address and attach it to order (safer than updating existing address row)
                            new_addr_payload = {
                                "name": sanitize_scalar(wix_contact.get("name") or "Wix Customer"),
                                "mobile": sanitize_scalar(wix_contact.get("mobile") or ""),
                                "pincode": sanitize_scalar(wix_pincode or ""),
                                "address_line": sanitize_scalar(wix_addr_line or ""),
                                "city": sanitize_scalar(wix_city or ""),
                                "state_id": wix_state_id or (db_addr_d.get("state_id") or 1),
                                "address_type": "shipping",
                                "created_at": datetime.utcnow(),
                                "updated_at": datetime.utcnow(),
                                "is_available": 1
                            }
                            if db_customer_id:
                                new_addr_payload["customer_id"] = db_customer_id
                            elif db_offline_customer_id:
                                new_addr_payload["offline_customer_id"] = db_offline_customer_id
                            new_addr_id = create_address(db, new_addr_payload)
                            db.execute(text("UPDATE orders SET address_id = :aid, updated_at = :u WHERE order_id = :oid"), {"aid": new_addr_id, "u": datetime.utcnow(), "oid": o.get("order_id")})
                            db.commit()
                            order_report["fixed"].append({"field": "address", "new_address_id": new_addr_id})
                        except Exception as e:
                            db.rollback()
                            order_report["differences"].append({"fix_failed": f"address create/update failed: {e}"})
            else:
                order_report["differences"].append({"field": "address_missing_in_db"})
                if fixes:
                    try:
                        new_addr_payload = {
                            "name": sanitize_scalar(wix_contact.get("name") or "Wix Customer"),
                            "mobile": sanitize_scalar(wix_contact.get("mobile") or ""),
                            "pincode": sanitize_scalar(wix_pincode or ""),
                            "address_line": sanitize_scalar(wix_addr_line or ""),
                            "city": sanitize_scalar(wix_city or ""),
                            "state_id": wix_state_id or 1,
                            "address_type": "shipping",
                            "created_at": datetime.utcnow(),
                            "updated_at": datetime.utcnow(),
                            "is_available": 1
                        }
                        if db_customer_id:
                            new_addr_payload["customer_id"] = db_customer_id
                        elif db_offline_customer_id:
                            new_addr_payload["offline_customer_id"] = db_offline_customer_id
                        new_addr_id = create_address(db, new_addr_payload)
                        db.execute(text("UPDATE orders SET address_id = :aid, updated_at = :u WHERE order_id = :oid"), {"aid": new_addr_id, "u": datetime.utcnow(), "oid": o.get("order_id")})
                        db.commit()
                        order_report["fixed"].append({"field": "address_created", "new_address_id": new_addr_id})
                    except Exception as e:
                        db.rollback()
                        order_report["differences"].append({"fix_failed": f"address create failed: {e}"})

            # --- 7) line items (compare counts, quantities, prices, SKUs)
            # fetch db items
            db_items_rows = db.execute(text("SELECT item_id, product_id, quantity, unit_price, total_price FROM order_items WHERE order_id = :oid"), {"oid": o.get("order_id")}).fetchall()
            db_items = [dict(r._mapping) for r in db_items_rows]
            # construct wix items list normalized
            wix_items_norm = []
            for li in line_items:
                sku = safe_str((li.get("physicalProperties") or {}).get("sku") or li.get("sku") or li.get("variantSku") or li.get("skuId") or "")
                qty = int(li.get("quantity") or li.get("qty") or 1)
                unit_price = float(extract_price_value(li) or 0.0)
                wix_items_norm.append({"sku": sku, "quantity": qty, "unit_price": unit_price, "total_price": round(unit_price * qty, 2)})

            # basic count mismatch
            if len(db_items) != len(wix_items_norm):
                order_report["differences"].append({"field": "line_items_count", "db": len(db_items), "wix": len(wix_items_norm)})
            # detailed comparison by index (best-effort)
            line_mismatches = []
            for i, wix_it in enumerate(wix_items_norm):
                db_it = db_items[i] if i < len(db_items) else None
                # attempt to find by sku->product mapping if db_it exists and product_id present
                db_sku = None
                if db_it and db_it.get("product_id"):
                    r = db.execute(text("SELECT sku_id FROM products WHERE product_id = :pid LIMIT 1"), {"pid": db_it.get("product_id")}).first()
                    db_sku = r[0] if r else None
                # compare sku, quantity, unit_price
                sku_ok = (safe_str(db_sku) == safe_str(wix_it.get("sku")))
                qty_ok = db_it and int(db_it.get("quantity") or 0) == int(wix_it.get("quantity") or 0)
                price_ok = db_it and round(float(db_it.get("unit_price") or 0), 2) == round(float(wix_it.get("unit_price") or 0), 2)
                if not (sku_ok and qty_ok and price_ok):
                    line_mismatches.append({"index": i, "db": db_it, "wix": wix_it})
            if line_mismatches:
                order_report["differences"].append({"field": "line_items_details", "mismatches": line_mismatches})
                if fixes:
                    # naive but safe fix: delete existing order_items and recreate from wix_items_norm
                    try:
                        db.execute(text("DELETE FROM order_items WHERE order_id = :oid"), {"oid": o.get("order_id")})
                        for wix_it in wix_items_norm:
                            # map sku -> product_id
                            product = None
                            if wix_it.get("sku"):
                                product = find_product_by_sku(db, wix_it.get("sku"))
                            if not product:
                                product = ensure_unknown_product(db)
                            pid = product.get("product_id") if product else None
                            db.execute(text("""
                                INSERT INTO order_items (order_id, product_id, quantity, unit_price, total_price)
                                VALUES (:oid, :pid, :qty, :unit, :t)
                            """), {"oid": o.get("order_id"), "pid": pid, "qty": wix_it.get("quantity"), "unit": wix_it.get("unit_price"), "t": wix_it.get("total_price")})
                        db.commit()
                        order_report["fixed"].append({"field": "line_items_recreated", "count": len(wix_items_norm)})
                    except Exception as e:
                        db.rollback()
                        order_report["differences"].append({"fix_failed": f"line_items recreation failed: {e}"})

            # finish per-order
            report.append(order_report)

        except Exception as e:
            logger.exception("Reconcile loop error for wix order %s: %s", safe_str(w.get("id")), e)
            report.append({"wix_id": safe_str(w.get("id")), "error": str(e)})
            continue

    return {"summary": {"processed": len(wix_orders), "with_differences": sum(1 for r in report if r.get("differences"))}, "details": report}
