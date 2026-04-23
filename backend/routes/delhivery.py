"""
delhivery.py  —  All Delhivery B2C API operations
--------------------------------------------------
Mount this router in your main FastAPI app:

    from delhivery import router as delhivery_router
    app.include_router(delhivery_router)

Required .env keys  (load with python-dotenv):
    DELHIVERY_TOKEN          = <your token>
    DELHIVERY_PICKUP_NAME    = <warehouse name, case-sensitive>
    DELHIVERY_SELLER_GST     = <GST TIN of seller>
    DELHIVERY_CLIENT_NAME    = <client name as registered with Delhivery>
    DELHIVERY_SELLER_NAME    = <your brand/company name>
    DELHIVERY_SELLER_ADDRESS = <your pickup address>
    DELHIVERY_SELLER_PHONE   = <your phone>
    DELHIVERY_HSN_CODE       = <default HSN code, e.g. 85171290>
    DELHIVERY_ENV            = staging | production   (default: staging)
"""

import os
import json
import httpx
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import text

from database import SessionLocal
from models import Order

# ─── env ──────────────────────────────────────────────────────────────────────
DELHIVERY_TOKEN       = os.getenv("DELHIVERY_TOKEN", "")
PICKUP_NAME           = os.getenv("DELHIVERY_PICKUP_NAME", "")
SELLER_GST            = os.getenv("DELHIVERY_SELLER_GST", "")
CLIENT_NAME           = os.getenv("DELHIVERY_CLIENT_NAME", "")
SELLER_NAME           = os.getenv("DELHIVERY_SELLER_NAME", "")
SELLER_ADDRESS        = os.getenv("DELHIVERY_SELLER_ADDRESS", "")
SELLER_PHONE          = os.getenv("DELHIVERY_SELLER_PHONE", "")
DEFAULT_HSN           = os.getenv("DELHIVERY_HSN_CODE", "85171290")
DELHIVERY_ENV         = os.getenv("DELHIVERY_ENV", "staging").lower()

BASE_URL = (
    "https://track.delhivery.com"
    if DELHIVERY_ENV == "production"
    else "https://staging-express.delhivery.com"
)

HEADERS = {
    "Authorization": f"Token {DELHIVERY_TOKEN}",
    "Content-Type": "application/json",
}

