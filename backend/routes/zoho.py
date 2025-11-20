# routes/zoho.py
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse
import requests
import os
import time
import json
from typing import Dict, Any, Optional
from dotenv import load_dotenv

load_dotenv()

router = APIRouter(prefix="/zoho", tags=["Zoho Books"])

# ------------------------------
# ENV CONFIG
# ------------------------------
ZOHO_CLIENT_ID = os.getenv("ZOHO_CLIENT_ID")
ZOHO_CLIENT_SECRET = os.getenv("ZOHO_CLIENT_SECRET")
ZOHO_ORG_ID = os.getenv("ZOHO_ORG_ID")
ZOHO_REDIRECT_URI = os.getenv("ZOHO_REDIRECT_URI", "http://localhost:8000/zoho/oauth/callback")

ACCOUNTS_BASE = "https://accounts.zoho.in"
TOKEN_URL = f"{ACCOUNTS_BASE}/oauth/v2/token"
AUTH_URL = f"{ACCOUNTS_BASE}/oauth/v2/auth"
ZOHO_API_BASE = "https://www.zohoapis.in/books/v3"

TOKENS_FILE = ".zoho_tokens.json"


# ------------------------------
# TOKEN STORAGE HELPERS
# ------------------------------
def _load_tokens_from_file():
    try:
        with open(TOKENS_FILE, "r") as f:
            return json.load(f)
    except:
        return {"access_token": None, "refresh_token": None, "expires_at": 0}


def _save_tokens_to_file(t):
    try:
        with open(TOKENS_FILE, "w") as f:
            json.dump(t, f)
    except Exception as e:
        print("Failed saving token:", e)


tokens = _load_tokens_from_file()


# ------------------------------
# AUTH: STEP 1 – Redirect to Zoho Login
# ------------------------------
@router.get("/auth")
def zoho_auth():
    if not ZOHO_CLIENT_ID:
        raise HTTPException(status_code=500, detail="Missing ZOHO_CLIENT_ID")

    url = (
        f"{AUTH_URL}?response_type=code"
        f"&client_id={ZOHO_CLIENT_ID}"
        f"&scope=ZohoBooks.fullaccess.all"
        f"&redirect_uri={ZOHO_REDIRECT_URI}"
        f"&access_type=offline"
        f"&prompt=consent"
    )

    return RedirectResponse(url)


# ------------------------------
# AUTH: STEP 2 – OAuth Callback
# ------------------------------
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
    resp = res.json()

    if "access_token" not in resp:
        raise HTTPException(status_code=400, detail={"error": "invalid_token", "data": resp})

    tokens["access_token"] = resp["access_token"]
    tokens["refresh_token"] = resp.get("refresh_token", tokens.get("refresh_token"))
    tokens["expires_at"] = time.time() + int(resp.get("expires_in", 3600))

    _save_tokens_to_file(tokens)

    return {
        "success": True,
        "message": "Zoho connected",
        "tokens": {
            "access_token": tokens["access_token"],
            "refresh_token": tokens["refresh_token"],
            "expires_at": tokens["expires_at"],
        }
    }


# ------------------------------
# AUTO-REFRESH TOKEN
# ------------------------------
def ensure_access_token() -> str:
    if tokens.get("access_token") and time.time() < tokens.get("expires_at", 0):
        return tokens["access_token"]

    if not tokens.get("refresh_token"):
        raise HTTPException(401, "Zoho not authenticated. Go to /zoho/auth")

    data = {
        "grant_type": "refresh_token",
        "refresh_token": tokens["refresh_token"],
        "client_id": ZOHO_CLIENT_ID,
        "client_secret": ZOHO_CLIENT_SECRET,
    }

    res = requests.post(TOKEN_URL, data=data)
    resp = res.json()

    if "access_token" not in resp:
        raise HTTPException(400, {"error": "refresh_failed", "data": resp})

    tokens["access_token"] = resp["access_token"]
    tokens["expires_at"] = time.time() + int(resp.get("expires_in", 3600))

    if resp.get("refresh_token"):
        tokens["refresh_token"] = resp["refresh_token"]

    _save_tokens_to_file(tokens)
    return tokens["access_token"]


def zoho_headers():
    return {
        "Authorization": f"Zoho-oauthtoken {ensure_access_token()}",
        "Content-Type": "application/json",
        "X-com-zoho-books-organizationid": ZOHO_ORG_ID,
    }


# ------------------------------
# Find Contact
# ------------------------------
def find_contact(search: str):
    if not search:
        return None

    url = f"{ZOHO_API_BASE}/contacts"
    res = requests.get(url, headers=zoho_headers(), params={"search_text": search})
    data = res.json()

    if "contacts" in data and len(data["contacts"]) > 0:
        return data["contacts"][0]

    return None


# ------------------------------
# Create Contact
# ------------------------------
def create_contact(order):
    payload = {
        "contact_name": order.get("customer_name", "Customer"),
        "email": order.get("customer", {}).get("email", ""),
        "phone": order.get("customer", {}).get("mobile", ""),
    }

    url = f"{ZOHO_API_BASE}/contacts"
    res = requests.post(url, headers=zoho_headers(), json=payload)
    data = res.json()

    if "contact" not in data:
        raise HTTPException(400, {"error": "create_contact_failed", "data": data})

    return data["contact"]


# ------------------------------
# Build Invoice Payload
# ------------------------------
def build_invoice(order, contact_id):
    items = []
    for it in order.get("items", []):
        items.append({
            "name": it.get("product_name") or it.get("title") or "Item",
            "rate": float(it.get("unit_price") or it.get("price") or 0),
            "quantity": float(it.get("quantity") or 1)
        })

    payload = {
        "customer_id": contact_id,
        "reference_number": order.get("order_id", ""),
        "line_items": items,
    }

    return payload


# ------------------------------
# PUBLIC API – Create Invoice
# ------------------------------
@router.post("/invoice")
def create_invoice(order: dict):

    ensure_access_token()

    search_keys = [
        order.get("customer", {}).get("email"),
        order.get("customer", {}).get("mobile"),
        order.get("customer_name"),
    ]

    contact = None
    for s in search_keys:
        if s:
            contact = find_contact(s)
            if contact:
                break

    if not contact:
        contact = create_contact(order)

    contact_id = contact.get("contact_id")
    if not contact_id:
        raise HTTPException(500, {"error": "missing_contact_id", "data": contact})

    payload = build_invoice(order, contact_id)

    url = f"{ZOHO_API_BASE}/invoices"
    res = requests.post(url, headers=zoho_headers(), json=payload)
    resp = res.json()

    if "invoice" not in resp:
        raise HTTPException(400, {"error": "invoice_failed", "data": resp})

    return {
        "success": True,
        "invoice": resp["invoice"],
        "zoho_response": resp,
    }


# DEBUG
@router.get("/tokens")
def debug_tokens():
    return tokens
