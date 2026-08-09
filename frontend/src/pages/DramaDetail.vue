<template>
  <div class="drama-detail">
    <div v-if="drama" class="hero" :style="{ background: `linear-gradient(135deg, #1a365d, #e53e3e)` }">
      <button class="back" @click="$router.back()">←</button>
      <h1>{{ drama.title }}</h1>
      <p>{{ drama.description }}</p>
      <div class="meta">
        <span>全 {{ drama.totalEps }} 集</span>
        <span class="price">${{ drama.pricePerEp }} / 集</span>
      </div>
    </div>
    <div class="ep-list">
      <h2>选集</h2>
      <div class="grid">
        <button v-for="ep in drama?.episodes" :key="ep.id" class="ep-btn" @click="play(ep.epNumber)">
          第 {{ ep.epNumber }} 集
          <small v-if="ep.durationSec">{{ ep.durationSec }}s</small>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";
import { useRoute } from "vue-router";
import { api } from "../api/client.js";

const route = useRoute();
const drama = ref(null);

onMounted(async () => {
  const { data } = await api.get(`/dramas/${route.params.id}`);
  drama.value = data.data;
});

function play(epNumber) {
  // 第 1 集免费直接进 player，否则调 create-checkout
  // TODO Phase 2 集成
  window.$router.push(`/drama/${route.params.id}/player/${epNumber}`);
}
</script>

<style scoped>
.drama-detail { min-height: 100vh; background: white; }
.hero { padding: 48px 20px 24px; color: white; position: relative; }
.back { position: absolute; top: 16px; left: 16px; background: rgba(0,0,0,0.3); color: white; border: none; border-radius: 50%; width: 36px; height: 36px; font-size: 18px; }
.hero h1 { margin: 0; font-size: 24px; }
.hero p { opacity: 0.9; margin: 8px 0 0; }
.meta { display: flex; gap: 16px; margin-top: 12px; }
.price { background: rgba(255,255,255,0.2); padding: 4px 12px; border-radius: 4px; }
.ep-list { padding: 20px; }
.ep-list h2 { margin: 0 0 16px; font-size: 18px; }
.grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; }
.ep-btn { aspect-ratio: 1; background: #f3f3f3; border: 1px solid #eee; border-radius: 8px; font-size: 14px; padding: 4px; display: flex; flex-direction: column; align-items: center; justify-content: center; cursor: pointer; }
.ep-btn small { font-size: 10px; color: #999; }
</style>
