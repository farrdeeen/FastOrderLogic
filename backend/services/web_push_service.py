import hashlib
import json
import logging
import os
import threading
from datetime import datetime
from typing import Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from database import SessionLocal

try:
    from pywebpush import WebPushException, webpush
except Exception:  # pragma: no cover - optional dependency until installed on server
    WebPushException = None
    webpush = None

logger = logging.getLogger(__name__)


def _public_key() -> str:
    return os.getenv("WEB_PUSH_PUBLIC_KEY", "").strip()


def _private_key() -> str:
    return os.getenv("WEB_PUSH_PRIVATE_KEY", "").strip()


def _subject() -> str:
    return os.getenv("WEB_PUSH_SUBJECT", "mailto:admin@mtmdash.com").strip()


def is_web_push_configured() -> bool:
    return bool(_public_key() and _private_key() and webpush)


def public_key_payload() -> dict:
    return {
        "enabled": bool(_public_key() and _private_key()),
        "server_ready": is_web_push_configured(),
        "public_key": _public_key(),
        "dependency_ready": bool(webpush),
    }


def _endpoint_hash(endpoint: str) -> str:
    return hashlib.sha256(endpoint.encode("utf-8")).hexdigest()


def save_subscription(
    db: Session,
    *,
    user_id: str,
    endpoint: str,
    p256dh: str,
    auth: str,
    platform: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> dict:
    now = datetime.now()
    endpoint_digest = _endpoint_hash(endpoint)

    db.execute(
        text(
            """
            INSERT INTO notification_subscriptions
                (user_id, endpoint_hash, endpoint, p256dh, auth, platform, user_agent,
                 enabled, last_error, created_at, updated_at)
            VALUES
                (:user_id, :endpoint_hash, :endpoint, :p256dh, :auth, :platform,
                 :user_agent, 1, NULL, :now, :now)
            ON DUPLICATE KEY UPDATE
                user_id = VALUES(user_id),
                endpoint = VALUES(endpoint),
                p256dh = VALUES(p256dh),
                auth = VALUES(auth),
                platform = VALUES(platform),
                user_agent = VALUES(user_agent),
                enabled = 1,
                last_error = NULL,
                updated_at = VALUES(updated_at)
            """
        ),
        {
            "user_id": user_id,
            "endpoint_hash": endpoint_digest,
            "endpoint": endpoint,
            "p256dh": p256dh,
            "auth": auth,
            "platform": platform,
            "user_agent": user_agent,
            "now": now,
        },
    )
    db.commit()
    return {"success": True, "endpoint_hash": endpoint_digest}


def disable_subscription(db: Session, endpoint: str, error: str = "") -> None:
    db.execute(
        text(
            """
            UPDATE notification_subscriptions
            SET enabled = 0, last_error = :error, updated_at = :now
            WHERE endpoint_hash = :endpoint_hash
            """
        ),
        {
            "endpoint_hash": _endpoint_hash(endpoint),
            "error": error[:1000],
            "now": datetime.now(),
        },
    )
    db.commit()


def _active_subscriptions(db: Session) -> list[dict]:
    rows = db.execute(
        text(
            """
            SELECT id, endpoint, p256dh, auth
            FROM notification_subscriptions
            WHERE enabled = 1
            ORDER BY updated_at DESC
            LIMIT 250
            """
        )
    ).mappings().all()
    return [dict(row) for row in rows]


def _subscriptions_for_user(db: Session, user_id: str) -> list[dict]:
    rows = db.execute(
        text(
            """
            SELECT id, endpoint, p256dh, auth
            FROM notification_subscriptions
            WHERE enabled = 1 AND user_id = :user_id
            ORDER BY updated_at DESC
            LIMIT 25
            """
        ),
        {"user_id": user_id},
    ).mappings().all()
    return [dict(row) for row in rows]


def _send_to_subscription(db: Session, subscription: dict, payload: dict) -> bool:
    if not is_web_push_configured():
        return False

    info = {
        "endpoint": subscription["endpoint"],
        "keys": {
            "p256dh": subscription["p256dh"],
            "auth": subscription["auth"],
        },
    }

    try:
        webpush(
            subscription_info=info,
            data=json.dumps(payload, ensure_ascii=False),
            vapid_private_key=_private_key(),
            vapid_claims={"sub": _subject()},
            timeout=10,
        )
        logger.info("Web push sent subscription_id=%s type=%s", subscription.get("id"), payload.get("type"))
        return True
    except Exception as exc:
        status_code = getattr(getattr(exc, "response", None), "status_code", None)
        logger.warning("Web push failed status=%s error=%s", status_code, exc)
        if status_code in (404, 410):
            disable_subscription(db, subscription["endpoint"], str(exc))
        else:
            db.execute(
                text(
                    """
                    UPDATE notification_subscriptions
                    SET last_error = :error, updated_at = :now
                    WHERE id = :id
                    """
                ),
                {"id": subscription["id"], "error": str(exc)[:1000], "now": datetime.now()},
            )
            db.commit()
        return False


def send_chat_push_notification(session_id: int, message_id: int, message: str) -> dict:
    db = SessionLocal()
    try:
        if not is_web_push_configured():
            return {"success": False, "sent": 0, "error": "web_push_not_configured"}

        session = db.execute(
            text(
                """
                SELECT id, phone_number, wa_contact_name
                FROM chat_sessions
                WHERE id = :sid
                LIMIT 1
                """
            ),
            {"sid": session_id},
        ).mappings().first()
        if not session:
            return {"success": False, "sent": 0, "error": "session_not_found"}

        title_name = session.get("wa_contact_name") or session.get("phone_number") or "Customer"
        payload = {
            "type": "chat_message",
            "title": f"New message from {title_name}",
            "body": message or "New WhatsApp message",
            "session_id": session_id,
            "message_id": message_id,
            "tag": f"chat-{session_id}",
            "url": "/",
        }

        sent = 0
        subscriptions = _active_subscriptions(db)
        logger.info(
            "Sending chat web push session_id=%s message_id=%s subscriptions=%s",
            session_id,
            message_id,
            len(subscriptions),
        )
        for subscription in subscriptions:
            if _send_to_subscription(db, subscription, payload):
                sent += 1
        return {"success": True, "sent": sent}
    except Exception as exc:
        logger.exception("send_chat_push_notification failed")
        return {"success": False, "sent": 0, "error": str(exc)}
    finally:
        db.close()


def queue_chat_push_notification(session_id: int, message_id: int, message: str) -> None:
    if not is_web_push_configured():
        logger.warning(
            "Web push skipped: configured=%s public_key=%s private_key=%s dependency=%s",
            is_web_push_configured(),
            bool(_public_key()),
            bool(_private_key()),
            bool(webpush),
        )
        return

    thread = threading.Thread(
        target=send_chat_push_notification,
        args=(session_id, message_id, message),
        daemon=True,
    )
    thread.start()


def send_test_push_notification(user_id: str) -> dict:
    db = SessionLocal()
    try:
        if not is_web_push_configured():
            return {"success": False, "sent": 0, "error": "web_push_not_configured"}

        subscriptions = _subscriptions_for_user(db, user_id)
        payload = {
            "type": "test",
            "title": "FastOrderLogic notification test",
            "body": "Chrome/Web Push is working on this device.",
            "tag": "fol-test-notification",
            "url": "/",
        }
        sent = 0
        for subscription in subscriptions:
            if _send_to_subscription(db, subscription, payload):
                sent += 1

        return {
            "success": sent > 0,
            "sent": sent,
            "subscriptions": len(subscriptions),
            "error": None if sent > 0 else "no_active_subscription_sent",
        }
    except Exception as exc:
        logger.exception("send_test_push_notification failed")
        return {"success": False, "sent": 0, "error": str(exc)}
    finally:
        db.close()
