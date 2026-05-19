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
from services.chat_service import (
    ensure_chat_session_columns,
    get_or_create_session,
    normalize_local_phone,
    save_message,
)
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


class SavedReplySendPayload(BaseModel):
    session_id: int


class ProductSendPayload(BaseModel):
    session_id: int
    sku: Optional[str] = None
    name: Optional[str] = None
    query: Optional[str] = None


class PaymentRequestPayload(BaseModel):
    session_id: int
    amount: float


class RefineMessagePayload(BaseModel):
    message: str


class SaveContactPayload(BaseModel):
    name: str
    phone: Optional[str] = None


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


def _saved_reply_to_dict(row, request: Request) -> dict:
    item = dict(row._mapping if hasattr(row, "_mapping") else row)
    base_url = _public_base_from_request(request)
    relative_path = item.get("relative_path")
    if relative_path:
        item["media_url"] = media_public_url(relative_path, base_url)
        item["download_url"] = media_download_url(
            relative_path,
            item.get("file_name") or "",
            base_url,
        )
    return item


def _absolute_media_url(url: str, request: Request) -> str:
    if not url:
        return ""
    if str(url).startswith(("https://", "http://")):
        return url
    base_url = _public_base_from_request(request)
    slash = "" if str(url).startswith("/") else "/"
    return f"{base_url}{slash}{url}"


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


@router.get("/conversations/by-id/{session_id}")
def get_conversation(
    session_id: int,
    _=Depends(require_user),
    db: Session = Depends(get_db),
):
    ensure_chat_session_columns(db)
    row = db.execute(text("""
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
        WHERE cs.id = :sid
        LIMIT 1
    """), {"sid": session_id}).first()
    if not row:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return dict(row._mapping)


@router.post("/sessions/{session_id}/save-contact")
def save_session_contact(
    session_id: int,
    payload: SaveContactPayload,
    _=Depends(require_user),
    db: Session = Depends(get_db),
):
    session = db.execute(
        text("SELECT id, phone_number, wa_contact_name FROM chat_sessions WHERE id = :sid"),
        {"sid": session_id},
    ).mappings().first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    name = (payload.name or session.get("wa_contact_name") or "").strip()
    phone = normalize_local_phone(payload.phone or session.get("phone_number") or "")
    if not name:
        raise HTTPException(status_code=400, detail="Contact name is required")
    if len(phone) != 10:
        raise HTTPException(status_code=400, detail="A valid 10-digit mobile number is required")

    try:
        result = db.execute(
            text("""
                INSERT INTO customer (name, mobile)
                VALUES (:name, :mobile)
                ON DUPLICATE KEY UPDATE
                    customer_id = LAST_INSERT_ID(customer_id),
                    name = CASE
                        WHEN VALUES(name) IS NOT NULL AND VALUES(name) <> '' THEN VALUES(name)
                        ELSE name
                    END
            """),
            {"name": name, "mobile": phone},
        )
        customer_id = result.lastrowid
        db.execute(
            text("""
                UPDATE chat_sessions
                SET wa_contact_name = :name, updated_at = :now
                WHERE id = :sid
            """),
            {"name": name, "now": datetime.now(), "sid": session_id},
        )
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.exception("Failed to save chat contact for session %s", session_id)
        raise HTTPException(status_code=500, detail="Failed to save contact") from exc

    notify_chat_change(session_id, "session")
    return {
        "success": True,
        "customer_id": customer_id,
        "name": name,
        "mobile": phone,
        "session_id": session_id,
    }


