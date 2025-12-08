# routes/zoho.py
from io import BytesIO
from fastapi import APIRouter, HTTPException, Request, Depends
from fastapi.responses import RedirectResponse, FileResponse, StreamingResponse
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
    print("Incoming order:", order.get("order_id"), order.get("customer"))

    # ---------------------------------------
    # Handle nested payload from frontend
    # ---------------------------------------
    if isinstance(order.get("order_id"), dict):
        order = order["order_id"]

    # ---------------------------------------
    # Basic Validation
    # ---------------------------------------
    if "items" not in order or not order["items"]:
        raise HTTPException(400, "Order has no items")

    addr = order.get("address")
    if not addr:
        raise HTTPException(400, "Order missing address")

    cust = order["customer"]

    # ---------------------------------------
    # Resolve State from DB
    # ---------------------------------------
    state_row = db.execute(
        text("SELECT name, abbreviation FROM state WHERE state_id=:sid"),
        {"sid": addr["state_id"]}
    ).fetchone()

    if not state_row:
        raise HTTPException(400, "Invalid state_id")

    addr["state_name"] = state_row.name
    addr["state_code"] = state_row.abbreviation

    print(f"✔ State resolved → {state_row.name} ({state_row.abbreviation})")

    # ---------------------------------------
    # Resolve SKUs in Zoho
    # ---------------------------------------
    zoho_items = []

    for item in order["items"]:
        sku = db.execute(
            text("SELECT sku_id FROM products WHERE product_id=:pid"),
            {"pid": item["product_id"]}
        ).scalar()

        z_item = get_zoho_item_by_sku(sku)
        if not z_item:
            raise HTTPException(400, f"SKU {sku} not found in Zoho Books")

        zoho_items.append(z_item)

    print(f"✔ Resolved {len(zoho_items)} Zoho items")

    # ---------------------------------------
    # GST lookup (customer / offline)
    # ---------------------------------------
    gst_number = db.execute(
        text("SELECT gst_number FROM customer WHERE mobile=:m"),
        {"m": cust["mobile"]}
    ).scalar()

    if not gst_number:
        gst_number = db.execute(
            text("SELECT gst_number FROM offline_customer WHERE mobile=:m"),
            {"m": cust["mobile"]}
        ).scalar()

    is_gst = bool(gst_number and gst_number.strip())
    gst_treatment = "business_gst" if is_gst else "consumer"

    # ---------------------------------------
    # Zoho Contact Payload
    # ---------------------------------------
    contact_payload = {
        "contact_name": cust["name"],
        "email": cust.get("email", ""),
        "phone": cust["mobile"],
        "company_name": cust["name"] if is_gst else "",
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
        "keep_contact_persons": True
    }

    if is_gst:
        contact_payload["gst_no"] = gst_number

    # ---------------------------------------
    # Find OR Create Zoho contact
    # ---------------------------------------
    contact_id = None

    # search by email
    if cust.get("email"):
        r = requests.get(
            f"{ZOHO_API_BASE}/contacts",
            headers=zoho_headers(),
            params={"email": cust["email"]}
        ).json()
        if r.get("contacts"):
            contact_id = r["contacts"][0]["contact_id"]

    # search by phone
    if not contact_id:
        r = requests.get(
            f"{ZOHO_API_BASE}/contacts",
            headers=zoho_headers(),
            params={"phone": cust["mobile"]}
        ).json()
        if r.get("contacts"):
            contact_id = r["contacts"][0]["contact_id"]

    # search by name
    if not contact_id:
        r = requests.get(
            f"{ZOHO_API_BASE}/contacts",
            headers=zoho_headers(),
            params={"search_text": cust["name"]}
        ).json()
        if r.get("contacts"):
            contact_id = r["contacts"][0]["contact_id"]

    # create if still not found
    if not contact_id:
        created = requests.post(
            f"{ZOHO_API_BASE}/contacts",
            headers=zoho_headers(),
            json=contact_payload
        ).json()

        contact_id = created.get("contact", {}).get("contact_id")
        if not contact_id:
            raise HTTPException(400, {"error": "Zoho contact creation failed", "data": created})

    print(f"✔ Zoho contact_id = {contact_id}")

    # ---------------------------------------
    # SERIAL NUMBERS (must load BEFORE invoice lines)
    # ---------------------------------------
    serial_rows = db.execute(
        text("""
            SELECT device_srno, sku_id
            FROM device_transaction
            WHERE order_id = :oid AND in_out = 2
        """),
        {"oid": order["order_id"]}
    ).fetchall()

    serial_map = {}
    for r in serial_rows:
        serial_map.setdefault(r.sku_id, []).append(r.device_srno)

    # ---------------------------------------
    # DELIVERY CHARGE → DIVIDE PER UNIT
    # ---------------------------------------
    delivery_charge = float(order.get("delivery_charge", 0) or 0)
    total_qty = sum(int(i["quantity"]) for i in order["items"])

    delivery_per_unit = round(delivery_charge / total_qty, 2) if total_qty > 0 else 0

    print(f"✔ Delivery Charge = {delivery_charge} → {delivery_per_unit} per unit")

    # ---------------------------------------
    # Build Invoice Payload
    # ---------------------------------------
    invoice_payload = {
        "customer_id": contact_id,
        "reference_number": order["order_id"],
        "place_of_supply": addr["state_code"],
        "salesperson_name": "mtm-store",
        "line_items": [],
    }

    # -------------------------------
    # Line Items
    # -------------------------------
    for idx, item in enumerate(order["items"]):

        z = zoho_items[idx]
        sku = z["sku"]

        # product name
        product_name = db.execute(
            text("SELECT name FROM products WHERE sku_id=:sku"),
            {"sku": sku}
        ).scalar() or ""

        # serial numbers
        serial_list = serial_map.get(sku, [])
        desc = f"{product_name} | Serial Numbers: {', '.join(serial_list)}" if serial_list else product_name

        # Wix unit price (GST INCLUSIVE)
        unit_price = float(item["unit_price"])

        # add delivery per unit
        final_unit_price = unit_price + delivery_per_unit

        # convert GST-INCLUSIVE → GST-EXCLUSIVE (18%)
        rate_ex_gst = round(final_unit_price / 1.18, 2)

        invoice_payload["line_items"].append({
            "item_id": z["item_id"],
            "name": z["name"],
            "quantity": float(item["quantity"]),
            "rate": rate_ex_gst,
            "sku": sku,
            "description": desc
        })

    print("\n--- FINAL INVOICE PAYLOAD ---")
    print(json.dumps(invoice_payload, indent=2))

    # ---------------------------------------
    # CREATE INVOICE IN ZOHO
    # ---------------------------------------
    r = requests.post(
        f"{ZOHO_API_BASE}/invoices",
        headers=zoho_headers(),
        json=invoice_payload
    )

    rj = r.json()
    print("Zoho Response:", rj)

    if "invoice" not in rj:
        raise HTTPException(400, rj)

    invoice_no = rj["invoice"]["invoice_number"]
    invoice_id = rj["invoice"]["invoice_id"]

    print(f"✔ Zoho Invoice Created: {invoice_no} (ID {invoice_id})")

    # ---------------------------------------
    # Save invoice_number + invoice_id in DB
    # ---------------------------------------
    db.execute(
        text("""
            UPDATE orders 
            SET invoice_number = :inv,
                invoice_id = :iid
            WHERE order_id = :oid
        """),
        {"inv": invoice_no, "iid": invoice_id, "oid": order["order_id"]}
    )
    db.commit()

    print("✔ Local DB updated with invoice information")

    return rj






