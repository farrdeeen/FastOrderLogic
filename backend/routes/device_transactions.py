"""
FastAPI router — device_transactions.py
Place in your routers/ or api/ directory and include in main.py:

    from routers.device_transactions import router as device_transactions_router
    app.include_router(device_transactions_router, prefix="/api")
"""

from datetime import date, datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession  # swap for Session if sync

# ── Adjust this import to match your db dependency ──────────────────────────
from database import get_db  # yields AsyncSession or Session
# ─────────────────────────────────────────────────────────────────────────────

router = APIRouter(tags=["Device Transactions"])


# ── Request / Response schemas ───────────────────────────────────────────────

class BulkDeviceTransactionIn(BaseModel):
    vendor: str = Field(..., max_length=255)
    in_out: int = Field(..., ge=1, le=2, description="1 = In, 2 = Out")
    model_name: str = Field(..., max_length=100)
    price: Optional[float] = Field(None, ge=0)
    serials: List[str] = Field(..., min_items=1)
    order_id: Optional[str] = Field(None, max_length=50)
    sku_id: Optional[str] = Field(None, max_length=100)
    remarks: Optional[str] = Field(None, max_length=255)


class DeviceTransactionOut(BaseModel):
    auto_id: int
    device_srno: str
    model_name: str
    sku_id: Optional[str]
    order_id: Optional[str]
    in_out: int
    create_date: date
    price: Optional[float]
    remarks: Optional[str]
    vendor: Optional[str]

    class Config:
        from_attributes = True


class BulkInsertResult(BaseModel):
    inserted: int
    rows: List[DeviceTransactionOut]


# ── Helpers ──────────────────────────────────────────────────────────────────

INSERT_SQL = text("""
    INSERT INTO device_transaction
        (device_srno, model_name, sku_id, order_id, in_out, price, remarks, create_date, vendor)
    VALUES
        (:device_srno, :model_name, :sku_id, :order_id, :in_out, :price, :remarks,  :create_date, :vendor)
""")

FETCH_SQL = text("""
    SELECT auto_id, device_srno, model_name, sku_id, order_id,
           in_out, create_date, price, remarks, vendor
    FROM device_transaction
    WHERE auto_id = :auto_id
""")


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post(
    "/device-transactions/bulk",
    response_model=BulkInsertResult,
    status_code=status.HTTP_201_CREATED,
    summary="Bulk insert device transactions (one row per serial number)",
)
async def bulk_create_device_transactions(
    payload: BulkDeviceTransactionIn,
    db: AsyncSession = Depends(get_db),
):
    """
    Accepts a single transaction form submission and inserts one row per
    serial number.  All rows share the same vendor, model_name, price,
    in_out, and create_date (today).
    """
    # Deduplicate serials (preserve order)
    seen = set()
    unique_serials = [s.strip() for s in payload.serials if s.strip() and not (s.strip() in seen or seen.add(s.strip()))]

    if not unique_serials:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No valid serial numbers provided.",
        )

    inserted_rows: List[DeviceTransactionOut] = []

    for srno in unique_serials:
        result = db.execute(
            INSERT_SQL,
            {
                "device_srno": srno,
                "model_name": payload.model_name,
                "sku_id": payload.sku_id,
                "order_id": payload.order_id,
                "in_out": payload.in_out,
                "price": payload.price,
                "remarks": payload.vendor,
                "create_date": datetime.now(),
                "vendor": payload.vendor,
            },
        )
        new_id = result.lastrowid

        row = db.execute(FETCH_SQL, {"auto_id": new_id})
        row_data = row.mappings().one()
        inserted_rows.append(DeviceTransactionOut(**row_data))

        db.commit()

    return BulkInsertResult(inserted=len(inserted_rows), rows=inserted_rows)


@router.get(
    "/device-transactions",
    response_model=List[DeviceTransactionOut],
    summary="List recent device transactions",
)
async def list_device_transactions(
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
):
    result = db.execute(
        text("SELECT * FROM device_transaction ORDER BY auto_id DESC LIMIT :limit"),
        {"limit": limit},
    )
    return [DeviceTransactionOut(**row) for row in result.mappings().all()]