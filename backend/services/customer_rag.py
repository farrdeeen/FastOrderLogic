"""
services/customer_rag.py
────────────────────────
Assembles the RAG context injected into the sales agent's system prompt:

  Layer 4 — CUSTOMER RELATIONSHIP (MySQL): who the customer is — name, tags
            (First-Time / Existing / Repeat / High-Value / Wholesale /
            Returning-After-Gap), order count, lifetime value, products bought,
            and any PENDING order (so we never re-place a paid-pending order).

  Layer 2 — PRODUCT + FAQ KNOWLEDGE (ChromaDB): the most relevant product and
            policy chunks for this message (multilingual vector search; degrades
            to keyword search over the training doc if Chroma is unavailable).

  Layer 3 — SALES LEARNING (ChromaDB): the closest operator-taught answers that
            worked before, so the agent reuses proven wording.

`learn_from_operator` writes each operator reply into the sales_learning vector
collection (auto-learn + dedup) — it NO LONGER appends to training_doc.txt.
"""

import hashlib
import logging
import os
import re
from pathlib import Path
from typing import Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from services import vector_store as vs

logger = logging.getLogger(__name__)

_PAID = ("paid", "success", "accepted")
_PAID_SQL = "('paid','success','accepted')"

# Customer-tag thresholds (tunable via env).
_HIGH_VALUE_LTV = float(os.getenv("RAG_HIGH_VALUE_LTV", "15000"))
_WHOLESALE_QTY = int(os.getenv("RAG_WHOLESALE_QTY", "5"))
_LONG_GAP_DAYS = int(os.getenv("RAG_LONG_GAP_DAYS", "120"))

# Keyword-fallback knowledge (only used when the vector store is unavailable).
_KB_DIR = Path(os.getenv("RAG_KB_DIR", "data/kb"))
_TRAINING_DOC = Path(os.getenv("TRAINING_DOC_PATH", "data/training_doc.txt"))
_chunks: list[str] = []
_chunks_sig: tuple = ()


# ─────────────────────────────────────────────────────────────────────────────
# Layer 4 — Customer relationship context (MySQL)
# ─────────────────────────────────────────────────────────────────────────────

def _phone_tail(phone: str) -> str:
    return re.sub(r"\D", "", str(phone or ""))[-10:]


def get_customer_context(db: Session, phone: str) -> str:
    digits = _phone_tail(phone)
    if len(digits) < 7:
        return ""
    tail = f"%{digits}"
    try:
        row = db.execute(
            text(f"""
                SELECT
                    COALESCE(MAX(NULLIF(c.name,'')), MAX(NULLIF(oc.name,''))) AS name,
                    COUNT(o.order_id)  AS orders_n,
                    MIN(o.created_at)  AS first_at,
                    MAX(o.created_at)  AS last_at,
                    SUM(LOWER(o.payment_status) IN {_PAID_SQL}) AS paid_n,
                    SUM(CASE WHEN LOWER(o.payment_status) IN {_PAID_SQL}
                             THEN o.total_amount ELSE 0 END) AS ltv
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
        return ("CUSTOMER CONTEXT: New customer / first-time visitor (no previous orders). "
                "Greet warmly, educate, build trust, and guide them to the right product.")

    name = row.get("name") or "the customer"
    orders_n = int(row.get("orders_n") or 0)
    paid_n = int(row.get("paid_n") or 0)
    ltv = float(row.get("ltv") or 0)
    since = row["first_at"].strftime("%b %Y") if row.get("first_at") else "?"

    products, max_qty = _purchased_products_and_qty(db, tail)
    tags = _customer_tags(orders_n, paid_n, ltv, max_qty, row.get("last_at"))

    lines = [
        "CUSTOMER CONTEXT (use it to sound like you know them; do NOT read it out verbatim):",
        f"- {name} — {', '.join(tags)}.",
        f"- With us since {since}; {orders_n} order(s), {paid_n} paid"
        + (f", lifetime value ~₹{ltv:,.0f}." if ltv else "."),
    ]
    if products:
        lines.append(f"- Previously bought: {', '.join(products[:5])}.")
    if "High-Value Customer" in tags or "Wholesale Buyer" in tags:
        lines.append("- Prioritise this customer: offer bulk pricing and faster, attentive help.")
    if "Returning After Long Gap" in tags:
        lines.append("- They're back after a long gap — welcome them back warmly.")
    if pend:
        lines.append(
            f"- HAS A PENDING ORDER {pend['order_id']} (payment pending). Do NOT place a new order — "
            "remind them to complete payment for this one."
        )
    return "\n".join(lines)


def _purchased_products_and_qty(db: Session, tail: str) -> tuple[list[str], int]:
    """Best-effort: distinct product names bought (most recent first) + the max
    single-line quantity (for wholesale detection). Degrades to ([],0) on error."""
    try:
        rows = db.execute(
            text("""
                SELECT p.name AS pname, oi.quantity AS qty, o.created_at AS created_at
                FROM orders o
                JOIN order_items oi ON oi.order_id = o.order_id
                LEFT JOIN products p ON p.product_id = oi.product_id
                LEFT JOIN offline_customer oc ON oc.customer_id = o.offline_customer_id
                LEFT JOIN customer c          ON c.customer_id  = o.customer_id
                WHERE (oc.mobile LIKE :t OR c.mobile LIKE :t)
                ORDER BY o.created_at DESC
                LIMIT 25
            """),
            {"t": tail},
        ).mappings().all()
    except Exception as exc:
        logger.debug("purchased-products lookup failed: %s", exc)
        return [], 0

    names: list[str] = []
    max_qty = 0
    for r in rows:
        nm = (r.get("pname") or "").strip()
        if nm and nm not in names:
            names.append(nm)
        try:
            max_qty = max(max_qty, int(r.get("qty") or 0))
        except (TypeError, ValueError):
            pass
    return names, max_qty


def _customer_tags(orders_n: int, paid_n: int, ltv: float, max_qty: int, last_at) -> list[str]:
    tags: list[str] = ["Existing Customer"]
    if paid_n >= 2 or orders_n >= 2:
        tags.append("Repeat Buyer")
    if ltv >= _HIGH_VALUE_LTV:
        tags.append("High-Value Customer")
    if max_qty >= _WHOLESALE_QTY:
        tags.append("Wholesale Buyer")
    if last_at is not None:
        try:
            from datetime import datetime
            gap_days = (datetime.now() - last_at).days
            if gap_days >= _LONG_GAP_DAYS:
                tags.append("Returning After Long Gap")
        except Exception:
            pass
    return tags


# ─────────────────────────────────────────────────────────────────────────────
# Layer 2 — Product + FAQ knowledge retrieval (ChromaDB, with keyword fallback)
# ─────────────────────────────────────────────────────────────────────────────

def retrieve_knowledge(query: str, k: int = 4) -> str:
    """Top relevant product + FAQ/policy chunks for the message. Vector search via
    ChromaDB; falls back to keyword overlap over the training doc if Chroma is
    unavailable."""
    query = (query or "").strip()
    if not query:
        return ""

    if vs.is_available():
        hits: list[dict] = []
        hits += vs.query(vs.PRODUCT_KNOWLEDGE, query, k=max(2, k - 1))
        hits += vs.query(vs.FAQ_POLICY, query, k=max(2, k - 1))
        # Sort by distance (lower = closer) and keep the best, deduped.
        hits = [h for h in hits if (h.get("document") or "").strip()]
        hits.sort(key=lambda h: h.get("distance") if h.get("distance") is not None else 1e9)
        lines, seen = [], set()
        for h in hits:
            doc = h["document"].strip()
            sig = doc[:60].lower()
            if sig in seen:
                continue
            seen.add(sig)
            lines.append(doc)
            if len(lines) >= k:
                break
        if lines:
            return "RELEVANT KNOWLEDGE (use for the answer; never invent specs/prices):\n- " + "\n- ".join(lines)
        # Chroma up but empty (not yet seeded) → fall through to keyword fallback.

    return _keyword_knowledge(query, k)


def retrieve_sales_examples(query: str, k: int = 3) -> str:
    """Closest operator-taught answers that worked before (Layer 3)."""
    query = (query or "").strip()
    if not query or not vs.is_available():
        return ""
    hits = vs.query(vs.SALES_LEARNING, query, k=k)
    lines = []
    for h in hits:
        meta = h.get("metadata") or {}
        q = (meta.get("question") or h.get("document") or "").strip()
        a = (meta.get("answer") or "").strip()
        # Skip weak matches (cosine distance ~>0.6 means low similarity).
        dist = h.get("distance")
        if dist is not None and dist > 0.6:
            continue
        if a:
            lines.append(f'Q: "{q[:160]}" → A: "{a[:400]}"')
    if not lines:
        return ""
    return ("PROVEN SALES ANSWERS (a human agent answered similar questions like "
            "this before — reuse the wording/approach that worked):\n- " + "\n- ".join(lines))


# ── Keyword fallback (only when Chroma is unavailable) ────────────────────────

_STOP = {"the", "and", "for", "you", "your", "are", "with", "what", "kya", "hai",
         "ka", "ki", "ke", "me", "is", "of", "to", "a"}


def _keyword_knowledge(query: str, k: int) -> str:
    chunks = _load_chunks()
    if not chunks:
        return ""
    q = {w for w in re.sub(r"[^0-9a-zA-Z]+", " ", query.lower()).split()
         if len(w) > 2 and w not in _STOP}
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
            txt = _pdf_text(f) if f.suffix.lower() == ".pdf" else f.read_text(encoding="utf-8", errors="ignore")
        except Exception as exc:
            logger.warning("RAG keyword fallback load failed for %s: %s", f, exc)
            continue
        for para in re.split(r"\n\s*\n", txt):
            para = re.sub(r"\s+", " ", para).strip()
            if len(para) > 40 and len(re.sub(r"[^a-zA-Z]", "", para)) > 25:
                chunks.append(para[:600])
    _chunks, _chunks_sig = chunks, sig
    return chunks


def _pdf_text(path: Path) -> str:
    try:
        import pdfplumber
        with pdfplumber.open(str(path)) as pdf:
            return "\n".join(p.extract_text() or "" for p in pdf.pages[:30])
    except Exception as exc:
        logger.warning("PDF read failed %s: %s", path, exc)
        return ""


# ─────────────────────────────────────────────────────────────────────────────
# Layer 3 — Learn from human operators (auto-learn into sales_learning)
# ─────────────────────────────────────────────────────────────────────────────

def _norm_question(q: str) -> str:
    return re.sub(r"[^0-9a-z]+", " ", (q or "").lower()).strip()


def learn_from_operator(db: Session, session_id: int, operator_reply: str) -> bool:
    """Store (last customer question → operator reply) in the sales_learning vector
    collection so similar future questions reuse this proven answer. Deduped by the
    normalised question (re-teaching the same question UPDATES the answer)."""
    reply = (operator_reply or "").strip()
    if len(reply) < 3 or len(reply) > 1200 or reply.startswith("[media") or reply.startswith("[image"):
        return False

    row = db.execute(
        text("SELECT message FROM chat_messages WHERE session_id=:sid AND sender='user' "
             "ORDER BY timestamp DESC LIMIT 1"),
        {"sid": session_id},
    ).first()
    question = (row[0] if row and row[0] else "").strip()
    if not question or question.startswith("[media") or len(question) < 3:
        return False

    if not vs.is_available():
        logger.info("learn_from_operator: vector store unavailable — skipping learn for session %s", session_id)
        return False

    norm = _norm_question(question)
    if not norm:
        return False
    doc_id = f"sale::{hashlib.sha1(norm.encode('utf-8', 'ignore')).hexdigest()[:12]}"
    n = vs.upsert(
        vs.SALES_LEARNING,
        ids=[doc_id],
        documents=[question[:400]],   # embed the QUESTION → match future questions
        metadatas=[{
            "question": question[:300],
            "answer": reply[:800],
            "session_id": int(session_id),
        }],
    )
    if n:
        logger.info("learn_from_operator: learned sales answer for session %s (q=%r)", session_id, question[:60])
        return True
    return False


# ─────────────────────────────────────────────────────────────────────────────
# Assembled RAG context (injected via generate_reply(extra_context=...))
# ─────────────────────────────────────────────────────────────────────────────

def build_rag_context(db: Session, phone: str, query: str) -> str:
    parts = [
        get_customer_context(db, phone),
        retrieve_knowledge(query),
        retrieve_sales_examples(query),
    ]
    return "\n\n".join(p for p in parts if p)
