from email.mime import base
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
from sqlalchemy import text, or_, func, String
from typing import Optional, List
from datetime import datetime

from pydantic import BaseModel
from database import SessionLocal
from models import Order


router = APIRouter(prefix="/orders", tags=["Orders"])


def get_global_suffix(db):
    result = db.execute(text("""
        SELECT 
            CAST(SUBSTRING_INDEX(order_id, '#', -1) AS UNSIGNED) AS suffix
        FROM orders
        WHERE order_id REGEXP '^[0-9]{5}#[0-9]{5}$'
        ORDER BY suffix DESC
        LIMIT 1;
    """)).fetchone()

    if result and result[0] is not None:
        return int(result[0])

    return 0




def generate_order_id(db, offline_customer_id: int) -> str:
    if not offline_customer_id:
        raise ValueError("offline_customer_id is required for order_id generation")

    prefix = str(offline_customer_id).zfill(5)

    last_suffix = get_global_suffix(db)
    next_suffix = str(last_suffix + 1).zfill(5)

    return f"{prefix}#{next_suffix}"





# ================================
# DB Dependency
# ================================
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()



# ================================
# Pydantic Models
# ================================
class OrderItemIn(BaseModel):
    product_id: int
    qty: int
    final_unit_price: float
    line_total: float
    gst_amount: float


class OrderCreate(BaseModel):
    customer_id: Optional[int] = None
    offline_customer_id: Optional[int] = None
    address_id: int
    total_items: int
    subtotal: float
    gst: float
    delivery_charge: float
    total_amount: float
    payment_type: str
    channel: str = "offline"
    items: List[OrderItemIn]



# ================================
# CREATE ORDER (Fixed)
# ================================
@router.post("/create")
def create_order(data: OrderCreate, db: Session = Depends(get_db)):

    # --------------------------
    # VALIDATION
    # --------------------------
    if not data.address_id:
        raise HTTPException(status_code=400, detail="Address not selected")

    # PREFIX = offline_customer_id preferred
    if data.offline_customer_id:
        prefix = f"{data.offline_customer_id:05d}"
    elif data.customer_id:
        prefix = f"{data.customer_id:05d}"
    else:
        raise HTTPException(400, "Customer is required")

    # --------------------------
    # GLOBAL SUFFIX LOGIC
    # --------------------------
    last = db.execute(text("""
        SELECT order_id
        FROM orders
        WHERE order_id LIKE '%#%'
        ORDER BY created_at DESC
        LIMIT 1
    """)).fetchone()

    if last:
        try:
            last_suffix = int(last[0].split("#")[1])
            new_suffix = last_suffix + 1
        except:
            new_suffix = 1
    else:
        new_suffix = 1

    suffix = f"{new_suffix:05d}"

    # FINAL order_id
    # FINAL ORDER ID BUILDER (offline preferred, otherwise online)
    if data.offline_customer_id:
        order_id = generate_order_id(db, data.offline_customer_id)
    else:
    # generate online order ID using same suffix logic
        prefix = f"{data.customer_id:05d}"

    last_suffix = get_global_suffix(db)
    next_suffix = str(last_suffix + 1).zfill(5)

    order_id = f"{prefix}#{next_suffix}"



    now = datetime.now()

    # order_index MUST be unique → use timestamp
    order_index = int(now.timestamp())

    # --------------------------
    # INSERT ORDER
    # --------------------------
    order = Order(
        order_id=order_id,
        customer_id=data.customer_id,
        offline_customer_id=data.offline_customer_id,
        address_id=data.address_id,
        total_items=data.total_items,
        subtotal=data.subtotal,
        gst=data.gst,
        delivery_charge=data.delivery_charge,
        total_amount=data.total_amount,
        channel=data.channel.lower(),
        payment_status="pending",
        delivery_status="NOT_SHIPPED",
        created_at=now,
        updated_at=now,
        order_index=order_index,
        payment_type=data.payment_type,
    )

    db.add(order)
    db.commit()
    db.refresh(order)

    # --------------------------
    # INSERT ITEMS
    # --------------------------
    for it in data.items:
        db.execute(text("""
            INSERT INTO order_items
            (order_id, product_id, quantity, unit_price, total_price)
            VALUES (:oid, :pid, :qty, :unit, :line_total)
        """), {
            "oid": order_id,
            "pid": it.product_id,
            "qty": it.qty,
            "unit": it.final_unit_price,
            "line_total": it.line_total
        })

    db.commit()

    return {
        "success": True,
        "order_id": order_id
    }


