from sqlalchemy import text
from database import engine

try:
    with engine.connect() as conn:
        print("✅ Connected successfully!")
        result = conn.execute(text("SHOW TABLES;"))
        tables = [row[0] for row in result]

        if tables:
            print("📦 Tables in mtm_store_db:")
            for t in tables:
                print(f" - {t}")
        else:
            print("⚠️ No tables found in mtm_store_db.")
except Exception as e:
    print("❌ Connection failed:", e)
