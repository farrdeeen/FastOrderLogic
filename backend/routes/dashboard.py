"""
routes/dashboard.py
───────────────────
Dashboard API — metrics for the AI sales agent + training doc management.

GET  /dashboard/stats          — all KPI metrics in one call
GET  /dashboard/ai-failures    — recent messages where AI failed or got no reply
GET  /dashboard/training-doc   — current training doc info
POST /dashboard/training-doc   — upload a new .txt / .docx training document
DELETE /dashboard/training-doc — remove the current training doc
"""

import os
import json
import logging
from datetime import datetime, date, timedelta
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from sqlalchemy import text

from database import SessionLocal
from auth.clerk_auth import get_current_user as require_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])

_TRAINING_DOC_PATH = Path(os.getenv("TRAINING_DOC_PATH", "data/training_doc.txt"))
_TRAINING_DOC_PATH.parent.mkdir(parents=True, exist_ok=True)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ─── GET /dashboard/stats ─────────────────────────────────────────────────────

@router.get("/stats")
def get_dashboard_stats(
    _=Depends(require_user),
    db: Session = Depends(get_db),
):
    """
    Returns all dashboard KPIs in a single query-efficient call.

    Metrics:
    - leads_today          : orders created today (from orders table)
    - conversations_total  : total chat sessions ever
    - conversations_today  : chat sessions active today
    - no_response_count    : sessions with user messages but no AI reply in last 24h
    - orders_converted     : sessions that resulted in a parsed order JSON
    - orders_dispatched    : orders with a non-null AWB / shipped status
    - ai_failures_today    : messages where the AI returned an error string
    - channel_*            : offline / wix order counts, total and today
    - avg_response_time_s  : average seconds between user message and AI reply
    - weekly_leads         : leads per day for the last 7 days (for sparkline)
    - weekly_conversations : conversations started per day for last 7 days
    """
    today_start = datetime.combine(date.today(), datetime.min.time())
    yesterday   = today_start - timedelta(days=1)
    week_ago    = today_start - timedelta(days=7)

    # ── Leads (orders) today ──
    leads_today = db.execute(
        text("SELECT COUNT(*) FROM orders WHERE created_at >= :ts"),
        {"ts": today_start},
    ).scalar() or 0

    # ── Channel split: total + today ──
    channel_row = db.execute(
        text("""
            SELECT
                SUM(CASE WHEN LOWER(COALESCE(channel, '')) = 'offline' THEN 1 ELSE 0 END) AS offline_total,
                SUM(CASE WHEN LOWER(COALESCE(channel, '')) = 'offline' AND created_at >= :ts THEN 1 ELSE 0 END) AS offline_today,
                SUM(CASE WHEN LOWER(COALESCE(channel, '')) = 'wix' THEN 1 ELSE 0 END) AS wix_total,
                SUM(CASE WHEN LOWER(COALESCE(channel, '')) = 'wix' AND created_at >= :ts THEN 1 ELSE 0 END) AS wix_today
            FROM orders
        """),
        {"ts": today_start},
    ).first()
    channel_counts = dict(channel_row._mapping) if channel_row else {}

    # ── Conversations ──
    conversations_total = db.execute(
        text("SELECT COUNT(*) FROM chat_sessions"),
    ).scalar() or 0

    conversations_today = db.execute(
        text("SELECT COUNT(*) FROM chat_sessions WHERE created_at >= :ts"),
        {"ts": today_start},
    ).scalar() or 0

    # ── No-response: sessions where user sent a message in the last 24h
    #    and there is NO subsequent ai/system message ──
    no_response_count = db.execute(
        text("""
            SELECT COUNT(DISTINCT cm.session_id)
            FROM chat_messages cm
            WHERE cm.sender = 'user'
              AND cm.timestamp >= :ts
              AND NOT EXISTS (
                  SELECT 1 FROM chat_messages cm2
                  WHERE cm2.session_id = cm.session_id
                    AND cm2.sender IN ('ai', 'system')
                    AND cm2.timestamp > cm.timestamp
              )
        """),
        {"ts": yesterday},
    ).scalar() or 0

    # ── Orders converted: sessions with an AI message containing order JSON ──
    orders_converted = db.execute(
        text("""
            SELECT COUNT(DISTINCT session_id)
            FROM chat_messages
            WHERE sender = 'ai'
              AND meta IS NOT NULL
              AND JSON_EXTRACT(meta, '$.order_data') IS NOT NULL
        """),
    ).scalar() or 0

    # ── Orders dispatched: orders table with awb_number or dispatched status ──
    orders_dispatched = db.execute(
        text("""
            SELECT COUNT(*) FROM orders
            WHERE awb_number IS NOT NULL AND awb_number != ''
        """),
    ).scalar() or 0

    # ── AI failures today: replies containing known error strings ──
    ai_failures_today = db.execute(
        text("""
            SELECT COUNT(*) FROM chat_messages
            WHERE sender = 'ai'
              AND timestamp >= :ts
              AND (
                  message LIKE '%having trouble connecting%'
                  OR message LIKE '%Something went wrong%'
                  OR message LIKE '%not configured%'
                  OR message LIKE '%assistant is temporarily busy%'
                  OR (
                      meta IS NOT NULL
                      AND JSON_VALID(meta)
                      AND (
                          JSON_UNQUOTE(JSON_EXTRACT(meta, '$.ai_failure')) = 'true'
                          OR JSON_UNQUOTE(JSON_EXTRACT(meta, '$.flow')) = 'ai_failure'
                          OR JSON_EXTRACT(meta, '$.error_response') IS NOT NULL
                      )
                  )
              )
        """),
        {"ts": today_start},
    ).scalar() or 0

    # ── Avg response time (seconds) between user msg and next AI msg ──
    avg_row = db.execute(
        text("""
            SELECT AVG(diff) FROM (
                SELECT TIMESTAMPDIFF(SECOND, cm_user.timestamp, MIN(cm_ai.timestamp)) AS diff
                FROM chat_messages cm_user
                JOIN chat_messages cm_ai
                  ON cm_ai.session_id = cm_user.session_id
                 AND cm_ai.sender IN ('ai', 'system')
                 AND cm_ai.timestamp > cm_user.timestamp
                WHERE cm_user.sender = 'user'
                  AND cm_user.timestamp >= :ts
                GROUP BY cm_user.id
            ) sub
        """),
        {"ts": week_ago},
    ).scalar()
    avg_response_time_s = round(float(avg_row), 1) if avg_row else 0

    # ── Weekly leads (last 7 days) ──
    weekly_leads_rows = db.execute(
        text("""
            SELECT DATE(created_at) AS day, COUNT(*) AS cnt
            FROM orders
            WHERE created_at >= :ts
            GROUP BY DATE(created_at)
            ORDER BY day
        """),
        {"ts": week_ago},
    ).fetchall()
    weekly_leads = _fill_week_gaps(weekly_leads_rows)

    # ── Weekly conversations ──
    weekly_conv_rows = db.execute(
        text("""
            SELECT DATE(created_at) AS day, COUNT(*) AS cnt
            FROM chat_sessions
            WHERE created_at >= :ts
            GROUP BY DATE(created_at)
            ORDER BY day
        """),
        {"ts": week_ago},
    ).fetchall()
    weekly_conversations = _fill_week_gaps(weekly_conv_rows)

    return {
        "leads_today":           leads_today,
        "conversations_total":   conversations_total,
        "conversations_today":   conversations_today,
        "no_response_count":     no_response_count,
        "orders_converted":      orders_converted,
        "orders_dispatched":     orders_dispatched,
        "ai_failures_today":     ai_failures_today,
        "channel_offline_total":  channel_counts.get("offline_total") or 0,
        "channel_offline_today":  channel_counts.get("offline_today") or 0,
        "channel_wix_total":      channel_counts.get("wix_total") or 0,
        "channel_wix_today":      channel_counts.get("wix_today") or 0,
        "avg_response_time_s":   avg_response_time_s,
        "weekly_leads":          weekly_leads,
        "weekly_conversations":  weekly_conversations,
        "generated_at":          datetime.now().isoformat(),
    }


