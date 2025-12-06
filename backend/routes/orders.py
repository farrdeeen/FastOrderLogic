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

    # Validate customer
    if not data.customer_id and not data.offline_customer_id:
        raise HTTPException(status_code=400, detail="Customer not selected")

    # Validate address
    if not data.address_id:
        raise HTTPException(status_code=400, detail="Address not selected")

    now = datetime.now()
    order_id = now.strftime("%H%M%S%d%m")

    # Insert main order
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
        order_index=int(now.strftime("%H%M%S%d")),
        payment_type=data.payment_type,
    )

    db.add(order)
    db.commit()
    db.refresh(order)

    # Insert each item
    for it in data.items:
        db.execute(
            text("""
                INSERT INTO order_items
                (order_id, product_id, quantity, unit_price, total_price)
                VALUES (:oid, :pid, :qty, :unit, :line_total)
            """),
            {
                "oid": order_id,
                "pid": it.product_id,
                "qty": it.qty,
                "unit": it.final_unit_price,
                "line_total": it.line_total
            }
        )

    db.commit()

    return {
        "success": True,
        "message": "Order created successfully",
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
                SELECT address_id, name, mobile, pincode, address_line, city, state_id, landmark
                FROM address WHERE address_id = :aid
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
            sn.sr_number
        FROM order_items oi
        LEFT JOIN products p ON p.product_id = oi.product_id
        LEFT JOIN serial_numbers sn ON sn.item_id = oi.item_id
        WHERE oi.order_id = :oid
        ORDER BY oi.item_id
    """), {"oid": order_id}).fetchall()

    items = {}
    for r in rows:
        if r.item_id not in items:
            items[r.item_id] = {
                "item_id": r.item_id,
                "product_id": r.product_id,
                "product_name": r.product_name,   # ← ADD THIS
                "quantity": r.quantity,
                "serials": []
            }
        if r.sr_number:
            items[r.item_id]["serials"].append(r.sr_number)

    return list(items.values())


@router.post("/{order_id}/serial_numbers/save")
def save_serial_numbers(order_id: str, data: dict, db: Session = Depends(get_db)):
    """
    Expect payload:
    {
        "entries": [
            {
                "item_id": 12,
                "serials": ["SN1", "SN2", ...]
            }
        ]
    }
    """
    entries = data.get("entries", [])

    if not entries:
        raise HTTPException(status_code=400, detail="No serial data provided")

    for entry in entries:
        item_id = entry.get("item_id")
        serials = entry.get("serials", [])

        if not item_id:
            continue

        # Delete old serial numbers for this item
        db.execute(text("""
            DELETE FROM serial_numbers
            WHERE item_id = :iid
        """), {"iid": item_id})

        # Insert new serials
        for sr in serials:
            if sr.strip():
                db.execute(text("""
                    INSERT INTO serial_numbers (item_id, sr_number)
                    VALUES (:iid, :sr)
                """), {"iid": item_id, "sr": sr.strip()})

    db.commit()
    return {"message": "Serial numbers saved successfully"}

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
