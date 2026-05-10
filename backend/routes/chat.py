"""
routers/chat.py
───────────────
REST endpoints consumed by the React frontend dashboard.

POST /chat/send                          — agent sends a manual message
POST /chat/send-order-confirmation       — trigger order_confirmation template
GET  /chat/conversations                 — list all sessions (sidebar)
GET  /chat/messages/{session_id}         — messages in a session (chat window)
POST /chat/sessions/{session_id}/resolve — mark session resolved
GET  /chat/conversations/count           — total session count
"""

import logging
import os
import asyncio
from datetime import datetime, timedelta
from typing import Optional, Set

from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks, UploadFile, File, Form, Request, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import text

from database import SessionLocal
from auth.clerk_auth import get_current_user as require_user
from services.chat_media_service import media_download_url, media_public_url, save_media_bytes
from services.chat_service import save_message, get_or_create_session, ensure_chat_session_columns
from services.whatsapp_service import (
    send_document_message,
    send_image_message,
    send_order_confirmation,
    send_text_message,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chat", tags=["Chat"])


class ChatChangeHub:
    def __init__(self):
        self.clients: Set[WebSocket] = set()
        self.loop = None

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.loop = asyncio.get_running_loop()
        self.clients.add(websocket)
        await websocket.send_json({"type": "chat_connected"})

    def disconnect(self, websocket: WebSocket):
        self.clients.discard(websocket)

    async def broadcast(self, payload: dict):
        dead_clients = []
        for websocket in list(self.clients):
            try:
                await websocket.send_json(payload)
            except Exception:
                dead_clients.append(websocket)
        for websocket in dead_clients:
            self.disconnect(websocket)


chat_change_hub = ChatChangeHub()


def notify_chat_change(
    session_id: Optional[int] = None,
    action: str = "message",
    message_id: Optional[int] = None,
    sender: Optional[str] = None,
    message: Optional[str] = None,
):
    """Fan out chat changes so the dashboard refreshes without manual reload."""
    if not chat_change_hub.clients:
        return

    payload = {
        "type": "chat_changed",
        "action": action,
        "session_id": session_id,
        "message_id": message_id,
        "sender": sender,
        "message": (message or "")[:240] if message else None,
        "updated_at": datetime.utcnow().isoformat(),
    }
    loop = chat_change_hub.loop
    if loop and loop.is_running():
        asyncio.run_coroutine_threadsafe(chat_change_hub.broadcast(payload), loop)


@router.websocket("/ws")
async def chat_ws(websocket: WebSocket):
    await chat_change_hub.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        chat_change_hub.disconnect(websocket)
    except Exception:
        chat_change_hub.disconnect(websocket)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ─── Pydantic models ─────────────────────────────────────────────────────────

class SendMessagePayload(BaseModel):
    session_id: int
    message: str


class DispatchSlipPayload(BaseModel):
    session_id: int
    order_id: str


class OrderConfirmationPayload(BaseModel):
    """
    Trigger the 'order_confirmation' WhatsApp template for a customer.
    phone must be E.164 without '+', e.g. '919311886444'.
    """
    phone: str
    customer_name: str
    order_id: str
    amount: str                  # e.g. "₹999"
    session_id: Optional[int] = None   # if provided, message is saved to that session


def _wa_message_id(response: Optional[dict]) -> Optional[str]:
    try:
        return (response or {}).get("messages", [{}])[0].get("id")
    except (IndexError, AttributeError, TypeError):
        return None


def _public_base_from_request(request: Request) -> str:
    configured = (
        os.getenv("CHAT_MEDIA_PUBLIC_BASE_URL")
        or os.getenv("PUBLIC_BACKEND_URL")
        or os.getenv("BACKEND_PUBLIC_URL")
        or os.getenv("BASE_URL")
        or ""
    ).rstrip("/")
    if configured:
        return configured

    forwarded_proto = (request.headers.get("x-forwarded-proto") or "").split(",")[0].strip()
    forwarded_host = (request.headers.get("x-forwarded-host") or "").split(",")[0].strip()
    host = forwarded_host or request.headers.get("host", "")
    scheme = forwarded_proto or request.url.scheme
    if host:
        return f"{scheme}://{host}".rstrip("/")
    return str(request.base_url).rstrip("/")


def _attach_request_urls(saved: dict, request: Request) -> dict:
    base_url = _public_base_from_request(request)
    saved["public_url"] = media_public_url(saved["relative_path"], base_url)
    saved["download_url"] = media_download_url(
        saved["relative_path"],
        saved["filename"],
        base_url,
    )
    return saved


# ─── GET /chat/conversations ─────────────────────────────────────────────────

@router.get("/conversations")
def list_conversations(
    _=Depends(require_user),
    search: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """Return paginated list of chat sessions with last-message preview."""
    ensure_chat_session_columns(db)
    conditions = ["1=1"]
    params: dict = {"lim": limit, "off": offset}

    if status:
        conditions.append("cs.status = :status")
        params["status"] = status

    if search:
        conditions.append("""(
            cs.phone_number    LIKE :search OR
            cs.wa_contact_name LIKE :search OR
            cs.last_message    LIKE :search
        )""")
        params["search"] = f"%{search}%"

    where = " AND ".join(conditions)

    rows = db.execute(text(f"""
        SELECT
            cs.id,
            cs.phone_number,
            cs.wa_contact_name,
            cs.last_message,
            cs.last_message_at,
            cs.status,
            cs.flag,
            cs.is_human,
            cs.preferred_language,
            cs.created_at,
            cs.updated_at,
            (
                SELECT COUNT(*) FROM chat_messages cm
                WHERE cm.session_id = cs.id AND cm.sender = 'user'
                  AND cm.timestamp > COALESCE((
                      SELECT MAX(cm2.timestamp) FROM chat_messages cm2
                      WHERE cm2.session_id = cs.id AND cm2.sender IN ('ai','system')
                  ), '2000-01-01')
            ) AS unread_count
        FROM chat_sessions cs
        WHERE {where}
        ORDER BY cs.updated_at DESC
        LIMIT :lim OFFSET :off
    """), params).fetchall()

    return [dict(r._mapping) for r in rows]


@router.get("/recent-user-messages")
def recent_user_messages(
    _=Depends(require_user),
    since: Optional[str] = Query(None, description="ISO timestamp; user messages after this time"),
    after_id: Optional[int] = Query(None, ge=0, description="Return user messages with id greater than this"),
    latest: bool = Query(False, description="Return only the latest user message for bootstrapping"),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    """
    Lightweight notification fallback for production Gunicorn deployments.
    Websocket broadcasts are instant when the webhook and socket share a worker;
    this DB-backed check catches messages when they land on a different worker.
    """
    where = ["cm.sender = 'user'"]
    params: dict = {"lim": 1 if latest else limit}
    order_direction = "DESC" if latest else "ASC"

    if after_id is not None:
        where.append("cm.id > :after_id")
        params["after_id"] = after_id
    elif not latest:
        if since:
            try:
                since_dt = datetime.fromisoformat(
                    since.replace("Z", "+00:00").replace("+00:00", "")
                )
            except ValueError:
                raise HTTPException(status_code=400, detail="Invalid 'since' datetime format")
        else:
            since_dt = datetime.utcnow() - timedelta(seconds=30)
        where.append("cm.timestamp > :since")
        params["since"] = since_dt

    where_clause = " AND ".join(where)

    rows = db.execute(
        text(f"""
            SELECT
                cm.id,
                cm.session_id,
                cm.message,
                cm.timestamp,
                cs.phone_number,
                cs.wa_contact_name,
                cs.status,
                cs.flag,
                cs.is_human,
                cs.last_message,
                cs.last_message_at
            FROM chat_messages cm
            JOIN chat_sessions cs ON cs.id = cm.session_id
            WHERE {where_clause}
            ORDER BY cm.id {order_direction}
            LIMIT :lim
        """),
        params,
    ).fetchall()

    result = []
    for row in rows:
        item = dict(row._mapping)
        if item.get("timestamp"):
            item["timestamp"] = item["timestamp"].isoformat()
        if item.get("last_message_at"):
            item["last_message_at"] = item["last_message_at"].isoformat()
        return_item = {
            "id": item["id"],
            "session_id": item["session_id"],
            "message": item["message"],
            "timestamp": item["timestamp"],
            "conversation": {
                "id": item["session_id"],
                "phone_number": item["phone_number"],
                "wa_contact_name": item["wa_contact_name"],
                "status": item["status"],
                "flag": item["flag"],
                "is_human": item["is_human"],
                "last_message": item["last_message"],
                "last_message_at": item["last_message_at"],
                "unread_count": 1,
            },
        }
        result.append(return_item)

    return result


# ─── GET /chat/messages/{session_id} ─────────────────────────────────────────

@router.get("/messages/{session_id}")
def get_messages(
    session_id: int,
    _=Depends(require_user),
    limit: int = Query(100, ge=1, le=500),
    before_id: Optional[int] = Query(None, description="Cursor for pagination"),
    db: Session = Depends(get_db),
):
    """Return messages for a session, oldest-first."""
    params: dict = {"sid": session_id, "lim": limit}
    cursor_clause = ""
    if before_id:
        cursor_clause = "AND cm.id < :before_id"
        params["before_id"] = before_id

    rows = db.execute(text(f"""
        SELECT latest.id, latest.session_id, latest.wa_message_id, latest.sender,
               latest.message, latest.meta, latest.status, latest.timestamp
        FROM (
            SELECT cm.id, cm.session_id, cm.wa_message_id, cm.sender,
                   cm.message, cm.meta, cm.status, cm.timestamp
            FROM chat_messages cm
            WHERE cm.session_id = :sid {cursor_clause}
            ORDER BY cm.timestamp DESC, cm.id DESC
            LIMIT :lim
        ) latest
        ORDER BY latest.timestamp ASC, latest.id ASC
    """), params).fetchall()

    return [dict(r._mapping) for r in rows]


# ─── POST /chat/send ─────────────────────────────────────────────────────────

@router.post("/send")
async def send_message(
    payload: SendMessagePayload,
    background: BackgroundTasks,
    _=Depends(require_user),
    db: Session = Depends(get_db),
):
    """Dashboard agent manually sends a WhatsApp message to a customer."""
    session = db.execute(
        text("SELECT * FROM chat_sessions WHERE id = :sid"),
        {"sid": payload.session_id},
    ).fetchone()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    phone = session.phone_number
    msg   = payload.message.strip()
    if not msg:
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    save_message(db, payload.session_id, "ai", msg)

    # Dispatch WhatsApp in background so the dashboard doesn't block
    background.add_task(_dispatch_wa, phone, msg)

    return {"success": True, "phone": phone}


async def _dispatch_wa(phone: str, msg: str) -> None:
    try:
        await send_text_message(phone, msg)
    except Exception:
        logger.exception("Failed to dispatch manual WA message to %s", phone)


# ─── POST /chat/send-media ───────────────────────────────────────────────────

@router.post("/send-media")
async def send_media_message(
    request: Request,
    session_id: int = Form(...),
    caption: str = Form(""),
    file: UploadFile = File(...),
    _=Depends(require_user),
    db: Session = Depends(get_db),
):
    """Dashboard agent sends an image or file to a WhatsApp chat."""
    session = db.execute(
        text("SELECT id, phone_number FROM chat_sessions WHERE id = :sid"),
        {"sid": session_id},
    ).mappings().first()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="File cannot be empty")

    content_type = file.content_type or "application/octet-stream"
    saved = _attach_request_urls(save_media_bytes(
        data,
        filename=file.filename or "attachment",
        folder=f"chat/{session_id}",
        content_type=content_type,
    ), request)

    phone = session["phone_number"]
    media_type = "image" if content_type.startswith("image/") else "document"
    message = caption.strip() or (
        f"[image] {saved['filename']}" if media_type == "image" else f"[file] {saved['filename']}"
    )
    meta = {
        "flow": "operator_media",
        "media_type": media_type,
        "mime_type": content_type,
        "media_url": saved["public_url"],
        "download_url": saved["download_url"],
        "file_name": saved["filename"],
        "file_size": saved["size"],
    }

    try:
        if media_type == "image":
            wa_resp = await send_image_message(phone, saved["public_url"], caption=caption.strip())
        else:
            wa_resp = await send_document_message(
                phone,
                saved["public_url"],
                saved["filename"],
                caption=caption.strip(),
            )
        meta["wa_send_status"] = "sent"
        wa_id = _wa_message_id(wa_resp)
    except Exception as exc:
        logger.exception("Failed to send chat media to %s", phone)
        meta["wa_send_status"] = "failed"
        meta["error"] = str(exc)
        wa_id = None

    message_id = save_message(db, session_id, "ai", message, wa_message_id=wa_id, meta=meta)
    return {
        "success": meta["wa_send_status"] == "sent",
        "message_id": message_id,
        "media": meta,
    }


# ─── POST /chat/send-dispatch-slip ───────────────────────────────────────────

@router.post("/send-dispatch-slip")
async def send_dispatch_slip_message(
    payload: DispatchSlipPayload,
    _=Depends(require_user),
    db: Session = Depends(get_db),
):
    """Send the Delhivery tracking link and dispatch slip PDF to the open chat."""
    from services.dispatch_slip_service import send_order_dispatch_update

    if not payload.order_id.strip():
        raise HTTPException(status_code=400, detail="Order ID is required")

    result = await send_order_dispatch_update(
        db,
        payload.order_id.strip(),
        session_id=payload.session_id,
    )
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error") or "Dispatch update failed")

    return result


# ─── POST /chat/send-order-confirmation ──────────────────────────────────────

@router.post("/send-order-confirmation")
async def send_order_confirmation_endpoint(
    payload: OrderConfirmationPayload,
    background: BackgroundTasks,
    _=Depends(require_user),
    db: Session = Depends(get_db),
):
    """
    Send the 'order_confirmation' WhatsApp template to a customer.
    Can be called from the order management UI after an order is placed.

    Example request body:
    {
        "phone": "919311886444",
        "customer_name": "Ashfaq",
        "order_id": "ORD-1001",
        "amount": "₹999",
        "session_id": 12          ← optional
    }
    """
    # If a session_id is provided, log the template send in chat history
    if payload.session_id:
        session = db.execute(
            text("SELECT id FROM chat_sessions WHERE id = :sid"),
            {"sid": payload.session_id},
        ).fetchone()
        if session:
            save_message(
                db, payload.session_id, "system",
                f"[template:order_confirmation] {payload.customer_name} / {payload.order_id} / {payload.amount}",
                meta={
                    "flow": "order_confirmation_template",
                    "order_id": payload.order_id,
                },
            )

    background.add_task(
        _dispatch_order_confirmation,
        payload.phone,
        payload.customer_name,
        payload.order_id,
        payload.amount,
    )

    return {"success": True, "phone": payload.phone, "order_id": payload.order_id}


async def _dispatch_order_confirmation(
    phone: str, customer_name: str, order_id: str, amount: str
) -> None:
    try:
        await send_order_confirmation(
            to=phone,
            customer_name=customer_name,
            order_id=order_id,
            amount=amount,
        )
        logger.info("order_confirmation template sent to %s for %s", phone, order_id)
    except Exception:
        logger.exception("Failed to send order_confirmation template to %s", phone)


# ─── POST /chat/sessions/{session_id}/resolve ────────────────────────────────

@router.post("/sessions/{session_id}/resolve")
def resolve_session(
    session_id: int,
    _=Depends(require_user),
    db: Session = Depends(get_db),
):
    db.execute(
        text("UPDATE chat_sessions SET status = 'resolved', updated_at = :now WHERE id = :sid"),
        {"now": datetime.now(), "sid": session_id},
    )
    db.commit()
    notify_chat_change(session_id, "session")
    return {"success": True, "session_id": session_id, "status": "resolved"}


# ─── GET /chat/conversations/count ───────────────────────────────────────────

@router.get("/conversations/count")
def count_conversations(
    _=Depends(require_user),
    status: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    q      = "SELECT COUNT(*) FROM chat_sessions"
    params = {}
    if status:
        q += " WHERE status = :status"
        params["status"] = status
    count = db.execute(text(q), params).scalar()
    return {"count": count}