# ─── router ───────────────────────────────────────────────────────────────────
router = APIRouter(prefix="/delhivery", tags=["Delhivery"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ─── pydantic ─────────────────────────────────────────────────────────────────
class PushOrderPayload(BaseModel):
    order_id: str
    weight: Optional[float] = 0.5          # kg
    length: Optional[float] = 10           # cm
    breadth: Optional[float] = 10
    height: Optional[float] = 10
    payment_mode: Optional[str] = "Prepaid"  # "Prepaid" or "COD"
    cod_amount: Optional[float] = 0
    hsn_code: Optional[str] = None
    e_waybill: Optional[str] = None


class CancelPayload(BaseModel):
    waybill: str


class PickupPayload(BaseModel):
    pickup_date: str               # "YYYY-MM-DD"
    expected_package_count: int = 1


# ─── helpers ──────────────────────────────────────────────────────────────────
def _headers():
    return {
        "Authorization": f"Token {DELHIVERY_TOKEN}",
        "Content-Type": "application/json",
    }


async def _get(url: str, params: dict = None):
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.get(url, headers=_headers(), params=params)
        return r


async def _post(url: str, body_data: dict):
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post(
            url,
            headers={
                "Authorization": f"Token {DELHIVERY_TOKEN}",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            data={
                "format": "json",
                "data": json.dumps(body_data),
            },
        )
        return r


# ─── 1. PINCODE SERVICEABILITY ────────────────────────────────────────────────
@router.get("/serviceability/{pincode}")
async def check_serviceability(pincode: str):
    """Check if a pincode is serviceable by Delhivery."""
    url = f"{BASE_URL}/c/api/pin-codes/json/"
    r = await _get(url, params={"filter_codes": pincode})
    if r.status_code != 200:
        raise HTTPException(502, f"Delhivery error: {r.text}")
    data = r.json()
    delivery_codes = data.get("delivery_codes", [])
    if not delivery_codes:
        return {"serviceable": False, "pincode": pincode, "data": None}
    pin_data = delivery_codes[0].get("postal_code", {})
    return {
        "serviceable": True,
        "pincode": pincode,
        "cod": pin_data.get("cod", ""),
        "pre_paid": pin_data.get("pre_paid", ""),
        "pickup": pin_data.get("pickup", ""),
        "repl": pin_data.get("repl", ""),
        "city": pin_data.get("district", ""),
        "state": pin_data.get("state_code", ""),
    }


# ─── 2. FETCH WAYBILL ─────────────────────────────────────────────────────────
@router.get("/waybill/fetch")
async def fetch_waybill(count: int = Query(1, ge=1, le=100)):
    """Fetch one or more waybill numbers from Delhivery."""
    url = f"{BASE_URL}/waybill/api/bulk/json/"
    r = await _get(url, params={"count": count})
    if r.status_code != 200:
        raise HTTPException(502, f"Delhivery error: {r.text}")
    data = r.json()
    waybills = data.get("data", [])
    return {"waybills": waybills, "count": len(waybills)}


# ─── 3. PUSH ORDER TO DELHIVERY ───────────────────────────────────────────────
@router.post("/push-order")
async def push_order_to_delhivery(
    payload: PushOrderPayload,
    db: Session = Depends(get_db),
):
    """
    Push an order from the DB to Delhivery and store the returned waybill.
    On success, updates orders.awb_number and orders.delivery_status = 'SHIPPED'.
    """
    order = db.query(Order).filter(Order.order_id == payload.order_id).first()
    if not order:
        raise HTTPException(404, "Order not found")

    if order.awb_number and order.awb_number not in ("", "To be assigned"):
        return {
            "success": True,
            "already_pushed": True,
            "waybill": order.awb_number,
            "message": "Order already pushed to Delhivery",
        }

    # ── gather order details ──────────────────────────────────────────────────
    customer = None
    if order.customer_id:
        row = db.execute(
            text("SELECT name, mobile, email FROM customer WHERE customer_id=:cid"),
            {"cid": order.customer_id},
        ).first()
    elif order.offline_customer_id:
        row = db.execute(
            text("SELECT name, mobile, email FROM offline_customer WHERE customer_id=:cid"),
            {"cid": order.offline_customer_id},
        ).first()
    if row:
        customer = dict(row._mapping)

    if not customer:
        raise HTTPException(400, "No customer associated with this order")

    address = db.execute(
        text("""
            SELECT a.*, s.name AS state_name
            FROM address a LEFT JOIN state s ON s.state_id = a.state_id
            WHERE a.address_id = :aid
        """),
        {"aid": order.address_id},
    ).first()
    if not address:
        raise HTTPException(400, "No delivery address for this order")

    items = db.execute(
        text("""
            SELECT oi.item_id, oi.product_id, p.name AS product_name,
                   p.sku_id, oi.quantity, oi.unit_price, oi.total_price
            FROM order_items oi LEFT JOIN products p ON p.product_id = oi.product_id
            WHERE oi.order_id = :oid
        """),
        {"oid": payload.order_id},
    ).fetchall()

    if not items:
        raise HTTPException(400, "Order has no items")

    # ── build product summary ─────────────────────────────────────────────────
    product_desc = ", ".join(
        f"{it.product_name} x{it.quantity}" for it in items
    )
    hsn = payload.hsn_code or DEFAULT_HSN

    # ── build Delhivery payload ───────────────────────────────────────────────
    consignee_phone = str(customer.get("mobile", "")).strip()
    consignee_name  = str(customer.get("name", "")).strip()
    addr_line       = str(address.address_line or "").replace("&", "and").replace("#", "").replace("%", "").strip()
    city            = str(address.city or "").strip()
    state           = str(getattr(address, "state_name", "") or "").strip()
    pincode         = str(address.pincode or "").strip()
    locality = str(address.locality or "").strip()
    full_address = f"{addr_line}, {locality}" if locality else addr_line

    delhivery_order = {
        "name":            consignee_name,
        "add":             full_address,
        "pin":             pincode,
        "city":            city,
        "state":           state,
        "country":         "India",
        "phone":           consignee_phone,
        "order":           payload.order_id,
        "payment_mode":    payload.payment_mode,
        "return_pin":      "110019",
        "return_city":     "Delhi",
        "return_phone":    SELLER_PHONE,
        "return_add":      SELLER_ADDRESS,
        "return_state":    "Delhi",
        "return_country":  "India",
        "products_desc":   product_desc,
        "hsn_code":        hsn,
        "cod_amount":      str(payload.cod_amount) if payload.payment_mode == "COD" else "0",
        "order_date":      datetime.now().strftime("%Y-%m-%d"),
        "total_amount":    str(float(order.total_amount)),
        "seller_add":      SELLER_ADDRESS,
        "seller_name":     SELLER_NAME,
        "seller_inv":      order.invoice_number if order.invoice_number not in ("NA", "", None) else payload.order_id,
        "quantity":        str(sum(it.quantity for it in items)),
        "shipment_width":  str(payload.breadth),
        "shipment_height": str(payload.height),
        "weight":          str(payload.weight),
        "shipment_length": str(payload.length),
        "seller_gst_tin":  SELLER_GST,
        "shipping_mode":   "Surface",
        "address_type":    "home",
    }

    if payload.e_waybill:
        delhivery_order["e_waybill_id"] = payload.e_waybill

    body_data = {
        "shipments": [delhivery_order],
        "pickup_location": {
            "name": PICKUP_NAME,
            "add": SELLER_ADDRESS,
            "city": "Delhi",
            "state": "Delhi",
            "country": "India",
            "pin": "110019",   # <-- IMPORTANT: match your address
            "phone": SELLER_PHONE
        }
    }


    raw_json = json.dumps(body_data)
    print("TOTAL LENGTH:", len(raw_json))

    error_pos = 558  # from error

    print("\nCHAR AT ERROR:", raw_json[error_pos])
    print("\nAROUND ERROR:\n", raw_json[error_pos-50:error_pos+50])
    url = f"{BASE_URL}/api/cmu/create.json"
    r = await _post(url, body_data)

    if r.status_code not in (200, 201):
        raise HTTPException(502, f"Delhivery API error {r.status_code}: {r.text[:500]}")

    result = r.json()

    # ── parse response ────────────────────────────────────────────────────────
    packages = result.get("packages", [])
    if not packages:
        raise HTTPException(502, f"Delhivery returned no package data: {result}")

    pkg = packages[0]
    waybill = pkg.get("waybill") or pkg.get("refnum") or ""

    if not waybill:
        raise HTTPException(502, f"No waybill in Delhivery response: {result}")

    # ── persist to DB ─────────────────────────────────────────────────────────
    order.awb_number      = waybill
    order.delivery_status = "SHIPPED"
    order.updated_at      = datetime.now()
    db.commit()

    return {
        "success":    True,
        "waybill":    waybill,
        "order_id":   payload.order_id,
        "status":     pkg.get("status", ""),
        "remark":     pkg.get("remark", ""),
        "sort_code":  pkg.get("sort_code", ""),
        "raw":        result,
    }


# ─── 4. TRACK ORDER ───────────────────────────────────────────────────────────
@router.get("/track/{waybill}")
async def track_shipment(waybill: str):
    """Fetch real-time tracking details for a waybill."""
    url = f"{BASE_URL}/api/v1/packages/json/"
    r = await _get(url, params={"waybill": waybill})
    if r.status_code != 200:
        raise HTTPException(502, f"Delhivery tracking error: {r.text}")
    data = r.json()
    ship_detail = data.get("ShipmentData", [{}])[0].get("Shipment", {})
    scans = ship_detail.get("Scans", [])

    timeline = []
    for s in scans:
        scan_detail = s.get("ScanDetail", {})
        timeline.append({
            "date":     scan_detail.get("ScanDateTime", ""),
            "status":   scan_detail.get("Scan", ""),
            "location": scan_detail.get("ScannedLocation", ""),
            "remark":   scan_detail.get("Instructions", ""),
        })

    return {
        "waybill":         waybill,
        "status":          ship_detail.get("Status", {}).get("Status", ""),
        "expected_date":   ship_detail.get("ExpectedDeliveryDate", ""),
        "consignee":       ship_detail.get("Consignee", ""),
        "destination":     ship_detail.get("DestinationCity", ""),
        "origin":          ship_detail.get("OriginCity", ""),
        "timeline":        timeline,
        "raw":             ship_detail,
    }


# ─── 5. TRACK BY ORDER_ID (convenience — looks up awb from DB) ───────────────
@router.get("/track-order/{order_id}")
async def track_by_order_id(order_id: str, db: Session = Depends(get_db)):
    order = db.query(Order).filter(Order.order_id == order_id).first()
    if not order:
        raise HTTPException(404, "Order not found")
    if not order.awb_number or order.awb_number == "To be assigned":
        raise HTTPException(400, "Order has not been pushed to Delhivery yet")
    return await track_shipment(order.awb_number)


# ─── 6. CANCEL SHIPMENT ───────────────────────────────────────────────────────
@router.post("/cancel")
async def cancel_shipment(payload: CancelPayload, db: Session = Depends(get_db)):
    url = f"{BASE_URL}/api/p/edit"
    body = json.dumps({"waybill": payload.waybill, "cancellation": True})
    encoded = f"format=json&data={body}"
    r = await _post(url, encoded)
    if r.status_code != 200:
        raise HTTPException(502, f"Delhivery cancel error: {r.text}")

    # Update DB
    db.execute(
        text("UPDATE orders SET delivery_status='NOT_SHIPPED', awb_number=NULL WHERE awb_number=:awb"),
        {"awb": payload.waybill},
    )
    db.commit()
    return {"success": True, "waybill": payload.waybill, "response": r.json()}


# ─── 7. SCHEDULE PICKUP ───────────────────────────────────────────────────────
@router.post("/pickup/schedule")
async def schedule_pickup(payload: PickupPayload):
    url = f"{BASE_URL}/fm/request/new/"
    body = {
        "pickup_location":        PICKUP_NAME,
        "expected_package_count": payload.expected_package_count,
        "pickup_date":            payload.pickup_date,
        "pickup_time":            "10:00:00",
    }
    encoded = f"format=json&data={json.dumps(body)}"
    r = await _post(url, encoded)
    if r.status_code != 200:
        raise HTTPException(502, f"Delhivery pickup error: {r.text}")
    return {"success": True, "response": r.json()}


# ─── 8. GET ORDER POD DATA (for offline print) ───────────────────────────────
@router.get("/pod-data/{order_id}")
async def get_pod_data(order_id: str, db: Session = Depends(get_db)):
    """Return all data needed to render an offline POD / shipping label."""
    order = db.query(Order).filter(Order.order_id == order_id).first()
    if not order:
        raise HTTPException(404, "Order not found")

    customer = None
    if order.customer_id:
        row = db.execute(
            text("SELECT name, mobile, email FROM customer WHERE customer_id=:cid"),
            {"cid": order.customer_id},
        ).first()
    elif order.offline_customer_id:
        row = db.execute(
            text("SELECT name, mobile, email FROM offline_customer WHERE customer_id=:cid"),
            {"cid": order.offline_customer_id},
        ).first()
    if row:
        customer = dict(row._mapping)

    address = db.execute(
        text("""
            SELECT a.*, s.name AS state_name
            FROM address a LEFT JOIN state s ON s.state_id = a.state_id
            WHERE a.address_id = :aid
        """),
        {"aid": order.address_id},
    ).first()

    items = db.execute(
        text("""
            SELECT oi.item_id, p.name AS product_name, p.sku_id,
                   oi.quantity, oi.unit_price, oi.total_price
            FROM order_items oi LEFT JOIN products p ON p.product_id = oi.product_id
            WHERE oi.order_id = :oid
        """),
        {"oid": order_id},
    ).fetchall()

    return {
        "order_id":       order_id,
        "created_at":     str(order.created_at),
        "invoice_number": order.invoice_number,
        "payment_type":   order.payment_type,
        "payment_status": order.payment_status,
        "total_amount":   float(order.total_amount),
        "awb_number":     order.awb_number,
        "channel":        order.channel,
        "utr_number":     order.utr_number,
        "seller": {
            "name":    SELLER_NAME,
            "address": SELLER_ADDRESS,
            "phone":   SELLER_PHONE,
            "gst":     SELLER_GST,
        },
        "customer":  customer,
        "address":   dict(address._mapping) if address else None,
        "items":     [dict(row._mapping) for row in items],
    }