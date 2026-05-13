import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://127.0.0.1:8000",
});

api.interceptors.request.use(
  async (config) => {
    if (
      window.Clerk &&
      window.Clerk.loaded &&
      window.Clerk.session
    ) {
      const token = await window.Clerk.session.getToken();

      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
    return config;
  },
  (error) => Promise.reject(error)
);

export default api;
