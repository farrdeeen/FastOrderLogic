from sqlalchemy import (
    Column,
    Integer,
    String,
    DECIMAL,
    DateTime,
    ForeignKey,
    CheckConstraint,
    SmallInteger
)
from database import Base


class Order(Base):
    __tablename__ = "orders"

    order_id = Column(String(30), primary_key=True, index=True, unique=True)
    customer_id = Column(Integer, nullable=True)
    offline_customer_id = Column(Integer, nullable=True)
    address_id = Column(Integer, nullable=False)
    total_items = Column(Integer)
    subtotal = Column(DECIMAL(10, 2))
    discount_percent = Column(DECIMAL(5, 2))
    delivery_charge = Column(DECIMAL(10, 2))
    tax_percent = Column(DECIMAL(5, 2))
    total_amount = Column(DECIMAL(10, 2))
    channel = Column(String(20))
    payment_status = Column(String(20))
    fulfillment_status = Column(SmallInteger)
    delivery_status = Column(String(20))
    delivery_method = Column(String(20))
    awb_number = Column(String(50))
    created_at = Column(DateTime)
    updated_at = Column(DateTime)
    order_index = Column(Integer, unique=True, nullable=False)
    upload_wbn = Column(String(50))
    order_status = Column(String(10))
    payment_type = Column(String(20))
    gst = Column(DECIMAL(10, 2))
    invoice_number = Column(String(50))


    __table_args__ = (
        CheckConstraint('(customer_id IS NOT NULL) OR (offline_customer_id IS NOT NULL)', name='check_customer_type'),
    )