# ─── GET /dashboard/ai-failures ──────────────────────────────────────────────

@router.get("/ai-failures")
def get_ai_failures(
    _=Depends(require_user),
    limit: int = 50,
    db: Session = Depends(get_db),
):
    """Recent AI failure messages with session context."""
    rows = db.execute(
        text("""
            SELECT
                cm.id,
                cm.session_id,
                cm.message,
                cm.meta,
                cm.timestamp,
                cs.phone_number,
                cs.wa_contact_name
            FROM chat_messages cm
            JOIN chat_sessions cs ON cs.id = cm.session_id
            WHERE cm.sender = 'ai'
              AND (
                  cm.message LIKE '%having trouble connecting%'
                  OR cm.message LIKE '%Something went wrong%'
                  OR cm.message LIKE '%not configured%'
                  OR cm.message LIKE '%assistant is temporarily busy%'
                  OR (
                      cm.meta IS NOT NULL
                      AND JSON_VALID(cm.meta)
                      AND (
                          JSON_UNQUOTE(JSON_EXTRACT(cm.meta, '$.ai_failure')) = 'true'
                          OR JSON_UNQUOTE(JSON_EXTRACT(cm.meta, '$.flow')) = 'ai_failure'
                          OR JSON_EXTRACT(cm.meta, '$.error_response') IS NOT NULL
                      )
                  )
              )
            ORDER BY cm.timestamp DESC
            LIMIT :lim
        """),
        {"lim": limit},
    ).fetchall()

    failures = []
    for row in rows:
        item = dict(row._mapping)
        meta = _parse_meta(item.get("meta"))
        item["error_response"] = _extract_failure_response(meta, item.get("message") or "")
        item["error_detail"] = item["error_response"]
        item["provider_errors"] = meta.get("provider_errors") if isinstance(meta, dict) else None
        item["flow"] = meta.get("flow") if isinstance(meta, dict) else None
        failures.append(item)
    return failures


