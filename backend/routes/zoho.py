# routes/zoho.py

from io import BytesIO
from fastapi import APIRouter, HTTPException, Request, Depends
from fastapi.responses import RedirectResponse, StreamingResponse
import requests
import os
import time
import json
from sqlalchemy.orm import Session
from sqlalchemy import text
from dotenv import load_dotenv

from database import get_db
from models import Order

load_dotenv()

router = APIRouter(prefix="/zoho", tags=["Zoho Books"])

# --------------------------------------------------
# ENV
# --------------------------------------------------
ZOHO_CLIENT_ID = os.getenv("ZOHO_CLIENT_ID")
ZOHO_CLIENT_SECRET = os.getenv("ZOHO_CLIENT_SECRET")
ZOHO_ORG_ID = os.getenv("ZOHO_ORG_ID")
ZOHO_REDIRECT_URI = os.getenv(
    "ZOHO_REDIRECT_URI",
    "http://localhost:8000/zoho/oauth/callback"
)

ACCOUNTS_BASE = "https://accounts.zoho.in"
TOKEN_URL = f"{ACCOUNTS_BASE}/oauth/v2/token"
AUTH_URL = f"{ACCOUNTS_BASE}/oauth/v2/auth"
ZOHO_API_BASE = "https://www.zohoapis.in/books/v3"

TOKENS_FILE = ".zoho_tokens.json"

# --------------------------------------------------
# TOKEN STORAGE
# --------------------------------------------------
def _load_tokens():
    try:
        with open(TOKENS_FILE, "r") as f:
            return json.load(f)
    except:
        return {
            "access_token": None,
            "refresh_token": None,
            "expires_at": 0,
        }


def _save_tokens(t):
    with open(TOKENS_FILE, "w") as f:
        json.dump(t, f)


tokens = _load_tokens()

# --------------------------------------------------
# OAUTH
# --------------------------------------------------
@router.get("/auth")
def zoho_auth():
    url = (
        f"{AUTH_URL}?response_type=code"
        f"&client_id={ZOHO_CLIENT_ID}"
        f"&scope=ZohoBooks.fullaccess.all"
        f"&redirect_uri={ZOHO_REDIRECT_URI}"
        f"&access_type=offline"
        f"&prompt=consent"
    )
    return RedirectResponse(url)


@router.get("/oauth/callback")
def zoho_callback(request: Request):
    code = request.query_params.get("code")
    if not code:
        raise HTTPException(400, "Missing ?code")

    res = requests.post(
        TOKEN_URL,
        data={
            "grant_type": "authorization_code",
            "client_id": ZOHO_CLIENT_ID,
            "client_secret": ZOHO_CLIENT_SECRET,
            "redirect_uri": ZOHO_REDIRECT_URI,
            "code": code,
        },
    ).json()

    if "access_token" not in res:
        raise HTTPException(400, res)

    tokens["access_token"] = res["access_token"]
    tokens["refresh_token"] = res.get(
        "refresh_token", tokens.get("refresh_token")
    )
    tokens["expires_at"] = time.time() + res.get("expires_in", 3600)

    _save_tokens(tokens)
    return {"success": True}


# --------------------------------------------------
# TOKEN REFRESH
# --------------------------------------------------
import time
import requests

def ensure_access_token():
    print("[DEBUG] Checking existing access token...")

    if tokens.get("access_token") and time.time() < tokens["expires_at"]:
        remaining = int(tokens["expires_at"] - time.time())
        print(f"[DEBUG] Using cached access token (expires in {remaining}s)")
        return tokens["access_token"]

    print("[DEBUG] Access token missing or expired. Refreshing...")

    start_time = time.time()

    response = requests.post(
        TOKEN_URL,
        data={
            "grant_type": "refresh_token",
            "refresh_token": tokens.get("refresh_token"),
            "client_id": ZOHO_CLIENT_ID,
            "client_secret": ZOHO_CLIENT_SECRET,
        },
    )

    print(f"[DEBUG] Token API status: {response.status_code}")

    try:
        r = response.json()
    except Exception as e:
        print(f"[ERROR] Failed to parse token response JSON: {e}")
        print(f"[RAW RESPONSE] {response.text}")
        raise HTTPException(500, "Invalid token response")

    print(f"[DEBUG] Token API response keys: {list(r.keys())}")

    if "access_token" not in r:
        print(f"[ERROR] No access_token in response: {r}")
        raise HTTPException(401, r)

    access_token = r["access_token"]
    expires_in = r.get("expires_in", 3600)

    print(f"[DEBUG] New access token received: {access_token[:10]}...")
    print(f"[DEBUG] Token expires in: {expires_in}s")

    tokens["access_token"] = access_token
    tokens["expires_at"] = time.time() + expires_in

    print("[DEBUG] Saving tokens...")
    _save_tokens(tokens)

    total_time = time.time() - start_time
    print(f"[DEBUG] Token refresh completed in {total_time:.2f}s")

    return access_token


