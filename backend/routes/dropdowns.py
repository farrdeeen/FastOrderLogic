from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text
from database import get_db

router = APIRouter()

@router.get("/products/list")
def get_products(db: Session = Depends(get_db)):
    products = db.execute(text("SELECT product_id, name FROM products")).fetchall()
    return [{"id": p.product_id, "name": p.name} for p in products]


@router.get("/customers/list")
def get_customers(db: Session = Depends(get_db)):
    # Fetch online customers
    online = db.execute(text("""
        SELECT customer_id, name
        FROM customer
    """)).fetchall()

    # Fetch offline customers
    offline = db.execute(text("""
        SELECT customer_id, name
        FROM offline_customer
    """)).fetchall()

    # Format both with type identifier
    formatted_online = [
        {"id": c.customer_id, "name": c.name, "type": "online"}
        for c in online
    ]

    formatted_offline = [
        {"id": c.customer_id, "name": c.name, "type": "offline"}
        for c in offline
    ]

    # Merge results + return
    return formatted_online + formatted_offline

@router.get("/customers/details")
def get_customer_details(type: str, id: int, db: Session = Depends(get_db)):

    # ------------------------------
    # 1. Fetch Customer (Online/Offline)
    # ------------------------------
    if type == "online":
        customer = db.execute(text(f"""
            SELECT customer_id, name, mobile, email 
            FROM customer 
            WHERE customer_id = {id}
        """)).fetchone()
    else:
        customer = db.execute(text(f"""
            SELECT customer_id, name, mobile, email 
            FROM offline_customer 
            WHERE customer_id = {id}
        """)).fetchone()

    if not customer:
        return {"error": "Customer not found"}

    # ------------------------------
    # 2. Fetch Address (from address table)
    # ------------------------------
    address = db.execute(text(f"""
        SELECT address_id, address_line, city, pincode, state_id
        FROM address
        WHERE customer_id = {id}
        ORDER BY address_id DESC
        LIMIT 1
    """)).fetchone()

    if address:
        state = db.execute(text(f"SELECT name FROM state WHERE state_id = {address.state_id}")).fetchone()
        address_details = {
            "id": address.address_id,
            "address_line": address.address_line,
            "city": address.city,
            "pincode": address.pincode,
            "state_id": address.state_id,
            "state_name": state.name if state else None
        }
    else:
        address_details = None

    # ------------------------------
    # 3. Final Response
    # ------------------------------
    return {
        "id": customer.customer_id,
        "type": type,
        "name": customer.name,
        "mobile": customer.mobile,
        "email": customer.email,
        "address": address_details
    }

@router.get("/customers/{cust_type}/{cust_id}/addresses")
def get_customer_addresses(cust_type: str, cust_id: int, db: Session = Depends(get_db)):

    if cust_type == "online":
        query = """
            SELECT address_id, address_line, city, state_id, pincode
            FROM address
            WHERE customer_id = :cid
        """
    else:
        query = """
            SELECT address_id, address_line, city, state_id, pincode
            FROM address
            WHERE offline_customer_id = :cid
        """

    rows = db.execute(text(query), {"cid": cust_id}).fetchall()

    return [
        {
            "address_id": r.address_id,
            "label": f"{r.address_line}, {r.city}, {r.state_id} - {r.pincode}",
        }
        for r in rows
    ]
@router.get("/states/list")
def get_states(db: Session = Depends(get_db)):
    """
    Returns all Indian states for dropdown menus.
    """
    query = text("""
        SELECT state_id, name, abbreviation
        FROM state
        ORDER BY name ASC
    """)
    rows = db.execute(query).fetchall()

    return [
        {
            "state_id": row.state_id,
            "name": row.name,
            "abbreviation": row.abbreviation
        }
        for row in rows
    ]

@router.get("/dropdowns/products/get_price")
def get_product_price(product_id: int, db: Session = Depends(get_db)):
    # 1. Fetch product SKU
    product = db.execute(
        text("SELECT sku_id FROM products WHERE product_id = :pid"),
        {"pid": product_id}
    ).fetchone()

    if not product or not product.sku_id:
        return {"price": 0}

    sku = product.sku_id

    # 2. Fetch latest selling price from device_transaction
    row = db.execute(
        text("""
            SELECT price 
            FROM device_transaction
            WHERE sku_id = :sku AND in_out = 1
            ORDER BY create_date DESC 
            LIMIT 1
        """),
        {"sku": sku}
    ).fetchone()

    return {"price": float(row.price) if row and row.price else 0}

@router.get("/products/details")
def get_product_details(id: int, db: Session = Depends(get_db)):
    row = db.execute(text("""
        SELECT 
            p.product_id AS id,
            p.name,
            p.sku_id,
            COALESCE(h.gst_rate, 18) AS gst_percent
        FROM products p
        LEFT JOIN hsn h ON h.hsn_id = p.hsn_id
        WHERE p.product_id = :pid
    """), {"pid": id}).fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Product not found")

    return {
        "id": row.id,
        "name": row.name,
        "sku_id": row.sku_id,
        "gst_percent": float(row.gst_percent),
    }