# ─── GET /dashboard/recent-conversations ─────────────────────────────────────

@router.get("/recent-conversations")
def get_recent_conversations(
    _=Depends(require_user),
    limit: int = 10,
    db: Session = Depends(get_db),
):
    """Last N conversations with message counts and status."""
    rows = db.execute(
        text("""
            SELECT
                cs.id,
                cs.phone_number,
                cs.wa_contact_name,
                cs.status,
                cs.last_message,
                cs.last_message_at,
                cs.created_at,
                (SELECT COUNT(*) FROM chat_messages cm WHERE cm.session_id = cs.id) AS msg_count,
                (SELECT COUNT(*) FROM chat_messages cm WHERE cm.session_id = cs.id AND cm.sender = 'user') AS user_msgs,
                (SELECT COUNT(*) FROM chat_messages cm WHERE cm.session_id = cs.id AND cm.sender = 'ai') AS ai_msgs
            FROM chat_sessions cs
            ORDER BY cs.updated_at DESC
            LIMIT :lim
        """),
        {"lim": limit},
    ).fetchall()
    return [dict(r._mapping) for r in rows]


# ─── GET /dashboard/invoice-pending ──────────────────────────────────────────

@router.get("/invoice-pending")
def get_invoice_pending(
    _=Depends(require_user),
    limit: int = 50,
    db: Session = Depends(get_db),
):
    """
    Customers with more than one order where the invoice has not been generated.

    Each customer row includes grouped order IDs and product quantities so the
    monthly credit invoice can be prepared without opening every order.
    """
    limit = max(1, min(int(limit or 50), 100))
    rows = db.execute(
        text("""
            SELECT
                CASE
                    WHEN o.customer_id IS NOT NULL THEN 'online'
                    ELSE 'offline'
                END AS customer_type,
                COALESCE(o.customer_id, o.offline_customer_id) AS customer_id,
                COALESCE(c.name, oc.name, 'Unknown Customer') AS customer_name,
                COALESCE(c.mobile, oc.mobile, '') AS customer_mobile,
                o.order_id,
                o.created_at,
                o.total_amount,
                o.total_items AS order_total_items,
                oi.item_id,
                oi.product_id,
                p.name AS product_name,
                p.sku_id,
                oi.quantity
            FROM orders o
            LEFT JOIN customer c ON c.customer_id = o.customer_id
            LEFT JOIN offline_customer oc ON oc.customer_id = o.offline_customer_id
            LEFT JOIN order_items oi ON oi.order_id = o.order_id
            LEFT JOIN products p ON p.product_id = oi.product_id
            WHERE (
                o.invoice_number IS NULL
                OR TRIM(o.invoice_number) = ''
            )
              AND UPPER(COALESCE(o.order_status, '')) <> 'REJECTED'
            ORDER BY customer_name ASC, o.created_at ASC, o.order_id ASC, oi.item_id ASC
        """),
    ).fetchall()

    groups = {}
    for row in rows:
        r = row._mapping
        customer_id = r["customer_id"]
        if customer_id is None:
            continue

        key = f"{r['customer_type']}:{customer_id}"
        group = groups.setdefault(
            key,
            {
                "customer_key": key,
                "customer_type": r["customer_type"],
                "customer_id": customer_id,
                "customer_name": r["customer_name"] or "Unknown Customer",
                "customer_mobile": r["customer_mobile"] or "",
                "_orders": {},
                "_devices": {},
            },
        )

        order_id = r["order_id"]
        order = group["_orders"].setdefault(
            order_id,
            {
                "order_id": order_id,
                "created_at": _to_iso(r["created_at"]),
                "_created_sort": r["created_at"],
                "total_amount": float(r["total_amount"] or 0),
                "quantity": 0,
                "fallback_quantity": int(r["order_total_items"] or 0),
                "_has_items": False,
            },
        )

        if r["product_id"] is None:
            continue

        quantity = int(r["quantity"] or 0)
        order["quantity"] += quantity
        order["_has_items"] = True

        product_name = r["product_name"] or "Unknown Product"
        sku_id = r["sku_id"] or ""
        device_key = f"{sku_id}|{product_name}"
        device = group["_devices"].setdefault(
            device_key,
            {
                "product_name": product_name,
                "sku_id": sku_id,
                "quantity": 0,
                "_order_ids": set(),
            },
        )
        device["quantity"] += quantity
        device["_order_ids"].add(order_id)

    result = []
    for group in groups.values():
        raw_orders = list(group["_orders"].values())
        if len(raw_orders) <= 1:
            continue

        orders = []
        for order in raw_orders:
            quantity = order["quantity"] if order["_has_items"] else order["fallback_quantity"]
            orders.append({
                "order_id": order["order_id"],
                "created_at": order["created_at"],
                "total_amount": order["total_amount"],
                "quantity": quantity,
            })

        devices = []
        for device in group["_devices"].values():
            devices.append({
                "product_name": device["product_name"],
                "sku_id": device["sku_id"],
                "quantity": device["quantity"],
                "order_count": len(device["_order_ids"]),
                "order_ids": sorted(device["_order_ids"]),
            })

        dates = [o["_created_sort"] for o in raw_orders if o["_created_sort"]]
        result.append({
            "customer_key": group["customer_key"],
            "customer_type": group["customer_type"],
            "customer_id": group["customer_id"],
            "customer_name": group["customer_name"],
            "customer_mobile": group["customer_mobile"],
            "order_count": len(orders),
            "total_quantity": sum(o["quantity"] for o in orders),
            "total_amount": sum(o["total_amount"] for o in orders),
            "order_ids": [o["order_id"] for o in orders],
            "first_order_at": _to_iso(min(dates)) if dates else None,
            "last_order_at": _to_iso(max(dates)) if dates else None,
            "orders": sorted(orders, key=lambda o: o["created_at"] or ""),
            "devices": sorted(
                devices,
                key=lambda d: (-d["quantity"], d["product_name"].lower(), d["sku_id"].lower()),
            ),
        })

    result.sort(key=lambda g: g["last_order_at"] or "", reverse=True)
    return result[:limit]