@router.get("/sessions/{session_id}/last-order")
def get_session_last_order(
    session_id: int,
    _=Depends(require_user),
    db: Session = Depends(get_db),
):
    session = db.execute(
        text("SELECT id, phone_number FROM chat_sessions WHERE id = :sid"),
        {"sid": session_id},
    ).mappings().first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    local_phone = normalize_local_phone(session["phone_number"] or "")
    if not local_phone:
        return {"order": None}

    order = db.execute(
        text("""
            SELECT
                o.order_id,
                o.created_at,
                o.total_amount,
                o.total_items,
                o.payment_status,
                o.delivery_status,
                o.order_status,
                o.awb_number,
                o.invoice_number,
                o.channel,
                COALESCE(a.name, c.name, oc.name) AS customer_name,
                COALESCE(a.mobile, c.mobile, oc.mobile) AS customer_mobile
            FROM orders o
            LEFT JOIN customer c ON c.customer_id = o.customer_id
            LEFT JOIN offline_customer oc ON oc.customer_id = o.offline_customer_id
            LEFT JOIN address a ON a.address_id = o.address_id
            WHERE
                RIGHT(REGEXP_REPLACE(COALESCE(c.mobile, ''), '[^0-9]', ''), 10) = :phone
                OR RIGHT(REGEXP_REPLACE(COALESCE(oc.mobile, ''), '[^0-9]', ''), 10) = :phone
                OR RIGHT(REGEXP_REPLACE(COALESCE(a.mobile, ''), '[^0-9]', ''), 10) = :phone
            ORDER BY o.created_at DESC, o.order_id DESC
            LIMIT 1
        """),
        {"phone": local_phone},
    ).mappings().first()
    if not order:
        return {"order": None}

    items = db.execute(
        text("""
            SELECT
                p.name AS product_name,
                p.sku_id,
                oi.quantity,
                oi.unit_price,
                oi.total_price
            FROM order_items oi
            LEFT JOIN products p ON p.product_id = oi.product_id
            WHERE oi.order_id = :oid
            ORDER BY oi.item_id ASC
        """),
        {"oid": order["order_id"]},
    ).mappings().all()

    return {
        "order": {
            **dict(order),
            "items": [dict(item) for item in items],
        },
    }


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


# ─── Saved replies ───────────────────────────────────────────────────────────

@router.get("/saved-replies")
def list_saved_replies(
    request: Request,
    _=Depends(require_user),
    db: Session = Depends(get_db),
):
    rows = db.execute(text("""
        SELECT
            id,
            title,
            message,
            media_url,
            download_url,
            relative_path,
            file_name,
            mime_type,
            file_size,
            created_by,
            is_active,
            created_at,
            updated_at
        FROM chat_saved_replies
        WHERE is_active = 1
        ORDER BY title ASC, id DESC
    """)).fetchall()
    return [_saved_reply_to_dict(row, request) for row in rows]


@router.post("/saved-replies")
async def create_saved_reply(
    request: Request,
    title: str = Form(...),
    message: str = Form(""),
    file: Optional[UploadFile] = File(None),
    user=Depends(require_user),
    db: Session = Depends(get_db),
):
    clean_title = (title or "").strip()
    clean_message = (message or "").strip()
    if not clean_title:
        raise HTTPException(status_code=400, detail="Title is required")
    if len(clean_title) > 120:
        raise HTTPException(status_code=400, detail="Title must be 120 characters or less")

    media = {}
    if file and file.filename:
        content_type = file.content_type or "application/octet-stream"
        if not content_type.startswith("image/"):
            raise HTTPException(status_code=400, detail="Saved reply media must be an image")
        data = await file.read()
        if not data:
            raise HTTPException(status_code=400, detail="Image cannot be empty")
        media = _attach_request_urls(save_media_bytes(
            data,
            filename=file.filename or "saved-reply-photo",
            folder="saved-replies",
            content_type=content_type,
        ), request)

    if not clean_message and not media:
        raise HTTPException(status_code=400, detail="Add a message or photo")

    now = datetime.now()
    result = db.execute(text("""
        INSERT INTO chat_saved_replies (
            title,
            message,
            media_url,
            download_url,
            relative_path,
            file_name,
            mime_type,
            file_size,
            created_by,
            is_active,
            created_at,
            updated_at
        )
        VALUES (
            :title,
            :message,
            :media_url,
            :download_url,
            :relative_path,
            :file_name,
            :mime_type,
            :file_size,
            :created_by,
            1,
            :now,
            :now
        )
    """), {
        "title": clean_title,
        "message": clean_message or None,
        "media_url": media.get("public_url"),
        "download_url": media.get("download_url"),
        "relative_path": media.get("relative_path"),
        "file_name": media.get("filename"),
        "mime_type": media.get("content_type"),
        "file_size": media.get("size"),
        "created_by": user.get("sub") if isinstance(user, dict) else None,
        "now": now,
    })
    db.commit()

    row = db.execute(text("""
        SELECT
            id,
            title,
            message,
            media_url,
            download_url,
            relative_path,
            file_name,
            mime_type,
            file_size,
            created_by,
            is_active,
            created_at,
            updated_at
        FROM chat_saved_replies
        WHERE id = :id
    """), {"id": result.lastrowid}).first()
    return _saved_reply_to_dict(row, request)


