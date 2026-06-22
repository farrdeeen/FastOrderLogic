# RAG Knowledge Base (ChromaDB) — Ops Guide

The WhatsApp sales agent (`Aria`) answers using a 5-layer context. This module
adds the retrieval layers on top of the existing system.

| Layer | Source | Code |
|---|---|---|
| 1. Core behaviour | `data/training_doc.txt` (human-curated) + base prompt | `services/ai_service.py` |
| 2. Product + FAQ knowledge | **ChromaDB** `product_knowledge`, `faq_policy` | `services/knowledge_ingest.py` |
| 3. Sales learning | **ChromaDB** `sales_learning` (operator-taught) | `services/customer_rag.py` |
| 4. Customer relationship | MySQL (tags, LTV, order history) | `services/customer_rag.py` |
| 5. Recent memory | chat history | `services/chat_service.py` |

Vector store is **embedded ChromaDB** (no server) with **multilingual** FastEmbed
embeddings (`paraphrase-multilingual-MiniLM-L12-v2`) — strong on Hindi/Hinglish +
typos. Everything **degrades gracefully**: if `chromadb`/`fastembed` are missing,
retrieval falls back to keyword search and the bot keeps working.

## Environment variables (optional — sane defaults)

| Var | Default | Notes |
|---|---|---|
| `RAG_CHROMA_DIR` | `data/chroma` | **Set to an absolute path OUTSIDE the repo on the server** (e.g. `/var/www/fol_chroma`) so `git clean -fd`/`git reset` on deploy never touches operator-learned data. |
| `RAG_EMBEDDER` | `fastembed` | `fastembed` (local, multilingual) or `openai` (needs `OPENAI_API_KEY`). |
| `RAG_EMBED_MODEL` | `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` | Any FastEmbed-supported model. |
| `RAG_HIGH_VALUE_LTV` | `15000` | ₹ threshold for the High-Value tag. |
| `RAG_WHOLESALE_QTY` | `5` | Single-line qty for the Wholesale tag. |
| `RAG_LONG_GAP_DAYS` | `120` | Days idle for the Returning-After-Gap tag. |

## Seeding

- **On startup** (non-blocking daemon thread): FAQ/policy seeded from
  `training_doc.txt` + `data/kb/*`; products seeded if the collection is empty.
- **On catalogue refresh** (hourly): `product_knowledge` re-synced automatically.
- **Manual:** `POST /knowledge/reseed` (admin) rebuilds products + FAQ.
  `sales_learning` is NEVER wiped by a reseed.

First startup downloads the ~120MB embedding model once (needs outbound internet).

## Admin API (`require_user`)

- `GET /knowledge/stats`
- `GET /knowledge/{collection}?q=&limit=&offset=`
- `PUT /knowledge/{collection}/{id}` (edit; re-embeds)
- `DELETE /knowledge/{collection}/{id}`
- `POST /knowledge/reseed`

Dashboard UI: **Knowledge** nav item → search / edit taught answers / prune /
reseed.

## Learning loop

Operator replies (dashboard `POST /chat/send`) are embedded into `sales_learning`
as `customer question → best reply`, deduped by the normalised question
(re-teaching the same question updates the answer). This **replaces** the old
behaviour of appending to `training_doc.txt` (which now stays human-curated).
