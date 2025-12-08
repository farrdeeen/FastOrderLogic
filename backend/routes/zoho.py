# routes/zoho.py
from fastapi import APIRouter, HTTPException, Request, Depends
from fastapi.responses import RedirectResponse, FileResponse
import requests
import os
import time
import json
from typing import Dict, Any, Optional
from sqlalchemy.orm import Session
from sqlalchemy import text
from dotenv import load_dotenv
from database import get_db
from models import Order

load_dotenv()

router = APIRouter(prefix="/zoho", tags=["Zoho Books"])

# ---------------------------------------
# ENV variables
# ---------------------------------------
ZOHO_CLIENT_ID = os.getenv("ZOHO_CLIENT_ID")
ZOHO_CLIENT_SECRET = os.getenv("ZOHO_CLIENT_SECRET")
ZOHO_ORG_ID = os.getenv("ZOHO_ORG_ID")
ZOHO_REDIRECT_URI = os.getenv("ZOHO_REDIRECT_URI", "http://localhost:8000/zoho/oauth/callback")

ACCOUNTS_BASE = "https://accounts.zoho.in"
TOKEN_URL = f"{ACCOUNTS_BASE}/oauth/v2/token"
AUTH_URL = f"{ACCOUNTS_BASE}/oauth/v2/auth"
ZOHO_API_BASE = "https://www.zohoapis.in/books/v3"

TOKENS_FILE = ".zoho_tokens.json"


# ---------------------------------------
# Token Functions
# ---------------------------------------
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


# ---------------------------------------
# OAuth Flow
# ---------------------------------------
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

    data = {
        "grant_type": "authorization_code",
        "client_id": ZOHO_CLIENT_ID,
        "client_secret": ZOHO_CLIENT_SECRET,
        "redirect_uri": ZOHO_REDIRECT_URI,
        "code": code,
    }

    res = requests.post(TOKEN_URL, data=data)
    j = res.json()

    if "access_token" not in j:
        raise HTTPException(400, j)

    tokens["access_token"] = j["access_token"]
    tokens["refresh_token"] = j.get("refresh_token", tokens.get("refresh_token"))
    tokens["expires_at"] = time.time() + j.get("expires_in", 3600)

    _save_tokens(tokens)

    return {"success": True}


# ---------------------------------------
# Token Refresh
# ---------------------------------------
def ensure_access_token():
    if tokens.get("access_token") and time.time() < tokens["expires_at"]:
        return tokens["access_token"]

    data = {
        "grant_type": "refresh_token",
        "refresh_token": tokens["refresh_token"],
        "client_id": ZOHO_CLIENT_ID,
        "client_secret": ZOHO_CLIENT_SECRET,
    }

    r = requests.post(TOKEN_URL, data=data)
    j = r.json()

    if "access_token" not in j:
        raise HTTPException(401, {"error": "Refresh failed", "data": j})

    tokens["access_token"] = j["access_token"]
    tokens["expires_at"] = time.time() + j.get("expires_in", 3600)

    _save_tokens(tokens)

    return tokens["access_token"]


def zoho_headers():
    return {
        "Authorization": f"Zoho-oauthtoken {ensure_access_token()}",
        "Content-Type": "application/json",
        "X-com-zoho-books-organizationid": ZOHO_ORG_ID,
    }


# ---------------------------------------
# Zoho Item Lookup
# ---------------------------------------
def get_zoho_item_by_sku(sku: str):
    r = requests.get(
        f"{ZOHO_API_BASE}/items",
        headers=zoho_headers(),
        params={"search_text": sku},
    )
    data = r.json()
    items = data.get("items", [])
    return items[0] if items else None


