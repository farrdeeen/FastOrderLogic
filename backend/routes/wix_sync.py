# routes/wix_sync.py
"""
Merged Wix sync endpoint (stable + advanced mapping features) with debug logging.

This is the "Option 2" file: full merged implementation + added debug logs and
address lookup behavior:
 - Before inserting a new address, we check whether an address with the same
   address_line / mobile / pincode / city already exists. If it does, we reuse
   that address_id and also pull the state_id from that DB row.
 - Extensive debug logging added so a failing request that returns 500 will
   include useful messages in your server logs.

Drop this file into your FastAPI project (routes folder) and wire the router
where you register other routers.

Notes:
 - Uses the existing SessionLocal and raw SQL execution like your previous file.
 - If you still get 500s, check app logs (stdout/stderr) where this process runs
   — the logger prints exception tracebacks and hints.
"""

from dotenv import load_dotenv
load_dotenv()
import json
import os
import re
import time
import traceback
import logging
from typing import Any, Dict, Optional, List
from datetime import datetime

import requests
from dateutil import parser
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from database import SessionLocal

# Router
router = APIRouter(prefix="/sync", tags=["Wix Sync"])

# Environment
WIX_API_KEY = os.getenv("WIX_API_KEY")
WIX_SITE_ID = os.getenv("WIX_SITE_ID")
DEFAULT_CATEGORY_ID = int(os.getenv("DEFAULT_AUTO_CATEGORY_ID", 26))
MIN_VALID_SKU_LEN = 2

# Configure logger
logger = logging.getLogger("wix_sync")
if not logger.handlers:
    # Avoid duplicate handlers if imported multiple times
    handler = logging.StreamHandler()
    fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s")
    handler.setFormatter(fmt)
    logger.addHandler(handler)
logger.setLevel(logging.DEBUG)


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
    if len(s) < MIN_VALID_SKU_LEN:
        return False
    return not re.match(r'^(unknown|misc|test)$', s, re.I)


# ---------------------
# synthetic mobile generator (unique sequence starting at 0000000001)
# ---------------------
def generate_synthetic_mobile(db: Session) -> str:
    """
    Generate next synthetic mobile starting from 0000000001.
    Uses CAST(mobile AS UNSIGNED) on offline_customer.mobile for numeric comparison.
    """
    try:
        r = db.execute(text("""
            SELECT COALESCE(MAX(CAST(mobile AS UNSIGNED)), 0) AS mx
            FROM offline_customer
            WHERE mobile REGEXP '^0{9}[0-9]+$'
        """)).first()
        current_max = int(r[0]) if r and r[0] is not None else 0
    except Exception:
        current_max = 0

    next_val = current_max + 1
    synthetic = str(next_val).zfill(10)  # e.g. '0000000001'
    return synthetic


# ---------------------
# product lookups / creation / fallback
# ---------------------
def find_product_by_sku(db: Session, sku: str) -> Optional[Dict]:
    if not sku:
        return None
    r = db.execute(text("""
        SELECT product_id, name, sku_id, IFNULL(zoho_sku, '') AS zoho_sku
        FROM products WHERE sku_id = :s LIMIT 1
    """), {"s": sku}).first()
    return dict(r._mapping) if r else None


def find_product_by_wix_product_id(db: Session, wix_pid: str) -> Optional[Dict]:
    if not wix_pid:
        return None
    r = db.execute(text("""
        SELECT product_id, name, sku_id, IFNULL(zoho_sku, '') AS zoho_sku
        FROM products
        WHERE sku_id = :wixpid OR product_id = :tryid
        LIMIT 1
    """), {"wixpid": wix_pid, "tryid": wix_pid}).first()
    return dict(r._mapping) if r else None


