# routes/zoho.py
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse
import requests
import os
import time
import json
from sqlalchemy.orm import Session
from typing import Dict, Any, Optional
from sqlalchemy import text
from dotenv import load_dotenv
from database import get_db
from fastapi import Depends
from fastapi.responses import FileResponse
from models import Order   # ✅ REQUIRED FIX

load_dotenv()

router = APIRouter(prefix="/zoho", tags=["Zoho Books"])

ZOHO_CLIENT_ID = os.getenv("ZOHO_CLIENT_ID")
ZOHO_CLIENT_SECRET = os.getenv("ZOHO_CLIENT_SECRET")
ZOHO_ORG_ID = os.getenv("ZOHO_ORG_ID")
ZOHO_REDIRECT_URI = os.getenv("ZOHO_REDIRECT_URI", "http://localhost:8000/zoho/oauth/callback")

ACCOUNTS_BASE = "https://accounts.zoho.in"
TOKEN_URL = f"{ACCOUNTS_BASE}/oauth/v2/token"
AUTH_URL = f"{ACCOUNTS_BASE}/oauth/v2/auth"
ZOHO_API_BASE = "https://www.zohoapis.in/books/v3"

TOKENS_FILE = ".zoho_tokens.json"


# ---------------------------------------------------------
# Token helpers
# ---------------------------------------------------------
def _load_tokens_from_file():
    try:
        with open(TOKENS_FILE, "r") as f:
            return json.load(f)
    except:
        return {"access_token": None, "refresh_token": None, "expires_at": 0}


def _save_tokens_to_file(t):
    with open(TOKENS_FILE, "w") as f:
        json.dump(t, f)


tokens = _load_tokens_from_file()


# ---------------------------------------------------------
# Zoho Auth endpoints
# ---------------------------------------------------------
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
    print("=== REDIRECTING USER TO ZOHO AUTH ===")
    print(url)
    return RedirectResponse(url)


@router.get("/oauth/callback")
def zoho_callback(request: Request):
    code = request.query_params.get("code")
    if not code:
        raise HTTPException(400, "Missing ?code")

    print("\n=== RECEIVED ZOHO AUTH CODE ===")
    print(code)

    data = {
        "grant_type": "authorization_code",
        "client_id": ZOHO_CLIENT_ID,
        "client_secret": ZOHO_CLIENT_SECRET,
        "redirect_uri": ZOHO_REDIRECT_URI,
        "code": code,
    }

    res = requests.post(TOKEN_URL, data=data)
    print("\n=== ZOHO TOKEN RAW RESPONSE ===")
    print(res.text)

    j = res.json()
    if "access_token" not in j:
        raise HTTPException(400, {"error": "invalid_token", "data": j})

    tokens["access_token"] = j["access_token"]
    tokens["refresh_token"] = j.get("refresh_token", tokens.get("refresh_token"))
    tokens["expires_at"] = time.time() + j.get("expires_in", 3600)

    _save_tokens_to_file(tokens)
    return {"success": True}


# ---------------------------------------------------------
# Token refresh logic
# ---------------------------------------------------------
def ensure_access_token() -> str:
    if tokens.get("access_token") and time.time() < tokens["expires_at"]:
        return tokens["access_token"]

    print("\n=== REFRESHING ZOHO TOKEN ===")

    data = {
        "grant_type": "refresh_token",
        "refresh_token": tokens.get("refresh_token"),
        "client_id": ZOHO_CLIENT_ID,
        "client_secret": ZOHO_CLIENT_SECRET,
    }

    res = requests.post(TOKEN_URL, data=data)
    print("=== ZOHO REFRESH RAW RESPONSE ===")
    print(res.text)

    j = res.json()
    if "access_token" not in j:
        raise HTTPException(401, {"error": "Zoho refresh failed", "data": j})

    tokens["access_token"] = j["access_token"]
    tokens["expires_at"] = time.time() + j.get("expires_in", 3600)

    _save_tokens_to_file(tokens)
    return tokens["access_token"]


def zoho_headers():
    return {
        "Authorization": f"Zoho-oauthtoken {ensure_access_token()}",
        "Content-Type": "application/json",
        "X-com-zoho-books-organizationid": ZOHO_ORG_ID,
    }


# ---------------------------------------------------------
# Helper: get Zoho item by SKU
# ---------------------------------------------------------
def get_zoho_item_by_sku(sku: str):
    print(f"\n=== SEARCHING ZOHO ITEM FOR SKU: {sku} ===")

    url = f"{ZOHO_API_BASE}/items"
    r = requests.get(url, headers=zoho_headers(), params={"search_text": sku})

    print("=== ZOHO ITEMS RAW RESPONSE ===")
    print(r.text)

    try:
        data = r.json()
    except:
        raise HTTPException(400, {"error": "Invalid JSON from Zoho items", "text": r.text})

    items = data.get("items", [])
    return items[0] if items else None


# ---------------------------------------------------------
# Build invoice payload
# ---------------------------------------------------------
def build_invoice_payload(contact_id: str, order: dict, zoho_item: dict):
    item = order["items"][0]

    payload = {
        "customer_id": contact_id,
        "reference_number": order.get("order_id", ""),
        "line_items": [
            {
                "item_id": zoho_item["item_id"],
                "name": zoho_item["name"],
                "rate": float(item.get("unit_price")),
                "quantity": float(item.get("quantity")),
                "sku": zoho_item.get("sku"),
            }
        ],
    }

    print("\n=== FINAL INVOICE PAYLOAD ===")
    print(json.dumps(payload, indent=2))

    return payload


