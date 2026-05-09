// src/chat/chatApi.js
// Uses the same axiosInstance as the rest of the app so Clerk auth headers
// and the base URL are applied automatically — no duplication.

import api from "../api/axiosInstance";

export function getChatWsUrl() {
  const base = api.defaults.baseURL || window.location.origin;
  const url = new URL(base, window.location.origin);
  const rootPath = url.pathname.replace(/\/$/, "");
  url.pathname = `${rootPath}/chat/ws`;
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.search = "";
  return url.toString();
}

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

// POST /chat/send  (plain text — manual agent message)
export async function sendChatMessage(sessionId, message) {
  const res = await api.post("/chat/send", {
    session_id: sessionId,
    message,
  });
  return res.data;
}

// POST /chat/send-media  (operator image/file upload)
export async function uploadChatMedia(sessionId, file, caption = "") {
  const form = new FormData();
  form.append("session_id", String(sessionId));
  form.append("caption", caption || "");
  form.append("file", file);

  const res = await api.post("/chat/send-media", form);
  return res.data;
}

// POST /chat/send-dispatch-slip  (tracking link + dispatch PDF)
export async function sendDispatchSlip({ sessionId, orderId }) {
  const res = await api.post("/chat/send-dispatch-slip", {
    session_id: sessionId,
    order_id: orderId,
  });
  return res.data;
}

// POST /chat/send-order-confirmation  (sends the approved WA template)
// phone must be E.164 without '+', e.g. "919311886444"
export async function sendOrderConfirmation({
  phone,
  customerName,
  orderId,
  amount,
  sessionId = null,
}) {
  const res = await api.post("/chat/send-order-confirmation", {
    phone,
    customer_name: customerName,
    order_id: orderId,
    amount,
    session_id: sessionId,
  });
  return res.data;
}

// POST /chat/sessions/{id}/resolve
export async function resolveSession(sessionId) {
  const res = await api.post(`/chat/sessions/${sessionId}/resolve`);
  return res.data;
}

// POST /chat/toggle-human
export async function toggleHumanMode(sessionId, phone, isHuman) {
  const res = await api.post("/chat/toggle-human", {
    session_id: sessionId,
    phone,
    is_human: isHuman,
  });
  return res.data;
}

// GET /chat/conversations/count
export async function fetchConversationCount(status = "") {
  const params = status ? { status } : {};
  const res = await api.get("/chat/conversations/count", { params });
  return res.data;
}