def find_product_by_name(db: Session, name: str) -> Optional[Dict]:
    if not name:
        return None
    r = db.execute(text("""
        SELECT product_id, name, sku_id, IFNULL(zoho_sku, '') AS zoho_sku
        FROM products
        WHERE LOWER(name) = :n
        LIMIT 1
    """), {"n": name.lower()}).first()
    if r:
        return dict(r._mapping)
    r2 = db.execute(text("""
        SELECT product_id, name, sku_id, IFNULL(zoho_sku, '') AS zoho_sku
        FROM products
        WHERE LOWER(name) LIKE :n
        LIMIT 1
    """), {"n": f"%{name.lower()}%"}).first()
    return dict(r2._mapping) if r2 else None


def create_product_from_sku(db: Session, sku: Optional[str], title: str = "Auto Product (from Wix)"):
    """
    Insert a minimal product row and return it.
    Uses sku if available to set sku_id.
    """
    now = datetime.utcnow()
    name = f"{title} ({sku})" if sku else title
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
    r = db.execute(text("""
        SELECT product_id, name, sku_id, IFNULL(zoho_sku, '') AS zoho_sku
        FROM products WHERE product_id = :pid LIMIT 1
    """), {"pid": pid}).first()
    return dict(r._mapping) if r else {"product_id": pid, "name": name, "sku_id": sku, "zoho_sku": ""}


def ensure_unknown_fallback_product(db: Session) -> Dict:
    """Return an existing 'Unknown Product (auto)' or create one and return it."""
    r = db.execute(text("""
        SELECT product_id, name, sku_id, IFNULL(zoho_sku, '') AS zoho_sku
        FROM products WHERE name = :n LIMIT 1
    """), {"n": "Unknown Product (auto)"}).first()
    if r:
        return dict(r._mapping)
    db.execute(text("""
        INSERT INTO products (name, description, category_id, product_type, created_at)
        VALUES (:name, :description, :category_id, 'auto', :created_at)
    """), {
        "name": "Unknown Product (auto)",
        "description": "Fallback product created automatically for unmapped Wix items",
        "category_id": DEFAULT_CATEGORY_ID,
        "created_at": datetime.utcnow()
    })
    pid = db.execute(text("SELECT LAST_INSERT_ID()")).scalar()
    r2 = db.execute(text("""
        SELECT product_id, name, sku_id, IFNULL(zoho_sku, '') AS zoho_sku
        FROM products WHERE product_id = :pid LIMIT 1
    """), {"pid": pid}).first()
    return dict(r2._mapping) if r2 else {"product_id": pid, "name": "Unknown Product (auto)", "sku_id": None, "zoho_sku": ""}


# ---------------------
# customer helpers
# ---------------------
def find_customer(db: Session, mobile=None, email=None):
    if mobile:
        r = db.execute(text("SELECT * FROM customer WHERE mobile = :m LIMIT 1"), {"m": mobile}).first()
        if r:
            return dict(r._mapping)
    if email:
        r = db.execute(text("SELECT * FROM customer WHERE email = :e LIMIT 1"), {"e": email}).first()
        if r:
            return dict(r._mapping)
    return None


def upsert_customer(db: Session, name, mobile, email):
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
    return None


def find_offline_customer_by_mobile(db: Session, mobile: str):
    if not mobile:
        return None
    r = db.execute(text("SELECT * FROM offline_customer WHERE mobile = :m LIMIT 1"), {"m": mobile}).first()
    return dict(r._mapping) if r else None


def create_or_get_offline_customer(db: Session, name=None, mobile=None, email=None):
    """
    Create offline_customer while avoiding UNIQUE mobile collisions.
    If mobile is too short, treat as missing and generate synthetic one.
    """
    if mobile and len(str(mobile).strip()) < 7:
        mobile = None

    if mobile:
        existing = find_offline_customer_by_mobile(db, mobile)
        if existing:
            return existing["customer_id"]

    use_mobile = mobile
    if not use_mobile:
        # attempt a few times to generate unique synthetic mobile
        for _ in range(5):
            candidate = generate_synthetic_mobile(db)
            if not find_offline_customer_by_mobile(db, candidate):
                use_mobile = candidate
                break
        if not use_mobile:
            use_mobile = datetime.utcnow().strftime("000%y%m%d%H%M%S")[:15]

    try:
        db.execute(text("INSERT INTO offline_customer (name, mobile, email) VALUES (:name, :mobile, :email)"),
                   {"name": sanitize_scalar(name) or "", "mobile": sanitize_scalar(use_mobile), "email": sanitize_scalar(email)})
        cid = db.execute(text("SELECT LAST_INSERT_ID()")).scalar()
        return cid
    except Exception:
        existing = find_offline_customer_by_mobile(db, use_mobile)
        if existing:
            return existing["customer_id"]
        raise


