from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import text
from database import get_db

router = APIRouter(prefix="/states", tags=["States"])

@router.get("/list")
def get_states(db: Session = Depends(get_db)):
    rows = db.execute(text("SELECT state_id, state_name FROM states ORDER BY state_name")).fetchall()
    return [{"id": r.state_id, "name": r.state_name} for r in rows]