# ---------------------------------------
# Create Invoice
# ---------------------------------------
@router.post("/invoice")
def create_invoice(order: dict, db=Depends(get_db)):

    print("\n=== /zoho/invoice called ===")
    print("Incoming order (trimmed):", json.dumps({k: order[k] for k in ("order_id", "customer")}, indent=2))

    # Fix frontend wrapping problem
    if isinstance(order.get("order_id"), dict):
        order = order["order_id"]

    if "items" not in order or not order["items"]:
        raise HTTPException(400, "Order has no items")

    addr = order.get("address")
    if not addr:
        raise HTTPException(400, "Order missing address")

    # Resolve state name + code
    state_row = db.execute(
        text("SELECT name, abbreviation FROM state WHERE state_id = :sid"),
        {"sid": addr["state_id"]}
    ).fetchone()

    order["address"]["state_name"] = state_row.name
    order["address"]["state_code"] = state_row.abbreviation

    print(f"✔ Resolved state: {state_row.name} {state_row.abbreviation}")

    # Resolve Zoho items
    zoho_items = []
    for item in order["items"]:
        product_id = item["product_id"]
        sku = db.execute(text("SELECT sku_id FROM products WHERE product_id = :p"), {"p": product_id}).scalar()

        z_item = get_zoho_item_by_sku(sku)
        zoho_items.append(z_item)

    print(f"✔ Resolved {len(zoho_items)} Zoho items for order items")

    # ---------------------------------------
    # GST Lookup (customer + offline_customer)
    # ---------------------------------------
    cust = order["customer"]

    gst_number = db.execute(
        text("SELECT gst_number FROM customer WHERE mobile = :m"),
        {"m": cust["mobile"]}
    ).scalar()

    if not gst_number:
        gst_number = db.execute(
            text("SELECT gst_number FROM offline_customer WHERE mobile = :m"),
            {"m": cust["mobile"]}
        ).scalar()

    is_gst = bool(gst_number and gst_number.strip())
    gst_treatment = "business_gst" if is_gst else "consumer"

    print(f"GST DETECTED={is_gst}, GST NUMBER={gst_number}, gst_treatment={gst_treatment}")

    # ---------------------------------------
    # Build Zoho Contact Payload
    # ---------------------------------------
    contact_payload = {
        "contact_name": cust["name"],
        "email": cust.get("email", ""),
        "phone": cust["mobile"],
        "company_name": cust["name"],
        "billing_address": {
            "address": addr["address_line"],
            "city": addr["city"],
            "state": addr["state_name"],
            "zip": addr["pincode"],
            "country": "India",
            "phone": cust["mobile"]
        },
        "shipping_address": {
            "address": addr["address_line"],
            "city": addr["city"],
            "state": addr["state_name"],
            "zip": addr["pincode"],
            "country": "India"
        },
        "gst_treatment": gst_treatment,
        "gst_no": gst_number if is_gst else None
    }

    print("➡️ Creating Zoho contact with payload:", json.dumps(contact_payload, indent=2))

    # Search existing Zoho contact
    existing = requests.get(
        f"{ZOHO_API_BASE}/contacts",
        headers=zoho_headers(),
        params={"search_text": cust["mobile"]}
    ).json()

    contacts = existing.get("contacts", [])
    if contacts:
        contact_id = contacts[0]["contact_id"]
        print(f"✔ Existing contact found: {contact_id}")
    else:
        created = requests.post(f"{ZOHO_API_BASE}/contacts", headers=zoho_headers(), json=contact_payload).json()
        print("🆕 Zoho contact create response:", created)
        contact_id = created.get("contact", {}).get("contact_id")

        if not contact_id:
            raise HTTPException(400, {"error": "Contact creation failed", "data": created})

    # ---------------------------------------
    # Serial Numbers
    # ---------------------------------------
    serial_rows = db.execute(text("SELECT device_srno, sku_id FROM device_transaction WHERE order_id = :oid"),
                             {"oid": order["order_id"]}).fetchall()

    serial_map = {}
    for r in serial_rows:
        serial_map.setdefault(r.sku_id, []).append(r.device_srno)

    # ---------------------------------------
    # Build Invoice Payload
    # ---------------------------------------
    payload = {
        "customer_id": contact_id,
        "reference_number": order["order_id"],
        "place_of_supply": order["address"]["state_code"],
        "line_items": []
    }

    for idx, item in enumerate(order["items"]):
        z = zoho_items[idx]
        sku = z.get("sku")

        serials = serial_map.get(sku, [])
        description_text = None
        if serials:
            description_text = "Serial Numbers: " + ", ".join(serials)

        base_rate = round(float(item["unit_price"]) / 1.18, 2)

        payload["line_items"].append({
            "item_id": z["item_id"],
            "name": z["name"],
            "rate": base_rate,
            "quantity": float(item["quantity"]),
            "sku": sku,
            "description": description_text
        })

    print("\n--- FINAL INVOICE PAYLOAD ---")
    print(json.dumps(payload, indent=2))

    # ---------------------------------------
    # Create Invoice in Zoho
    # ---------------------------------------
    r = requests.post(f"{ZOHO_API_BASE}/invoices", headers=zoho_headers(), json=payload)
    print("➡️ Zoho invoices API status:", r.status_code)
    print("➡️ Zoho invoices API response (trimmed):", r.text[:900])

    rj = r.json()
    if "invoice" not in rj:
        raise HTTPException(400, rj)

    invoice_no = rj["invoice"]["invoice_number"]
    print(f"✅ Zoho invoice created: {invoice_no}")

    # ---------------------------------------
    # Update Local DB
    # ---------------------------------------
    db.execute(text("UPDATE orders SET invoice_number = :inv WHERE order_id = :oid"),
               {"inv": invoice_no, "oid": order["order_id"]})
    db.commit()

    print(f"✔ Local order updated with invoice number: {invoice_no}")

    return rj


# ---------------------------------------
# DOWNLOAD INVOICE PDF
# ---------------------------------------
@router.get("/orders/{order_id}/invoice/download")
def download_invoice(order_id: str, db: Session = Depends(get_db)):

    order = db.query(Order).filter(Order.order_id == order_id).first()
    if not order:
        raise HTTPException(404, "Order not found")

    if not order.invoice_number:
        raise HTTPException(400, "Invoice not yet generated")

    pdf_path = f"invoices/{order.invoice_number}.pdf"

    try:
        return FileResponse(pdf_path, media_type="application/pdf", filename=f"{order.invoice_number}.pdf")
    except:
        raise HTTPException(500, "Invoice file missing")
