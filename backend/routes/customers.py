from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text
from database import SessionLocal
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/customers", tags=["Customers"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@router.post("/create")
def create_customer(data: dict, db: Session = Depends(get_db)):
    # Debug log — safe to keep, remove after confirmed working
    print(f"[create_customer] payload: {data}")

    name            = (data.get("name") or "").strip()
    mobile          = (data.get("mobile") or "").strip()
    email           = (data.get("email") or "").strip() or None
    gst_number      = (data.get("gst_number") or "").strip() or None
    customer_type   = (data.get("customer_type") or "offline").strip()

    if not name:
        raise HTTPException(400, "Missing required field: name")
    if not mobile:
        raise HTTPException(400, "Missing required field: mobile")

    # ── address fields ──────────────────────────────────────────────────────
    address_line    = (data.get("address_line") or "").strip()
    city            = (data.get("city") or "").strip()
    pincode         = (data.get("pincode") or "").strip()
    locality        = (data.get("locality") or "").strip() or " "
    landmark        = (data.get("landmark") or "").strip() or None
    alternate_phone = (data.get("alternate_phone") or "").strip() or None
    address_type    = (data.get("address_type") or "home").strip().lower()

    # Robust state_id parsing — handles int / "26" / "" / None / "null"
    raw_state = data.get("state_id")
    state_id  = None
    if raw_state not in (None, "", "None", "null"):
        try:
            state_id = int(raw_state)
        except (ValueError, TypeError):
            state_id = None

    print(f"[create_customer] state_id parsed: {state_id!r}  (raw: {raw_state!r})")

    has_address = bool(address_line or city or pincode)

    # Only validate address fields when the user actually typed something
    if has_address:
        missing = []
        if not address_line:  missing.append("address_line")
        if not city:          missing.append("city")
        if not pincode:       missing.append("pincode")
        if state_id is None:  missing.append("state_id")
        if missing:
            raise HTTPException(
                400,
                f"Missing required address field(s): {', '.join(missing)}"
            )

    try:
        # ── insert customer ─────────────────────────────────────────────────
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

        result      = db.execute(sql, {"name": name, "mobile": mobile,
                                       "email": email, "gst": gst_number})
        customer_id = result.lastrowid

        # ── insert address (only when address data supplied) ────────────────
        if has_address:
            db.execute(text("""
                INSERT INTO address (
                    customer_id, offline_customer_id,
                    name, mobile, pincode, address_line,
                    locality, city, state_id, landmark,
                    alternate_phone, address_type
                ) VALUES (
                    :cust_id, :offline_id,
                    :name, :mobile, :pincode, :address_line,
                    :locality, :city, :state_id, :landmark,
                    :alternate_phone, :address_type
                )
            """), {
                "cust_id":         customer_id if customer_type == "online"   else None,
                "offline_id":      customer_id if customer_type == "offline"  else None,
                "name":            name,
                "mobile":          mobile,
                "pincode":         pincode,
                "address_line":    address_line,
                "locality":        locality,
                "city":            city,
                "state_id":        state_id,
                "landmark":        landmark,
                "alternate_phone": alternate_phone,
                "address_type":    address_type,
            })

        db.commit()
        return {"success": True, "customer_id": customer_id}

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        print(f"[create_customer] DB error: {e}")
        raise HTTPException(status_code=500, detail=str(e))