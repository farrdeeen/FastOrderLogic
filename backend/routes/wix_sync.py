# routes/wix_sync.py
"""
Optimized Wix sync (Option C, final) - MERGED (Option A1 name/address extraction).
- Robust extraction for fullName (handles str/dict/absent).
- Robust invoice logic (delivery distribution, subtotal).
- Proper payment and totals determination.
- Duplicate detection, force=1 item recreation.
- Per-order commit/rollback and predictable logging.
- Drop into routes/ and wire router as before.
"""

import os
import re
import json
import logging
from datetime import datetime
from typing import Optional, Dict, Any, List

import requests
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

    # Handle Wix "IN-BR", "IN-UP", etc.
    if "-" in s:
        parts = s.split("-", 1)
        if len(parts) == 2:
            s = parts[1]  # BR, UP, MH

    # Map short codes properly
    abbrev = {
    # States
    "ap": "andhra pradesh",
    "ar": "arunachal pradesh",
    "as": "assam",
    "br": "bihar",
    "ct": "chhattisgarh",
    "ga": "goa",
    "gj": "gujarat",
    "hr": "haryana",
    "hp": "himachal pradesh",
    "jh": "jharkhand",
    "jk": "jammu and kashmir",
    "ka": "karnataka",
    "kl": "kerala",
    "mp": "madhya pradesh",
    "mh": "maharashtra",
    "mn": "manipur",
    "ml": "meghalaya",
    "mz": "mizoram",
    "nl": "nagaland",
    "or": "odisha",
    "pb": "punjab",
    "rj": "rajasthan",
    "sk": "sikkim",
    "tn": "tamil nadu",
    "tg": "telangana",
    "tr": "tripura",
    "up": "uttar pradesh",
    "ut": "uttarakhand",
    "wb": "west bengal",

    # Union Territories
    "an": "andaman and nicobar islands",
    "ch": "chandigarh",
    "dn": "dadra and nagar haveli and daman and diu",
    "dd": "daman and diu",  # legacy
    "dh": "dadra and nagar haveli",  # legacy
    "dl": "delhi",
    "la": "ladakh",
    "ld": "lakshadweep",
    "py": "puducherry"
}

    if s in abbrev:
        s = abbrev[s]

    # Exact match
    r = db.execute(text("SELECT state_id FROM state WHERE LOWER(name)=:n LIMIT 1"), {"n": s}).first()
    if r:
        return int(r[0])

    # Partial match only if input is longer (avoid AP → Andhra)
    if len(s) > 2:
        r2 = db.execute(text("SELECT state_id FROM state WHERE LOWER(name) LIKE :n LIMIT 1"),
                        {"n": f"%{s}%"}).first()
        return int(r2[0]) if r2 else None

    return None

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
        # Wix returns order object under "order"
        return data.get("order", {}).get("number")
    except Exception as e:
        logger.exception("fetch_wix_order_number error: %s", e)
        return None

