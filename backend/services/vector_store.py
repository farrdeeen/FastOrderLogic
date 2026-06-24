"""
services/vector_store.py
────────────────────────
Thin, defensive wrapper around an EMBEDDED ChromaDB (no separate server) used by
the WhatsApp sales agent's hybrid RAG.

Three collections:
  • product_knowledge — one doc per catalogue product (name, specs, price, link)
  • faq_policy        — chunked FAQ / shipping / returns / warranty / policy text
  • sales_learning    — operator-taught (customer question → best reply) pairs

Design rules
  • MULTILINGUAL embeddings (Hindi / Hinglish / typos) — default
    `paraphrase-multilingual-MiniLM-L12-v2` via FastEmbed (ONNX, no torch,
    runs in-process, free). Swappable with the RAG_EMBEDDER env var.
  • GRACEFUL DEGRADATION — if chromadb/fastembed isn't installed or the client
    fails to initialise, every public call becomes a logged no-op returning an
    empty result. The live bot must NEVER crash because RAG is unavailable.
"""

from __future__ import annotations

import os
import logging
import threading
from pathlib import Path
from typing import Optional

# Silence ChromaDB's posthog telemetry (it logs noisy "Failed to send telemetry
# event" warnings on some versions even when disabled via Settings). Must be set
# before chromadb is imported.
os.environ.setdefault("ANONYMIZED_TELEMETRY", "False")
os.environ.setdefault("CHROMA_TELEMETRY_ENABLED", "False")

logger = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────────
_CHROMA_DIR = Path(os.getenv("RAG_CHROMA_DIR", "data/chroma"))
_EMBEDDER = os.getenv("RAG_EMBEDDER", "fastembed").strip().lower()
# FastEmbed model id — multilingual, ~120MB ONNX, strong on Hindi/Hinglish.
_FASTEMBED_MODEL = os.getenv(
    "RAG_EMBED_MODEL", "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
)
# Where FastEmbed downloads/caches the model. Defaults under the Chroma dir so it
# lives wherever Chroma is writable (the service user's HOME may not be).
_EMBED_CACHE = os.getenv("RAG_EMBED_CACHE") or str(_CHROMA_DIR / ".fastembed_cache")

# The only collection names the rest of the app (and the admin API) may touch.
PRODUCT_KNOWLEDGE = "product_knowledge"
FAQ_POLICY = "faq_policy"
SALES_LEARNING = "sales_learning"
COLLECTIONS = (PRODUCT_KNOWLEDGE, FAQ_POLICY, SALES_LEARNING)


# ─────────────────────────────────────────────────────────────────────────────
# Embedding function factory
# ─────────────────────────────────────────────────────────────────────────────

def _build_embedding_function():
    """Return a Chroma-compatible embedding function for the configured backend.

    Raises on failure so the caller can disable the whole store gracefully.
    """
    if _EMBEDDER in ("openai",):
        # Optional cloud embedder (needs a direct OPENAI_API_KEY).
        from chromadb.utils import embedding_functions
        key = os.getenv("OPENAI_API_KEY", "")
        if not key:
            raise RuntimeError("RAG_EMBEDDER=openai but OPENAI_API_KEY is empty")
        model = os.getenv("RAG_EMBED_MODEL", "text-embedding-3-small")
        logger.info("vector_store: using OpenAI embedder model=%s", model)
        return embedding_functions.OpenAIEmbeddingFunction(api_key=key, model_name=model)

    # Default: FastEmbed multilingual (local, ONNX, no torch).
    fn = _FastEmbedFn(_FASTEMBED_MODEL)
    logger.info("vector_store: using FastEmbed multilingual embedder model=%s", _FASTEMBED_MODEL)
    return fn


class _FastEmbedFn:
    """Chroma EmbeddingFunction backed by fastembed.TextEmbedding (multilingual)."""

    def __init__(self, model_name: str):
        from fastembed import TextEmbedding  # imported lazily; raises if missing
        self._model_name = model_name
        try:
            Path(_EMBED_CACHE).mkdir(parents=True, exist_ok=True)
        except Exception:
            pass
        self._model = TextEmbedding(model_name=model_name, cache_dir=_EMBED_CACHE)

    # Chroma calls the function with a list of strings and expects a list of vectors.
    def __call__(self, input):  # noqa: A002 (Chroma's required param name)
        texts = list(input)
        if not texts:
            return []
        return [list(map(float, vec)) for vec in self._model.embed(texts)]

    # Chroma >= 0.5 persists an EF name with each collection; provide a stable one.
    def name(self) -> str:  # pragma: no cover - trivial
        return f"fastembed::{self._model_name}"


