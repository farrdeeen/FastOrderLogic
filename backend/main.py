from dotenv import load_dotenv
load_dotenv()

from fastapi.middleware.cors import CORSMiddleware
from fastapi import FastAPI
from routes import orders
from routes import wix_sync
from routes import zoho
from routes.dropdowns import router as dropdowns_router
from routes import address_routes
from routes import customers
from routes import states
from routes.wix_sync import start_wix_auto_sync
from routes.device_transactions import router as device_transactions_router
from routes.delhivery import router as delhivery_router
from routes import webhook as webhook_router
from routes import dashboard as dashboard_router 
from routes.chat import router as chat_api_router
from routes.chat_router import router as chat_control_router
from routes.razorpay_webhook import router as razorpay_router
from routes.serial_search import router as serial_search_router
from routes.payment_webhook import router as payment_webhook_router
from routes.media import router as media_router
from routes.auth import router as auth_router
from routes.notifications import router as notifications_router




app = FastAPI(title="FastOrderLogic Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(media_router)
app.include_router(auth_router)
app.include_router(notifications_router)
app.include_router(orders.router)
app.include_router(wix_sync.router)
app.include_router(zoho.router)
app.include_router(dropdowns_router, prefix="/dropdowns")
app.include_router(address_routes.router)
app.include_router(customers.router)
app.include_router(states.router)
app.include_router(device_transactions_router)
app.include_router(delhivery_router)
app.include_router(chat_api_router)
app.include_router(webhook_router.router)
app.include_router(dashboard_router.router) 
app.include_router(chat_control_router)
app.include_router(razorpay_router)
app.include_router(serial_search_router)
app.include_router(payment_webhook_router)

@app.get("/")
def home():
    return {"message": "Backend running"}


@app.on_event("startup")
async def on_startup():
    start_wix_auto_sync()

    # Pre-warm the product catalogue so first WhatsApp message is fast
    try:
        from services.product_catalogue import get_catalogue
        await get_catalogue()
    except Exception as exc:
        import logging
        logging.getLogger(__name__).warning("Catalogue pre-warm failed: %s", exc)
