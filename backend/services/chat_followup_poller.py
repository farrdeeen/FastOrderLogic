"""
services/chat_followup_poller.py
────────────────────────────────
Background poller for two time-based chat behaviours:

  1. 24-hour follow-up: if a customer who showed buying intent goes quiet inside
     the WhatsApp 24h service window, send ONE follow-up (in their language + tone)
       - order placed but unpaid  → payment reminder
       - order not placed yet     → friendly "shall I place the order?" nudge
     Exactly one follow-up per customer message round (last_followup_at gate).

  2. Auto-revert: chats marked human (is_human=1) with no activity for 24h are
     handed back to the AI.

Mirrors the asyncio-task pattern of order_notification_poller.
"""

import asyncio
import logging
import os
from typing import Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from database import SessionLocal

logger = logging.getLogger(__name__)

_TASK: Optional[asyncio.Task] = None
_PAID_STATES = ("paid", "success", "accepted")


def _env_bool(name: str, default: bool = True) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int, minimum: int = 1) -> int:
    try:
        return max(minimum, int(os.getenv(name, str(default))))
    except (TypeError, ValueError):
        return default


# ── 2. Auto-revert human chats back to AI ─────────────────────────────────────

def _revert_stale_human_chats(db: Session) -> int:
    hours = _env_int("CHAT_HUMAN_REVERT_HOURS", 24)
    res = db.execute(
        text(f"""
            UPDATE chat_sessions
            SET is_human = 0, updated_at = NOW()
            WHERE COALESCE(is_human, 0) = 1
              AND updated_at < NOW() - INTERVAL {hours} HOUR
        """)
    )
    db.commit()
    if res.rowcount:
        logger.info("chat_followup: reverted %d stale human chat(s) back to AI", res.rowcount)
    return res.rowcount or 0


# ── 1. 24h follow-up ──────────────────────────────────────────────────────────

def _followup_candidates(db: Session, limit: int) -> list[dict]:
    silence_min = _env_int("CHAT_FOLLOWUP_SILENCE_MIN", 180)   # quiet for 3h
    window_hours = _env_int("CHAT_FOLLOWUP_WINDOW_HOURS", 24)  # still inside free window
    rows = db.execute(
        text(f"""
            SELECT cs.id, cs.phone_number, cs.preferred_language, lu.last_user_at
            FROM chat_sessions cs
            JOIN (
                SELECT session_id, MAX(timestamp) AS last_user_at
                FROM chat_messages WHERE sender = 'user'
                GROUP BY session_id
            ) lu ON lu.session_id = cs.id
            WHERE COALESCE(cs.is_human, 0) = 0
              AND (cs.status IS NULL OR cs.status <> 'resolved')
              AND lu.last_user_at >= NOW() - INTERVAL {window_hours} HOUR
              AND cs.last_message_at <= NOW() - INTERVAL {silence_min} MINUTE
              AND (cs.last_followup_at IS NULL OR cs.last_followup_at < lu.last_user_at)
            ORDER BY cs.last_message_at ASC
            LIMIT :lim
        """),
        {"lim": limit},
    ).mappings().all()
    return [dict(r) for r in rows]


def _mark_followup(db: Session, session_id: int) -> None:
    db.execute(
        text("UPDATE chat_sessions SET last_followup_at = NOW() WHERE id = :sid"),
        {"sid": session_id},
    )
    db.commit()


def _order_context(db: Session, phone: str) -> Optional[dict]:
    digits = "".join(ch for ch in str(phone or "") if ch.isdigit())[-10:]
    if not digits:
        return None
    row = db.execute(
        text("""
            SELECT o.order_id, o.payment_status
            FROM orders o
            JOIN offline_customer oc ON oc.customer_id = o.offline_customer_id
            WHERE oc.mobile LIKE :tail
              AND o.channel = 'AI_ASSISTANT'
              AND o.created_at >= NOW() - INTERVAL 7 DAY
            ORDER BY o.created_at DESC
            LIMIT 1
        """),
        {"tail": f"%{digits}"},
    ).mappings().first()
    return dict(row) if row else None


