from email.mime import base
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
from sqlalchemy import text, or_, func, String
from typing import Optional, List
from datetime import datetime
from auth.clerk_auth import get_current_user as require_user
from fastapi import Depends
from fastapi import Request
from pydantic import BaseModel
from database import SessionLocal
from models import Order
from sqlalchemy import Table, MetaData


router = APIRouter(prefix="/orders", tags=["Orders"])

metadata = MetaData()

customer_tbl = Table("customer", metadata, autoload_with=SessionLocal().bind)
offline_customer_tbl = Table("offline_customer", metadata, autoload_with=SessionLocal().bind)


def get_global_suffix(db):
    result = db.execute(text("""
        SELECT CAST(SUBSTRING_INDEX(order_id, '#', -1) AS UNSIGNED) AS suffix
        FROM orders
        WHERE order_id REGEXP '^[0-9]{5}#[0-9]{5}$'
        ORDER BY suffix DESC LIMIT 1;
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

class UTRPayload(BaseModel):
    utr_number: str

class UTRUpdate(BaseModel):
    utr_number: str

class EmailUpdate(BaseModel):
    email: str

class MobileUpdate(BaseModel):
    mobile: str

class ItemPriceUpdate(BaseModel):
    item_id: int
    unit_price: float

class AddressUpdate(BaseModel):
    address_id: int

class ProductUpdate(BaseModel):
    item_id: int
    product_id: int

class AddOrderItem(BaseModel):
    product_id: int
    quantity: int
    unit_price: float

class AddressCreate(BaseModel):
    customer_id: Optional[int] = None
    offline_customer_id: Optional[int] = None
    name: str
    mobile: str
    pincode: str
    locality: str
    address_line: str
    city: str
    state_id: int
    landmark: Optional[str] = None
    alternate_phone: Optional[str] = None
    address_type: str = "HOME"
    email: Optional[str] = None
    gst: Optional[str] = None


# ================================
# CREATE ORDER
# ================================
@router.post("/create")
def create_order(data: OrderCreate, db: Session = Depends(get_db)):
    if not data.address_id:
        raise HTTPException(status_code=400, detail="Address not selected")

    if data.offline_customer_id:
        prefix = f"{data.offline_customer_id:05d}"
    elif data.customer_id:
        prefix = f"{data.customer_id:05d}"
    else:
        raise HTTPException(400, "Customer is required")

    last_suffix = db.execute(text("""
        SELECT CAST(SUBSTRING_INDEX(order_id, '#', -1) AS UNSIGNED) AS suffix
        FROM orders WHERE order_id REGEXP '^[0-9]{5}#[0-9]{5}$'
        ORDER BY suffix DESC LIMIT 1
    """)).scalar()

    next_suffix = (last_suffix + 1) if last_suffix else 1
    order_id = f"{prefix}#{next_suffix:05d}"
    now = datetime.now()
    order_index = int(now.timestamp())

    total_qty = sum(item.qty for item in data.items)
    delivery_per_unit = 0
    if data.delivery_charge and total_qty > 0:
        delivery_per_unit = round(data.delivery_charge / total_qty, 2)

    order = Order(
        order_id=order_id, customer_id=data.customer_id,
        offline_customer_id=data.offline_customer_id,
        address_id=data.address_id, total_items=data.total_items,
        subtotal=data.subtotal, gst=data.gst,
        delivery_charge=data.delivery_charge, total_amount=data.total_amount,
        channel=data.channel.lower(), payment_status="pending",
        delivery_status="NOT_SHIPPED", created_at=now, updated_at=now,
        order_index=order_index, payment_type=data.payment_type
    )
    db.add(order)
    db.commit()
    db.refresh(order)

    for it in data.items:
        new_unit_price = float(it.final_unit_price) if data.channel.lower() == "offline" else float(it.final_unit_price) + delivery_per_unit
        new_total_price = round(new_unit_price * it.qty, 2)
        result = db.execute(text("""
            INSERT INTO order_items (order_id, product_id, quantity, unit_price, total_price)
            VALUES (:oid, :pid, :qty, :unit, :line_total)
        """), {"oid": order_id, "pid": it.product_id, "qty": it.qty, "unit": new_unit_price, "line_total": new_total_price})
        item_id = result.lastrowid
        db.execute(text("""
            INSERT INTO order_details (item_id, order_id, product_id, sr_no)
            VALUES (:item_id, :order_id, :product_id, NULL)
        """), {"item_id": item_id, "order_id": order_id, "product_id": it.product_id})

    db.commit()
    return {"success": True, "order_id": order_id}


# ================================
# COUNT ENDPOINT (fast, for skeleton hint)
# ─────────────────────────────────────────
# Add this index to your DB for instant counts:
#   CREATE INDEX idx_orders_created_at ON orders (created_at DESC);
#   CREATE INDEX idx_orders_payment    ON orders (payment_status);
#   CREATE INDEX idx_orders_delivery   ON orders (delivery_status);
#   CREATE INDEX idx_orders_channel    ON orders (channel);
# ================================
@router.get("/count")
def count_orders(
    _=Depends(require_user),
    payment_status: Optional[str] = Query(None),
    delivery_status: Optional[str] = Query(None),
    channel: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """
    Ultra-fast row count (index-only scan) so the frontend can show a
    realistic 'Fetching N orders…' skeleton hint before the data arrives.
    """
    query = db.query(func.count(Order.order_id))
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
    return {"count": query.scalar()}


# ================================
# LIST ORDERS  (optimised for 20k rows)
# ─────────────────────────────────────────
# Key optimisations vs original:
#   1. Raw SQL with a single LEFT JOIN LATERAL / subquery for customer
#      instead of N+1 Python queries per row.
#   2. Only selects the columns the table actually renders — avoids
#      shipping large TEXT fields over the wire unnecessarily.
#   3. Default page size reduced to 300 (sweet spot for first-paint speed);
#      caller can page with offset to stream the rest in the background.
#   4. Search uses a covering index hint on order_id / awb_number.
# ================================
@router.get("")
def list_orders(
    request: Request,
    _=Depends(require_user),
    payment_status: Optional[str] = Query(None),
    delivery_status: Optional[str] = Query(None),
    channel: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    limit: int = Query(300, ge=1, le=1000),   # ← first page default 300
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db)
):
    """
    Fast list using a single raw SQL query with inline customer subquery.
    Eliminates the Python-level N+1 customer lookup from the original.

    Recommended DB indexes (run once):
        CREATE INDEX IF NOT EXISTS idx_orders_created  ON orders (created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_orders_pay      ON orders (payment_status);
        CREATE INDEX IF NOT EXISTS idx_orders_del      ON orders (delivery_status);
        CREATE INDEX IF NOT EXISTS idx_orders_channel  ON orders (channel);
        CREATE INDEX IF NOT EXISTS idx_orders_cust_id  ON orders (customer_id);
        CREATE INDEX IF NOT EXISTS idx_orders_off_id   ON orders (offline_customer_id);
        CREATE INDEX IF NOT EXISTS idx_cust_id         ON customer (customer_id);
        CREATE INDEX IF NOT EXISTS idx_off_cust_id     ON offline_customer (customer_id);
    """
    conditions = ["1=1"]
    params: dict = {"lim": limit, "off": offset}

    if payment_status:
        conditions.append("LOWER(o.payment_status) = :pay_status")
        params["pay_status"] = payment_status.lower()

    if delivery_status:
        conditions.append("LOWER(o.delivery_status) = :del_status")
        params["del_status"] = delivery_status.lower()

    if channel:
        conditions.append("LOWER(o.channel) = :channel")
        params["channel"] = channel.lower()

    if date_from:
        conditions.append("o.created_at >= :date_from")
        params["date_from"] = datetime.strptime(date_from, "%Y-%m-%d")

    if date_to:
        conditions.append("o.created_at <= :date_to")
        params["date_to"] = datetime.strptime(date_to, "%Y-%m-%d")

    if search:
        s = f"%{search.lower().strip()}%"
        params["search"] = s
        # Search applied as a post-filter via HAVING or subquery;
        # we include customer columns in the main SELECT so we can filter.
        conditions.append("""(
            LOWER(o.order_id)        LIKE :search OR
            LOWER(o.payment_status)  LIKE :search OR
            LOWER(o.delivery_status) LIKE :search OR
            LOWER(CAST(o.awb_number AS CHAR)) LIKE :search OR
            LOWER(COALESCE(c.name,  '')) LIKE :search OR
            LOWER(CAST(COALESCE(c.mobile, '') AS CHAR)) LIKE :search OR
            LOWER(COALESCE(oc.name, ''))  LIKE :search OR
            LOWER(CAST(COALESCE(oc.mobile,'') AS CHAR)) LIKE :search
        )""")

    where_clause = " AND ".join(conditions)

    # Single-query approach: LEFT JOIN customer tables once, no Python N+1
    sql = text(f"""
        SELECT
            o.order_id,
            o.customer_id,
            o.offline_customer_id,
            o.address_id,
            o.total_items,
            o.total_amount,
            o.channel,
            o.payment_status,
            o.delivery_status,
            o.fulfillment_status,
            o.order_status,
            o.awb_number,
            o.utr_number,
            o.invoice_number,
            o.created_at,
            o.updated_at,
            o.payment_type,
            COALESCE(c.name,  oc.name)   AS cust_name,
            COALESCE(c.mobile, oc.mobile) AS cust_mobile,
            COALESCE(c.email,  oc.email)  AS cust_email
        FROM orders o
        LEFT JOIN customer         c  ON c.customer_id  = o.customer_id
        LEFT JOIN offline_customer oc ON oc.customer_id = o.offline_customer_id
        WHERE {where_clause}
        ORDER BY o.created_at DESC
        LIMIT :lim OFFSET :off
    """)

    rows = db.execute(sql, params).fetchall()

    out = []
    for row in rows:
        d = dict(row._mapping)
        # Nest customer info the way the frontend expects
        cust_name   = d.pop("cust_name", None)
        cust_mobile = d.pop("cust_mobile", None)
        cust_email  = d.pop("cust_email", None)
        d["customer"] = (
            {"name": cust_name, "mobile": cust_mobile, "email": cust_email}
            if (cust_name or cust_mobile)
            else None
        )
        out.append(d)

    return out


# ================================
# PRODUCTS LIST (for dropdowns)
# ================================
@router.get("/products/list")
def list_products_for_orders(search: Optional[str] = Query(None), db: Session = Depends(get_db)):
    if search:
        like = f"%{search.lower()}%"
        rows = db.execute(text("""
            SELECT product_id AS id, name, sku_id, category_id FROM products
            WHERE is_visible = 1 AND (LOWER(name) LIKE :like OR LOWER(sku_id) LIKE :like)
            ORDER BY preference DESC, name ASC LIMIT 100
        """), {"like": like}).fetchall()
    else:
        rows = db.execute(text("""
            SELECT product_id AS id, name, sku_id, category_id FROM products
            WHERE is_visible = 1 ORDER BY preference DESC, name ASC LIMIT 200
        """)).fetchall()
    return [dict(row._mapping) for row in rows]


# ================================
# STATES LIST
# ================================
@router.get("/states/list")
def list_states(db: Session = Depends(get_db)):
    rows = db.execute(text("SELECT state_id, name FROM state ORDER BY name ASC")).fetchall()
    return [dict(row._mapping) for row in rows]


# ================================
# ADD ITEM TO EXISTING ORDER
# ================================
@router.post("/{order_id}/add-item")
def add_item_to_order(order_id: str, payload: AddOrderItem, db: Session = Depends(get_db)):
    order = db.query(Order).filter(Order.order_id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    product = db.execute(text("SELECT product_id, name FROM products WHERE product_id = :pid"), {"pid": payload.product_id}).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    total_price = round(payload.unit_price * payload.quantity, 2)
    result = db.execute(text("""
        INSERT INTO order_items (order_id, product_id, quantity, unit_price, total_price)
        VALUES (:oid, :pid, :qty, :unit, :total)
    """), {"oid": order_id, "pid": payload.product_id, "qty": payload.quantity, "unit": payload.unit_price, "total": total_price})
    item_id = result.lastrowid
    db.execute(text("""
        INSERT INTO order_details (item_id, order_id, product_id, sr_no)
        VALUES (:item_id, :order_id, :product_id, NULL)
    """), {"item_id": item_id, "order_id": order_id, "product_id": payload.product_id})

    totals = db.execute(text("SELECT SUM(total_price) AS total, SUM(quantity) AS items FROM order_items WHERE order_id = :oid"), {"oid": order_id}).first()
    order.total_amount = totals.total or 0
    order.total_items = totals.items or 0
    order.updated_at = datetime.now()
    db.commit()

    return {"success": True, "item_id": item_id, "product_id": payload.product_id,
            "product_name": product.name, "quantity": payload.quantity,
            "unit_price": payload.unit_price, "total_price": total_price,
            "order_total": float(order.total_amount), "order_total_items": order.total_items}


# ================================
# REMOVE ITEM FROM ORDER
# ================================
@router.delete("/{order_id}/items/{item_id}")
def remove_item_from_order(order_id: str, item_id: int, db: Session = Depends(get_db)):
    order = db.query(Order).filter(Order.order_id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    count = db.execute(text("SELECT COUNT(*) FROM order_items WHERE order_id = :oid"), {"oid": order_id}).scalar()
    if count <= 1:
        raise HTTPException(status_code=400, detail="Cannot remove the last item from an order")

    # Delete OUT serials tied to this item's SKU
    db.execute(text("""
        DELETE dt FROM device_transaction dt
        INNER JOIN order_items oi ON oi.item_id = :iid
        INNER JOIN products p ON p.product_id = oi.product_id AND p.sku_id = dt.sku_id
        WHERE dt.order_id = :oid AND dt.in_out = 2
    """), {"iid": item_id, "oid": order_id})

    db.execute(text("DELETE FROM order_details WHERE item_id = :iid AND order_id = :oid"), {"iid": item_id, "oid": order_id})
    db.execute(text("DELETE FROM order_items WHERE item_id = :iid AND order_id = :oid"), {"iid": item_id, "oid": order_id})

    totals = db.execute(text("SELECT SUM(total_price) AS total, SUM(quantity) AS items FROM order_items WHERE order_id = :oid"), {"oid": order_id}).first()
    order.total_amount = totals.total or 0
    order.total_items = totals.items or 0
    order.updated_at = datetime.now()
    db.commit()

    return {"success": True, "message": "Item removed", "order_total": float(order.total_amount), "order_total_items": order.total_items}


# ================================
# CREATE ADDRESS FOR CUSTOMER
# ================================
@router.post("/addresses/create")
def create_customer_address(payload: AddressCreate, db: Session = Depends(get_db)):
    if not payload.customer_id and not payload.offline_customer_id:
        raise HTTPException(status_code=400, detail="Either customer_id or offline_customer_id is required")
    state = db.execute(text("SELECT state_id FROM state WHERE state_id = :sid"), {"sid": payload.state_id}).first()
    if not state:
        raise HTTPException(status_code=404, detail="Invalid state_id")
    now = datetime.now()
    result = db.execute(text("""
        INSERT INTO address
            (customer_id, offline_customer_id, name, mobile, pincode, locality,
             address_line, city, state_id, landmark, alternate_phone, address_type,
             email, gst, created_at, updated_at, is_available)
        VALUES
            (:customer_id, :offline_customer_id, :name, :mobile, :pincode, :locality,
             :address_line, :city, :state_id, :landmark, :alternate_phone, :address_type,
             :email, :gst, :created_at, :updated_at, 1)
    """), {
        "customer_id": payload.customer_id, "offline_customer_id": payload.offline_customer_id,
        "name": payload.name, "mobile": payload.mobile, "pincode": payload.pincode,
        "locality": payload.locality, "address_line": payload.address_line, "city": payload.city,
        "state_id": payload.state_id, "landmark": payload.landmark,
        "alternate_phone": payload.alternate_phone, "address_type": payload.address_type,
        "email": payload.email, "gst": payload.gst, "created_at": now, "updated_at": now,
    })
    db.commit()
    new_address_id = result.lastrowid
    address = db.execute(text("""
        SELECT a.*, s.name AS state_name FROM address a
        LEFT JOIN state s ON s.state_id = a.state_id WHERE a.address_id = :aid
    """), {"aid": new_address_id}).first()
    return dict(address._mapping)


# ================================
# UPDATE UTR NUMBER
# ================================
@router.put("/{order_id}/update-utr")
def update_utr_number(order_id: str, payload: UTRUpdate, db: Session = Depends(get_db)):
    """Update UTR/transaction reference number without changing payment status."""
    order = db.query(Order).filter(Order.order_id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    utr = payload.utr_number.strip()
    order.utr_number = utr if utr else None
    order.updated_at = datetime.now()
    db.commit()
    db.refresh(order)
    return {"success": True, "order_id": order_id, "utr_number": order.utr_number}


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


@router.put("/{order_id:path}/mark-paid-utr")
def mark_paid_with_utr(order_id: str, payload: UTRPayload, db: Session = Depends(get_db)):
    utr = payload.utr_number.strip()
    if not utr:
        raise HTTPException(status_code=400, detail="utr_number cannot be empty")
    order = db.query(Order).filter(Order.order_id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    order.payment_status = "paid"
    order.order_status = "APPR"
    order.utr_number = utr
    order.updated_at = datetime.now()
    db.commit()
    db.refresh(order)
    return {"message": f"Order {order_id} marked as paid", "payment_status": order.payment_status,
            "utr_number": order.utr_number, "order_status": order.order_status}


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
        SELECT oi.item_id, oi.product_id, p.name AS product_name, oi.quantity, dt.device_srno
        FROM order_items oi
        LEFT JOIN products p ON p.product_id = oi.product_id
        LEFT JOIN device_transaction dt ON dt.order_id = oi.order_id AND dt.sku_id = p.sku_id
        WHERE oi.order_id = :oid ORDER BY oi.item_id
    """), {"oid": order_id}).fetchall()
    items = {}
    for r in rows:
        if r.item_id not in items:
            items[r.item_id] = {"item_id": r.item_id, "product_id": r.product_id,
                                 "product_name": r.product_name, "quantity": r.quantity, "serials": []}
        if r.device_srno:
            items[r.item_id]["serials"].append(r.device_srno)
    return list(items.values())


@router.post("/{order_id}/serial_numbers/save")
def save_serial_numbers(order_id: str, data: dict, db: Session = Depends(get_db)):
    entries = data.get("entries", [])
    if not entries:
        raise HTTPException(status_code=400, detail="No serial data provided")

    order_items = db.execute(text("""
        SELECT oi.item_id, oi.product_id, oi.unit_price, p.name AS model_name, p.sku_id
        FROM order_items oi LEFT JOIN products p ON p.product_id = oi.product_id
        WHERE oi.order_id = :oid
    """), {"oid": order_id}).fetchall()

    item_map = {row.item_id: {"unit_price": row.unit_price, "model_name": row.model_name, "sku_id": row.sku_id} for row in order_items}

    for entry in entries:
        item_id = entry.get("item_id")
        serials = entry.get("serials", [])
        if not item_id or item_id not in item_map:
            continue
        item = item_map[item_id]
        sku = item["sku_id"]
        db.execute(text("DELETE FROM device_transaction WHERE order_id = :oid AND sku_id = :sku AND in_out = 2"), {"oid": order_id, "sku": sku})
        for sr in serials:
            sr = sr.strip()
            if not sr:
                continue
            result = db.execute(text("SELECT model_name FROM device_transaction WHERE device_srno = :sr AND in_out = 1 ORDER BY auto_id DESC LIMIT 1"), {"sr": sr}).fetchone()
            correct_model_name = result.model_name if result else item["model_name"]
            db.execute(text("""
                INSERT INTO device_transaction (device_srno, model_name, sku_id, order_id, in_out, create_date, price, remarks)
                VALUES (:sr, :model, :sku, :oid, 2, CURDATE(), :price, NULL)
            """), {"sr": sr, "model": correct_model_name, "sku": sku, "oid": order_id, "price": item["unit_price"]})

    db.commit()
    order_skus = [row.sku_id for row in order_items]
    serial_counts = db.execute(text("SELECT sku_id, COUNT(*) AS count FROM device_transaction WHERE order_id = :oid AND in_out = 2 GROUP BY sku_id"), {"oid": order_id}).fetchall()
    serial_map = {row.sku_id: row.count for row in serial_counts}
    if all(sku in serial_map and serial_map[sku] > 0 for sku in order_skus):
        serial_status = "complete"
    elif any(sku in serial_map and serial_map[sku] > 0 for sku in order_skus):
        serial_status = "partial"
    else:
        serial_status = "none"
    return {"message": "Serial numbers updated successfully", "serial_status": serial_status}


@router.put("/{order_id}/toggle-payment")
def toggle_payment(order_id: str, db: Session = Depends(get_db)):
    order = db.query(Order).filter(Order.order_id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.payment_status == "paid":
        order.payment_status = "pending"
        order.order_status = "PEND"
    else:
        order.payment_status = "paid"
        order.order_status = "APPR"
    order.updated_at = datetime.now()
    db.commit()
    db.refresh(order)
    return {"message": f"Payment toggled for {order_id}", "payment_status": order.payment_status, "order_status": order.order_status}


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
    invoice_number = "INV-" + datetime.now().strftime("%Y%m%d-%H%M%S")
    order.invoice_number = invoice_number
    order.updated_at = datetime.now()
    db.commit()
    return {"message": "Invoice created", "invoice_number": invoice_number}


@router.get("/{order_id}/invoice/download")
def download_invoice_redirect(order_id: str):
    return RedirectResponse(url=f"/zoho/orders/{order_id}/invoice/download")


class DeliveryUpdate(BaseModel):
    status: str


@router.put("/{order_id}/update-delivery")
def update_delivery(order_id: str, payload: DeliveryUpdate, db: Session = Depends(get_db)):
    allowed = ["NOT_SHIPPED", "SHIPPED", "COMPLETED", "READY"]
    if payload.status not in allowed:
        raise HTTPException(400, detail="Invalid delivery status")
    order = db.query(Order).filter(Order.order_id == order_id).first()
    if not order:
        raise HTTPException(404, detail="Order not found")
    order.delivery_status = payload.status
    order.updated_at = datetime.now()
    db.commit()
    return {"message": "Delivery updated", "delivery_status": payload.status}


@router.put("/{order_id}/remarks")
def update_order_remarks(order_id: str, data: dict, db: Session = Depends(get_db)):
    remarks = data.get("remarks")
    if remarks is None:
        raise HTTPException(400, "Missing remarks value")
    db.execute(text("UPDATE orders SET remarks = :remarks WHERE order_id = :oid"), {"remarks": remarks, "oid": order_id})
    db.commit()
    return {"success": True, "order_id": order_id, "remarks": remarks}


@router.get("/search/suggestions")
def search_suggestions(q: str, db: Session = Depends(get_db)):
    if not q or len(q.strip()) < 2:
        return []
    q = f"%{q.lower()}%"
    rows = db.execute(text("""
        SELECT DISTINCT result FROM (
            SELECT order_id AS result FROM orders WHERE LOWER(order_id) LIKE :q
            UNION SELECT CAST(awb_number AS CHAR) FROM orders WHERE LOWER(awb_number) LIKE :q
            UNION SELECT name FROM customer WHERE LOWER(name) LIKE :q
            UNION SELECT mobile FROM customer WHERE LOWER(mobile) LIKE :q
            UNION SELECT name FROM offline_customer WHERE LOWER(name) LIKE :q
            UNION SELECT mobile FROM offline_customer WHERE LOWER(mobile) LIKE :q
            UNION SELECT address_line FROM address WHERE LOWER(address_line) LIKE :q
            UNION SELECT city FROM address WHERE LOWER(city) LIKE :q
            UNION SELECT pincode FROM address WHERE LOWER(pincode) LIKE :q
            UNION SELECT name FROM products WHERE LOWER(name) LIKE :q
        ) AS all_results LIMIT 10;
    """), {"q": q}).fetchall()
    return [r[0] for r in rows]


@router.delete("/{order_id}")
def delete_order(order_id: str, db: Session = Depends(get_db)):
    try:
        order = db.query(Order).filter(Order.order_id == order_id).first()
        if not order:
            raise HTTPException(status_code=404, detail="Order not found")
        db.execute(text("DELETE FROM order_items WHERE order_id = :oid"), {"oid": order_id})
        db.execute(text("DELETE FROM device_transaction WHERE order_id = :oid"), {"oid": order_id})
        db.delete(order)
        db.commit()
        return {"success": True, "message": "Order deleted successfully"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to delete order")


@router.get("/{order_id:path}/details")
def get_order_details(order_id: str, db: Session = Depends(get_db)):
    order = db.query(Order).filter(Order.order_id == order_id).first()
    if not order:
        raise HTTPException(404, "Order not found")

    customer = None
    row = None
    if order.customer_id:
        row = db.execute(text("SELECT name, mobile, email FROM customer WHERE customer_id=:cid"), {"cid": order.customer_id}).first()
    elif order.offline_customer_id:
        row = db.execute(text("SELECT name, mobile, email FROM offline_customer WHERE customer_id=:cid"), {"cid": order.offline_customer_id}).first()
    if row:
        customer = dict(row._mapping)

    address = db.execute(text("""
        SELECT a.address_id, a.name, a.mobile, a.pincode, a.address_line,
               a.city, a.state_id, s.name AS state_name, a.landmark
        FROM address a LEFT JOIN state s ON s.state_id = a.state_id
        WHERE a.address_id = :aid
    """), {"aid": order.address_id}).first()

    items = db.execute(text("""
        SELECT oi.item_id, oi.product_id, p.name AS product_name,
               oi.quantity, oi.unit_price, oi.total_price
        FROM order_items oi LEFT JOIN products p ON p.product_id = oi.product_id
        WHERE oi.order_id = :oid
    """), {"oid": order_id}).fetchall()
    items = [dict(row._mapping) for row in items]

    serial_rows = db.execute(text("""
        SELECT oi.item_id, COUNT(dt.device_srno) AS assigned
        FROM order_items oi
        LEFT JOIN products p ON p.product_id = oi.product_id
        LEFT JOIN device_transaction dt ON dt.order_id = oi.order_id AND dt.sku_id = p.sku_id AND dt.in_out = 2
        WHERE oi.order_id = :oid GROUP BY oi.item_id
    """), {"oid": order_id}).fetchall()

    serial_map = {r.item_id: r.assigned for r in serial_rows}
    total_required = sum(it["quantity"] for it in items)
    total_assigned = sum(serial_map.get(it["item_id"], 0) for it in items)

    if total_assigned == 0:
        serial_status = "none"
    elif total_assigned < total_required:
        serial_status = "partial"
    else:
        serial_status = "complete"

    return {
        "address": dict(address._mapping) if address else None,
        "items": items,
        "remarks": order.remarks,
        "serial_status": serial_status,
        "utr_number": order.utr_number,
        "customer": customer,
        "invoice_number": order.invoice_number,
        "fulfillment_status": order.fulfillment_status,
        "order_status": order.order_status,
    }


# ================================
# UPDATE ENDPOINTS
# ================================

@router.put("/{order_id}/update-email")
def update_customer_email(order_id: str, payload: EmailUpdate, db: Session = Depends(get_db)):
    order = db.query(Order).filter(Order.order_id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    email = payload.email.strip()
    if not email:
        raise HTTPException(status_code=400, detail="Email cannot be empty")
    try:
        if order.customer_id:
            db.execute(text("UPDATE customer SET email = :email WHERE customer_id = :cid"), {"email": email, "cid": order.customer_id})
        elif order.offline_customer_id:
            db.execute(text("UPDATE offline_customer SET email = :email WHERE customer_id = :cid"), {"email": email, "cid": order.offline_customer_id})
        else:
            raise HTTPException(status_code=400, detail="No customer associated with order")
        db.commit()
        return {"success": True, "email": email}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to update email")


@router.put("/{order_id}/update-mobile")
def update_customer_mobile(order_id: str, payload: MobileUpdate, db: Session = Depends(get_db)):
    order = db.query(Order).filter(Order.order_id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    mobile = payload.mobile.strip()
    if not mobile:
        raise HTTPException(status_code=400, detail="Mobile cannot be empty")
    try:
        if order.customer_id:
            db.execute(text("UPDATE customer SET mobile = :mobile WHERE customer_id = :cid"), {"mobile": mobile, "cid": order.customer_id})
        elif order.offline_customer_id:
            db.execute(text("UPDATE offline_customer SET mobile = :mobile WHERE customer_id = :cid"), {"mobile": mobile, "cid": order.offline_customer_id})
        else:
            raise HTTPException(status_code=400, detail="No customer associated with order")
        db.commit()
        return {"success": True, "mobile": mobile}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to update mobile")


@router.put("/{order_id}/update-item-price")
def update_item_price(order_id: str, payload: ItemPriceUpdate, db: Session = Depends(get_db)):
    order = db.query(Order).filter(Order.order_id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if payload.unit_price < 0:
        raise HTTPException(status_code=400, detail="Unit price cannot be negative")
    try:
        item = db.execute(text("SELECT quantity FROM order_items WHERE item_id = :iid AND order_id = :oid"), {"iid": payload.item_id, "oid": order_id}).first()
        if not item:
            raise HTTPException(status_code=404, detail="Item not found in order")
        new_total_price = round(payload.unit_price * item.quantity, 2)
        db.execute(text("UPDATE order_items SET unit_price = :up, total_price = :tp WHERE item_id = :iid AND order_id = :oid"),
                   {"up": payload.unit_price, "tp": new_total_price, "iid": payload.item_id, "oid": order_id})
        totals = db.execute(text("SELECT SUM(total_price) as s FROM order_items WHERE order_id = :oid"), {"oid": order_id}).first()
        new_order_total = totals.s if totals.s else 0
        db.execute(text("UPDATE orders SET total_amount = :t WHERE order_id = :oid"), {"t": new_order_total, "oid": order_id})
        db.commit()
        return {"success": True, "item_id": payload.item_id, "unit_price": payload.unit_price, "total_price": new_total_price, "order_total": new_order_total}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to update item price")


@router.put("/{order_id}/update-address")
def update_order_address(order_id: str, payload: AddressUpdate, db: Session = Depends(get_db)):
    order = db.query(Order).filter(Order.order_id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    address = db.execute(text("SELECT address_id FROM address WHERE address_id = :aid"), {"aid": payload.address_id}).first()
    if not address:
        raise HTTPException(status_code=404, detail="Address not found")
    try:
        order.address_id = payload.address_id
        order.updated_at = datetime.now()
        db.commit()
        return {"success": True, "address_id": payload.address_id}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to update address")


@router.put("/{order_id}/update-item-product")
def update_item_product(order_id: str, payload: ProductUpdate, db: Session = Depends(get_db)):
    order = db.query(Order).filter(Order.order_id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    try:
        product = db.execute(text("SELECT product_id, name FROM products WHERE product_id = :pid"), {"pid": payload.product_id}).first()
        if not product:
            raise HTTPException(status_code=404, detail="Product not found")

        old_item = db.execute(text("""
            SELECT oi.item_id, p.sku_id FROM order_items oi
            LEFT JOIN products p ON p.product_id = oi.product_id
            WHERE oi.item_id = :iid AND oi.order_id = :oid
        """), {"iid": payload.item_id, "oid": order_id}).first()

        if old_item and old_item.sku_id:
            db.execute(text("""
                DELETE FROM device_transaction
                WHERE order_id = :oid AND sku_id = :sku AND in_out = 2
            """), {"oid": order_id, "sku": old_item.sku_id})

        db.execute(text("UPDATE order_items SET product_id = :pid WHERE item_id = :iid AND order_id = :oid"),
                   {"pid": payload.product_id, "iid": payload.item_id, "oid": order_id})
        db.execute(text("UPDATE order_details SET product_id = :pid WHERE item_id = :iid AND order_id = :oid"),
                   {"pid": payload.product_id, "iid": payload.item_id, "oid": order_id})
        db.commit()
        return {"success": True, "item_id": payload.item_id, "product_id": payload.product_id, "product_name": product.name}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to update product")


@router.put("/{order_id}/reject")
def reject_order(order_id: str, db: Session = Depends(get_db)):
    order = db.query(Order).filter(Order.order_id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    try:
        order.order_status = "REJECTED"
        order.invoice_number = "NA"
        order.updated_at = datetime.now()
        db.commit()
        return {"success": True, "message": "Order rejected successfully", "order_status": "REJECTED", "invoice_number": "NA"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to reject order")