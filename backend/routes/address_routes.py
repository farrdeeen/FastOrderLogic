# routes/address_routes.py

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text
from database import get_db
from pydantic import BaseModel

router = APIRouter()

class NewAddress(BaseModel):
    cust_type: str
    customer_id: int
    name: str
    mobile: str
    pincode: str
    locality: str
    address_line: str
    city: str
    state_id: int
    address_type: str = "home"
    landmark: str = ""
    alternate_phone: str = ""

@router.get("/dropdowns/customers/{cust_type}/{cust_id}/addresses")
def get_customer_addresses(cust_type: str, cust_id: int, db: Session = Depends(get_db)):

    if cust_type not in ["online", "offline"]:
        raise HTTPException(status_code=400, detail="cust_type must be 'online' or 'offline'")

    if cust_type == "online":
        query = """
            SELECT 
                address_id,
                name,
                mobile,
                pincode,
                locality,
                address_line,
                city,
                state_id,
                landmark,
                alternate_phone,
                address_type
            FROM address
            WHERE customer_id = :cid
              AND is_available = 1
            ORDER BY address_id ASC
        """
    else:
        query = """
            SELECT 
                address_id,
                name,
                mobile,
                pincode,
                locality,
                address_line,
                city,
                state_id,
                landmark,
                alternate_phone,
                address_type
            FROM address
            WHERE offline_customer_id = :cid
              AND is_available = 1
            ORDER BY address_id ASC
        """

    rows = db.execute(text(query), {"cid": cust_id}).fetchall()

    result = []
    for r in rows:
        label = f"{r.address_line}, {r.locality}, {r.city} - {r.pincode}"
        result.append({
            "address_id": r.address_id,
            "name": r.name,
            "mobile": r.mobile,
            "pincode": r.pincode,
            "locality": r.locality,
            "address_line": r.address_line,
            "city": r.city,
            "state_id": r.state_id,
            "landmark": r.landmark,
            "alternate_phone": r.alternate_phone,
            "address_type": r.address_type,
            "label": label
        })

    return result

@router.post("/customers/address/create")
def create_new_address(payload: NewAddress, db: Session = Depends(get_db)):
    cust_type = payload.cust_type
    customer_id = payload.customer_id

    if cust_type not in ["online", "offline"]:
        raise HTTPException(status_code=400, detail="cust_type must be 'online' or 'offline'")

    params = {
        "name": payload.name,
        "mobile": payload.mobile,
        "pincode": payload.pincode,
        "locality": payload.locality,
        "address_line": payload.address_line,
        "city": payload.city,
        "state_id": payload.state_id,
        "landmark": payload.landmark,
        "alternate_phone": payload.alternate_phone,
        "address_type": payload.address_type,
        "is_available": 1
    }

    if cust_type == "online":
        sql = text("""
            INSERT INTO address
            (customer_id, name, mobile, pincode, locality, address_line,
             city, state_id, landmark, alternate_phone, address_type, is_available)
            VALUES
            (:customer_id, :name, :mobile, :pincode, :locality, :address_line,
             :city, :state_id, :landmark, :alternate_phone, :address_type, :is_available)
        """)
        params["customer_id"] = customer_id
    else:
        sql = text("""
            INSERT INTO address
            (offline_customer_id, name, mobile, pincode, locality, address_line,
             city, state_id, landmark, alternate_phone, address_type, is_available)
            VALUES
            (:offline_customer_id, :name, :mobile, :pincode, :locality, :address_line,
             :city, :state_id, :landmark, :alternate_phone, :address_type, :is_available)
        """)
        params["offline_customer_id"] = customer_id

    db.execute(sql, params)
    db.commit()

    new_id = db.execute(text("SELECT LAST_INSERT_ID() AS id")).fetchone().id

    return {
        "success": True,
        "address_id": new_id
    }

@router.get("/states/list")
def get_states(db: Session = Depends(get_db)):
    rows = db.execute(text("SELECT state_id AS id, name FROM state")).fetchall()
    return [{"id": r.id, "name": r.name} for r in rows]
