<template>
  <video
    :src="src"
    :poster="poster"
    controls
    playsinline
    preload="metadata"
    class="video-player"
  />
</template>

<script setup>
defineProps({ src: String, poster: String });
</script>

<style scoped>
.video-player { width: 100%; background: #000; }
</style>