# ---------------------------------------
# DOWNLOAD INVOICE PDF
# ---------------------------------------

# ---------------------------------------
# PRINT INVOICE (Zoho print view PDF)
# ---------------------------------------
@router.get("/orders/{order_id:path}/invoice/print")
def print_invoice(order_id: str, db: Session = Depends(get_db)):
    """
    Fetch INVOICE PDF from Zoho (Zoho Books India does NOT support /print endpoint)
    """

    order = db.query(Order).filter(Order.order_id == order_id).first()
    if not order:
        raise HTTPException(404, f"Order not found: {order_id}")

    if not order.invoice_id:
        raise HTTPException(400, "invoice_id missing — invoice not generated")

    zoho_invoice_id = order.invoice_id

    # ✔ Correct & ONLY valid PDF endpoint for Zoho Books India
    pdf_url = f"{ZOHO_API_BASE}/invoices/{zoho_invoice_id}?accept=pdf"

    headers = {
        "Authorization": f"Zoho-oauthtoken {ensure_access_token()}",
        "X-com-zoho-books-organizationid": ZOHO_ORG_ID,
    }

    res = requests.get(pdf_url, headers=headers)

    if res.status_code != 200:
        raise HTTPException(
            400,
            {
                "error": "Failed to fetch invoice PDF from Zoho",
                "status_code": res.status_code,
                "detail": res.text[:300],
                "pdf_url": pdf_url
            }
        )

    return StreamingResponse(
        BytesIO(res.content),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"inline; filename=invoice_{zoho_invoice_id}.pdf"
        }
    )