# ================================
# LIST ORDERS (unchanged but cleaned)
# ================================
@router.get("/")
def list_orders(
    payment_status: Optional[str] = Query(None),
    delivery_status: Optional[str] = Query(None),
    channel: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):

    query = db.query(Order)

    # FILTERS
    if payment_status:
        query = query.filter(func.lower(Order.payment_status) == payment_status.lower())
    if delivery_status:
        query = query.filter(func.lower(Order.delivery_status) == delivery_status.lower())
    if channel:
        query = query.filter(func.lower(Order.channel) == channel.lower())

    if date_from:
        query = query.filter(Order.created_at >= datetime.strptime(date_from, "%Y-%m-%d"))
    if date_to:
        query = query.filter(Order.created_at <= datetime.strptime(date_to, "%Y-%m-%d"))

    if search:
        s = search.lower().strip()
        like = f"%{s}%"
        query = query.filter(
            or_(
                func.lower(Order.order_id).like(like),
                func.lower(Order.payment_status).like(like),
                func.lower(Order.delivery_status).like(like),
                func.cast(Order.awb_number, String).like(like)
            )
        )

    results = query.order_by(Order.created_at.desc()).all()
    out = []

    for o in results:
        base = {
            k: v
            for k, v in o.__dict__.items()
            if not k.startswith("_")
        }
        
        # ADD INVOICE NUMBER
        base["invoice_number"] = o.invoice_number

        # CUSTOMER
        customer = None
        if o.customer_id:
            row = db.execute(
                text("SELECT name, mobile, email FROM customer WHERE customer_id=:cid"),
                {"cid": o.customer_id}
            ).first()
            if row:
                customer = dict(row._mapping)
        elif o.offline_customer_id:
            row = db.execute(
                text("SELECT name, mobile, email FROM offline_customer WHERE customer_id=:cid"),
                {"cid": o.offline_customer_id}
            ).first()
            if row:
                customer = dict(row._mapping)

        base["customer"] = customer

        # ADDRESS
        address = db.execute(
            text("""
                SELECT 
    a.address_id,
    a.name,
    a.mobile,
    a.pincode,
    a.address_line,
    a.city,
    a.state_id,
    s.name AS state_name,
    a.landmark
FROM address a
LEFT JOIN state s ON s.state_id = a.state_id
WHERE a.address_id = :aid

            """),
            {"aid": o.address_id}
        ).first()
        base["address"] = dict(address._mapping) if address else None

        # ITEMS
        items = db.execute(
            text("""
                SELECT oi.item_id, oi.product_id, p.name AS product_name,
                    oi.quantity, oi.unit_price, oi.total_price
                FROM order_items oi
                LEFT JOIN products p ON p.product_id = oi.product_id
                WHERE oi.order_id = :oid
            """),
            {"oid": o.order_id}
        ).fetchall()

        items = [dict(row._mapping) for row in items]
        base["items"] = items

        # SERIAL STATUS
        serial_rows = db.execute(
            text("""
                SELECT item_id, COUNT(sr_number) AS assigned
                FROM serial_numbers
                WHERE item_id IN (
                    SELECT item_id FROM order_items WHERE order_id = :oid
                )
                GROUP BY item_id
            """),
            {"oid": o.order_id}
        ).fetchall()

        serial_map = {r.item_id: r.assigned for r in serial_rows}
        total_required = sum(it["quantity"] for it in items)
        total_assigned = sum(serial_map.get(it["item_id"], 0) for it in items)

        if total_assigned == 0:
            base["serial_status"] = "none"
        elif total_assigned < total_required:
            base["serial_status"] = "partial"
        else:
            base["serial_status"] = "complete"

        out.append(base)

    return out