def _has_buying_intent(db: Session, session_id: int) -> bool:
    row = db.execute(
        text("""
            SELECT 1 FROM chat_messages
            WHERE session_id = :sid
              AND (
                JSON_UNQUOTE(JSON_EXTRACT(meta, '$.flow')) IN
                    ('product_image', 'ai_order_json', 'operator_product_share', 'ai_order_placed',
                     'product_confirm', 'order_cta')
                OR message LIKE '%🔗%'
              )
            LIMIT 1
        """),
        {"sid": session_id},
    ).first()
    return bool(row)


async def _send_followup(db: Session, session: dict) -> None:
    from services.ai_service import generate_followup_message
    from services.chat_service import get_conversation_history, save_message, _wa_message_id
    from services.whatsapp_service import send_text_message

    sid = session["id"]
    phone = session["phone_number"]
    language = session.get("preferred_language") or "en"

    # ATOMIC CLAIM — prevents two workers (or two sessions of the same phone) from
    # both sending. Only the worker whose UPDATE actually changes the row proceeds.
    claimed = db.execute(
        text("""
            UPDATE chat_sessions SET last_followup_at = NOW()
            WHERE id = :sid
              AND (last_followup_at IS NULL OR last_followup_at < :lua)
        """),
        {"sid": sid, "lua": session.get("last_user_at")},
    ).rowcount
    db.commit()
    if not claimed:
        return

    order = _order_context(db, phone)
    if order and str(order.get("payment_status") or "").lower() not in _PAID_STATES:
        kind, order_id = "payment_reminder", order.get("order_id")
    elif _has_buying_intent(db, sid):
        kind, order_id = "order_nudge", None
    else:
        # No order context — don't spam a generic chat. Mark so we don't re-check.
        _mark_followup(db, sid)
        return

    history = get_conversation_history(db, sid, limit=20)
    try:
        msg = await generate_followup_message(history, language=language, kind=kind, order_id=order_id)
    except Exception as exc:
        logger.warning("chat_followup: message generation failed for session %s: %s", sid, exc)
        _mark_followup(db, sid)
        return

    if not msg:
        _mark_followup(db, sid)
        return

    try:
        wa_resp = await send_text_message(phone, msg)
        save_message(
            db, sid, "ai", msg,
            wa_message_id=_wa_message_id(wa_resp),
            meta={"flow": "ai_followup", "kind": kind, "order_id": order_id},
        )
        logger.info("chat_followup: sent %s follow-up to session %s", kind, sid)
    except Exception as exc:
        logger.error("chat_followup: send failed for session %s: %s", sid, exc)
    finally:
        _mark_followup(db, sid)


async def run_chat_followup_once() -> dict:
    db = SessionLocal()
    report = {"reverted": 0, "followups": 0}
    try:
        from services.chat_service import ensure_chat_session_columns
        ensure_chat_session_columns(db)
        report["reverted"] = _revert_stale_human_chats(db)
        candidates = _followup_candidates(db, _env_int("CHAT_FOLLOWUP_BATCH", 20))
    except Exception as exc:
        logger.exception("chat_followup: candidate scan failed: %s", exc)
        db.close()
        return report
    finally:
        # keep db open for follow-ups below if we got candidates
        pass

    for session in candidates:
        try:
            await _send_followup(db, session)
            report["followups"] += 1
        except Exception as exc:
            logger.exception("chat_followup: follow-up failed for session %s: %s", session.get("id"), exc)
    db.close()
    return report


async def _loop() -> None:
    interval = _env_int("CHAT_FOLLOWUP_POLL_SECONDS", 900)  # every 15 min
    while True:
        try:
            await run_chat_followup_once()
        except Exception as exc:
            logger.exception("chat_followup poll cycle failed: %s", exc)
        await asyncio.sleep(interval)


def start_chat_followup_poller() -> Optional[asyncio.Task]:
    global _TASK
    if not _env_bool("CHAT_FOLLOWUP_POLLER_ENABLED", True):
        logger.info("chat_followup poller disabled by CHAT_FOLLOWUP_POLLER_ENABLED")
        return None
    if _TASK and not _TASK.done():
        return _TASK
    _TASK = asyncio.create_task(_loop())
    logger.info(
        "chat_followup poller started interval=%ss silence=%smin revert=%sh",
        _env_int("CHAT_FOLLOWUP_POLL_SECONDS", 900),
        _env_int("CHAT_FOLLOWUP_SILENCE_MIN", 180),
        _env_int("CHAT_HUMAN_REVERT_HOURS", 24),
    )
    return _TASK
