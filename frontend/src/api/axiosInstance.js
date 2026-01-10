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
      console.log("CLERK TOKEN SENT:", token); // 👈 ADD THIS

      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
    console.log("REQUEST HEADERS:", config.headers); // 👈 ADD THIS
    return config;
  },
  (error) => Promise.reject(error)
);

export default api;
