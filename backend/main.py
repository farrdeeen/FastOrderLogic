from fastapi.middleware.cors import CORSMiddleware
from fastapi import FastAPI
from routes import orders
from routes import wix_sync
from routes import zoho

app = FastAPI(title="FastOrderLogic Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(orders.router)
app.include_router(wix_sync.router)
app.include_router(zoho.router)

@app.get("/")
def home():
    return {"message": "Backend running"}