# ================================
# Order Status Endpoints
# ================================
@router.put("/{order_id:path}/mark-paid")
def mark_as_paid(order_id: str, db: Session = Depends(get_db)):
    order = db.query(Order).filter(Order.order_id == order_id).first()
    if not order:
        raise HTTPException(404, "Order not found")
    order.payment_status = "paid"
    order.updated_at = datetime.now()
    db.commit()
    return {"message": "Marked as paid"}


@router.put("/{order_id:path}/mark-fulfilled")
def mark_as_fulfilled(order_id: str, db: Session = Depends(get_db)):
    order = db.query(Order).filter(Order.order_id == order_id).first()
    if not order:
        raise HTTPException(404, "Order not found")
    order.delivery_status = "READY"
    order.updated_at = datetime.now()
    db.commit()
    return {"message": "Marked as fulfilled"}


@router.put("/{order_id:path}/mark-delhivery")
def mark_as_delhivery(order_id: str, awb: Optional[str] = None, db: Session = Depends(get_db)):
    order = db.query(Order).filter(Order.order_id == order_id).first()
    if not order:
        raise HTTPException(404, "Order not found")
    order.delivery_status = "SHIPPED"
    order.awb_number = awb or "To be assigned"
    order.updated_at = datetime.now()
    db.commit()
    return {"message": "Marked as shipped", "awb": order.awb_number}


@router.put("/{order_id:path}/mark-invoiced")
def mark_as_invoiced(order_id: str, db: Session = Depends(get_db)):
    order = db.query(Order).filter(Order.order_id == order_id).first()
    if not order:
        raise HTTPException(404, "Order not found")
    order.order_status = "COMPLETED"
    order.updated_at = datetime.now()
    db.commit()
    return {"message": "Marked as invoiced"}


@router.get("/{order_id}/serial_numbers")
def get_serial_numbers(order_id: str, db: Session = Depends(get_db)):
    rows = db.execute(text("""
        SELECT 
            oi.item_id,
            oi.product_id,
            p.name AS product_name,
            oi.quantity,
            dt.device_srno
        FROM order_items oi
        LEFT JOIN products p ON p.product_id = oi.product_id
        LEFT JOIN device_transaction dt 
            ON dt.order_id = oi.order_id 
            AND dt.sku_id = p.sku_id
        WHERE oi.order_id = :oid
        ORDER BY oi.item_id
    """), {"oid": order_id}).fetchall()

    items = {}

    for r in rows:
        if r.item_id not in items:
            items[r.item_id] = {
                "item_id": r.item_id,
                "product_id": r.product_id,
                "product_name": r.product_name,
                "quantity": r.quantity,
                "serials": []
            }
        if r.device_srno:
            items[r.item_id]["serials"].append(r.device_srno)

    return list(items.values())