def zoho_headers():
    return {
        "Authorization": f"Zoho-oauthtoken {ensure_access_token()}",
        "Content-Type": "application/json",
        "X-com-zoho-books-organizationid": ZOHO_ORG_ID,
    }


# --------------------------------------------------
# ZOHO ITEM LOOKUP
# --------------------------------------------------
def normalize(s: str):
    return s.strip().lower() if s else ""


def get_zoho_item_by_sku(sku: str):
    r = requests.get(
        f"{ZOHO_API_BASE}/items",
        headers=zoho_headers(),
        params={"search_text": sku},
    ).json()

    if r.get("code") != 0:
        raise HTTPException(400, r)

    norm_sku = normalize(sku)

    for item in r.get("items", []):
        if normalize(item.get("sku")) == norm_sku:
            return item

    return None


# --------------------------------------------------
# NORMALIZE MOBILE — returns bare 10-digit number
# --------------------------------------------------
def normalize_mobile(mobile: str) -> str:
    """Strip country code prefix and return a 10-digit mobile number."""
    m = mobile.strip()
    if m.startswith("+91"):
        return m[3:]
    if m.startswith("91") and len(m) == 12:
        return m[2:]
    return m


# --------------------------------------------------
# SPLIT NAME — first two words → first_name, rest → last_name
# --------------------------------------------------
def split_name(full_name: str) -> tuple[str, str]:
    """
    Split a full name into first_name and last_name.
    - 1 word  → first_name=word, last_name=""
    - 2 words → first_name=word1, last_name=word2
    - 3+ words → first_name="word1 word2", last_name=rest
    """
    parts = full_name.strip().split()
    if len(parts) == 0:
        return ("", "")
    if len(parts) == 1:
        return (parts[0], "")
    if len(parts) == 2:
        return (parts[0], parts[1])
    return (" ".join(parts[:2]), " ".join(parts[2:]))


# --------------------------------------------------
# SPLIT ADDRESS — halve by char count, break at word boundary
# --------------------------------------------------
def split_address(address_line: str) -> tuple[str, str]:
    """
    Split address_line into two halves at the midpoint,
    walking back to the nearest space so no word is cut.
    Returns (line1, line2). line2 is empty if address is short.
    """
    s = address_line.strip()
    if not s:
        return ("", "")

    mid = len(s) // 2
    split_at = s.rfind(" ", 0, mid + 1)
    if split_at == -1:
        split_at = s.find(" ", mid)
    if split_at == -1:
        return (s, "")

    return (s[:split_at].strip(), s[split_at:].strip())


# --------------------------------------------------
# SALESPERSONS LIST
# --------------------------------------------------
@router.get("/salespersons")
def get_salespersons():
    """
    Returns active salespersons from Zoho for the frontend dropdown.
    Response shape: {"salespersons": [{"salesperson_id": "...", "name": "..."}]}
    """
    r = requests.get(
        f"{ZOHO_API_BASE}/users",
        headers=zoho_headers(),
    ).json()

    if r.get("code") != 0:
        raise HTTPException(400, r)

    salespersons = [
        {
            "salesperson_id": u["user_id"],
            "name": u["name"],
        }
        for u in r.get("users", [])
        if u.get("is_active", False)
    ]

    return {"salespersons": salespersons}


# --------------------------------------------------
# CREATE INVOICE — request body schema
# --------------------------------------------------
from pydantic import BaseModel
from typing import Optional

class InvoiceRequest(BaseModel):
    salesperson_id: Optional[str] = None

DEFAULT_SALESPERSON_ID = "657895000001889087"

