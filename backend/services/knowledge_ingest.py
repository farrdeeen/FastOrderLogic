"""
services/knowledge_ingest.py
────────────────────────────
Seeds the ChromaDB collections used by the sales agent's RAG:

  • product_knowledge — one rich doc per catalogue product (Layer 2)
  • faq_policy        — chunked FAQ / shipping / returns / warranty / policy text
                        from training_doc.txt + data/kb/* (Layer 2)

Sales-learning (Layer 3) is written incrementally by
`customer_rag.learn_from_operator`, not seeded here.

All functions are defensive: if the vector store is unavailable they log and
return 0 — seeding must never crash startup or a catalogue refresh.
"""

from __future__ import annotations

import hashlib
import logging
import os
import re
import threading
from pathlib import Path
from typing import Optional

from services import vector_store as vs

logger = logging.getLogger(__name__)

_TRAINING_DOC = Path(os.getenv("TRAINING_DOC_PATH", "data/training_doc.txt"))
_KB_DIR = Path(os.getenv("RAG_KB_DIR", "data/kb"))

# Extra retrieval hints per catalogue category — so a Hinglish browse term like
# "fingerprint" / "anguthha" / "aeps" still pulls the right product docs even when
# the catalogue description doesn't spell them out.
_CATEGORY_KEYWORDS = {
    "biometric fingerprint scanner": "fingerprint scanner biometric thumb anguthha AEPS Aadhaar RD service banking CSP",
    "biometric": "fingerprint scanner biometric thumb AEPS Aadhaar RD service",
    "iris scanner": "iris scanner eye aankh Aadhaar authentication enrolment",
    "gps device": "gps receiver usb location CSP tracking",
    "thermal printer": "thermal receipt printer passbook billing print",
    "printers": "printer receipt passbook billing print",
    "mpos machine": "micro atm mpos card swipe banking withdrawal",
    "pos machine": "pos micro atm card swipe billing",
    "cash counting machine": "note counting cash currency money counter",
    "computer": "computer laptop desktop pc",
}


# ─────────────────────────────────────────────────────────────────────────────
# Products (Layer 2)
# ─────────────────────────────────────────────────────────────────────────────

def _product_document(p: dict) -> str:
    """Build the embeddable text for one product: name, category, price, specs,
    stock and a few retrieval hints — what a customer might describe."""
    name = (p.get("name") or "").strip()
    category = (p.get("category") or "").strip()
    price = p.get("effective_price") or p.get("price_display") or ""
    desc = (p.get("description") or "").strip()
    in_stock = p.get("in_stock")
    stock_txt = "in stock" if in_stock else ("out of stock" if in_stock is False else "")
    hints = _CATEGORY_KEYWORDS.get((category or "").lower(), "")

    parts = [name]
    if category:
        parts.append(f"Category: {category}.")
    if price:
        parts.append(f"Price: {price}.")
    if desc:
        parts.append(desc)
    if stock_txt:
        parts.append(stock_txt + ".")
    if hints:
        parts.append(hints)
    return " ".join(part for part in parts if part).strip()


def _product_id(p: dict) -> str:
    key = (p.get("sku") or p.get("slug") or p.get("name") or "").strip()
    return f"prod::{key}"


def seed_products_from_list(catalogue: list[dict]) -> int:
    """Rebuild product_knowledge from a catalogue list. Recreates the collection so
    discontinued products don't linger. Returns the number of products seeded."""
    if not vs.is_available():
        return 0
    items = [p for p in (catalogue or []) if (p.get("sku") or p.get("slug") or p.get("name"))]
    if not items:
        logger.info("seed_products: empty catalogue — skipping")
        return 0

    vs.recreate_collection(vs.PRODUCT_KNOWLEDGE)
    ids, docs, metas = [], [], []
    seen: set[str] = set()
    for p in items:
        pid = _product_id(p)
        if pid in seen:
            continue
        seen.add(pid)
        ids.append(pid)
        docs.append(_product_document(p))
        metas.append({
            "sku": (p.get("sku") or "").strip(),
            "name": (p.get("name") or "").strip(),
            "category": (p.get("category") or "").strip(),
            "price": str(p.get("effective_price") or p.get("price_display") or ""),
            "link": (p.get("link") or "").strip(),
            "in_stock": bool(p.get("in_stock")) if p.get("in_stock") is not None else False,
        })
    n = vs.upsert(vs.PRODUCT_KNOWLEDGE, ids=ids, documents=docs, metadatas=metas)
    logger.info("seed_products: seeded %d products into product_knowledge", n)
    return n


