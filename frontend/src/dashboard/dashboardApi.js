// src/dashboard/dashboardApi.js
import api from "../api/axiosInstance";

export async function fetchDashboardStats() {
  const res = await api.get("/dashboard/stats");
  return res.data;
}

export async function fetchAnalytics(days = 30) {
  const res = await api.get("/dashboard/analytics", { params: { days } });
  return res.data;
}

export async function fetchAiBalance() {
  const res = await api.get("/dashboard/ai-balance");
  return res.data;
}

export async function fetchAiFailures(limit = 50) {
  const res = await api.get("/dashboard/ai-failures", { params: { limit } });
  return res.data || [];
}

export async function fetchRecentConversations(limit = 10) {
  const res = await api.get("/dashboard/recent-conversations", {
    params: { limit },
  });
  return res.data || [];
}

export async function fetchInvoicePending(limit = 50) {
  const res = await api.get("/dashboard/invoice-pending", {
    params: { limit },
  });
  return res.data || [];
}

export async function updateInvoiceNumberForOrders(orderIds = [], invoiceNumber = "") {
  const res = await api.put("/dashboard/invoice-pending/invoice-number", {
    order_ids: orderIds,
    invoice_number: invoiceNumber,
  });
  return res.data;
}

export async function fetchStockReconStatus() {
  const res = await api.get("/dashboard/stock-recon/status");
  return res.data;
}

export async function fetchStockReconLogs(limit = 20) {
  const res = await api.get("/dashboard/stock-recon/logs", {
    params: { limit },
  });
  return res.data || [];
}

export async function startStockRecon() {
  const res = await api.post("/dashboard/stock-recon/start");
  return res.data;
}

export async function stopStockRecon(runId) {
  const res = await api.post("/dashboard/stock-recon/stop", {
    run_id: runId,
  });
  return res.data;
}

export async function completeStockRecon(runId, counts) {
  const res = await api.post("/dashboard/stock-recon/complete", {
    run_id: runId,
    counts,
  });
  return res.data;
}

export async function fetchTrainingDocInfo() {
  const res = await api.get("/dashboard/training-doc");
  return res.data;
}

export async function uploadTrainingDoc(file) {
  const form = new FormData();
  form.append("file", file);
  const res = await api.post("/dashboard/training-doc", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return res.data;
}

export async function deleteTrainingDoc() {
  const res = await api.delete("/dashboard/training-doc");
  return res.data;
}
