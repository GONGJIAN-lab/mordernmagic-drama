<template>
  <div class="lock-mask">
    <div class="content">
      <div class="icon">🔒</div>
      <h3>本集需要解锁</h3>
      <p>¥ ${{ price }} 解锁第 {{ epNumber }} 集</p>
      <slot name="action" />
    </div>
  </div>
</template>

<script setup>
defineProps({ price: { type: [String, Number], default: "0.99" }, epNumber: [String, Number] });
</script>

<style scoped>
.lock-mask { position: absolute; inset: 0; background: rgba(0,0,0,0.85); display: flex; align-items: center; justify-content: center; }
.content { text-align: center; color: white; padding: 24px; }
.icon { font-size: 48px; }
.content h3 { margin: 16px 0 8px; }
.content p { color: #ccc; margin: 0 0 24px; }
</style>
