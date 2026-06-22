// src/knowledge/knowledgeApi.js
// Admin client for the RAG knowledge base (ChromaDB). Uses the shared
// axiosInstance so Clerk auth + base URL are applied automatically.

import api from "../api/axiosInstance";

export async function fetchKnowledgeStats() {
  const res = await api.get("/knowledge/stats");
  return res.data || {};
}

// List recent entries, or vector-search when `q` is provided.
export async function fetchKnowledgeEntries(collection, { q = "", limit = 100, offset = 0 } = {}) {
  const params = { limit, offset };
  if (q) params.q = q;
  const res = await api.get(`/knowledge/${collection}`, { params });
  return res.data || { items: [] };
}

export async function updateKnowledgeEntry(collection, id, { document, metadata } = {}) {
  const res = await api.put(`/knowledge/${collection}/${encodeURIComponent(id)}`, {
    document,
    metadata,
  });
  return res.data;
}

export async function deleteKnowledgeEntry(collection, id) {
  const res = await api.delete(`/knowledge/${collection}/${encodeURIComponent(id)}`);
  return res.data;
}

export async function reseedKnowledge() {
  const res = await api.post("/knowledge/reseed");
  return res.data;
}