# ---------------------------
# Helpers: robust fullName normalization (Option A1)
# ---------------------------
def normalize_fullname(val: Any) -> str:
    """
    Handle Wix's fullName which can be:
     - string "Amit Shah"
     - dict {"firstName": "Amit", "lastName": "Shah", "formatted": "Amit Shah"}
     - None/other types
    Return a clean string (may be empty).
    """
    if not val:
        return ""
    if isinstance(val, str):
        return val.strip()
    if isinstance(val, dict):
        # try formatted first
        fmt = val.get("formatted")
        if isinstance(fmt, str) and fmt.strip():
            return fmt.strip()
        fn = val.get("firstName") or ""
        ln = val.get("lastName") or ""
        return f"{fn} {ln}".strip()
    try:
        return str(val).strip()
    except Exception:
        return ""

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
        # reset per-order DB transaction state if used externally
        order_result = {"wix_order_id": None, "status": None, "reasons": [], "items": []}

        try:
            # 1) Determine the wix order number (prefer number; fallback only if missing)
            wix_number = w.get("number")
            if not wix_number:
                wix_number = fetch_wix_order_number(w.get("id")) or w.get("id")

            raw_id = safe_str(wix_number).strip()
            wix_order_id = f"WIX#{raw_id}" if raw_id else None
            order_result["wix_order_id"] = wix_order_id

            if not wix_order_id:
                skipped += 1
                order_result["status"] = "skipped"
                order_result["reasons"].append("missing_order_id")
                details.append(order_result)
                continue

            # Duplicate check (match WIX#number, raw id or previous versions)
            existing_order_row = db.execute(
                text("""
                    SELECT order_id 
                    FROM orders
                    WHERE order_id = :oid_raw
                    OR order_id = CONCAT('WIX#', :noprefix)
                    OR REPLACE(order_id, 'WIX#', '') = :noprefix
                    LIMIT 1
                """),
                {"oid_raw": wix_order_id, "noprefix": raw_id}
            ).first()

            existing_order = bool(existing_order_row)

            if existing_order and not force:
                skipped += 1
                order_result["status"] = "skipped_existing"
                order_result["reasons"].append("order_already_synced")
                details.append(order_result)
                continue

            # created_at from DB server
            created_at = db.execute(text("SELECT NOW()")).scalar()

            # ----------------------
            #  CUSTOMER + ADDRESS
            # ----------------------
            billing = w.get("billingInfo") or {}
            shipping = w.get("shippingInfo") or {}
            buyer = w.get("buyerInfo") or {}

            # robust extraction (Option A1)
            def _extract_address_info():
                # shipping destination preferred
                ship_dest = (shipping.get("logistics") or {}).get("shippingDestination") or {}
                ship_addr = ship_dest.get("address") or (shipping.get("shipmentDetails") or {}).get("address") or {}
                ship_contact = ship_dest.get("contactDetails") or (shipping.get("shipmentDetails") or {}).get("contactDetails") or {}

                # detect presence
                if ship_addr or ship_contact:
                    # try multiple sources for name
                    fn = ""
                    ln = ""
                    # shipping contact may be dict
                    if isinstance(ship_contact, dict):
                        fn = ship_contact.get("firstName") or ""
                        ln = ship_contact.get("lastName") or ""
                        # sometimes fullName may exist
                        if not fn and isinstance(ship_contact.get("fullName"), (str, dict)):
                            fn_full = normalize_fullname(ship_contact.get("fullName"))
                            if fn_full:
                                parts = fn_full.split()
                                fn = parts[0] if parts else ""
                                ln = " ".join(parts[1:]) if len(parts) > 1 else ln
                    # ship_addr may have fullName block
                    if (not fn and isinstance(ship_addr, dict)) and ship_addr.get("fullName"):
                        fn_full = normalize_fullname(ship_addr.get("fullName"))
                        if fn_full:
                            parts = fn_full.split()
                            fn = parts[0] if parts else ""
                            ln = " ".join(parts[1:]) if len(parts) > 1 else ln

                    # last fallback to explicit fields
                    if not fn and isinstance(ship_addr, dict):
                        fn = ship_addr.get("firstName") or ""
                        ln = ship_addr.get("lastName") or ""

                    full = f"{fn or ''} {ln or ''}".strip()

                    return {
                        "fullName": full or None,
                        "firstName": fn.strip() or None,
                        "lastName": ln.strip() or None,
                        "phone": ship_contact.get("phone") or ship_addr.get("phone"),
                        "email": ship_addr.get("email") or ship_contact.get("email"),
                        "addressLine1": ship_addr.get("addressLine") or ship_addr.get("addressLine1") or ship_addr.get("addressLine"),
                        "postalCode": ship_addr.get("postalCode") or ship_addr.get("zipCode"),
                        "city": ship_addr.get("city"),
                        "region": (
                            ship_addr.get("subdivision")
                            or ship_addr.get("subdivisionFullname")
                            or ship_addr.get("state")
                            or ship_addr.get("region")
                            or ship_addr.get("province")
                            or ship_addr.get("administrativeArea")
                        )
                    }

                # billing fallback
                bill_addr = billing.get("address") or {}
                bill_contact = billing.get("contactDetails") or {}
                if bill_addr or bill_contact:
                    fn = ""
                    ln = ""
                    if isinstance(bill_contact, dict):
                        fn = bill_contact.get("firstName") or ""
                        ln = bill_contact.get("lastName") or ""
                        if not fn and isinstance(bill_contact.get("fullName"), (str, dict)):
                            fn_full = normalize_fullname(bill_contact.get("fullName"))
                            if fn_full:
                                parts = fn_full.split()
                                fn = parts[0] if parts else ""
                                ln = " ".join(parts[1:]) if len(parts) > 1 else ln
                    if (not fn and isinstance(bill_addr, dict)) and bill_addr.get("fullName"):
                        fn_full = normalize_fullname(bill_addr.get("fullName"))
                        if fn_full:
                            parts = fn_full.split()
                            fn = parts[0] if parts else ""
                            ln = " ".join(parts[1:]) if len(parts) > 1 else ln

                    if not fn and isinstance(bill_addr, dict):
                        fn = bill_addr.get("firstName") or ""
                        ln = bill_addr.get("lastName") or ""

                    full = f"{fn or ''} {ln or ''}".strip()

                    return {
                        "fullName": full or None,
                        "firstName": fn.strip() or None,
                        "lastName": ln.strip() or None,
                        "phone": bill_contact.get("phone") or bill_addr.get("phone"),
                        "email": bill_addr.get("email") or bill_contact.get("email"),
                        "addressLine1": bill_addr.get("addressLine") or bill_addr.get("addressLine1") or bill_addr.get("addressLine"),
                        "postalCode": bill_addr.get("postalCode") or bill_addr.get("zipCode"),
                        "city": bill_addr.get("city"),
                        "region": (
                            bill_addr.get("subdivision")
                            or bill_addr.get("subdivisionFullname")
                            or bill_addr.get("state")
                            or bill_addr.get("region")
                            or bill_addr.get("province")
                            or bill_addr.get("administrativeArea")
                        )
                    }

                # buyer fallback
                bn_fn = ""
                bn_ln = ""
                if isinstance(buyer, dict):
                    bn_fn = buyer.get("firstName") or ""
                    bn_ln = buyer.get("lastName") or ""
                    if not bn_fn and buyer.get("fullName"):
                        bn_full = normalize_fullname(buyer.get("fullName"))
                        if bn_full:
                            parts = bn_full.split()
                            bn_fn = parts[0] if parts else ""
                            bn_ln = " ".join(parts[1:]) if len(parts) > 1 else bn_ln
                full = f"{bn_fn or ''} {bn_ln or ''}".strip()
                return {
                    "fullName": full or None,
                    "firstName": bn_fn.strip() or None,
                    "lastName": bn_ln.strip() or None,
                    "phone": buyer.get("phone"),
                    "email": buyer.get("email"),
                    "addressLine1": buyer.get("addressLine") or buyer.get("address") or "",
                    "postalCode": "",
                    "city": "",
                    "region": (
                        buyer.get("region")
                        or buyer.get("state")
                        or buyer.get("province")
                    )
                }

            contact = _extract_address_info()
            # Ensure we have a name: prefer fullName then firstName then buyer names
            name_candidate = safe_str(contact.get("fullName") or contact.get("firstName") or (buyer.get("firstName") or buyer.get("lastName")) or "")
            name = name_candidate.strip() or None
            phone_raw = safe_str(contact.get("phone") or "")
            phone_digits = re.sub(r'\D', '', phone_raw)
            if phone_digits and len(phone_digits) < 7:
                phone_digits = ""
            email = safe_str(contact.get("email") or "")

            logger.debug("Extracted contact for wix order %s: %s", wix_order_id, contact)

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

            # ----------------------
            #   LINE ITEMS + INVOICE LOGIC
            # ----------------------
            line_items = w.get("lineItems") or w.get("items") or []
            items_out = []

            # If force and existing order -> delete order_items for recreation
            if existing_order and force:
                try:
                    db.execute(text("DELETE FROM order_items WHERE order_id = :oid"), {"oid": wix_order_id})
                    logger.debug("Deleted previous order_items for %s (force)", wix_order_id)
                except Exception as e:
                    logger.exception("Failed delete order_items for %s: %s", wix_order_id, e)

            # Step 1: gather base unit prices and product mapping
            for li in line_items:
                try:
                    if not isinstance(li, dict):
                        continue
                    sku = safe_str((li.get("physicalProperties") or {}).get("sku") or li.get("sku") or li.get("variantSku") or li.get("skuId") or "")
                    wix_pid = safe_str((li.get("catalogReference") or {}).get("catalogItemId") if isinstance(li.get("catalogReference"), dict) else li.get("productId") or li.get("product_id") or "")
                    name_field = li.get("productName") or li.get("name") or li.get("title") or ""
                    title = safe_str(name_field.get("original") if isinstance(name_field, dict) else name_field)
                    qty = int(li.get("quantity") or li.get("qty") or 1)
                    base_price = extract_price_value(li)

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

                    # Enforce misc product fallback if still unknown
                    if not product:
                        misc_row = db.execute(
                            text("SELECT product_id, name, sku_id, IFNULL(zoho_sku,'') AS zoho_sku FROM products WHERE sku_id = 'misc' LIMIT 1")
                        ).first()
                        if not misc_row:
                            raise HTTPException(500, "Misc product (sku='misc') not found. Please create it in products table.")
                        product = dict(misc_row._mapping)
                        mapping = mapping or "misc_assigned"

                    pid = product.get("product_id") if product else None
                    items_out.append({
                        "title": title,
                        "sku": sku,
                        "wix_product_id": wix_pid,
                        "product_id": pid,
                        "quantity": qty,
                        "base_unit_price": base_price,
                        "mapping": mapping or "unknown"
                    })
                except Exception as e:
                    logger.exception("Failed to process line item (gather): %s", e)
                    order_result["reasons"].append(f"line_item_failed:{e}")

            # Step 2: delivery charge distribution AFTER items gathered
            try:
                totals = w.get("totals") or {}
                delivery_charge = float(
                    totals.get("shipping") or totals.get("shippingFee") or totals.get("deliveryCharge") or totals.get("shippingAmount") or 0
                )
            except Exception:
                delivery_charge = 0.0

            total_qty = sum(i["quantity"] for i in items_out) or 1
            delivery_per_unit = round(delivery_charge / total_qty, 2) if total_qty else 0.0

            # Insert order_items with distributed delivery
            subtotal_sum = 0.0
            for item in items_out:
                try:
                    unit_price = float(item["base_unit_price"]) + delivery_per_unit
                    total_price = round(unit_price * item["quantity"], 2)

                    item["unit_price"] = unit_price
                    item["total_price"] = total_price

                    subtotal_sum += total_price

                    # Insert order_items
                    db.execute(text("""
                        INSERT INTO order_items (order_id, product_id, model_id, color_id,
                                                 quantity, unit_price, total_price)
                        VALUES (:oid, :pid, NULL, NULL, :qty, :unit, :total)
                    """), {
                        "oid": wix_order_id,
                        "pid": item["product_id"],
                        "qty": item["quantity"],
                        "unit": unit_price,
                        "total": total_price
                    })
                except Exception as e:
                    logger.exception("order_item insert failed: %s", e)
                    order_result["reasons"].append(f"order_item_insert_failed:{e}")

            # ----------------------
            #  PAYMENT & ORDER ROW
            # ----------------------
            totals = w.get("totals") or {}
            billing = w.get("billingInfo") or {}

            # Extract raw status values Wix may send
            payment_status_raw = (
                (totals.get("paymentStatus") or "")
                or (billing.get("paymentStatus") or "")
                or w.get("paymentStatus")
                or ""
            )
            payment_status_raw = safe_str(payment_status_raw).upper()

            gateway_status = (
                ((billing.get("paymentGateway") or {}).get("transactionStatus"))
                or ((billing.get("paymentGatewayInfo") or {}).get("status"))
                or ""
            )
            gateway_status = safe_str(gateway_status).upper()

            try:
                paid_amount = float(totals.get("paid") or 0)
            except Exception:
                paid_amount = 0.0

            # Determine paid/unpaid using robust rules
            is_paid = False
            if paid_amount > 0:
                is_paid = True
            elif payment_status_raw in ["PAID", "ACCEPTED", "SUCCESS"]:
                is_paid = True
            elif gateway_status in ["SUCCESS", "PAID", "CAPTURED"]:
                is_paid = True

            payment_status = "paid" if is_paid else "pending"

            # totals: prefer paymentDue then total, subtotal prefer totals.subtotal
            try:
                payment_due = float(totals.get("paymentDue") or totals.get("total") or subtotal_sum)
            except Exception:
                payment_due = subtotal_sum
            try:
                subtotal_val = float(totals.get("subtotal") or subtotal_sum)
            except Exception:
                subtotal_val = subtotal_sum

            order_index = get_next_order_index(db)

            order_payload = {
                "order_id": wix_order_id,
                "customer_id": customer_id,
                "offline_customer_id": offline_customer_id,
                "address_id": address_id or 0,
                "total_items": len(items_out),
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
                        "total_items": order_payload["total_items"],
                        "subtotal": round(order_payload["subtotal"], 2),
                        "total_amount": float(order_payload["total_amount"]),
                        "payment_status": order_payload["payment_status"],
                        "updated_at": order_payload["updated_at"],
                        "order_id": order_payload["order_id"]
                    })
                db.commit()
                if not existing_order:
                    inserted += 1
                    order_result["status"] = "inserted"
                else:
                    order_result["status"] = "updated"
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
            try:
                db.rollback()
            except Exception:
                logger.exception("Rollback after unexpected error failed.")
            skipped += 1
            details.append({"wix_order_id": safe_str(w.get("id")), "status": "skipped", "reasons": [str(e)], "items": []})
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

