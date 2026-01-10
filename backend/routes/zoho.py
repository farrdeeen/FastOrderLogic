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
ZOHO_REDIRECT_URI = os.getenv("ZOHO_REDIRECT_URI", "http://localhost:8000/zoho/oauth/callback")

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
        return {"access_token": None, "refresh_token": None, "expires_at": 0}

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

    res = requests.post(TOKEN_URL, data={
        "grant_type": "authorization_code",
        "client_id": ZOHO_CLIENT_ID,
        "client_secret": ZOHO_CLIENT_SECRET,
        "redirect_uri": ZOHO_REDIRECT_URI,
        "code": code,
    }).json()

    if "access_token" not in res:
        raise HTTPException(400, res)

    tokens["access_token"] = res["access_token"]
    tokens["refresh_token"] = res.get("refresh_token", tokens.get("refresh_token"))
    tokens["expires_at"] = time.time() + res.get("expires_in", 3600)

    _save_tokens(tokens)
    return {"success": True}

# --------------------------------------------------
# TOKEN REFRESH
# --------------------------------------------------
def ensure_access_token():
    if tokens.get("access_token") and time.time() < tokens["expires_at"]:
        return tokens["access_token"]

    r = requests.post(TOKEN_URL, data={
        "grant_type": "refresh_token",
        "refresh_token": tokens["refresh_token"],
        "client_id": ZOHO_CLIENT_ID,
        "client_secret": ZOHO_CLIENT_SECRET,
    }).json()

    if "access_token" not in r:
        raise HTTPException(401, r)

    tokens["access_token"] = r["access_token"]
    tokens["expires_at"] = time.time() + r.get("expires_in", 3600)
    _save_tokens(tokens)
    return tokens["access_token"]

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
# CREATE INVOICE (NEW PATH, OLD LOGIC)
# --------------------------------------------------
@router.post("/invoice/{order_id}")
def create_invoice(order_id: str, db: Session = Depends(get_db)):

    order_row = db.query(Order).filter(Order.order_id == order_id).first()
    if not order_row:
        raise HTTPException(404, "Order not found")

    if order_row.invoice_id:
        return {
            "message": "Invoice already created",
            "invoice_id": order_row.invoice_id,
        }

    # -------------------------------
    # CUSTOMER (NO UNION)
    # -------------------------------
    if order_row.customer_id:
        cust = db.execute(text("""
            SELECT name, mobile, email, gst_number
            FROM customer WHERE customer_id = :cid
        """), {"cid": order_row.customer_id}).first()
    else:
        cust = db.execute(text("""
            SELECT name, mobile, email, gst_number
            FROM offline_customer WHERE customer_id = :cid
        """), {"cid": order_row.offline_customer_id}).first()

    if not cust:
        raise HTTPException(400, "Customer not found")

    cust = dict(cust._mapping)

    # -------------------------------
    # ADDRESS
    # -------------------------------
    addr = db.execute(text("""
        SELECT 
            a.address_line,
            a.city,
            a.pincode,
            s.name AS state_name,
            s.abbreviation AS state_code
        FROM address a
        JOIN state s ON s.state_id = a.state_id
        WHERE a.address_id = :aid
    """), {"aid": order_row.address_id}).first()

    if not addr:
        raise HTTPException(400, "Address missing")

    addr = dict(addr._mapping)

    # -------------------------------
    # ITEMS
    # -------------------------------
    items = db.execute(text("""
        SELECT product_id, quantity, unit_price
        FROM order_items
        WHERE order_id = :oid
    """), {"oid": order_id}).fetchall()

    if not items:
        raise HTTPException(400, "Order has no items")

    items = [dict(i._mapping) for i in items]

    # -------------------------------
    # SERIALS
    # -------------------------------
    serial_rows = db.execute(text("""
        SELECT device_srno, sku_id
        FROM device_transaction
        WHERE order_id = :oid AND in_out = 2
    """), {"oid": order_id}).fetchall()

    serial_map = {}
    for r in serial_rows:
        serial_map.setdefault(r.sku_id, []).append(r.device_srno)

    # -------------------------------
    # DELIVERY SPLIT (OLD LOGIC)
    # -------------------------------
    delivery_charge = float(order_row.delivery_charge or 0)
    total_qty = sum(int(i["quantity"]) for i in items)
    delivery_per_unit = round(delivery_charge / total_qty, 2) if total_qty else 0

    # -------------------------------
    # CONTACT (OLD LOGIC)
    # -------------------------------
    gst_no = cust.get("gst_number")
    gst_treatment = "business_gst" if gst_no else "consumer"

    contact_payload = {
        "contact_name": cust["name"],
        "email": cust.get("email", ""),
        "phone": cust["mobile"],
        "gst_treatment": gst_treatment,
        "billing_address": {
            "address": addr["address_line"],
            "city": addr["city"],
            "state": addr["state_name"],
            "zip": addr["pincode"],
            "country": "India",
        },
        "shipping_address": {
            "address": addr["address_line"],
            "city": addr["city"],
            "state": addr["state_name"],
            "zip": addr["pincode"],
            "country": "India",
        }
    }

    if gst_no:
        contact_payload["gst_no"] = gst_no

    contact_id = None
    for key in ("email", "phone"):
        if cust.get(key):
            r = requests.get(
                f"{ZOHO_API_BASE}/contacts",
                headers=zoho_headers(),
                params={key: cust[key]}
            ).json()
            if r.get("contacts"):
                contact_id = r["contacts"][0]["contact_id"]
                break

    if not contact_id:
        created = requests.post(
            f"{ZOHO_API_BASE}/contacts",
            headers=zoho_headers(),
            json=contact_payload
        ).json()
        contact_id = created.get("contact", {}).get("contact_id")

    if not contact_id:
        raise HTTPException(400, "Zoho contact creation failed")

    # -------------------------------
    # INVOICE PAYLOAD (OLD NUMBERS)
    # -------------------------------
    invoice_payload = {
        "customer_id": contact_id,
        "reference_number": order_id,
        "place_of_supply": addr["state_code"],
        "line_items": [],
    }

    for item in items:
        sku = db.execute(
            text("SELECT sku_id FROM products WHERE product_id = :pid"),
            {"pid": item["product_id"]}
        ).scalar()

        z = get_zoho_item_by_sku(sku)
        print("DB SKU:", sku)
        print("ZOHO SEARCH RESPONSE:", z)

        if not z:
            raise HTTPException(400, f"SKU {sku} not found in Zoho")

        serials = serial_map.get(sku, [])
        desc = z["name"] + (f" | Serials: {', '.join(serials)}" if serials else "")

        rate_ex_gst = round((float(item["unit_price"]) + delivery_per_unit) / 1.18, 2)

        invoice_payload["line_items"].append({
            "item_id": z["item_id"],
            "quantity": item["quantity"],
            "rate": rate_ex_gst,
            "description": desc,
        })
    
    # -------------------------------
    # CREATE INVOICE
    # -------------------------------
    res = requests.post(
        f"{ZOHO_API_BASE}/invoices",
        headers=zoho_headers(),
        json=invoice_payload
    ).json()

    if "invoice" not in res:
        raise HTTPException(400, res)

    inv = res["invoice"]

    db.execute(text("""
        UPDATE orders
        SET invoice_number = :inv_no,
            invoice_id = :inv_id
        WHERE order_id = :oid
    """), {
        "inv_no": inv["invoice_number"],
        "inv_id": inv["invoice_id"],
        "oid": order_id
    })
    db.commit()

    return res

# --------------------------------------------------
# PRINT INVOICE
# --------------------------------------------------
@router.get("/orders/{order_id:path}/invoice/print")
def print_invoice(order_id: str, db: Session = Depends(get_db)):
    order = db.query(Order).filter(Order.order_id == order_id).first()
    if not order or not order.invoice_id:
        raise HTTPException(404, "Invoice not found")

    res = requests.get(
        f"{ZOHO_API_BASE}/invoices/{order.invoice_id}?accept=pdf",
        headers={
            "Authorization": f"Zoho-oauthtoken {ensure_access_token()}",
            "X-com-zoho-books-organizationid": ZOHO_ORG_ID,
        }
    )

    if res.status_code != 200:
        raise HTTPException(400, "Failed to fetch invoice PDF")

    return StreamingResponse(
        BytesIO(res.content),
        media_type="application/pdf",
        headers={"Content-Disposition": f"inline; filename=invoice_{order.invoice_id}.pdf"}
    )