# ---------------------
# address helpers (with address lookup + state lookup)
# ---------------------
def find_state_id(db: Session, state_name: Optional[str]):
    """
    Return state_id for a given state_name, trying exact then LIKE matches,
    handling common abbreviations. Returns None if not found.
    """
    if not state_name:
        return None

    s = state_name.strip().lower()

    # remove commas, country, and extra words
    s = re.sub(r',.*$', '', s)       # remove ", India"
    s = re.sub(r'\s+state$', '', s)  # remove "state"
    s = s.strip()

    # handle common abbreviations
    abbrev = {
        "up": "uttar pradesh",
        "u.p": "uttar pradesh",
        "mh": "maharashtra",
        "mp": "madhya pradesh",
        "tn": "tamil nadu",
        "dl": "delhi",
        "gj": "gujarat",
        "rj": "rajasthan",
        "wb": "west bengal",
        "jk": "jammu and kashmir",
        "ka": "karnataka",
        "br": "bihar",
        "cg": "chhattisgarh",
    }

    if s in abbrev:
        s = abbrev[s]

    # exact match
    r = db.execute(
        text("SELECT state_id FROM state WHERE LOWER(name)=:n LIMIT 1"),
        {"n": s}
    ).first()
    if r:
        return r[0]

    # partial LIKE match
    r2 = db.execute(
        text("SELECT state_id FROM state WHERE LOWER(name) LIKE :n LIMIT 1"),
        {"n": f"%{s}%"}
    ).first()
    if r2:
        return r2[0]

    return None


