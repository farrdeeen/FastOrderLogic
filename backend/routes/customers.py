from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text
from database import SessionLocal

router = APIRouter(prefix="/customers", tags=["Customers"])

# ------------------------------
# DB Session Helper
# ------------------------------
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# ------------------------------
# CREATE CUSTOMER (ONLINE/OFFLINE)
# ------------------------------
@router.post("/create")
def create_customer(data: dict, db: Session = Depends(get_db)):
    """
    Compatible with CustomerForm.jsx
    {
        name, mobile, email, gst_number, customer_type,
        address_line, locality, city, state_id, pincode,
        landmark, alternate_phone, address_type
    }
    """

    # -----------------------
    # BASIC VALIDATION
    # -----------------------
    required_fields = ["name", "mobile", "address_line", "city", "state_id", "pincode"]
    for field in required_fields:
        if not data.get(field):
            raise HTTPException(400, f"Missing required field: {field}")

    name = data["name"]
    mobile = data["mobile"]
    email = data.get("email")
    gst_number = data.get("gst_number")
    customer_type = data.get("customer_type", "online")

    # -----------------------
    # INSERT INTO CUSTOMER TABLE
    # -----------------------
    try:
        if customer_type == "online":
            sql = text("""
                INSERT INTO customer (name, mobile, email, gst_number)
                VALUES (:name, :mobile, :email, :gst)
            """)
        else:
            sql = text("""
                INSERT INTO offline_customer (name, mobile, email, gst_number)
                VALUES (:name, :mobile, :email, :gst)
            """)

        result = db.execute(sql, {
            "name": name,
            "mobile": mobile,
            "email": email,
            "gst": gst_number
        })

        customer_id = result.lastrowid

        # -----------------------
        # INSERT ADDRESS
        # -----------------------
        address_sql = text("""
            INSERT INTO address (
                customer_id,
                offline_customer_id,
                name,
                mobile,
                pincode,
                address_line,
                locality,
                city,
                state_id,
                landmark,
                alternate_phone,
                address_type
            )
            VALUES (
                :cust_id,
                :offline_id,
                :name,
                :mobile,
                :pincode,
                :address_line,
                :locality,
                :city,
                :state_id,
                :landmark,
                :alternate_phone,
                :address_type
            )
        """)

        db.execute(address_sql, {
            "cust_id": customer_id if customer_type == "online" else None,
            "offline_id": customer_id if customer_type == "offline" else None,

            "name": name,
            "mobile": mobile,
            "pincode": data["pincode"],
            "address_line": data["address_line"],
            "locality": data.get("locality", ""),
            "city": data["city"],
            "state_id": data["state_id"],
            "landmark": data.get("landmark", ""),
            "alternate_phone": data.get("alternate_phone", ""),
            "address_type": data.get("address_type", "home"),
        })

        db.commit()

        return {
            "success": True,
            "customer_id": customer_id
        }

    except Exception as e:
        db.rollback()
        raise HTTPException(500, detail=str(e))


    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
