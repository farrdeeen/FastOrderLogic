// src/chat/chatApi.js
// Uses the same axiosInstance as the rest of the app so Clerk auth headers
// and the base URL are applied automatically — no duplication.

import api from "../api/axiosInstance";

// GET /chat/conversations
export async function fetchConversations({
  search = "",
  status = "",
  limit = 50,
  offset = 0,
} = {}) {
  const params = {};
  if (search) params.search = search;
  if (status) params.status = status;
  params.limit = limit;
  params.offset = offset;

  const res = await api.get("/chat/conversations", { params });
  return res.data || [];
}

// GET /chat/messages/{session_id}
export async function fetchMessages(
  sessionId,
  { limit = 100, beforeId = null } = {},
) {
  const params = { limit };
  if (beforeId) params.before_id = beforeId;

  const res = await api.get(`/chat/messages/${sessionId}`, { params });
  return res.data || [];
}

// POST /chat/send
export async function sendChatMessage(sessionId, message) {
  const res = await api.post("/chat/send", {
    session_id: sessionId,
    message,
  });
  return res.data;
}

// POST /chat/sessions/{id}/resolve
export async function resolveSession(sessionId) {
  const res = await api.post(`/chat/sessions/${sessionId}/resolve`);
  return res.data;
}

// GET /chat/conversations/count
export async function fetchConversationCount(status = "") {
  const params = status ? { status } : {};
  const res = await api.get("/chat/conversations/count", { params });
  return res.data;
}