@router.delete("/saved-replies/{reply_id}")
def delete_saved_reply(
    reply_id: int,
    _=Depends(require_user),
    db: Session = Depends(get_db),
):
    result = db.execute(text("""
        UPDATE chat_saved_replies
        SET is_active = 0, updated_at = :now
        WHERE id = :id AND is_active = 1
    """), {"id": reply_id, "now": datetime.now()})
    db.commit()
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Saved reply not found")
    return {"success": True, "id": reply_id}


@router.post("/saved-replies/{reply_id}/send")
async def send_saved_reply(
    request: Request,
    reply_id: int,
    payload: SavedReplySendPayload,
    _=Depends(require_user),
    db: Session = Depends(get_db),
):
    session = db.execute(
        text("SELECT id, phone_number FROM chat_sessions WHERE id = :sid"),
        {"sid": payload.session_id},
    ).mappings().first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    row = db.execute(text("""
        SELECT
            id,
            title,
            message,
            media_url,
            download_url,
            relative_path,
            file_name,
            mime_type,
            file_size
        FROM chat_saved_replies
        WHERE id = :id AND is_active = 1
    """), {"id": reply_id}).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Saved reply not found")

    reply = _saved_reply_to_dict(row, request)
    message = (reply.get("message") or "").strip()
    media_url = reply.get("media_url") or ""
    file_name = reply.get("file_name") or "saved-reply-photo"
    mime_type = reply.get("mime_type") or ""
    phone = session["phone_number"]

    if not message and not media_url:
        raise HTTPException(status_code=400, detail="Saved reply is empty")

    meta = {
        "flow": "saved_reply",
        "saved_reply_id": reply_id,
        "saved_reply_title": reply.get("title"),
    }
    wa_id = None
    success = False
    display_message = message or f"[image] {file_name}"

    try:
        if media_url:
            wa_resp = await send_image_message(phone, media_url, caption=message[:1024])
            meta.update({
                "media_type": "image",
                "mime_type": mime_type,
                "media_url": media_url,
                "download_url": reply.get("download_url"),
                "file_name": file_name,
                "file_size": reply.get("file_size"),
            })
        else:
            wa_resp = await send_text_message(phone, message)
        wa_id = _wa_message_id(wa_resp)
        meta["wa_send_status"] = "sent"
        success = True
    except Exception as exc:
        logger.exception("Failed to send saved reply %s to %s", reply_id, phone)
        meta["wa_send_status"] = "failed"
        meta["error"] = str(exc)

    message_id = save_message(
        db,
        payload.session_id,
        "ai",
        display_message,
        wa_message_id=wa_id,
        meta=meta,
    )

    return {
        "success": success,
        "message_id": message_id,
        "saved_reply_id": reply_id,
    }


# ─── Operator product sharing ────────────────────────────────────────────────

def _product_result(product: dict, image_url: str = "") -> dict:
    return {
        "id": product.get("id"),
        "name": product.get("name"),
        "sku": product.get("sku"),
        "price_display": product.get("effective_price") or product.get("price_display"),
        "regular_price": product.get("price_display"),
        "sale_price": product.get("sale_price_display"),
        "on_sale": product.get("on_sale"),
        "in_stock": product.get("in_stock"),
        "link": product.get("link"),
        "image_url": image_url,
    }


@router.get("/products/search")
async def search_chat_products(
    request: Request,
    query: str = Query(""),
    limit: int = Query(12, ge=1, le=30),
    _=Depends(require_user),
):
    from services.product_catalogue import get_product_images_by_sku, search_products

    products = await search_products(query or "", limit=limit)
    result = []
    for product in products:
        images = await get_product_images_by_sku(
            (product.get("sku") or "").strip(),
            product_name=(product.get("name") or "").strip(),
        )
        image_url = _absolute_media_url(images[0], request) if images else ""
        result.append(_product_result(product, image_url=image_url))
    return result