def find_existing_address(db: Session, address_line: str, mobile: str, pincode: str, city: str):
    """
    Try to find an address row that matches address_line / mobile / pincode / city.
    Returns full row mapping or None.
    """
    # Normalize inputs
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
        """), {
            "addr": addr,
            "addr_like": f"%{addr}%",
            "mob": mob,
            "pin": pin,
            "cty": cty
        }).first()
        return dict(r._mapping) if r else None
    except Exception as e:
        logger.exception("find_existing_address DB error: %s", e)
        return None


def create_address(db: Session, payload: Dict):
    """
    Insert address. Note: this function is used only when no existing address was found.
    """
    if "pincode" not in payload or payload["pincode"] is None:
        payload["pincode"] = ""
    defaults = {
        "locality": "",
        "address_line": "",
        "city": "",
        "state_id": 1,
        "address_type": "shipping",
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
        "is_available": 1,
    }
    for k, v in defaults.items():
        if k not in payload or payload[k] is None:
            payload[k] = v
    cols = ", ".join(payload.keys())
    vals = ", ".join([f":{c}" for c in payload])
    db.execute(text(f"INSERT INTO address ({cols}) VALUES ({vals})"), payload)
    return db.execute(text("SELECT LAST_INSERT_ID()")).scalar()


# ---------------------
# order index
# ---------------------
def get_next_order_index(db: Session) -> int:
    r = db.execute(text("SELECT MAX(order_index) as mx FROM orders")).first()
    mx = r[0] if r and r[0] is not None else None
    if not mx:
        return int(time.time())
    return int(mx) + 1


# ---------------------
# price extraction (robust)
# ---------------------
def extract_price_value(li: Dict) -> float:
    candidates = [
        lambda x: (x.get("price") or {}).get("amount") if isinstance(x.get("price"), dict) else x.get("price"),
        lambda x: (x.get("lineItemPrice") or {}).get("amount"),
        lambda x: (x.get("totalPriceAfterTax") or {}).get("amount"),
        lambda x: (x.get("totalPrice") or {}).get("amount"),
        lambda x: (x.get("priceData") or {}).get("price"),
        lambda x: x.get("price"),
        lambda x: x.get("unitPrice"),
        lambda x: x.get("sellingPrice"),
        lambda x: x.get("total")
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


# ---------------------
# invoice description helper
# ---------------------
def invoice_description_for_product(product: Dict) -> str:
    if not product:
        return "Item"
    zoho = product.get("zoho_sku") or ""
    if zoho and zoho.strip():
        return zoho.strip()
    name = (product.get("name") or "").lower()
    if "gps" in name:
        return "GPS"
    if "scanner" in name:
        return "Scanner"
    words = re.findall(r"[A-Za-z0-9]+", product.get("name") or "")
    if not words:
        return "Item"
    return " ".join(words[:2])

def fetch_wix_order_number(order_id: str):
    """
    Fetch a single order from Wix Stores API to retrieve the 'number' field
    if missing in the bulk query response.
    """
    if not order_id:
        return None

    try:
        res = requests.post(
            "https://www.wixapis.com/stores/v2/orders/get",
            headers={
                "Authorization": WIX_API_KEY,
                "wix-site-id": WIX_SITE_ID,
                "Content-Type": "application/json",
            },
            json={"id": order_id}
        )

        if res.status_code != 200:
            logger.warning("Failed fallback fetch for order %s: %s", order_id, res.text)
            return None

        data = res.json()
        return data.get("order", {}).get("number")

    except Exception as e:
        logger.exception("fetch_wix_order_number error for %s: %s", order_id, e)
        return None

# ---------------------
# main sync endpoint
# ---------------------
@router.get("/wix")
def sync_wix_orders(request: Request, db: Session = Depends(get_db)):
    """
    Query Wix orders (Stores v2) and upsert into local DB.
    Use ?force=1 to force re-processing (recreate order_items and update order totals).
    """
    logger.debug("Wix sync requested (force=%s)", request.query_params.get("force"))
    force = request.query_params.get("force") == "1"

    if not WIX_API_KEY or not WIX_SITE_ID:
        logger.error("Missing Wix credentials (WIX_API_KEY or WIX_SITE_ID empty)")
        raise HTTPException(status_code=500, detail="Missing Wix credentials")

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
        logger.exception("Failed to call Wix API: %s", e)
        raise HTTPException(status_code=500, detail=f"Failed to talk to Wix: {e}")

    logger.debug("Wix API status_code=%s", res.status_code)
    if res.status_code != 200:
        logger.error("Wix responded non-200: %s - %s", res.status_code, res.text[:200])
        raise HTTPException(status_code=500, detail=f"Wix responded: {res.status_code} - {res.text}")

    payload = res.json()
    wix_orders = payload.get("orders", []) or []
    logger.debug("Wix returned %d orders", len(wix_orders))

    inserted = 0
    skipped = 0
    details: List[Dict] = []

    for idx, w in enumerate(wix_orders, start=1):
        try:
            logger.debug("Processing wix order #%d: raw id keys=%s", idx, list(w.keys()))
            # Always prefer Wix's official 'number' field
            wix_order_number = w.get("number")

# Fallback if missing — fetch order details from Wix
            if not wix_order_number:
             fallback_number = fetch_wix_order_number(w.get("id"))

            if fallback_number:
                wix_order_number = fallback_number
                logger.debug("Fetched missing order number %s for %s", fallback_number, w.get("id"))
            else:
                logger.warning("Order %s missing 'number' even after fallback fetch", w.get("id"))
                wix_order_number = w.get("id")  # last fallback (UUID)

# Final order ID used everywhere
            wix_order_id = safe_str(wix_order_number)

            order_result = {"wix_order_id": wix_order_id, "status": None, "reasons": [], "items": []}

            if not wix_order_id:
                skipped += 1
                order_result["status"] = "skipped"
                order_result["reasons"].append("missing_wix_id")
                details.append(order_result)
                logger.warning("Skipping order with missing wix id (index %d)", idx)
                continue

            # Pre-check existing order (to implement force behavior)
            existing_order = db.execute(text("SELECT order_id FROM orders WHERE order_id = :oid LIMIT 1"), {"oid": wix_order_id}).first()
            if existing_order and not force:
                skipped += 1
                order_result["status"] = "skipped"
                order_result["reasons"].append("duplicate_order_id")
                details.append(order_result)
                logger.info("Skipping duplicate order %s", wix_order_id)
                continue

            # created date
            dt = w.get("createdDate") or w.get("dateCreated") or w.get("purchasedDate") or w.get("updatedDate") or w.get("paidDate")
            try:
                created_at = parser.parse(dt) if dt else datetime.utcnow()
            except Exception:
                created_at = datetime.utcnow()

            # Extract contact details: shipping -> billing -> buyer
            billing = w.get("billingInfo") or {}
            shipping = w.get("shippingInfo") or {}
            buyer = w.get("buyerInfo") or {}

            contact = {}
            ship_dest = (shipping.get("logistics") or {}).get("shippingDestination") or {}
            ship_addr = ship_dest.get("address") or (shipping.get("shipmentDetails") or {}).get("address") or {}
            ship_contact = ship_dest.get("contactDetails") or (shipping.get("shipmentDetails") or {}).get("contactDetails") or {}
            bill_addr = (billing.get("address") or {})
            bill_contact = (billing.get("contactDetails") or {})

            if ship_contact or ship_addr:
                fn = ship_contact.get("firstName") or ship_addr.get("fullName", {}).get("firstName") or ship_addr.get("firstName")
                ln = ship_contact.get("lastName") or ship_addr.get("fullName", {}).get("lastName") or ship_addr.get("lastName")
                contact["fullName"] = f"{fn or ''} {ln or ''}".strip()
                contact["phone"] = ship_contact.get("phone") or ship_addr.get("phone")
                contact["email"] = ship_addr.get("email") or ship_contact.get("email")
                contact["addressLine1"] = ship_addr.get("addressLine") or ship_addr.get("addressLine1") or ship_addr.get("addressLine")
                contact["postalCode"] = ship_addr.get("postalCode") or ship_addr.get("zipCode")
                contact["city"] = ship_addr.get("city")
                contact["region"] = ship_addr.get("subdivision") or ship_addr.get("subdivisionFullname")
            elif bill_contact or bill_addr:
                fn = bill_contact.get("firstName") or bill_addr.get("fullName", {}).get("firstName") or bill_addr.get("firstName")
                ln = bill_contact.get("lastName") or bill_addr.get("fullName", {}).get("lastName") or bill_addr.get("lastName")
                contact["fullName"] = f"{fn or ''} {ln or ''}".strip()
                contact["phone"] = bill_contact.get("phone") or bill_addr.get("phone")
                contact["email"] = bill_addr.get("email") or bill_contact.get("email")
                contact["addressLine1"] = bill_addr.get("addressLine") or bill_addr.get("addressLine1") or bill_addr.get("addressLine")
                contact["postalCode"] = bill_addr.get("postalCode") or bill_addr.get("zipCode")
                contact["city"] = bill_addr.get("city")
                contact["region"] = bill_addr.get("subdivision") or bill_addr.get("subdivisionFullname")
            else:
                contact["fullName"] = f"{buyer.get('firstName','')} {buyer.get('lastName','')}".strip()
                contact["phone"] = buyer.get("phone")
                contact["email"] = buyer.get("email")
                contact["addressLine1"] = buyer.get("addressLine") or buyer.get("address") or ""
                contact["postalCode"] = ""
                contact["city"] = ""

            name = safe_str(contact.get("fullName") or "")
            phone_raw = safe_str(contact.get("phone") or "")
            email = safe_str(contact.get("email") or "")
            phone_digits = re.sub(r'\D', '', phone_raw)
            if phone_digits and len(phone_digits) < 7:
                phone_digits = ""

            # CUSTOMER resolution
            customer_id = None
            offline_customer_id = None
            try:
                customer_id = upsert_customer(db, name, phone_digits, email)
                if not customer_id:
                    offline_customer_id = create_or_get_offline_customer(db, name, phone_digits, email)
            except Exception as e:
                logger.exception("customer resolution failed for order %s: %s", wix_order_id, e)
                order_result["reasons"].append(f"customer_resolution_failed:{e}")

            # ADDRESS handling:
            # - attempt to find existing address in DB that matches incoming address_line/mobile/pincode/city
            # - if found: reuse address_id and adopt its state_id
            # - otherwise: try to resolve state_id from incoming region text then insert address
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
                    logger.debug("Reusing existing address id %s for order %s (found match)", address_id, wix_order_id)
                else:
                    # Try to resolve state from incoming region text first
                    resolved_state_id = find_state_id(db, contact.get("region"))
                    if resolved_state_id:
                        logger.debug("Resolved state_id=%s from incoming region text for order %s", resolved_state_id, wix_order_id)
                    else:
                        logger.debug("Could not resolve state from incoming region text for order %s; will use default (1) unless DB finds better", wix_order_id)

                    addr_payload = {
                        "name": sanitize_scalar(name or "Wix Customer"),
                        "mobile": sanitize_scalar(phone_digits or ""),
                        "pincode": sanitize_scalar(contact.get("postalCode") or ""),
                        "locality": "",
                        "address_line": sanitize_scalar(contact.get("addressLine1") or ""),
                        "city": sanitize_scalar(contact.get("city") or ""),
                        # if resolved_state_id is None, create_address will use state_id default
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
                    logger.debug("Inserted new address id %s for order %s", address_id, wix_order_id)

            except Exception as e:
                logger.exception("address handling failed for order %s: %s", wix_order_id, e)
                order_result["reasons"].append(f"address_handling_failed:{e}")
                address_id = None

            # If we have address_id but no resolved_state_id (e.g. reused address), pull state from db row
            if address_id and (resolved_state_id is None or resolved_state_id == ""):
                try:
                    row = db.execute(text("SELECT state_id FROM address WHERE address_id = :aid LIMIT 1"), {"aid": address_id}).first()
                    if row and row[0]:
                        resolved_state_id = int(row[0])
                        logger.debug("Pulled state_id=%s from existing address row %s", resolved_state_id, address_id)
                except Exception as e:
                    logger.exception("Failed to fetch state_id from address %s: %s", address_id, e)

            # LINE ITEMS
            subtotal_sum = 0.0
            items_out = []
            line_items = w.get("lineItems") or w.get("items") or []

            # If existing_order and force => delete existing order_items so we can recreate them.
            if existing_order and force:
                try:
                    db.execute(text("DELETE FROM order_items WHERE order_id = :oid"), {"oid": wix_order_id})
                    logger.debug("Deleted existing order_items for order %s due to force=1", wix_order_id)
                except Exception as e:
                    logger.exception("failed_to_delete_previous_order_items for %s: %s", wix_order_id, e)
                    order_result["reasons"].append(f"failed_to_delete_previous_order_items:{e}")

            # Process each line item and insert order_items rows. We will try to ensure product_id is not null.
            for li in line_items:
                try:
                    if not isinstance(li, dict):
                        continue

                    # Extract SKU / product id / name / qty
                    sku = safe_str((li.get("physicalProperties") or {}).get("sku") or li.get("sku") or li.get("variantSku") or li.get("skuId") or "")
                    wix_product_id = safe_str((li.get("catalogReference") or {}).get("catalogItemId") if isinstance(li.get("catalogReference"), dict) else li.get("productId") or li.get("product_id") or "")
                    name_field = li.get("productName") or li.get("name") or li.get("title")
                    title = ""
                    if isinstance(name_field, dict):
                        title = safe_str(name_field.get("original") or name_field.get("translated") or "")
                    else:
                        title = safe_str(name_field or "")

                    qty = int(li.get("quantity") or li.get("qty") or 1)
                    price = extract_price_value(li)
                    total_price = round(qty * price, 2)
                    subtotal_sum += total_price

                    # Mapping attempts
                    product = None
                    mapping_reason = None

                    if is_valid_sku(sku):
                        try:
                            product = find_product_by_sku(db, sku)
                            if product:
                                mapping_reason = f"mapped_by_sku:{sku}"
                        except Exception as e:
                            logger.exception("sku lookup failed for %s: %s", sku, e)
                            order_result["reasons"].append(f"sku_lookup_failed:{sku}:{e}")

                    if not product and wix_product_id:
                        try:
                            product = find_product_by_wix_product_id(db, wix_product_id)
                            if product:
                                mapping_reason = f"mapped_by_wix_product_id:{wix_product_id}"
                        except Exception as e:
                            logger.exception("wixpid lookup failed for %s: %s", wix_product_id, e)
                            order_result["reasons"].append(f"wixpid_lookup_failed:{wix_product_id}:{e}")

                    if not product and title:
                        try:
                            product = find_product_by_name(db, title)
                            if product:
                                mapping_reason = f"mapped_by_name:{title}"
                        except Exception as e:
                            logger.exception("name lookup failed for %s: %s", title, e)
                            order_result["reasons"].append(f"name_lookup_failed:{title}:{e}")

                    # Auto-create logic
                    created_product = None
                    if not product and is_valid_sku(sku):
                        try:
                            created_product = create_product_from_sku(db, sku, title or "Auto Product")
                            product = created_product
                            mapping_reason = f"auto_created_by_sku:{sku}"
                        except Exception as e:
                            logger.exception("auto-create by sku failed for %s: %s", sku, e)
                            order_result["reasons"].append(f"product_auto_create_failed:{sku}:{e}")
                            product = None

                    if not product and title:
                        try:
                            created_product = create_product_from_sku(db, None, title)
                            product = created_product
                            mapping_reason = f"auto_created_by_title:{title}"
                        except Exception as e:
                            logger.exception("auto-create by title failed for %s: %s", title, e)
                            order_result["reasons"].append(f"product_auto_create_failed_by_title:{title}:{e}")
                            product = None

                    # Final fallback
                    if not product:
                        try:
                            product = ensure_unknown_fallback_product(db)
                            mapping_reason = mapping_reason or "fallback_unknown_product"
                        except Exception as e:
                            logger.exception("ensure_unknown_fallback_product failed: %s", e)
                            order_result["reasons"].append(f"fallback_product_create_failed:{e}")
                            product = None

                    pid = product.get("product_id") if product else None

                    # invoice description
                    invoice_desc = invoice_description_for_product(product) if product else "Item"

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
                        logger.exception("order_item insert failed for order %s item %s: %s", wix_order_id, title or sku, e)
                        order_result["reasons"].append(f"order_item_insert_failed:{title or sku}:{e}")

                    items_out.append({
                        "title": title,
                        "sku": sku,
                        "wix_product_id": wix_product_id,
                        "product_id": pid,
                        "quantity": qty,
                        "unit_price": price,
                        "total_price": total_price,
                        "mapping": mapping_reason or ("unknown_no_sku" if not sku else "unknown"),
                        "invoice_description": invoice_desc
                    })
                except Exception as e:
                    logger.exception("Failed to process line item for order %s: %s", wix_order_id, e)
                    order_result["reasons"].append(f"line_item_processing_failed:{e}")

            # Prepare order payload and either insert or update orders table
            try:
                order_index = get_next_order_index(db)
            except Exception as e:
                logger.exception("get_next_order_index failed: %s", e)
                order_index = int(time.time())

            payment_status = "paid" if (str(w.get("paymentStatus") or w.get("payment_status") or "")).upper() == "PAID" else "pending"
            total_items = len(line_items)

            order_payload = {
                "order_id": wix_order_id,
                "customer_id": customer_id,
                "offline_customer_id": offline_customer_id,
                "address_id": address_id or 0,
                "total_items": total_items,
                "subtotal": round(subtotal_sum, 2),
                "total_amount": round(subtotal_sum, 2),
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

            # Insert/update order row with per-order commit/rollback pattern
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
                    logger.debug("Inserted orders row for %s", wix_order_id)
                else:
                    # update the existing order totals/timestamps (force mode)
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
                        "subtotal": round(subtotal_sum, 2),
                        "total_amount": round(subtotal_sum, 2),
                        "payment_status": payment_status,
                        "updated_at": created_at,
                        "order_id": wix_order_id
                    })
                    logger.debug("Updated orders row for %s (force mode)", wix_order_id)

                # commit at order boundary
                db.commit()
                inserted += 1
                order_result["status"] = "inserted"
                order_result["items"] = items_out
                order_result["customer_id"] = customer_id
                order_result["offline_customer_id"] = offline_customer_id
                order_result["address_id"] = address_id
                logger.info("Successfully processed order %s (items=%d)", wix_order_id, len(items_out))

            except Exception as e:
                # rollback on error so DB remains consistent
                try:
                    db.rollback()
                except Exception:
                    logger.exception("Rollback failed for order %s", wix_order_id)
                skipped += 1
                order_result["status"] = "skipped"
                order_result["reasons"].append(f"order_processing_failed:{e}")
                logger.exception("Order processing failed for %s: %s", wix_order_id, e)
                if "Duplicate entry" in str(e):
                    order_result["reasons"].append("order_index_conflict_or_duplicate")
                details.append(order_result)
                # continue to next order
                continue

            details.append(order_result)

        except Exception as e:
            # unexpected top-level error for a single order loop
            logger.exception("Unexpected error processing an order: %s", e)
            skipped += 1
            details.append({
                "wix_order_id": safe_str(w.get("id") if isinstance(w, dict) else None),
                "status": "skipped",
                "reasons": [f"unexpected_error:{e}"],
                "items": []
            })
            continue

    logger.info("Wix sync completed: inserted=%d skipped=%d", inserted, skipped)
    return {"message": "Wix sync completed", "inserted": inserted, "skipped": skipped, "details": details}


# ---- recover endpoint (paginated fetch) ----
@router.get("/wix/recover")
def recover_missing_orders(db: Session = Depends(get_db)):
    """
    Fetch all Wix orders via paging and return list of orders not present in local DB.
    Useful to discover orders that were skipped previously.
    """
    logger.debug("Recover missing orders called")
    if not WIX_API_KEY or not WIX_SITE_ID:
        logger.error("Missing Wix credentials for recover endpoint")
        raise HTTPException(status_code=500, detail="Missing Wix credentials")

    all_wix_orders = []
    cursor = None

    while True:
        body = {"paging": {"limit": 100}}
        if cursor:
            body["paging"]["cursor"] = cursor

        try:
            res = requests.post(
                "https://www.wixapis.com/stores/v2/orders/query",
                headers={
                    "Authorization": WIX_API_KEY,
                    "wix-site-id": WIX_SITE_ID,
                    "Content-Type": "application/json",
                },
                json=body,
            )
        except Exception as e:
            logger.exception("Recover: failed to call Wix: %s", e)
            raise HTTPException(status_code=500, detail=f"Wix: {e}")

        if res.status_code != 200:
            logger.error("Recover: wix returned %s", res.status_code)
            raise HTTPException(status_code=500, detail=f"Wix: {res.text}")

        data = res.json()
        all_wix_orders.extend(data.get("orders", []))
        cursor = data.get("paging", {}).get("cursors", {}).get("next")
        if not cursor:
            break

    db_orders = db.execute(text("SELECT order_id FROM orders")).fetchall()
    db_order_ids = {str(row[0]) for row in db_orders}

    missing_orders = []
    for w in all_wix_orders:
        wix_id = str(w.get("id"))
        if wix_id not in db_order_ids:
            missing_orders.append(w)

    logger.debug("Recover results: total=%d in_db=%d missing=%d", len(all_wix_orders), len(db_order_ids), len(missing_orders))
    return {
        "total_wix_orders": len(all_wix_orders),
        "orders_in_db": len(db_order_ids),
        "missing_count": len(missing_orders),
        "missing_order_ids": [o.get("id") for o in missing_orders],
        "missing_orders": missing_orders[:5],
    }
