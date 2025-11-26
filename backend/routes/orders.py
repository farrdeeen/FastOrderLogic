from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_, func, String
from typing import Optional
from datetime import datetime
from sqlalchemy import text, or_, func, String


from database import SessionLocal
from models import Order

router = APIRouter(prefix="/orders", tags=["Orders"])

# ---------- DB Dependency ----------
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ---------- ROUTES ----------

@router.post("/create")
def create_order(
    sku: Optional[str] = None,
    quantity: int = 1,
    customer_id: Optional[int] = None,
    offline_customer_id: Optional[int] = None,
    address_id: Optional[int] = None,
    total_items: int = 0,
    subtotal: float = 0.0,
    channel: Optional[str] = "offline",
    payment_type: Optional[str] = "pending",
    gst: Optional[float] = 0.0,
    db: Session = Depends(get_db)
):
    """
    Create a new order with address + offline customer + sku item support.
    """

    # 1️⃣ Create offline customer if none provided
    if customer_id is None and offline_customer_id is None:
        db.execute(text("""
            INSERT INTO offline_customer (name, mobile, email)
            VALUES ('Offline User', CONCAT('9', FLOOR(RAND()*1000000000)), 'na@example.com')
        """))
        offline_customer_id = db.execute(text("SELECT LAST_INSERT_ID()")).scalar()

    # 2️⃣ Create address if not provided
    if address_id is None:
        db.execute(text(f"""
            INSERT INTO address
            (customer_id, offline_customer_id, name, mobile, pincode, locality,
             address_line, city, state_id, landmark, address_type)
            VALUES
            (NULL, {offline_customer_id}, 'Offline User', '9999999999', '000000', 
             'NA', 'NA', 'NA_CITY', 1, NULL, 'offline')
        """))
        address_id = db.execute(text("SELECT LAST_INSERT_ID()")).scalar()

    # 3️⃣ Create Order Entry
    now = datetime.now()
    order_id = now.strftime("%H%M%S%d%m")

    order = Order(
        order_id=order_id,
        customer_id=customer_id,
        offline_customer_id=offline_customer_id,
        address_id=address_id,
        total_items=total_items,
        subtotal=subtotal,
        total_amount=subtotal,
        channel=channel.lower(),
        payment_status="pending",
        delivery_status="NOT_SHIPPED",
        created_at=now,
        updated_at=now,
        order_index=int(now.strftime("%H%M%S%d")),
        payment_type=payment_type,
        gst=gst,
    )

    db.add(order)
    db.commit()
    db.refresh(order)

    # 4️⃣ Insert order item if sku provided
    if sku:
        product = db.execute(text("""
            SELECT product_id FROM products WHERE sku_id = :s
        """), {"s": sku}).fetchone()

        if product:
            pid = product[0]
        else:
            pid = None  # No match — treat as unknown

        db.execute(text("""
            INSERT INTO order_items
            (order_id, product_id, quantity, unit_price, total_price)
            VALUES (:oid, :pid, :qty, :price, :total)
        """), {
            "oid": order_id,
            "pid": pid,
            "qty": quantity,
            "price": subtotal,
            "total": subtotal
        })
        db.commit()

    return {"message": "Order created", "order_id": order_id}






