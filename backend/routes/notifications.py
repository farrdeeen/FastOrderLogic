from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth.clerk_auth import get_current_user as require_user
from database import SessionLocal
from services.web_push_service import (
    public_key_payload,
    save_subscription,
    send_test_push_notification,
)

router = APIRouter(prefix="/notifications", tags=["Notifications"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class PushKeys(BaseModel):
    p256dh: str
    auth: str


class PushSubscriptionIn(BaseModel):
    endpoint: str
    keys: PushKeys
    platform: Optional[str] = None
    user_agent: Optional[str] = None


@router.get("/web-push-key")
def web_push_key(_=Depends(require_user)):
    return public_key_payload()


@router.post("/subscribe")
def subscribe(
    payload: PushSubscriptionIn,
    user=Depends(require_user),
    db: Session = Depends(get_db),
):
    key_payload = public_key_payload()
    if not key_payload["enabled"]:
        raise HTTPException(status_code=503, detail="Web push keys are not configured")
    if not key_payload["dependency_ready"]:
        raise HTTPException(status_code=503, detail="pywebpush is not installed")

    return save_subscription(
        db,
        user_id=user.get("sub", ""),
        endpoint=payload.endpoint,
        p256dh=payload.keys.p256dh,
        auth=payload.keys.auth,
        platform=payload.platform,
        user_agent=payload.user_agent,
    )


@router.post("/test")
def test_push(user=Depends(require_user)):
    return send_test_push_notification(user.get("sub", ""))