@router.post("/{order_id}/serial_numbers/save")
def save_serial_numbers(order_id: str, data: dict, db: Session = Depends(get_db)):
    """
    - Deletes old serials for each SKU
    - Inserts new serials into device_transaction (OUT entries)
    - Restores model_name using previous IN record
    - Returns serial_status = complete | partial | none
    """

    entries = data.get("entries", [])
    if not entries:
        raise HTTPException(status_code=400, detail="No serial data provided")

    # Fetch order items (to know sku_id, price, model_name)
    order_items = db.execute(text("""
        SELECT 
            oi.item_id,
            oi.product_id,
            oi.unit_price,
            p.name AS model_name,
            p.sku_id
        FROM order_items oi
        LEFT JOIN products p ON p.product_id = oi.product_id
        WHERE oi.order_id = :oid
    """), {"oid": order_id}).fetchall()

    item_map = {
        row.item_id: {
            "unit_price": row.unit_price,
            "model_name": row.model_name,
            "sku_id": row.sku_id
        }
        for row in order_items
    }

    # ---------------------------------------------------------
    # PROCESS EACH ENTRY
    # ---------------------------------------------------------
    for entry in entries:
        item_id = entry.get("item_id")
        serials = entry.get("serials", [])

        if not item_id or item_id not in item_map:
            continue

        item = item_map[item_id]
        sku = item["sku_id"]

        # ---------------------------------------------------------
        # DELETE old OUT serial numbers for this SKU
        # ---------------------------------------------------------
        db.execute(text("""
            DELETE FROM device_transaction
            WHERE order_id = :oid
              AND sku_id = :sku
              AND in_out = 2
        """), {"oid": order_id, "sku": sku})

        # ---------------------------------------------------------
        # INSERT NEW SERIALS
        # ---------------------------------------------------------
        for sr in serials:
            sr = sr.strip()
            if not sr:
                continue

            # Look up correct model_name from last IN record
            result = db.execute(text("""
                SELECT model_name
                FROM device_transaction
                WHERE device_srno = :sr
                  AND in_out = 1
                ORDER BY auto_id DESC
                LIMIT 1
            """), {"sr": sr}).fetchone()

            correct_model_name = result.model_name if result else item["model_name"]

            # Insert OUT entry
            db.execute(text("""
                INSERT INTO device_transaction
                    (device_srno, model_name, sku_id, order_id, in_out, create_date, price, remarks)
                VALUES
                    (:sr, :model, :sku, :oid, 2, CURDATE(), :price, NULL)
            """), {
                "sr": sr,
                "model": correct_model_name,
                "sku": sku,
                "oid": order_id,
                "price": item["unit_price"]
            })

    db.commit()

    # ---------------------------------------------------------
    # SERIAL STATUS CALCULATION FOR FRONTEND
    # ---------------------------------------------------------

    # Get required SKUs for this order
    order_skus = [row.sku_id for row in order_items]

    # Count inserted serials (OUT entries)
    serial_counts = db.execute(text("""
        SELECT sku_id, COUNT(*) AS count
        FROM device_transaction
        WHERE order_id = :oid AND in_out = 2
        GROUP BY sku_id
    """), {"oid": order_id}).fetchall()

    serial_map = {row.sku_id: row.count for row in serial_counts}

    # Determine complete/partial/none
    if all(sku in serial_map and serial_map[sku] > 0 for sku in order_skus):
        serial_status = "complete"
    elif any(sku in serial_map and serial_map[sku] > 0 for sku in order_skus):
        serial_status = "partial"
    else:
        serial_status = "none"

    return {
        "message": "Serial numbers updated successfully",
        "serial_status": serial_status
    }






@router.put("/{order_id}/toggle-payment")
def toggle_payment(order_id: str, db: Session = Depends(get_db)):
    """
    Toggle payment_status between 'pending' and 'paid'.
    Also set order_status automatically.
    """
    order = db.query(Order).filter(Order.order_id == order_id).first()

    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    # Toggle
    if order.payment_status == "paid":
        order.payment_status = "pending"
        order.order_status = "PEND"
    else:
        order.payment_status = "paid"
        order.order_status = "APPR"

    order.updated_at = datetime.now()
    db.commit()
    db.refresh(order)

    return {
        "message": f"Payment toggled for {order_id}",
        "payment_status": order.payment_status,
        "order_status": order.order_status,
    }