# ---------------------------
# Reconcile endpoint
# ---------------------------
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
            # Prefer number, fallback to id
            wix_number = w.get("number") or fetch_wix_order_number(w.get("id")) or w.get("id")
            raw_id = safe_str(wix_number).strip()

            # Always prefix with WIX#
            wix_order_id = f"WIX#{raw_id}"
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
                order_report["differences"].append({"field": "subtotal", "db": db_sub,"wix": wix_subtotal_val})
                if fixes:
                    try:
                        db.execute(text("UPDATE orders SET subtotal = :st, updated_at = :u WHERE order_id = :oid"),
                                   {"st": wix_subtotal_val, "u": datetime.utcnow(), "oid": o.get("order_id")})
                        db.commit()
                        order_report["fixed"].append({"field": "subtotal", "to": wix_subtotal_val})
                    except Exception as e:
                        db.rollback()
                        order_report["differences"].append({"fix_failed": f"subtotal update failed: {e}"})

            # --- 3) total_amount
            db_total = float(o.get("total_amount") or 0)
            if round(db_total, 2) != round(wix_payment_due, 2):
                order_report["differences"].append({
                    "field": "total_amount",
                    "db": db_total,
                    "wix": wix_payment_due
                })
                if fixes:
                    try:
                        db.execute(text("""
                            UPDATE orders
                            SET total_amount = :ta, updated_at = :u
                            WHERE order_id = :oid
                        """), {
                            "ta": wix_payment_due,
                            "u": datetime.utcnow(),
                            "oid": o.get("order_id")
                        })
                        db.commit()
                        order_report["fixed"].append({"field": "total_amount", "to": wix_payment_due})
                    except Exception as e:
                        db.rollback()
                        order_report["differences"].append({"fix_failed": f"total_amount update failed: {e}"})

            # done for this order
            report.append(order_report)

        except Exception as e:
            order_report["differences"].append({"error": str(e)})
            report.append(order_report)
            logger.exception("Error during reconcile for order %s: %s", w.get("id"), e)

    return {
        "message": "Wix reconciliation complete",
        "fix_mode": fixes,
        "checked_orders": len(wix_orders),
        "report": report
    }