# ─── Training doc endpoints ───────────────────────────────────────────────────

@router.get("/training-doc")
def get_training_doc_info(_=Depends(require_user)):
    """Returns metadata about the current training document."""
    if not _TRAINING_DOC_PATH.exists():
        return {"exists": False, "filename": None, "size_bytes": 0, "updated_at": None}

    stat = _TRAINING_DOC_PATH.stat()
    # Read the first line to get the stored original filename
    lines = _TRAINING_DOC_PATH.read_text(encoding="utf-8").splitlines()
    filename = lines[0].replace("# FILENAME: ", "") if lines and lines[0].startswith("# FILENAME:") else "training_doc.txt"

    return {
        "exists":      True,
        "filename":    filename,
        "size_bytes":  stat.st_size,
        "updated_at":  datetime.fromtimestamp(stat.st_mtime).isoformat(),
    }


@router.post("/training-doc")
async def upload_training_doc(
    _=Depends(require_user),
    file: UploadFile = File(...),
):
    """
    Upload a training document (.txt or .docx).
    Content is extracted and stored as plain text for the AI to use.
    """
    filename = file.filename or "upload"
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "txt"

    if ext not in ("txt", "docx", "doc"):
        raise HTTPException(status_code=400, detail="Only .txt and .docx files are supported.")

    content = await file.read()

    if ext == "txt":
        text_content = content.decode("utf-8", errors="replace")
    elif ext in ("docx", "doc"):
        text_content = _extract_docx_text(content, filename)
    else:
        text_content = content.decode("utf-8", errors="replace")

    # Store with original filename as first line comment for retrieval
    _TRAINING_DOC_PATH.write_text(
        f"# FILENAME: {filename}\n{text_content}",
        encoding="utf-8",
    )
    logger.info("Training doc updated: %s (%d chars)", filename, len(text_content))

    return {
        "success":    True,
        "filename":   filename,
        "size_bytes": len(text_content.encode("utf-8")),
        "message":    f"Training document '{filename}' uploaded successfully.",
    }