# --------------------------------------------------
# CREATE INVOICE
# --------------------------------------------------
@router.post("/invoice/{order_id}")
def create_invoice(order_id: str, db: Session = Depends(get_db)):
    order_row = (
        db.query(Order)
        .filter(Order.order_id == order_id)
        .first()
    )

    if not order_row:
        raise HTTPException(404, "Order not found")

    if order_row.invoice_id:
        return {
            "message": "Invoice already created",
            "invoice_id": order_row.invoice_id,
        }

    # CUSTOMER
    if order_row.customer_id:
        cust = db.execute(
            text("""
                SELECT name, mobile, email, gst_number
                FROM customer
                WHERE customer_id = :cid
            """),
            {"cid": order_row.customer_id},
        ).first()
    else:
        cust = db.execute(
            text("""
                SELECT name, mobile, email, gst_number
                FROM offline_customer
                WHERE customer_id = :cid
            """),
            {"cid": order_row.offline_customer_id},
        ).first()

    if not cust:
        raise HTTPException(400, "Customer not found")

    cust = dict(cust._mapping)

    # ADDRESS
    addr = db.execute(
        text("""
            SELECT
                a.address_line,
                a.city,
                a.pincode,
                s.name AS state_name,
                s.abbreviation AS state_code
            FROM address a
            JOIN state s ON s.state_id = a.state_id
            WHERE a.address_id = :aid
        """),
        {"aid": order_row.address_id},
    ).first()

    if not addr:
        raise HTTPException(400, "Address missing")

    addr = dict(addr._mapping)

    # ITEMS
    items = db.execute(
        text("""
            SELECT product_id, quantity, unit_price
            FROM order_items
            WHERE order_id = :oid
        """),
        {"oid": order_id},
    ).fetchall()

    if not items:
        raise HTTPException(400, "Order has no items")

    items = [dict(i._mapping) for i in items]

    # SERIALS
    serial_rows = db.execute(
        text("""
            SELECT device_srno, sku_id
            FROM device_transaction
            WHERE order_id = :oid AND in_out = 2
        """),
        {"oid": order_id},
    ).fetchall()

    serial_map = {}
    for r in serial_rows:
        serial_map.setdefault(r.sku_id, []).append(r.device_srno)

    # DELIVERY
    delivery_charge = float(order_row.delivery_charge or 0)
    total_qty = sum(int(i["quantity"]) for i in items)
    delivery_per_unit = (
        round(delivery_charge / total_qty, 2)
        if total_qty else 0
    )

    # --------------------------------------------------
    # CONTACT PAYLOAD
    # --------------------------------------------------
    gst_no = cust.get("gst_number")
    gst_treatment = "business_gst" if gst_no else "consumer"

    addr_line1, addr_line2 = split_address(addr["address_line"])

    mobile_raw = cust.get("mobile", "")
    mobile_10 = normalize_mobile(mobile_raw) if mobile_raw else ""
    mobile_with_code = f"+91{mobile_10}" if mobile_10 else ""

    cust_first_name, cust_last_name = split_name(cust["name"])

    contact_payload = {
        "contact_name": cust["name"],
        "first_name": cust_first_name,
        "last_name": cust_last_name,
        "email": cust.get("email", ""),
        # phone and mobile both carry the +91 prefixed number
        "phone": mobile_with_code,
        "mobile": mobile_with_code,
        "gst_treatment": gst_treatment,
        **({"gst_no": gst_no} if gst_no else {}),
        "billing_address": {
            "address": addr_line1,
            "street2": addr_line2,
            "city": addr["city"],
            "state": addr["state_name"],
            "zip": addr["pincode"],
            "country": "India",
            "phone": mobile_with_code,
        },
        "shipping_address": {
            "address": addr_line1,
            "street2": addr_line2,
            "city": addr["city"],
            "state": addr["state_name"],
            "zip": addr["pincode"],
            "country": "India",
            "phone": mobile_with_code,
        },
        "contact_persons": [
            {
                "first_name": cust_first_name,
                "last_name": cust_last_name,
                "email": cust.get("email", ""),
                "phone": mobile_with_code,
                "mobile": mobile_with_code,
                "is_primary_contact": True,
            }
        ],
    }

    # --------------------------------------------------
    # CUSTOMER LOOKUP — email, then phone with/without +91
    # --------------------------------------------------
    contact_id = None

    # 1a) Search by email
    if cust.get("email"):
        r = requests.get(
            f"{ZOHO_API_BASE}/contacts",
            headers=zoho_headers(),
            params={"email": cust["email"]},
        ).json()
        if r.get("contacts"):
            contact_id = r["contacts"][0]["contact_id"]
            print(f"[DEBUG] Contact found by email: {contact_id}")

    # 1b) Search by phone — try both 10-digit and +91 variant
    if not contact_id and mobile_10:
        for phone_variant in (mobile_10, mobile_with_code):
            r = requests.get(
                f"{ZOHO_API_BASE}/contacts",
                headers=zoho_headers(),
                params={"phone": phone_variant},
            ).json()
            if r.get("contacts"):
                contact_id = r["contacts"][0]["contact_id"]
                print(f"[DEBUG] Contact found by phone ({phone_variant}): {contact_id}")
                break

    # 1c) Create if still not found
    if not contact_id:
        print("[DEBUG] No existing contact found. Creating new contact...")
        created = requests.post(
            f"{ZOHO_API_BASE}/contacts",
            headers=zoho_headers(),
            json=contact_payload,
        ).json()
        print(f"[DEBUG] Contact create response: {created}")
        contact_id = created.get("contact", {}).get("contact_id")

    if not contact_id:
        raise HTTPException(400, "Zoho contact creation failed")

    # --------------------------------------------------
    # INVOICE
    # --------------------------------------------------
    invoice_payload = {
        "customer_id": contact_id,
        "reference_number": order_id,
        "place_of_supply": addr["state_code"],
        "line_items": [],
        "salesperson_id": DEFAULT_SALESPERSON_ID,
    }

    for item in items:
        sku = db.execute(
            text("SELECT zoho_sku FROM products WHERE product_id = :pid"),
            {"pid": item["product_id"]},
        ).scalar()

        if not sku:
            raise HTTPException(
                400,
                f"Zoho SKU not linked for product_id {item['product_id']}",
            )

        z = get_zoho_item_by_sku(sku)
        if not z:
            raise HTTPException(400, f"Zoho SKU {sku} not found")

        product_name = db.execute(
            text("SELECT name FROM products WHERE product_id = :pid"),
            {"pid": item["product_id"]},
        ).scalar() or z["name"]

        device_sku = db.execute(
            text("SELECT sku_id FROM products WHERE product_id = :pid"),
            {"pid": item["product_id"]}
        ).scalar()

        serials = serial_map.get(device_sku, [])

        desc = product_name + (
            f" | Serial Numbers: {', '.join(serials)}"
            if serials else ""
        )

        rate_ex_gst = round(
            (float(item["unit_price"]) + delivery_per_unit) / 1.18,
            2,
        )

        invoice_payload["line_items"].append({
            "item_id": z["item_id"],
            "quantity": item["quantity"],
            "rate": rate_ex_gst,
            "description": desc,
        })

    res = requests.post(
        f"{ZOHO_API_BASE}/invoices",
        headers=zoho_headers(),
        json=invoice_payload,
    ).json()

    if "invoice" not in res:
        raise HTTPException(400, res)

    inv = res["invoice"]

    db.execute(
        text("""
            UPDATE orders
            SET invoice_number = :inv_no,
                invoice_id = :inv_id
            WHERE order_id = :oid
        """),
        {
            "inv_no": inv["invoice_number"],
            "inv_id": inv["invoice_id"],
            "oid": order_id,
        },
    )
    db.commit()

    return res


