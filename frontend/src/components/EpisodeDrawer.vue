<template>
  <van-popup v-model:show="show" position="bottom" :style="{ height: '70%' }" round>
    <div class="drawer">
      <h3>选集</h3>
      <div class="grid">
        <button v-for="ep in episodes" :key="ep.id" class="ep-btn" :class="{ active: ep.epNumber === current }" @click="$emit('select', ep.epNumber)">
          {{ ep.epNumber }}
        </button>
      </div>
    </div>
  </van-popup>
</template>

<script setup>
defineProps({ show: Boolean, episodes: Array, current: [String, Number] });
defineEmits(["update:show", "select"]);
</script>

<style scoped>
.drawer { padding: 20px; }
.drawer h3 { margin: 0 0 16px; }
.grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; }
.ep-btn { aspect-ratio: 1; background: #f3f3f3; border: none; border-radius: 8px; }
.ep-btn.active { background: #e53e3e; color: white; }
</style>