@router.delete("/training-doc")
def delete_training_doc(_=Depends(require_user)):
    """Remove the current training document."""
    if _TRAINING_DOC_PATH.exists():
        _TRAINING_DOC_PATH.unlink()
        return {"success": True, "message": "Training document removed."}
    return {"success": False, "message": "No training document found."}


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _fill_week_gaps(rows) -> list[dict]:
    """Ensures we have an entry for each of the last 7 days (zero-fill missing days)."""
    day_map = {}
    for r in rows:
        day_map[str(r.day)] = r.cnt

    result = []
    for i in range(6, -1, -1):
        day = (date.today() - timedelta(days=i)).isoformat()
        result.append({"day": day, "count": day_map.get(day, 0)})
    return result


def _to_iso(value):
    return value.isoformat() if hasattr(value, "isoformat") else value


def _parse_meta(raw) -> dict:
    if isinstance(raw, dict):
        return raw
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return {}


def _extract_failure_response(meta: dict, fallback: str) -> str:
    if not isinstance(meta, dict):
        return fallback

    for key in ("error_response", "error", "response_body", "detail"):
        value = meta.get(key)
        if value:
            return str(value)

    provider_errors = meta.get("provider_errors") or []
    if isinstance(provider_errors, list):
        chunks = []
        for err in provider_errors:
            if not isinstance(err, dict):
                continue
            provider = err.get("provider") or "provider"
            kind = err.get("kind") or "error"
            status = err.get("status_code")
            title = f"{provider} {kind}"
            if status:
                title += f" ({status})"
            body = err.get("response_body") or err.get("detail") or ""
            chunks.append(f"{title}:\n{body}")
        if chunks:
            return "\n\n".join(chunks)

    return fallback


def _extract_docx_text(content: bytes, filename: str) -> str:
    """Extract plain text from a .docx file using python-docx if available."""
    try:
        import docx
        import io
        doc = docx.Document(io.BytesIO(content))
        return "\n".join(p.text for p in doc.paragraphs if p.text.strip())
    except ImportError:
        logger.warning("python-docx not installed — storing raw bytes as text fallback")
        return content.decode("utf-8", errors="replace")
    except Exception as exc:
        logger.error("docx extraction failed for %s: %s", filename, exc)
        return content.decode("utf-8", errors="replace")
    
@router.get("/catalogue")
async def get_catalogue_status(_=Depends(require_user)):
    """Returns in-memory catalogue info and first 20 products."""
    from services.product_catalogue import _catalogue, _last_fetched
    return {
        "product_count": len(_catalogue),
        "last_fetched":  _last_fetched.isoformat() if _last_fetched else None,
        "products":      _catalogue[:20],
    }
 
 
# ─── POST /dashboard/catalogue/refresh ───────────────────────────────────────
 
@router.post("/catalogue/refresh")
async def refresh_catalogue_endpoint(_=Depends(require_user)):
    """Force a full re-fetch of the Wix product catalogue into memory."""
    from services.product_catalogue import refresh_catalogue
    result = await refresh_catalogue()
    return {"success": True, **result}