# --------------------------------------------------
# PRINT INVOICE
# --------------------------------------------------
@router.get("/orders/{order_id:path}/invoice/print")
def print_invoice(order_id: str, db: Session = Depends(get_db)):
    print(f"[DEBUG] Incoming request for order_id: {order_id}")

    order = (
        db.query(Order)
        .filter(Order.order_id == order_id)
        .first()
    )

    print(f"[DEBUG] DB Query Result: {order}")

    if not order:
        print("[ERROR] Order not found in DB")
        raise HTTPException(404, "Order not found")

    if not order.invoice_id:
        print("[ERROR] Invoice ID missing in order")
        raise HTTPException(404, "Invoice not found")

    print(f"[DEBUG] Found invoice_id: {order.invoice_id}")

    token = ensure_access_token()
    print(f"[DEBUG] Access token fetched: {token[:10]}...")

    url = f"{ZOHO_API_BASE}/invoices/{order.invoice_id}?accept=pdf"
    print(f"[DEBUG] Calling Zoho API: {url}")

    res = requests.get(
        url,
        headers={
            "Authorization": f"Zoho-oauthtoken {token}",
            "X-com-zoho-books-organizationid": ZOHO_ORG_ID,
        },
    )

    print(f"[DEBUG] Zoho response status: {res.status_code}")
    print(f"[DEBUG] Zoho response headers: {res.headers}")

    if res.status_code != 200:
        print(f"[ERROR] Failed to fetch invoice. Response: {res.text}")
        raise HTTPException(400, "Failed to fetch invoice PDF")

    print(f"[DEBUG] PDF size: {len(res.content)} bytes")

    return StreamingResponse(
        BytesIO(res.content),
        media_type="application/pdf",
        headers={
            "Content-Disposition":
                f"inline; filename=invoice_{order.invoice_id}.pdf"
        },
    )