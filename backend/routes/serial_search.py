"""
routes/serial_search.py

Provides two search endpoints:
  GET /serial-search/by-serial?q=<serial_no>
      → full history of a device_srno across in/out/return transactions
  GET /serial-search/by-order?order_id=<id>
      → all serials associated with an order, grouped by product/item

in_out codes: 1 = IN (stock arrival), 2 = OUT (sold/shipped), 3 = RETURN
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import Optional
from database import SessionLocal

router = APIRouter(prefix="/serial-search", tags=["Serial Search"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


IN_OUT_LABEL = {1: "IN", 2: "OUT", 3: "RETURN"}


# ─── Helper: enrich a device_transaction row ─────────────────────────────────
def _enrich_tx(row: dict) -> dict:
    row["in_out_label"] = IN_OUT_LABEL.get(row.get("in_out"), str(row.get("in_out")))
    return row


# ================================
# SEARCH BY SERIAL NUMBER
# ================================
@router.get("/by-serial")
def search_by_serial(
    q: str = Query(..., min_length=1, description="Serial / IMEI number (partial match OK)"),
    db: Session = Depends(get_db),
):
    """
    Returns the full lifecycle of every serial number matching *q*.
    Each result includes:
      - The device_transaction rows (IN / OUT / RETURN) in chronological order
      - Linked order details (if any)
      - Customer details for the order (if any)
    """
    like = f"%{q.strip()}%"

    rows = db.execute(text("""
        SELECT
            dt.auto_id,
            dt.device_srno,
            dt.model_name,
            dt.sku_id,
            dt.order_id,
            dt.in_out,
            dt.create_date,
            dt.price,
            dt.remarks,
            -- order info
            o.total_amount,
            o.payment_status,
            o.delivery_status,
            o.channel,
            o.created_at   AS order_created_at,
            o.payment_type,
            -- customer (online)
            c.name         AS online_cust_name,
            c.mobile       AS online_cust_mobile,
            -- customer (offline)
            oc.name        AS offline_cust_name,
            oc.mobile      AS offline_cust_mobile,
            -- address snapshot
            a.address_line,
            a.city,
            s.name         AS state_name,
            a.pincode
        FROM device_transaction dt
        LEFT JOIN orders              o  ON o.order_id       = dt.order_id
        LEFT JOIN customer            c  ON c.customer_id    = o.customer_id
        LEFT JOIN offline_customer    oc ON oc.customer_id   = o.offline_customer_id
        LEFT JOIN address             a  ON a.address_id     = o.address_id
        LEFT JOIN state               s  ON s.state_id       = a.state_id
        WHERE dt.device_srno LIKE :like
        ORDER BY dt.device_srno ASC, dt.auto_id ASC
    """), {"like": like}).fetchall()

    if not rows:
        return {"serials": []}

    # Group by serial number
    grouped: dict = {}
    for r in rows:
        d = dict(r._mapping)
        srno = d["device_srno"]
        if srno not in grouped:
            grouped[srno] = {
                "device_srno": srno,
                "model_name": d["model_name"],
                "sku_id": d["sku_id"],
                "transactions": [],
            }
        # Build customer name
        cust_name   = d.pop("online_cust_name")  or d.pop("offline_cust_name")  or None
        cust_mobile = d.pop("online_cust_mobile") or d.pop("offline_cust_mobile") or None
        d["offline_cust_name"]   = None  # already consumed
        d["offline_cust_mobile"] = None

        tx = {
            "auto_id":     d["auto_id"],
            "in_out":      d["in_out"],
            "in_out_label": IN_OUT_LABEL.get(d["in_out"], str(d["in_out"])),
            "create_date": str(d["create_date"]) if d["create_date"] else None,
            "price":       float(d["price"]) if d["price"] is not None else None,
            "remarks":     d["remarks"],
            "order_id":    d["order_id"],
        }
        if d["order_id"]:
            tx["order"] = {
                "order_id":        d["order_id"],
                "total_amount":    float(d["total_amount"]) if d["total_amount"] else None,
                "payment_status":  d["payment_status"],
                "delivery_status": d["delivery_status"],
                "channel":         d["channel"],
                "payment_type":    d["payment_type"],
                "order_created_at": str(d["order_created_at"]) if d["order_created_at"] else None,
                "customer": {
                    "name":   cust_name,
                    "mobile": cust_mobile,
                } if (cust_name or cust_mobile) else None,
                "ship_to": {
                    "address_line": d["address_line"],
                    "city":         d["city"],
                    "state":        d["state_name"],
                    "pincode":      d["pincode"],
                } if d["address_line"] else None,
            }
        else:
            tx["order"] = None

        grouped[srno]["transactions"].append(tx)

    return {"serials": list(grouped.values())}


# ================================
# SEARCH BY ORDER ID
# ================================
@router.get("/by-order")
def search_by_order(
    order_id: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
):
    """
    Returns every serial number linked to an order, grouped by order_item / product.
    Also returns order header + customer + address.
    """
    # ── Order header ──────────────────────────────────────────────────────────
    order_row = db.execute(text("""
        SELECT
            o.order_id,
            o.total_items,
            o.subtotal,
            o.gst,
            o.delivery_charge,
            o.total_amount,
            o.payment_status,
            o.delivery_status,
            o.order_status,
            o.fulfillment_status,
            o.channel,
            o.payment_type,
            o.awb_number,
            o.utr_number,
            o.invoice_number,
            o.created_at,
            o.updated_at,
            COALESCE(c.name,   oc.name)   AS cust_name,
            COALESCE(c.mobile, oc.mobile) AS cust_mobile,
            COALESCE(c.email,  oc.email)  AS cust_email,
            a.address_line,
            a.locality,
            a.city,
            st.name   AS state_name,
            a.pincode,
            a.landmark
        FROM orders o
        LEFT JOIN customer         c  ON c.customer_id  = o.customer_id
        LEFT JOIN offline_customer oc ON oc.customer_id = o.offline_customer_id
        LEFT JOIN address          a  ON a.address_id   = o.address_id
        LEFT JOIN state            st ON st.state_id    = a.state_id
        WHERE o.order_id = :oid
        LIMIT 1
    """), {"oid": order_id}).first()

    if not order_row:
        raise HTTPException(status_code=404, detail="Order not found")

    od = dict(order_row._mapping)

    order_header = {
        "order_id":          od["order_id"],
        "total_items":       od["total_items"],
        "subtotal":          float(od["subtotal"]) if od["subtotal"] else 0,
        "gst":               float(od["gst"]) if od["gst"] else 0,
        "delivery_charge":   float(od["delivery_charge"]) if od["delivery_charge"] else 0,
        "total_amount":      float(od["total_amount"]) if od["total_amount"] else 0,
        "payment_status":    od["payment_status"],
        "delivery_status":   od["delivery_status"],
        "order_status":      od["order_status"],
        "fulfillment_status":od["fulfillment_status"],
        "channel":           od["channel"],
        "payment_type":      od["payment_type"],
        "awb_number":        od["awb_number"],
        "utr_number":        od["utr_number"],
        "invoice_number":    od["invoice_number"],
        "created_at":        str(od["created_at"]) if od["created_at"] else None,
        "updated_at":        str(od["updated_at"]) if od["updated_at"] else None,
        "customer": {
            "name":   od["cust_name"],
            "mobile": od["cust_mobile"],
            "email":  od["cust_email"],
        } if (od["cust_name"] or od["cust_mobile"]) else None,
        "ship_to": {
            "address_line": od["address_line"],
            "locality":     od["locality"],
            "city":         od["city"],
            "state":        od["state_name"],
            "pincode":      od["pincode"],
            "landmark":     od["landmark"],
        } if od["address_line"] else None,
    }

    # ── Items + serials ───────────────────────────────────────────────────────
    item_rows = db.execute(text("""
        SELECT
            oi.item_id,
            oi.product_id,
            p.name         AS product_name,
            p.sku_id,
            oi.quantity,
            oi.unit_price,
            oi.total_price
        FROM order_items oi
        LEFT JOIN products p ON p.product_id = oi.product_id
        WHERE oi.order_id = :oid
        ORDER BY oi.item_id ASC
    """), {"oid": order_id}).fetchall()

    items = []
    for ir in item_rows:
        item = dict(ir._mapping)

        # Serials for this sku in this order (out transactions)
        serial_rows = db.execute(text("""
            SELECT
                dt.auto_id,
                dt.device_srno,
                dt.in_out,
                dt.create_date,
                dt.price,
                dt.remarks
            FROM device_transaction dt
            WHERE dt.order_id = :oid
              AND dt.sku_id   = :sku
              AND dt.in_out   = 2
            ORDER BY dt.auto_id ASC
        """), {"oid": order_id, "sku": item["sku_id"]}).fetchall()

        item["serials"] = [
            {
                "auto_id":      s.auto_id,
                "device_srno":  s.device_srno,
                "in_out":       s.in_out,
                "in_out_label": IN_OUT_LABEL.get(s.in_out, str(s.in_out)),
                "create_date":  str(s.create_date) if s.create_date else None,
                "price":        float(s.price) if s.price is not None else None,
                "remarks":      s.remarks,
            }
            for s in serial_rows
        ]
        item["serial_count"] = len(item["serials"])
        item["serial_status"] = (
            "complete" if item["serial_count"] >= item["quantity"]
            else "partial" if item["serial_count"] > 0
            else "none"
        )
        item["unit_price"]  = float(item["unit_price"])  if item["unit_price"]  else 0
        item["total_price"] = float(item["total_price"]) if item["total_price"] else 0
        items.append(item)

    return {
        "order": order_header,
        "items": items,
    }