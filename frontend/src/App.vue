<template>
  <div class="app">
    <router-view />
  </div>
</template>

<script setup>
// 全局 toast/loading 工具
import { showToast, showLoadingToast, closeToast } from "vant";
window.$toast = showToast;
window.$loading = (msg) => showLoadingToast({ message: msg || "加载中...", forbidClick: true });
window.$closeLoading = closeToast;
</script>

<style>
.app { min-height: 100vh; background: #fafafa; }
</style>
