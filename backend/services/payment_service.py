import httpx
import os

RAZORPAY_KEY = os.getenv("RAZORPAY_API_KEY")
RAZORPAY_SECRET = os.getenv("RAZORPAY_API_SECRET")

async def create_payment_link(order_id: str, amount: float, name: str, phone: str):
    url = "https://api.razorpay.com/v1/payment_links"

    payload = {
        "amount": int(amount * 100),  # paise
        "currency": "INR",
        "description": f"Payment for Order {order_id}",
        "reference_id": order_id,
        "customer": {
            "name": name,
            "contact": phone
        },
        "notify": {
            "sms": True,
            "email": False
        }
    }

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            url,
            json=payload,
            auth=(RAZORPAY_KEY, RAZORPAY_SECRET)
        )

    data = resp.json()
    return data.get("short_url")