# ---------------------------------------------------------
# MAIN — CREATE INVOICE
# ---------------------------------------------------------
@router.post("/invoice")
def create_invoice(order: dict, db=Depends(get_db)):

    print("\n\n==============================")
    print("=== RECEIVED ORDER FROM FRONTEND ===")
    print(json.dumps(order, indent=2))
    print("==============================\n\n")

    # ---------------------------------------------------------
    # FIX: Frontend sends order nested incorrectly:
    #
    # {
    #   "order_id": { FULL ORDER OBJECT }
    # }
    #
    # So unwrap it:
    # ---------------------------------------------------------
    if isinstance(order.get("order_id"), dict):
        print("⚠️  FIXING WRONG FRONTEND PAYLOAD (UNWRAPPING order_id)")
        order = order["order_id"]

        print("\n=== ORDER AFTER UNWRAP ===")
        print(json.dumps(order, indent=2))

    # Ensure items exist
    if "items" not in order or not order["items"]:
        raise HTTPException(400, "Order has no items")

    # ---------------------------------------------------------
    # 1) Get product SKU
    # ---------------------------------------------------------
    product_id = order["items"][0]["product_id"]
    sku = db.execute(
        text("SELECT sku_id FROM products WHERE product_id = :p"),
        {"p": product_id}
    ).scalar()

    print("=== DB SKU LOOKUP ===")
    print(f"product_id={product_id} -> sku={sku}")

    if not sku:
        raise HTTPException(400, f"Product {product_id} has no SKU in DB")

    # ---------------------------------------------------------
    # 2) find item in Zoho
    # ---------------------------------------------------------
    zoho_item = get_zoho_item_by_sku(sku)
    if not zoho_item:
        raise HTTPException(400, f"SKU {sku} not found in Zoho")

    # ---------------------------------------------------------
    # 3) create very minimal contact
    # ---------------------------------------------------------
    contact_payload = {
        "contact_name": order["customer"]["name"],
        "email": order["customer"]["email"],
        "phone": order["customer"]["mobile"],
    }

    print("\n=== CONTACT CREATE PAYLOAD ===")
    print(json.dumps(contact_payload, indent=2))

    # Search or Create Zoho Contact
    contact_search = requests.get(
        f"{ZOHO_API_BASE}/contacts",
        headers=zoho_headers(),
        params={"search_text": order["customer"]["mobile"]},
    )

    print("\n=== CONTACT SEARCH RAW RESPONSE ===")
    print(contact_search.text)

    try:
        search_json = contact_search.json()
    except:
        search_json = {}

    contacts = search_json.get("contacts") or []
    if contacts:
        contact_id = contacts[0]["contact_id"]
        print("=== EXISTING CONTACT FOUND ===", contact_id)
    else:
        print("=== CREATING NEW CONTACT ===")
        c = requests.post(
            f"{ZOHO_API_BASE}/contacts",
            headers=zoho_headers(),
            json=contact_payload
        )

        print("=== CONTACT CREATE RAW RESPONSE ===")
        print(c.text)

        cj = c.json()
        contact_id = cj.get("contact", {}).get("contact_id")

        if not contact_id:
            raise HTTPException(400, {"error": "Contact create failed", "data": cj})

    # ---------------------------------------------------------
    # 4) Invoice payload
    # ---------------------------------------------------------
    payload = build_invoice_payload(contact_id, order, zoho_item)

    # ---------------------------------------------------------
    # 5) Create invoice
    # ---------------------------------------------------------
    r = requests.post(
        f"{ZOHO_API_BASE}/invoices",
        headers=zoho_headers(),
        json=payload
    )

    print("\n=== ZOHO INVOICE RAW STATUS ===", r.status_code)
    print("=== ZOHO INVOICE RAW RESPONSE TEXT ===")
    print(r.text)

    try:
        rj = r.json()
        print("\n=== ZOHO INVOICE PARSED JSON ===")
        print(json.dumps(rj, indent=2))
    except:
        raise HTTPException(400, {"error": "Invalid JSON from Zoho invoice", "raw": r.text})

    if "invoice" not in rj:
        raise HTTPException(400, rj)
    
    invoice_no = rj["invoice"]["invoice_number"]
    order_id = order["order_id"]

    # Update DB
    db.execute(
    text("UPDATE orders SET invoice_number = :inv WHERE order_id = :oid"),
    {"inv": invoice_no, "oid": order_id}
    )
    db.commit()

    return rj



# ---------------------------------------------------------
# DOWNLOAD INVOICE PDF
# ---------------------------------------------------------
@router.get("/orders/{order_id}/invoice/download")
def download_invoice(order_id: str, db: Session = Depends(get_db)):
    """
    Returns the invoice PDF file for an order.
    """

    order = db.query(Order).filter(Order.order_id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    if not order.invoice_number:
        raise HTTPException(status_code=400, detail="Invoice not yet generated")

    pdf_path = f"invoices/{order.invoice_number}.pdf"

    try:
        return FileResponse(
            pdf_path,
            media_type="application/pdf",
            filename=f"{order.invoice_number}.pdf"
        )
    except:
        raise HTTPException(status_code=500, detail="Invoice file missing on server")