@router.post("/products/send")
async def send_chat_product(
    request: Request,
    payload: ProductSendPayload,
    _=Depends(require_user),
    db: Session = Depends(get_db),
):
    from services.product_catalogue import (
        download_product_image_to_media,
        format_product_card,
        get_product_images_by_sku,
        search_products,
    )

    session = db.execute(
        text("SELECT id, phone_number FROM chat_sessions WHERE id = :sid"),
        {"sid": payload.session_id},
    ).mappings().first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    query = (payload.query or payload.sku or payload.name or "").strip()
    if not query:
        raise HTTPException(status_code=400, detail="Product search is required")

    products = await search_products(query, limit=8)
    product = None
    sku = (payload.sku or "").strip().lower()
    name = (payload.name or "").strip().lower()
    if sku:
        product = next(
            (p for p in products if (p.get("sku") or "").strip().lower() == sku),
            None,
        )
    if not product and name:
        product = next(
            (p for p in products if (p.get("name") or "").strip().lower() == name),
            None,
        )
    if not product and products:
        product = products[0]
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    text_message = format_product_card(product)
    product_sku = (product.get("sku") or "").strip()
    product_name = (product.get("name") or "").strip()
    images = await get_product_images_by_sku(product_sku, product_name=product_name)
    image_url = _absolute_media_url(images[0], request) if images else ""
    downloaded_image = (
        await download_product_image_to_media(
            image_url,
            product_sku=product_sku,
            product_name=product_name,
            public_base_url=_public_base_from_request(request),
        )
        if image_url
        else None
    )
    wa_image_url = (downloaded_image or {}).get("public_url") or ""
    phone = session["phone_number"]

    meta = {
        "flow": "operator_product_share",
        "product_name": product_name,
        "sku": product_sku,
        "product_link": product.get("link"),
        "product_price": product.get("effective_price") or product.get("price_display"),
        "product_in_stock": product.get("in_stock"),
    }
    display_message = text_message
    wa_id = None
    success = False

    try:
        if wa_image_url:
            try:
                wa_resp = await send_image_message(phone, wa_image_url, caption=text_message[:1024])
                meta.update({
                    "media_type": "image",
                    "mime_type": downloaded_image.get("content_type") or "image/*",
                    "media_url": wa_image_url,
                    "download_url": downloaded_image.get("download_url") or wa_image_url,
                    "file_name": downloaded_image.get("filename") or f"{product_sku or product_name or 'product'}.jpg",
                    "file_size": downloaded_image.get("size"),
                    "source_image_url": image_url,
                })
            except Exception as image_exc:
                logger.warning(
                    "Product image send failed for %s (%s); falling back to link preview: %s",
                    product_sku or product_name,
                    image_url,
                    image_exc,
                )
                wa_resp = await send_text_message(phone, text_message, preview_url=True)
                meta.update({
                    "link_preview": True,
                    "product_has_photo": False,
                    "image_send_error": str(image_exc),
                    "source_image_url": image_url,
                })
        else:
            wa_resp = await send_text_message(phone, text_message, preview_url=True)
            meta.update({
                "link_preview": True,
                "product_has_photo": False,
                "source_image_url": image_url,
                "image_downloaded": False,
            })
        wa_id = _wa_message_id(wa_resp)
        meta["wa_send_status"] = "sent"
        success = True
    except Exception as exc:
        logger.exception("Failed to share product %s to %s", product_sku or product_name, phone)
        meta["wa_send_status"] = "failed"
        meta["error"] = str(exc)

    message_id = save_message(
        db,
        payload.session_id,
        "ai",
        display_message,
        wa_message_id=wa_id,
        meta=meta,
    )
    return {
        "success": success,
        "message_id": message_id,
        "product": _product_result(product, image_url=image_url),
    }


# ─── Operator payment request ────────────────────────────────────────────────

