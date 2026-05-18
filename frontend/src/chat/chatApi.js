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

// GET /chat/conversations/by-id/{session_id}
export async function fetchConversation(sessionId) {
  const res = await api.get(`/chat/conversations/by-id/${sessionId}`);
  return res.data;
}

// GET /chat/recent-user-messages
// Lightweight fallback for production servers where websocket fanout may miss
// cross-worker webhook events.
export async function fetchRecentUserMessages({
  since,
  afterId,
  latest = false,
  limit = 50,
} = {}) {
  const params = { limit };
  if (since) params.since = since;
  if (afterId !== undefined && afterId !== null) params.after_id = afterId;
  if (latest) params.latest = true;

  const res = await api.get("/chat/recent-user-messages", { params });
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

// GET /chat/saved-replies
export async function fetchSavedReplies() {
  const res = await api.get("/chat/saved-replies");
  return res.data || [];
}

// POST /chat/saved-replies  (save reusable text + optional photo)
export async function createSavedReply({ title, message = "", file = null }) {
  const form = new FormData();
  form.append("title", title || "");
  form.append("message", message || "");
  if (file) form.append("file", file);

  const res = await api.post("/chat/saved-replies", form);
  return res.data;
}

// DELETE /chat/saved-replies/{id}
export async function deleteSavedReply(replyId) {
  const res = await api.delete(`/chat/saved-replies/${replyId}`);
  return res.data;
}

// POST /chat/saved-replies/{id}/send
export async function sendSavedReply(sessionId, replyId) {
  const res = await api.post(`/chat/saved-replies/${replyId}/send`, {
    session_id: sessionId,
  });
  return res.data;
}

// GET /chat/products/search
export async function searchChatProducts(query = "") {
  const res = await api.get("/chat/products/search", {
    params: { query, limit: 12 },
  });
  return res.data || [];
}

// POST /chat/products/send
export async function sendChatProduct(sessionId, product) {
  const res = await api.post("/chat/products/send", {
    session_id: sessionId,
    sku: product?.sku || "",
    name: product?.name || "",
    query: product?.sku || product?.name || "",
  });
  return res.data;
}

// POST /chat/payment-request
export async function sendChatPaymentRequest(sessionId, amount) {
  const res = await api.post("/chat/payment-request", {
    session_id: sessionId,
    amount: Number(amount),
  });
  return res.data;
}

// POST /chat/refine-message
export async function refineChatMessage(message) {
  const res = await api.post("/chat/refine-message", { message });
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

// POST /chat/sessions/{id}/save-contact  (save WA contact into customer table)
export async function saveChatContact(sessionId, { name, phone }) {
  const res = await api.post(`/chat/sessions/${sessionId}/save-contact`, {
    name,
    phone,
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

// POST /chat/sessions/{id}/flag
export async function updateSessionFlag(sessionId, flag) {
  const res = await api.post(`/chat/sessions/${sessionId}/flag`, { flag });
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
