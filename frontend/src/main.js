import { createApp } from "vue";
import { createRouter, createWebHistory } from "vue-router";
import Vant from "vant";
import "vant/lib/index.css";
import "./assets/main.css";
import App from "./App.vue";
import { initTikTokPixel } from "./utils/tiktok-pixel.js";

import DramaList from "./pages/DramaList.vue";
import DramaDetail from "./pages/DramaDetail.vue";
import Player from "./pages/Player.vue";

const routes = [
  { path: "/", component: DramaList },
  { path: "/drama/:id", component: DramaDetail },
  { path: "/drama/:id/player/:epNumber", component: Player, props: true },
];

const router = createRouter({ history: createWebHistory(), routes });

const app = createApp(App);
app.use(router);
app.use(Vant);
app.mount("#app");

// TikTok Pixel 初始化
initTikTokPixel(import.meta.env.VITE_TIKTOK_PIXEL_ID);