# ─────────────────────────────────────────────────────────────────────────────
# Store singleton
# ─────────────────────────────────────────────────────────────────────────────

class _VectorStore:
    def __init__(self):
        self.available = False
        self._client = None
        self._ef = None
        self._collections: dict[str, object] = {}
        self._lock = threading.Lock()
        self._init()

    def _init(self) -> None:
        try:
            import chromadb
            from chromadb.config import Settings

            _CHROMA_DIR.mkdir(parents=True, exist_ok=True)
            self._ef = _build_embedding_function()
            self._client = chromadb.PersistentClient(
                path=str(_CHROMA_DIR),
                settings=Settings(anonymized_telemetry=False, allow_reset=True),
            )
            # Touch all collections up front so embedding/config mismatches surface now.
            for name in COLLECTIONS:
                self._get_collection(name)
            self.available = True
            logger.info("vector_store: ChromaDB ready at %s (embedder=%s)", _CHROMA_DIR, _EMBEDDER)
        except Exception as exc:
            self.available = False
            logger.warning(
                "vector_store: DISABLED (RAG falls back to keyword search). Reason: %s", exc
            )

    def _get_collection(self, name: str):
        if name not in COLLECTIONS:
            raise ValueError(f"unknown collection: {name!r}")
        coll = self._collections.get(name)
        if coll is None:
            coll = self._client.get_or_create_collection(
                name=name,
                embedding_function=self._ef,
                metadata={"hnsw:space": "cosine"},
            )
            self._collections[name] = coll
        return coll

    # ── Public ops (all guard on availability) ────────────────────────────────

    def query(self, collection: str, text: str, k: int = 4, where: Optional[dict] = None) -> list[dict]:
        if not self.available or not (text or "").strip():
            return []
        try:
            res = self._get_collection(collection).query(
                query_texts=[text],
                n_results=max(1, k),
                where=where or None,
                include=["documents", "metadatas", "distances"],
            )
        except Exception as exc:
            logger.warning("vector_store.query(%s) failed: %s", collection, exc)
            return []
        out: list[dict] = []
        ids = (res.get("ids") or [[]])[0]
        docs = (res.get("documents") or [[]])[0]
        metas = (res.get("metadatas") or [[]])[0]
        dists = (res.get("distances") or [[]])[0]
        for i, doc in enumerate(docs):
            out.append({
                "id": ids[i] if i < len(ids) else None,
                "document": doc,
                "metadata": metas[i] if i < len(metas) else {},
                "distance": dists[i] if i < len(dists) else None,
            })
        return out

    def upsert(self, collection: str, ids: list[str], documents: list[str],
               metadatas: Optional[list[dict]] = None) -> int:
        if not self.available or not ids:
            return 0
        try:
            with self._lock:
                self._get_collection(collection).upsert(
                    ids=ids, documents=documents, metadatas=metadatas
                )
            return len(ids)
        except Exception as exc:
            logger.warning("vector_store.upsert(%s) failed: %s", collection, exc)
            return 0

    def delete(self, collection: str, ids: list[str]) -> int:
        if not self.available or not ids:
            return 0
        try:
            with self._lock:
                self._get_collection(collection).delete(ids=ids)
            return len(ids)
        except Exception as exc:
            logger.warning("vector_store.delete(%s) failed: %s", collection, exc)
            return 0

    def count(self, collection: str) -> int:
        if not self.available:
            return 0
        try:
            return self._get_collection(collection).count()
        except Exception as exc:
            logger.warning("vector_store.count(%s) failed: %s", collection, exc)
            return 0

    def list_entries(self, collection: str, limit: int = 50, offset: int = 0) -> list[dict]:
        if not self.available:
            return []
        try:
            res = self._get_collection(collection).get(
                limit=max(1, limit), offset=max(0, offset),
                include=["documents", "metadatas"],
            )
        except Exception as exc:
            logger.warning("vector_store.list_entries(%s) failed: %s", collection, exc)
            return []
        out: list[dict] = []
        ids = res.get("ids") or []
        docs = res.get("documents") or []
        metas = res.get("metadatas") or []
        for i, _id in enumerate(ids):
            out.append({
                "id": _id,
                "document": docs[i] if i < len(docs) else "",
                "metadata": metas[i] if i < len(metas) else {},
            })
        return out

    def get_one(self, collection: str, doc_id: str) -> Optional[dict]:
        if not self.available or not doc_id:
            return None
        try:
            res = self._get_collection(collection).get(
                ids=[doc_id], include=["documents", "metadatas"]
            )
        except Exception as exc:
            logger.warning("vector_store.get_one(%s) failed: %s", collection, exc)
            return None
        ids = res.get("ids") or []
        if not ids:
            return None
        docs = res.get("documents") or []
        metas = res.get("metadatas") or []
        return {
            "id": ids[0],
            "document": docs[0] if docs else "",
            "metadata": metas[0] if metas else {},
        }

    def recreate_collection(self, collection: str) -> bool:
        """Drop & recreate a collection — used by reseed so discontinued products
        / removed FAQ chunks don't linger."""
        if not self.available:
            return False
        if collection not in COLLECTIONS:
            raise ValueError(f"unknown collection: {collection!r}")
        try:
            with self._lock:
                try:
                    self._client.delete_collection(collection)
                except Exception:
                    pass  # may not exist yet
                self._collections.pop(collection, None)
                self._get_collection(collection)
            return True
        except Exception as exc:
            logger.warning("vector_store.recreate_collection(%s) failed: %s", collection, exc)
            return False

    def replace_all(self, collection: str, ids: list[str], documents: list[str],
                    metadatas: Optional[list[dict]] = None) -> int:
        """Make the collection match exactly the given ids — WITHOUT a destructive
        drop. Upserts the new set, then deletes only stale ids. Avoids the empty
        window that recreate_collection causes (which made dashboard counts flicker
        to 0 mid-reseed)."""
        if not self.available:
            return 0
        if collection not in COLLECTIONS:
            raise ValueError(f"unknown collection: {collection!r}")
        try:
            coll = self._get_collection(collection)
            with self._lock:
                if ids:
                    coll.upsert(ids=ids, documents=documents, metadatas=metadatas)
                existing = coll.get(include=[]).get("ids") or []
                keep = set(ids)
                stale = [i for i in existing if i not in keep]
                if stale:
                    coll.delete(ids=stale)
            return len(ids)
        except Exception as exc:
            logger.warning("vector_store.replace_all(%s) failed: %s", collection, exc)
            return 0

    def stats(self) -> dict:
        return {
            "available": self.available,
            "embedder": _EMBEDDER,
            "embed_model": _FASTEMBED_MODEL if _EMBEDDER == "fastembed" else os.getenv("RAG_EMBED_MODEL", ""),
            "path": str(_CHROMA_DIR),
            "collections": {name: self.count(name) for name in COLLECTIONS},
        }


