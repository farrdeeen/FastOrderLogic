"""
routes/knowledge.py
───────────────────
Admin API for the sales agent's RAG knowledge base (ChromaDB).

Lets operators/admins inspect what the bot has learned and curate it:
  • GET    /knowledge/stats                 — counts per collection + status
  • GET    /knowledge/{collection}          — list or search entries
  • PUT    /knowledge/{collection}/{id}     — edit an entry (re-embeds)
  • DELETE /knowledge/{collection}/{id}     — prune an entry
  • POST   /knowledge/reseed                — rebuild product + FAQ collections

All endpoints require an authenticated dashboard user.
"""

import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from auth.clerk_auth import get_current_user as require_user
from services import vector_store as vs
from services import knowledge_ingest as ki

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/knowledge", tags=["Knowledge"])

# Human-friendly labels for the admin UI.
_COLLECTION_LABELS = {
    vs.PRODUCT_KNOWLEDGE: "Product Knowledge",
    vs.FAQ_POLICY: "FAQ & Policies",
    vs.SALES_LEARNING: "Sales Learning (from operators)",
}


class EntryUpdate(BaseModel):
    document: Optional[str] = None
    metadata: Optional[dict] = None


def _require_collection(collection: str) -> str:
    if collection not in vs.COLLECTIONS:
        raise HTTPException(status_code=404, detail=f"Unknown collection: {collection}")
    return collection


def _require_available() -> None:
    if not vs.is_available():
        raise HTTPException(
            status_code=503,
            detail="Knowledge base (vector store) is unavailable on the server. "
                   "Check that chromadb + fastembed are installed.",
        )


@router.get("/stats")
def knowledge_stats(_=Depends(require_user)):
    s = vs.stats()
    s["labels"] = _COLLECTION_LABELS
    return s


@router.get("/{collection}")
def list_or_search(
    collection: str,
    q: str = Query("", description="Search query; empty lists recent entries"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    _=Depends(require_user),
):
    _require_collection(collection)
    _require_available()
    query = (q or "").strip()
    if query:
        rows = vs.query(collection, query, k=limit)
        return {"collection": collection, "mode": "search", "query": query, "count": len(rows), "items": rows}
    rows = vs.list_entries(collection, limit=limit, offset=offset)
    return {
        "collection": collection,
        "mode": "list",
        "total": vs.count(collection),
        "offset": offset,
        "count": len(rows),
        "items": rows,
    }


@router.put("/{collection}/{entry_id}")
def update_entry(collection: str, entry_id: str, body: EntryUpdate, _=Depends(require_user)):
    _require_collection(collection)
    _require_available()
    existing = vs.get_one(collection, entry_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Entry not found")

    document = body.document if body.document is not None else existing.get("document") or ""
    metadata = dict(existing.get("metadata") or {})
    if body.metadata:
        metadata.update(body.metadata)
    if not (document or "").strip():
        raise HTTPException(status_code=400, detail="Document text cannot be empty")

    n = vs.upsert(collection, ids=[entry_id], documents=[document], metadatas=[metadata])
    if not n:
        raise HTTPException(status_code=500, detail="Failed to update entry")
    return {"success": True, "id": entry_id, "entry": vs.get_one(collection, entry_id)}


@router.delete("/{collection}/{entry_id}")
def delete_entry(collection: str, entry_id: str, _=Depends(require_user)):
    _require_collection(collection)
    _require_available()
    if not vs.get_one(collection, entry_id):
        raise HTTPException(status_code=404, detail="Entry not found")
    n = vs.delete(collection, [entry_id])
    return {"success": bool(n), "id": entry_id}


@router.post("/reseed")
async def reseed(_=Depends(require_user)):
    """Rebuild product_knowledge + faq_policy from the live catalogue + docs.
    sales_learning (operator-taught answers) is preserved."""
    _require_available()
    # Run the blocking embed work off the event loop.
    result = await asyncio.to_thread(ki.reseed_all_blocking)
    return {"success": result.get("available", False), **result, **vs.stats()}
