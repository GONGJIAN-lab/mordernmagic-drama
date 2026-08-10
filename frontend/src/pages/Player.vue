<template>
  <div class="player-page">
    <div v-if="!playUrl && !locked" class="loading">
      <van-loading color="#fff" />
    </div>
    <div v-else-if="locked" class="locked">
      <h2>🔒 第 {{ epNumber }} 集</h2>
      <p>解锁本集后即可观看</p>
      <van-button type="danger" @click="unlock" :loading="paying">支付 $0.99 解锁</van-button>
    </div>
    <div v-else class="player-wrap">
      <video
        ref="videoEl"
        :src="playUrl"
        controls
        playsinline
        autoplay
        muted
        @ended="onEnded"
        @error="onVideoError"
        class="video"
      />
      <div class="info">
        <h2>第 {{ epNumber }} 集</h2>
        <p>{{ drama?.title }}</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../api/client.js";
import { trackCompletePayment } from "../utils/tiktok-pixel.js";

const props = defineProps({ epNumber: [String, Number] });
const route = useRoute();
const router = useRouter();
const playUrl = ref(null);
const locked = ref(false);
const paying = ref(false);
const drama = ref(null);
const videoEl = ref(null);

onMounted(async () => {
  const { data: detail } = await api.get(`/dramas/${route.params.id}`);
  drama.value = detail.data;
  await loadAuth();
});

async function loadAuth() {
  try {
    const { data } = await api.post(`/dramas/${route.params.id}/episodes/${props.epNumber}/play-auth`);
    playUrl.value = data.data.playUrl;
    console.log("playUrl length:", playUrl.value?.length);
  } catch (e) {
    if (e.response?.status === 402) locked.value = true;
    else window.$toast("加载失败");
  }
}

async function unlock() {
  if (!localStorage.getItem("mmg_token")) {
    window.$toast("请先登录");
    router.push("/login");
    return;
  }
  paying.value = true;
  try {
    const { data } = await api.post("/payment/create-checkout", {
      dramaId: route.params.id, epNumber: Number(props.epNumber),
    });
    if (data.data.url) window.location.href = data.data.url;
  } catch (e) { window.$toast("创建支付失败"); }
  finally { paying.value = false; }
}

function onVideoError(e){console.error("Video error:",videoEl.value?.error);console.error("Video src:",videoEl.value?.src);window.$toast("视频错误: "+(videoEl.value?.error?.code||"unknown"))}

function onEnded() {
  window.$toast("已看完本集");
  // TikTok Pixel 上报
  trackCompletePayment({ value: 0.99, contentName: drama.value?.title, contentId: route.params.id });
}
</script>

<style scoped>
.player-page { background: black; min-height: 100vh; color: white; }
.loading { display: flex; align-items: center; justify-content: center; height: 100vh; }
.locked { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; padding: 24px; text-align: center; gap: 16px; }
.player-wrap { width: 100%; max-width: 540px; margin: 0 auto; }
.video { width: 100%; aspect-ratio: 9/16; object-fit: cover; background: black; }
.info { padding: 16px; }
.info h2 { margin: 0 0 4px; font-size: 18px; }
.info p { color: #999; margin: 0; }
</style>