# ── Lazy module-level singleton ───────────────────────────────────────────────
_store: Optional[_VectorStore] = None
_store_lock = threading.Lock()


def get_store() -> _VectorStore:
    global _store
    if _store is None:
        with _store_lock:
            if _store is None:
                _store = _VectorStore()
    return _store


# ── Module-level convenience wrappers ─────────────────────────────────────────

def is_available() -> bool:
    return get_store().available


def query(collection: str, text: str, k: int = 4, where: Optional[dict] = None) -> list[dict]:
    return get_store().query(collection, text, k=k, where=where)


def upsert(collection: str, ids: list[str], documents: list[str],
           metadatas: Optional[list[dict]] = None) -> int:
    return get_store().upsert(collection, ids, documents, metadatas)


def delete(collection: str, ids: list[str]) -> int:
    return get_store().delete(collection, ids)


def count(collection: str) -> int:
    return get_store().count(collection)


def list_entries(collection: str, limit: int = 50, offset: int = 0) -> list[dict]:
    return get_store().list_entries(collection, limit=limit, offset=offset)


def get_one(collection: str, doc_id: str) -> Optional[dict]:
    return get_store().get_one(collection, doc_id)


def recreate_collection(collection: str) -> bool:
    return get_store().recreate_collection(collection)


def replace_all(collection: str, ids: list[str], documents: list[str],
                metadatas: Optional[list[dict]] = None) -> int:
    return get_store().replace_all(collection, ids, documents, metadatas)


def stats() -> dict:
    return get_store().stats()
