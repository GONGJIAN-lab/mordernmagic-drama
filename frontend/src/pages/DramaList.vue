<template>
  <div class="drama-list">
    <header class="hero">
      <h1>MORDER MAGIC</h1>
      <p>热门短剧 · 每日更新</p>
    </header>
    <van-loading v-if="loading" class="loading" />
    <div v-else class="grid">
      <div v-for="d in dramas" :key="d.slug" class="card" @click="$router.push(`/drama/${d.slug}`)">
        <div class="cover" :style="{ background: gradientFor(d.slug) }">
          <span class="ep-count">全 {{ d.totalEpisodes }} 集</span>
        </div>
        <h3>{{ d.title }}</h3>
        <p class="price">${{ (d.priceCents/100).toFixed(2) }} / 集</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";
import { api } from "../api/client.js";

const dramas = ref([]);
const loading = ref(true);

onMounted(async () => {
  try {
    const { data } = await api.get("/dramas");
    dramas.value = data.data;
  } catch (e) {
    window.$toast("加载失败");
  } finally { loading.value = false; }
});

function gradientFor(id) {
  const colors = ["#1a365d", "#e53e3e", "#38a169", "#d69e2e", "#805ad5"];
  const i = (id.charCodeAt(0) || 0) % colors.length;
  return `linear-gradient(135deg, ${colors[i]}, ${colors[(i+1)%colors.length]})`;
}
</script>

<style scoped>
.drama-list { padding: 16px; padding-bottom: 60px; }
.hero { padding: 24px 0 16px; }
.hero h1 { font-size: 28px; color: #1a365d; margin: 0; }
.hero p { color: #666; margin: 4px 0 0; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.card { background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,0.06); cursor: pointer; }
.cover { aspect-ratio: 9/12; position: relative; display: flex; align-items: flex-end; padding: 8px; }
.ep-count { color: white; font-size: 12px; background: rgba(0,0,0,0.4); padding: 2px 6px; border-radius: 4px; }
.card h3 { margin: 8px 10px 4px; font-size: 15px; }
.price { margin: 0 10px 10px; color: #e53e3e; font-weight: bold; }
.loading { text-align: center; margin: 40px 0; }
</style>