async def seed_products() -> int:
    """Fetch the live catalogue and seed product_knowledge."""
    if not vs.is_available():
        return 0
    try:
        from services.product_catalogue import get_catalogue
        catalogue = await get_catalogue()
    except Exception as exc:
        logger.warning("seed_products: catalogue fetch failed: %s", exc)
        return 0
    return seed_products_from_list(catalogue)


def schedule_product_reseed(catalogue: list[dict]) -> None:
    """Fire-and-forget product reseed on a daemon thread — used from the catalogue
    refresh hook so embedding (and any first-run model download) never blocks the
    event loop."""
    if not vs.is_available():
        return
    threading.Thread(
        target=lambda: seed_products_from_list(catalogue),
        name="rag-product-reseed",
        daemon=True,
    ).start()


# ─────────────────────────────────────────────────────────────────────────────
# FAQ / policy (Layer 2)
# ─────────────────────────────────────────────────────────────────────────────

def _hash8(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8", "ignore")).hexdigest()[:8]


def _pdf_text(path: Path) -> str:
    try:
        import pdfplumber
        with pdfplumber.open(str(path)) as pdf:
            return "\n".join(pg.extract_text() or "" for pg in pdf.pages[:30])
    except Exception as exc:
        logger.warning("knowledge_ingest: PDF read failed %s: %s", path, exc)
        return ""


def _chunk_text(text: str) -> list[str]:
    """Split policy/FAQ text into reasonably-sized chunks on blank lines and the
    `=====` section separators used in training_doc.txt."""
    text = re.sub(r"=+", "\n\n", text or "")
    chunks: list[str] = []
    for para in re.split(r"\n\s*\n", text):
        para = re.sub(r"[ \t]+", " ", para).strip()
        if not para:
            continue
        # Drop the leading "# FILENAME:" marker line if present.
        para = re.sub(r"^#\s*FILENAME:[^\n]*\n?", "", para).strip()
        if len(para) < 25 or len(re.sub(r"[^a-zA-Z]", "", para)) < 15:
            continue
        # Keep chunks readable; break very long paragraphs at ~700 chars.
        while len(para) > 800:
            cut = para.rfind(". ", 0, 800)
            cut = cut + 1 if cut > 200 else 800
            chunks.append(para[:cut].strip())
            para = para[cut:].strip()
        chunks.append(para)
    return chunks


def _product_faq_rows() -> list[tuple]:
    """Pull per-product FAQs (question, answer, product name) from products.faqs JSON."""
    rows: list[tuple] = []
    try:
        import json as _json
        from database import SessionLocal
        from sqlalchemy import text as _t
        db = SessionLocal()
        try:
            res = db.execute(_t(
                "SELECT name, faqs FROM products WHERE faqs IS NOT NULL AND is_visible = 1"
            )).mappings().all()
        finally:
            db.close()
        for r in res:
            pname = (r.get("name") or "").strip()
            raw = r.get("faqs")
            try:
                data = _json.loads(raw) if isinstance(raw, str) else raw
                if isinstance(data, str):   # faqs is double-encoded JSON
                    data = _json.loads(data)
            except Exception:
                continue
            if not isinstance(data, list):
                continue
            for item in data:
                if isinstance(item, dict):
                    q = str(item.get("question") or item.get("q") or item.get("title") or "").strip()
                    a = str(item.get("answer") or item.get("a") or item.get("content") or "").strip()
                elif isinstance(item, (list, tuple)) and len(item) >= 2:
                    q, a = str(item[0]).strip(), str(item[1]).strip()
                else:
                    continue
                if q and a:
                    rows.append((q, a, pname))
    except Exception as exc:
        logger.warning("product faq pull failed: %s", exc)
    return rows


def seed_faq_policy() -> int:
    """Rebuild faq_policy from training_doc.txt + data/kb/* (txt + pdf) + product FAQs."""
    if not vs.is_available():
        return 0

    sources: list[tuple[str, str]] = []  # (source_name, raw_text)
    if _TRAINING_DOC.exists():
        try:
            sources.append((_TRAINING_DOC.name, _TRAINING_DOC.read_text(encoding="utf-8", errors="ignore")))
        except Exception as exc:
            logger.warning("seed_faq_policy: training doc read failed: %s", exc)
    if _KB_DIR.exists():
        for f in sorted(_KB_DIR.glob("*.txt")):
            try:
                sources.append((f.name, f.read_text(encoding="utf-8", errors="ignore")))
            except Exception as exc:
                logger.warning("seed_faq_policy: %s read failed: %s", f, exc)
        for f in sorted(_KB_DIR.glob("*.pdf")):
            txt = _pdf_text(f)
            if txt:
                sources.append((f.name, txt))

    vs.recreate_collection(vs.FAQ_POLICY)
    ids, docs, metas = [], [], []
    seen: set[str] = set()
    for source_name, raw in sources:
        for chunk in _chunk_text(raw):
            cid = f"faq::{_hash8(chunk)}"
            if cid in seen:
                continue
            seen.add(cid)
            ids.append(cid)
            docs.append(chunk)
            metas.append({"source": source_name})

    # Per-product FAQs from products.faqs JSON.
    faq_n = 0
    for q, a, pname in _product_faq_rows():
        chunk = f"{pname} — Q: {q} A: {a}"
        cid = f"faq::{_hash8(chunk)}"
        if cid in seen:
            continue
        seen.add(cid)
        ids.append(cid)
        docs.append(chunk)
        metas.append({"source": "product_faq", "product": pname})
        faq_n += 1

    if not ids:
        logger.info("seed_faq_policy: no FAQ/policy content")
        return 0
    n = vs.upsert(vs.FAQ_POLICY, ids=ids, documents=docs, metadatas=metas)
    logger.info("seed_faq_policy: seeded %d chunks (%d product FAQs) from %d source(s)",
                n, faq_n, len(sources))
    return n


# ─────────────────────────────────────────────────────────────────────────────
# Full reseed
# ─────────────────────────────────────────────────────────────────────────────

async def reseed_all() -> dict:
    """Rebuild product_knowledge + faq_policy. (sales_learning is left untouched —
    it is grown incrementally from operator chats.)"""
    if not vs.is_available():
        return {"available": False, "products": 0, "faq": 0}
    products = await seed_products()
    faq = seed_faq_policy()
    return {"available": True, "products": products, "faq": faq, **vs.stats()}


def warm_seed_blocking() -> None:
    """Startup warm-up (run on a daemon thread): seed FAQ/policy always, and seed
    products only if the collection is empty (the catalogue pre-warm hook normally
    seeds products, so this just covers the case where that hasn't run)."""
    if not vs.is_available():
        logger.info("warm_seed: vector store unavailable — RAG will use keyword fallback")
        return
    try:
        seed_faq_policy()
    except Exception as exc:
        logger.warning("warm_seed: faq seed failed: %s", exc)
    try:
        if vs.count(vs.PRODUCT_KNOWLEDGE) == 0:
            import asyncio
            asyncio.run(seed_products())
    except Exception as exc:
        logger.warning("warm_seed: product seed failed: %s", exc)


def start_warm_seed() -> None:
    """Kick off warm_seed_blocking on a daemon thread so a slow first-run model
    download never blocks uvicorn startup."""
    threading.Thread(target=warm_seed_blocking, name="rag-warm-seed", daemon=True).start()


def reseed_all_blocking() -> dict:
    """Synchronous reseed for use on a background thread (startup). Runs the async
    product seed in a private event loop so it doesn't need the main loop."""
    if not vs.is_available():
        return {"available": False, "products": 0, "faq": 0}
    import asyncio
    try:
        products = asyncio.run(seed_products())
    except Exception as exc:
        logger.warning("reseed_all_blocking: product seed failed: %s", exc)
        products = 0
    faq = seed_faq_policy()
    logger.info("reseed_all_blocking: products=%s faq=%s", products, faq)
    return {"available": True, "products": products, "faq": faq}
