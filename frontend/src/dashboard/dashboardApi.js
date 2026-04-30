// src/dashboard/dashboardApi.js
import api from "../api/axiosInstance";

export async function fetchDashboardStats() {
  const res = await api.get("/dashboard/stats");
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
