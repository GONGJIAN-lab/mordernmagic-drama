import axios from "axios";

const API_URL = import.meta.env.VITE_API_URL || "";

export const api = axios.create({
  baseURL: API_URL ? `${API_URL}/api/v1` : "/api/v1",
  timeout: 15000,
});

// 自动附加 JWT
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("mmg_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem("mmg_token");
    }
    return Promise.reject(err);
  }
);

export const STRIPE_PK = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
