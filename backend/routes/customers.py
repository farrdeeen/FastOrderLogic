from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text
from datetime import datetime

from database import SessionLocal

router = APIRouter(prefix="/customers", tags=["Customers"])

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@router.post("/create")
def create_customer(data: dict, db: Session = Depends(get_db)):

    name = data.get("name")
    mobile = data.get("mobile")
    email = data.get("email")
    customer_type = data.get("customer_type", "online")

    if not name or not mobile:
        raise HTTPException(status_code=400, detail="Name and Mobile are required")

    # Wrap everything in a transaction
    try:
        # --------------------------------------
        # INSERT CUSTOMER
        # --------------------------------------
        if customer_type == "online":
            insert_customer_sql = text("""
                INSERT INTO customer (name, mobile, email)
                VALUES (:name, :mobile, :email)
            """)
        else:
            insert_customer_sql = text("""
                INSERT INTO offline_customer (name, mobile, email)
                VALUES (:name, :mobile, :email)
            """)

        customer_result = db.execute(insert_customer_sql, {
            "name": name,
            "mobile": mobile,
            "email": email
        })

        customer_id = customer_result.lastrowid

        # --------------------------------------
        # PREPARE ADDRESS FIELDS
        # --------------------------------------
        locality = data.get("locality", "")

        address_payload = {
            "cid": customer_id,
            "name": name,
            "mobile": mobile,
            "pincode": data.get("pincode"),
            "address_line": data.get("address_line"),
            "locality": locality,
            "city": data.get("city"),
            "state_id": data.get("state_id"),
            "landmark": data.get("landmark", ""),
            "alternate_phone": data.get("alternate_phone", ""),
            "address_type": data.get("address_type", "home"),
        }

        # --------------------------------------
        # INSERT ADDRESS
        # --------------------------------------
        insert_address_sql = text("""
            INSERT INTO address
            (customer_id, name, mobile, pincode, address_line, locality, city, state_id, landmark, alternate_phone, address_type)
            VALUES
            (:cid, :name, :mobile, :pincode, :address_line, :locality, :city, :state_id, :landmark, :alternate_phone, :address_type)
        """)

        address_result = db.execute(insert_address_sql, address_payload)

        # --------------------------------------
        # COMMIT *ONLY* IF EVERYTHING SUCCEEDED
        # --------------------------------------
        db.commit()

        return {
            "success": True,
            "customer_id": customer_id,
            "address_id": address_result.lastrowid
        }

    except Exception as e:
        db.rollback()  # rollback everything if ANYTHING fails
        raise HTTPException(status_code=500, detail=str(e))



