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


# -------------------------------------------------------------------
# TOKEN HELPERS
# -------------------------------------------------------------------
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


# -------------------------------------------------------------------
# AUTH
# -------------------------------------------------------------------
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

    res = requests.post(TOKEN_URL, data=data).json()

    if "access_token" not in res:
        raise HTTPException(400, {"error": "invalid_token", "data": res})

    tokens["access_token"] = res["access_token"]
    tokens["refresh_token"] = res.get("refresh_token", tokens.get("refresh_token"))
    tokens["expires_at"] = time.time() + res.get("expires_in", 3600)

    _save_tokens_to_file(tokens)
    return {"success": True}


# -------------------------------------------------------------------
# TOKEN REFRESH
# -------------------------------------------------------------------
def ensure_access_token() -> str:
    if tokens.get("access_token") and time.time() < tokens["expires_at"]:
        return tokens["access_token"]

    data = {
        "grant_type": "refresh_token",
        "refresh_token": tokens["refresh_token"],
        "client_id": ZOHO_CLIENT_ID,
        "client_secret": ZOHO_CLIENT_SECRET,
    }

    res = requests.post(TOKEN_URL, data=data).json()

    if "access_token" not in res:
        raise HTTPException(401, "Zoho Auth failed")

    tokens["access_token"] = res["access_token"]
    tokens["expires_at"] = time.time() + res.get("expires_in", 3600)

    _save_tokens_to_file(tokens)
    return tokens["access_token"]


def zoho_headers():
    return {
        "Authorization": f"Zoho-oauthtoken {ensure_access_token()}",
        "Content-Type": "application/json",
        "X-com-zoho-books-organizationid": ZOHO_ORG_ID,
    }


# -------------------------------------------------------------------
# GET ZOHO ITEM BY SKU
# -------------------------------------------------------------------
def get_zoho_item_by_sku(sku):
    url = f"{ZOHO_API_BASE}/items"
    res = requests.get(url, headers=zoho_headers(), params={"search_text": sku}).json()
    items = res.get("items", [])
    return items[0] if items else None


# -------------------------------------------------------------------
# FIND/CREATE CONTACT
# -------------------------------------------------------------------
def find_or_create_contact(order):
    keys = [
        order.get("customer", {}).get("mobile"),
        order.get("customer", {}).get("email"),
        order.get("customer_name")
    ]

    # search existing
    for key in keys:
        if key:
            r = requests.get(
                f"{ZOHO_API_BASE}/contacts",
                headers=zoho_headers(),
                params={"search_text": key}
            ).json()
            if r.get("contacts"):
                return r["contacts"][0]["contact_id"]

    # create new
    payload = {
        "contact_name": order.get("customer_name", "Customer"),
        "email": order.get("customer", {}).get("email", ""),
        "phone": order.get("customer", {}).get("mobile", ""),
    }
    res = requests.post(f"{ZOHO_API_BASE}/contacts", headers=zoho_headers(), json=payload).json()

    if "contact" not in res:
        raise HTTPException(400, {"error": res})

    return res["contact"]["contact_id"]


# -------------------------------------------------------------------
# BUILD INVOICE — ALWAYS USE ZOHO NAME
# -------------------------------------------------------------------
def build_invoice(order, contact_id, zoho_item):
    item = order["items"][0]  # frontend always sends list with exactly 1 item

    line_item = {
        "item_id": zoho_item["item_id"],
        "name": zoho_item["name"],
        "rate": float(item.get("unit_price") or 0),  # ✅ FIX: correct price
        "quantity": float(item.get("quantity") or 1),
        "sku": zoho_item.get("sku")
    }

    payload = {
        "customer_id": contact_id,
        "reference_number": order.get("order_id", ""),
        "line_items": [line_item],
    }

    return payload



# -------------------------------------------------------------------
# MAIN — CREATE INVOICE
# -------------------------------------------------------------------
@router.post("/invoice")
def create_invoice(order: dict, db=Depends(get_db)):

    print("=== RECEIVED ORDER FROM FRONTEND ===")
    print(order)

    product_id = order["items"][0]["product_id"]

    # 1️⃣ get SKU from database
    sku = db.execute(
        text("SELECT sku_id FROM products WHERE product_id = :pid"),
        {"pid": product_id}
    ).scalar()

    if not sku:
        raise HTTPException(400, f"Product {product_id} has no SKU in DB")

    # 2️⃣ get Zoho item
    zoho_item = get_zoho_item_by_sku(sku)
    if not zoho_item:
        raise HTTPException(400, f"SKU {sku} not found in Zoho items")

    # 3️⃣ find/create Zoho contact
    contact_id = find_or_create_contact(order)

    # 4️⃣ build final payload
    payload = build_invoice(order, contact_id, zoho_item)


    # 5️⃣ create invoice
    url = f"{ZOHO_API_BASE}/invoices"
    resp = requests.post(url, headers=zoho_headers(), json=payload).json()

    if "invoice" not in resp:
        raise HTTPException(400, resp)

    return resp