@router.post("/payment-request")
async def send_payment_request(
    payload: PaymentRequestPayload,
    _=Depends(require_user),
    db: Session = Depends(get_db),
):
    from services.payment_service import (
        PaymentLinkError,
        build_payment_qr_url,
        create_payment_link_details,
        create_payment_qr_details,
    )

    if payload.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than 0")

    session = db.execute(
        text("SELECT id, phone_number, wa_contact_name FROM chat_sessions WHERE id = :sid"),
        {"sid": payload.session_id},
    ).mappings().first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    phone = session["phone_number"]
    customer_name = session.get("wa_contact_name") or "Customer"
    reference_id = f"CHAT-{payload.session_id}-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}"
    amount_label = f"₹{payload.amount:,.2f}".rstrip("0").rstrip(".")

    try:
        payment_link = await create_payment_link_details(
            order_id=reference_id,
            amount=payload.amount,
            name=customer_name,
            phone=phone,
        )
    except PaymentLinkError as exc:
        raise HTTPException(status_code=400, detail=f"Razorpay payment link failed: {exc}") from exc

    pay_url = payment_link.get("short_url") or ""
    if not pay_url:
        raise HTTPException(status_code=400, detail="Razorpay did not return a payment link")

    qr_url = ""
    razorpay_qr_id = None
    try:
        razorpay_qr = await create_payment_qr_details(
            order_id=reference_id,
            amount=payload.amount,
            name=customer_name,
        )
        qr_url = razorpay_qr.get("image_url") or ""
        razorpay_qr_id = razorpay_qr.get("id")
    except Exception as exc:
        logger.warning("Razorpay QR create failed for %s, using link QR fallback: %s", reference_id, exc)
        qr_url = build_payment_qr_url(pay_url)

    text_msg = (
        f"Payment request for {amount_label}\n"
        f"Please complete the payment here:\n{pay_url}"
    )
    result = {
        "success": True,
        "payment_url": pay_url,
        "qr_url": qr_url,
        "reference_id": reference_id,
        "errors": [],
    }

    try:
        wa_resp = await send_text_message(phone, text_msg, preview_url=True)
        save_message(
            db,
            payload.session_id,
            "ai",
            text_msg,
            wa_message_id=_wa_message_id(wa_resp),
            meta={
                "flow": "operator_payment_link",
                "reference_id": reference_id,
                "amount": payload.amount,
                "payment_url": pay_url,
                "razorpay_payment_link_id": payment_link.get("id"),
                "link_preview": True,
            },
        )
    except Exception as exc:
        logger.exception("Payment link send failed for session %s", payload.session_id)
        result["success"] = False
        result["errors"].append(f"payment_link_send:{exc}")
        save_message(
            db,
            payload.session_id,
            "ai",
            f"[payment_link_send_failed] {reference_id}: {exc}",
            meta={
                "flow": "operator_payment_link_failed",
                "reference_id": reference_id,
                "amount": payload.amount,
                "payment_url": pay_url,
                "error": str(exc),
            },
        )

    if qr_url:
        try:
            caption = f"Scan this QR to pay {amount_label}"
            wa_resp = await send_image_message(phone, qr_url, caption=caption)
            save_message(
                db,
                payload.session_id,
                "ai",
                caption,
                wa_message_id=_wa_message_id(wa_resp),
                meta={
                    "flow": "payment_qr",
                    "reference_id": reference_id,
                    "amount": payload.amount,
                    "payment_url": pay_url,
                    "qr_url": qr_url,
                    "razorpay_payment_link_id": payment_link.get("id"),
                    "razorpay_qr_id": razorpay_qr_id,
                    "media_type": "image",
                    "mime_type": "image/png",
                    "media_url": qr_url,
                    "download_url": qr_url,
                    "file_name": f"payment-qr-{reference_id}.png",
                },
            )
        except Exception as exc:
            logger.exception("Payment QR send failed for session %s", payload.session_id)
            result["success"] = False
            result["errors"].append(f"payment_qr_send:{exc}")

    return result


# ─── Operator AI refine ──────────────────────────────────────────────────────

@router.post("/refine-message")
async def refine_message(
    payload: RefineMessagePayload,
    _=Depends(require_user),
):
    draft = (payload.message or "").strip()
    if not draft:
        raise HTTPException(status_code=400, detail="Message is required")
    try:
        from services.ai_service import refine_operator_message

        refined = await refine_operator_message(draft)
    except Exception as exc:
        logger.exception("Message refine failed")
        raise HTTPException(status_code=502, detail=f"AI refine failed: {exc}") from exc
    return {"message": refined or draft}


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