@router.get("/")
def list_orders(
    payment_status: Optional[str] = Query(None),
    delivery_status: Optional[str] = Query(None),
    channel: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None, description="Start date in YYYY-MM-DD format"),
    date_to: Optional[str] = Query(None, description="End date in YYYY-MM-DD format"),
    db: Session = Depends(get_db)
):
    """
    Retrieve orders with optional filters. Each returned order includes:
    - customer: { name, mobile, email, offline: bool }
    - address: { address_line, city, pincode, state_id, name, mobile }
    - items: [{ item_id, sku, product_id, product_name, model_id, color_id, quantity, unit_price, total_price }]
    """
    query = db.query(Order)

    # Field-based filters (case-insensitive)
    if payment_status:
        query = query.filter(func.lower(Order.payment_status) == payment_status.lower())
    if delivery_status:
        query = query.filter(func.lower(Order.delivery_status) == delivery_status.lower())
    if channel:
        query = query.filter(func.lower(Order.channel) == channel.lower())

    # Date range
    if date_from:
        try:
            start_date = datetime.strptime(date_from, "%Y-%m-%d")
            query = query.filter(Order.created_at >= start_date)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date_from format. Use YYYY-MM-DD.")
    if date_to:
        try:
            end_date = datetime.strptime(date_to, "%Y-%m-%d")
            query = query.filter(Order.created_at <= end_date)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date_to format. Use YYYY-MM-DD.")

    # Search filter (supports field:value or general)
    if search:
        s = search.strip()
        if ":" in s:
            field, value = s.split(":", 1)
            field, value = field.lower().strip(), value.strip()
            if field == "total_amount":
                try:
                    query = query.filter(Order.total_amount == float(value))
                except ValueError:
                    raise HTTPException(status_code=400, detail="Invalid number for total_amount")
            elif field == "order_id":
                query = query.filter(func.lower(Order.order_id) == value.lower())
            elif field in ["awb", "awb_number"]:
                query = query.filter(func.lower(func.coalesce(Order.awb_number, "")) == value.lower())
            else:
                like = f"%{value.lower()}%"
                query = query.filter(
                    or_(
                        func.lower(Order.order_id).like(like),
                        func.lower(Order.channel).like(like),
                        func.lower(Order.payment_status).like(like),
                        func.lower(Order.delivery_status).like(like),
                    )
                )
        else:
            if s.replace(".", "", 1).isdigit():
                query = query.filter(Order.total_amount == float(s))
            else:
                like = f"%{s.lower()}%"
                query = query.filter(
                    or_(
                        func.lower(Order.order_id).like(like),
                        func.lower(Order.channel).like(like),
                        func.lower(Order.payment_status).like(like),
                        func.lower(Order.delivery_status).like(like),
                        func.cast(Order.awb_number, String).like(like),
                    )
                )

    # Get orders
    results = query.order_by(Order.created_at.desc()).all()

    orders_out = []

    # For each order, fetch customer/offline_customer, address, and items
    for o in results:
        # base order dict
        base = {k: v for k, v in o.__dict__.items() if not k.startswith("_sa_instance_state")}

        # --- Customer (prefer customer table, fallback offline_customer) ---
        customer = None
        if base.get("customer_id"):
            r = db.execute(text("SELECT customer_id, name, mobile, email FROM customer WHERE customer_id = :cid"),
                           {"cid": base["customer_id"]}).first()
            if r:
                customer = dict(r._mapping)
                customer["offline"] = False
        elif base.get("offline_customer_id"):
            r = db.execute(text("SELECT customer_id AS offline_id, name, mobile, email FROM offline_customer WHERE customer_id = :cid"),
                           {"cid": base["offline_customer_id"]}).first()
            if r:
                # normalize keys
                mapped = dict(r._mapping)
                customer = {
                    "customer_id": mapped.get("offline_id"),
                    "name": mapped.get("name"),
                    "mobile": mapped.get("mobile"),
                    "email": mapped.get("email"),
                    "offline": True
                }

        # --- Address ---
        address = None
        if base.get("address_id"):
            r = db.execute(text("""
                SELECT address_id, name, mobile, pincode, address_line, city, state_id, landmark
                FROM address WHERE address_id = :aid
            """), {"aid": base["address_id"]}).first()
            if r:
                address = dict(r._mapping)

        # --- Order items (with product name if available) ---
        items = []
        r_items = db.execute(text("""
            SELECT oi.item_id, oi.order_id, oi.product_id, p.name AS product_name,
                   oi.model_id, oi.color_id, oi.quantity, oi.unit_price, oi.total_price
            FROM order_items oi
            LEFT JOIN products p ON p.product_id = oi.product_id
            WHERE oi.order_id = :oid
        """), {"oid": base.get("order_id")}).fetchall()

        for row in r_items:
            m = dict(row._mapping)
            items.append({
                "item_id": m.get("item_id"),
                "product_id": m.get("product_id"),
                "product_name": m.get("product_name"),
                "model_id": m.get("model_id"),
                "color_id": m.get("color_id"),
                "quantity": int(m.get("quantity") or 0),
                "unit_price": float(m.get("unit_price") or 0),
                "total_price": float(m.get("total_price") or 0),
            })

        # Attach
        base["customer"] = customer
        base["address"] = address
        base["items"] = items

        orders_out.append(base)

    return orders_out


@router.put("/{order_id:path}/mark-paid")
def mark_as_paid(order_id: str, db: Session = Depends(get_db)):
    """
    Mark an order as paid.
    """
    order = db.query(Order).filter(Order.order_id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    order.payment_status = "paid"
    order.order_status = "APPR"
    order.updated_at = datetime.now()
    db.commit()
    db.refresh(order)
    return {"message": f"Order {order_id} marked as paid"}


@router.put("/{order_id:path}/mark-fulfilled")
def mark_as_fulfilled(order_id: str, db: Session = Depends(get_db)):
    """
    Mark an order as fulfilled (ready for dispatch).
    """
    order = db.query(Order).filter(Order.order_id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    order.fulfillment_status = 1
    order.delivery_status = "READY"
    order.updated_at = datetime.now()
    db.commit()
    db.refresh(order)
    return {"message": f"Order {order_id} marked as fulfilled"}


@router.put("/{order_id:path}/mark-delhivery")
def mark_as_delhivery(order_id: str, awb: Optional[str] = None, db: Session = Depends(get_db)):
    """
    Mark an order as shipped via Delhivery (assign AWB if available).
    """
    order = db.query(Order).filter(Order.order_id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    order.delivery_status = "SHIPPED"
    order.awb_number = awb or "To be assigned"
    order.updated_at = datetime.now()
    db.commit()
    db.refresh(order)
    return {"message": f"Order {order_id} marked as shipped", "awb": order.awb_number}


@router.put("/{order_id:path}/mark-invoiced")
def mark_as_invoiced(order_id: str, db: Session = Depends(get_db)):
    """
    Mark an order as invoiced and completed.
    """
    order = db.query(Order).filter(Order.order_id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    order.order_status = "COMPLETED"
    order.updated_at = datetime.now()
    db.commit()
    db.refresh(order)
    return {"message": f"Order {order_id} marked as invoiced"}
