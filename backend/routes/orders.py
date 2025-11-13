from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_, func, String
from typing import Optional
from datetime import datetime

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
    customer_id: Optional[int] = None,
    offline_customer_id: Optional[int] = None,
    address_id: int = 0,
    total_items: int = 0,
    subtotal: float = 0.0,
    channel: Optional[str] = "offline",
    payment_type: Optional[str] = "pending",
    gst: Optional[float] = 0.0,
    db: Session = Depends(get_db)
):
    """
    Create a new order in the MySQL database.
    """
    now = datetime.now()
    order = Order(
        order_id=f"{now.strftime('%H%M%S%d%m')}",
        customer_id=customer_id,
        offline_customer_id=offline_customer_id,
        address_id=address_id,
        total_items=total_items,
        subtotal=subtotal,
        total_amount=subtotal,
        channel=channel.lower() if channel else None,
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
    return {"message": "Order created successfully", "order_id": order.order_id}


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
    Retrieve all orders, with optional filters, flexible search (supports `field:value`),
    numeric amount exact match, and date range filtering.
    """
    query = db.query(Order)

    # 🧩 Field-based filters
    if payment_status:
        query = query.filter(func.lower(Order.payment_status) == payment_status.lower())
    if delivery_status:
        query = query.filter(func.lower(Order.delivery_status) == delivery_status.lower())
    if channel:
        query = query.filter(func.lower(Order.channel) == channel.lower())

    # 🧩 Date range filters (created_at)
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

    # 🧩 Search filter: supports "field:value" or general search
    if search:
        s = search.strip()

        # Case: field:value pattern
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
            # General search (auto-detect numeric vs text)
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

    # 🧩 Sort by creation date descending
    results = query.order_by(Order.created_at.desc()).all()

    # Convert SQLAlchemy objects to plain dicts (drop internal state)
    out = []
    for r in results:
        d = {k: v for k, v in r.__dict__.items() if not k.startswith("_sa_instance_state")}
        out.append(d)

    return out


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
