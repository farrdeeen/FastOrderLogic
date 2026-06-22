"""
services/customer_rag.py
────────────────────────
Lightweight RAG that feeds the AI two things, injected into the system prompt:

  1. CUSTOMER CONTEXT (MySQL): who the customer is — name, how long they've been
     with us (first order date), order count, last order + any PENDING order — so
     the AI treats existing customers like existing customers and never re-places
     an order that is already pending payment.

  2. KNOWLEDGE (Training Doc + PDFs + FAQ): top relevant chunks for the question,
     retrieved by keyword overlap (no external deps), so warranty/after-sales/
     general answers come from the latest docs.
"""

import logging
import os
import re
from pathlib import Path
from typing import Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

_PAID = ("paid", "success", "accepted")
_KB_DIR = Path(os.getenv("RAG_KB_DIR", "data/kb"))               # drop PDFs here
_TRAINING_DOC = Path(os.getenv("TRAINING_DOC_PATH", "data/training_doc.txt"))

_chunks: list[str] = []
_chunks_sig: tuple = ()


# ── 1. Customer context from MySQL ────────────────────────────────────────────

def get_customer_context(db: Session, phone: str) -> str:
    digits = re.sub(r"\D", "", str(phone or ""))[-10:]
    if len(digits) < 7:
        return ""
    tail = f"%{digits}"
    try:
        row = db.execute(
            text("""
                SELECT
                    COALESCE(MAX(NULLIF(c.name,'')), MAX(NULLIF(oc.name,''))) AS name,
                    COUNT(o.order_id)        AS orders_n,
                    MIN(o.created_at)         AS first_at,
                    MAX(o.created_at)         AS last_at,
                    SUM(LOWER(o.payment_status) IN ('paid','success','accepted')) AS paid_n
                FROM orders o
                LEFT JOIN offline_customer oc ON oc.customer_id = o.offline_customer_id
                LEFT JOIN customer c          ON c.customer_id  = o.customer_id
                WHERE oc.mobile LIKE :t OR c.mobile LIKE :t
            """),
            {"t": tail},
        ).mappings().first()
        pend = db.execute(
            text("""
                SELECT o.order_id, o.total_amount, o.payment_status
                FROM orders o
                LEFT JOIN offline_customer oc ON oc.customer_id = o.offline_customer_id
                LEFT JOIN customer c          ON c.customer_id  = o.customer_id
                WHERE (oc.mobile LIKE :t OR c.mobile LIKE :t)
                  AND LOWER(o.payment_status) NOT IN ('paid','success','accepted')
                ORDER BY o.created_at DESC LIMIT 1
            """),
            {"t": tail},
        ).mappings().first()
    except Exception as exc:
        logger.warning("customer context lookup failed: %s", exc)
        return ""

    if not row or not (row.get("orders_n") or 0):
        return "CUSTOMER CONTEXT: New customer (no previous orders) — greet warmly as a first-time buyer."

    name = row.get("name") or "the customer"
    since = row["first_at"].strftime("%b %Y") if row.get("first_at") else "?"
    lines = [
        "CUSTOMER CONTEXT (use it to sound like you know them; do NOT read it out verbatim):",
        f"- Returning customer: {name}, with us since {since}, {row['orders_n']} order(s), {row.get('paid_n') or 0} paid.",
    ]
    if pend:
        lines.append(
            f"- HAS A PENDING ORDER {pend['order_id']} (payment pending). Do NOT place a new order — "
            "remind them to complete payment for this one."
        )
    return "\n".join(lines)


# ── 2. Knowledge retrieval (training doc + PDFs) ──────────────────────────────

def _load_chunks() -> list[str]:
    global _chunks, _chunks_sig
    files = []
    if _TRAINING_DOC.exists():
        files.append(_TRAINING_DOC)
    if _KB_DIR.exists():
        files += sorted(_KB_DIR.glob("*.pdf")) + sorted(_KB_DIR.glob("*.txt"))
    sig = tuple((str(f), f.stat().st_mtime) for f in files)
    if sig == _chunks_sig and _chunks:
        return _chunks

    chunks: list[str] = []
    for f in files:
        try:
            if f.suffix.lower() == ".pdf":
                txt = _pdf_text(f)
            else:
                txt = f.read_text(encoding="utf-8", errors="ignore")
        except Exception as exc:
            logger.warning("RAG load failed for %s: %s", f, exc)
            continue
        for para in re.split(r"\n\s*\n", txt):
            para = re.sub(r"\s+", " ", para).strip()
            if len(para) > 40 and len(re.sub(r"[^a-zA-Z]", "", para)) > 25:
                chunks.append(para[:600])
    _chunks, _chunks_sig = chunks, sig
    logger.info("RAG knowledge loaded: %d chunks from %d file(s)", len(chunks), len(files))
    return chunks


def _pdf_text(path: Path) -> str:
    try:
        import pdfplumber
        with pdfplumber.open(str(path)) as pdf:
            return "\n".join(p.extract_text() or "" for p in pdf.pages[:30])
    except Exception as exc:
        logger.warning("PDF read failed %s: %s", path, exc)
        return ""


_STOP = {"the", "and", "for", "you", "your", "are", "with", "what", "kya", "hai", "ka", "ki", "ke", "me", "is", "of", "to", "a"}


def retrieve_knowledge(query: str, k: int = 3) -> str:
    chunks = _load_chunks()
    if not chunks:
        return ""
    q = {w for w in re.sub(r"[^0-9a-zA-Z]+", " ", (query or "").lower()).split() if len(w) > 2 and w not in _STOP}
    if not q:
        return ""
    scored = []
    for ch in chunks:
        words = set(re.sub(r"[^0-9a-zA-Z]+", " ", ch.lower()).split())
        hits = len(q & words)
        if hits:
            scored.append((hits, ch))
    scored.sort(key=lambda x: -x[0])
    top = [c for _, c in scored[:k]]
    return ("RELEVANT KNOWLEDGE (use for the answer):\n- " + "\n- ".join(top)) if top else ""


def build_rag_context(db: Session, phone: str, query: str) -> str:
    parts = [get_customer_context(db, phone), retrieve_knowledge(query)]
    return "\n\n".join(p for p in parts if p)
