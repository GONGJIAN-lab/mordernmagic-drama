import axios from "axios";

// TikTok minis WebView base URL 是 minis 内部域，
// 相对路径 /api/v1 无法代理到 Railway 后端 → minis 内 fetch 404。
// Vercel web 走 Vercel rewrites 代理 /api/* 到 Railway，相对路径 OK。
// 用 navigator.userAgent 区分 TikTok 客户端。
const isInTikTok =
  typeof navigator !== "undefined" &&
  navigator.userAgent &&
  navigator.userAgent.includes("TikTok")

const baseURL = isInTikTok
  ? "https://api.drama.mordernmagic.com/api/v1"
  : "/api/v1"

export const api = axios.create({
  baseURL,
  timeout: 15000,
})

// 自动附加 JWT
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("mmg_token")
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem("mmg_token")
    }
    return Promise.reject(err)
  }
)

export const STRIPE_PK = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY
