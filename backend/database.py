import os
from pathlib import Path
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

# Path to backend/.env
BASE_DIR = Path(__file__).resolve().parent
env_path = BASE_DIR / ".env"

# Load .env (ONLY ONCE)
load_dotenv(dotenv_path=env_path)

# Read environment variables
DB_USER = os.getenv("DB_USER")
DB_PASSWORD = os.getenv("DB_PASSWORD")
DB_HOST = os.getenv("DB_HOST", "127.0.0.1")
DB_PORT = os.getenv("DB_PORT", "3306")
DB_NAME = os.getenv("DB_NAME")

# Debug check
if not DB_USER or not DB_NAME:
    print("❌ ERROR: DB environment variables NOT loaded!")
    print("DB_USER:", DB_USER)
    print("DB_PASSWORD:", DB_PASSWORD)
    print("DB_NAME:", DB_NAME)
else:
    print(f"✅ Loaded DB config for {DB_NAME} on {DB_HOST}:{DB_PORT}")

# Build SQLAlchemy URL
DATABASE_URL = f"mysql+pymysql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"

# SQLAlchemy Init
engine = create_engine(DATABASE_URL, echo=False, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