@router.put("/{order_id}/delivery-status")
def update_delivery_status(order_id: str, status: str, db: Session = Depends(get_db)):
    allowed = ["NOT_SHIPPED", "SHIPPED", "COMPLETED"]

    if status not in allowed:
        raise HTTPException(400, detail="Invalid delivery status")

    order = db.query(Order).filter(Order.order_id == order_id).first()
    if not order:
        raise HTTPException(404, "Order not found")

    order.delivery_status = status
    order.updated_at = datetime.now()
    db.commit()

    return {"message": "Delivery status updated", "delivery_status": status}

@router.post("/{order_id}/create-invoice")
def create_local_invoice(order_id: str, db: Session = Depends(get_db)):
    order = db.query(Order).filter(Order.order_id == order_id).first()
    if not order:
        raise HTTPException(404, "Order not found")

    # Generate invoice number
    invoice_number = "INV-" + datetime.now().strftime("%Y%m%d-%H%M%S")

    order.invoice_number = invoice_number
    order.updated_at = datetime.now()
    db.commit()

    return {
        "message": "Invoice created",
        "invoice_number": invoice_number
    }

@router.get("/{order_id}/invoice/download")
def download_invoice_redirect(order_id: str):
    return RedirectResponse(url=f"/zoho/orders/{order_id}/invoice/download")


class DeliveryUpdate(BaseModel):
    status: str

@router.put("/{order_id}/update-delivery")
def update_delivery(order_id: str, payload: DeliveryUpdate, db: Session = Depends(get_db)):
    allowed = ["NOT_SHIPPED", "SHIPPED", "COMPLETED"]

    if payload.status not in allowed:
        raise HTTPException(400, detail="Invalid delivery status")

    order = db.query(Order).filter(Order.order_id == order_id).first()
    if not order:
        raise HTTPException(404, detail="Order not found")

    order.delivery_status = payload.status
    order.updated_at = datetime.now()
    db.commit()

    return {
        "message": "Delivery updated",
        "delivery_status": payload.status,
    }

# ---- SERIAL STATUS CHECK ----
@router.put("/{order_id}/remarks")
def update_order_remarks(order_id: str, data: dict, db: Session = Depends(get_db)):
    remarks = data.get("remarks")

    if remarks is None:
        raise HTTPException(400, "Missing remarks value")

    db.execute(
        text("""
            UPDATE orders
            SET remarks = :remarks
            WHERE order_id = :oid
        """),
        {"remarks": remarks, "oid": order_id}
    )

    db.commit()

    return {"success": True, "order_id": order_id, "remarks": remarks}

@router.get("/search/suggestions")
def search_suggestions(q: str, db: Session = Depends(get_db)):
    if not q or len(q.strip()) < 2:
        return []

    q = f"%{q.lower()}%"

    rows = db.execute(text("""
        SELECT DISTINCT result FROM (

            -- Order ID
            SELECT order_id AS result FROM orders WHERE LOWER(order_id) LIKE :q

            UNION

            -- AWB
            SELECT CAST(awb_number AS CHAR) FROM orders WHERE LOWER(awb_number) LIKE :q

            UNION

            -- Customer (online)
            SELECT name FROM customer WHERE LOWER(name) LIKE :q
            UNION
            SELECT mobile FROM customer WHERE LOWER(mobile) LIKE :q

            UNION

            -- Customer (offline)
            SELECT name FROM offline_customer WHERE LOWER(name) LIKE :q
            UNION
            SELECT mobile FROM offline_customer WHERE LOWER(mobile) LIKE :q

            UNION

            -- Address fields
            SELECT address_line FROM address WHERE LOWER(address_line) LIKE :q
            UNION
            SELECT city FROM address WHERE LOWER(city) LIKE :q
            UNION
            SELECT pincode FROM address WHERE LOWER(pincode) LIKE :q

            UNION

            -- Product names
            SELECT name FROM products WHERE LOWER(name) LIKE :q

        ) AS all_results
        LIMIT 10;
    """), {"q": q}).fetchall()

    return [r[0] for r in rows]
