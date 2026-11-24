<script setup lang="ts">
import { computed } from 'vue';
import { useMediaQuery } from '@vueuse/core';
import { Toaster } from 'vue-sonner';
import 'vue-sonner/style.css';

// Desktop (>= 1024px): góc phải dưới. Tablet và mobile: đẩy từ trên xuống, giữa màn hình.
const isDesktop = useMediaQuery('(min-width: 1024px)');
const position = computed(() => (isDesktop.value ? 'bottom-right' : 'top-center'));
</script>

<template>
  <!-- Toaster chỉ chạy phía trình duyệt để SSR không lệch hydrate. -->
  <ClientOnly>
    <Toaster
      theme="dark"
      :position="position"
      :visible-toasts="4"
      :toast-options="{
        classes: {
          toast: 'app-toast',
          description: 'app-toast-description',
          success: 'app-toast-success',
          error: 'app-toast-error',
          warning: 'app-toast-warning',
          info: 'app-toast-info',
        },
      }"
    />
  </ClientOnly>
</template>

<style>
/* Nền bán trong suốt + làm mờ phía sau; màu viền và icon theo loại: xanh lá = thành công, đỏ = lỗi, vàng = cảnh báo. */
.app-toast {
  background: rgba(30, 41, 59, 0.55) !important;
  color: #f8fafc !important;
  border: 1px solid rgba(148, 163, 184, 0.25) !important;
  border-radius: 10px !important;
  -webkit-backdrop-filter: blur(14px) saturate(140%);
  backdrop-filter: blur(14px) saturate(140%);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25) !important;
}
.app-toast .app-toast-description {
  color: #cbd5e1 !important;
}
.app-toast-success {
  background: rgba(16, 185, 129, 0.16) !important;
  border-color: rgba(52, 211, 153, 0.45) !important;
  color: #d1fae5 !important;
}
.app-toast-success [data-icon] {
  color: #34d399;
}
.app-toast-error {
  background: rgba(239, 68, 68, 0.16) !important;
  border-color: rgba(248, 113, 113, 0.45) !important;
  color: #fee2e2 !important;
}
.app-toast-error [data-icon] {
  color: #f87171;
}
.app-toast-warning {
  background: rgba(245, 158, 11, 0.16) !important;
  border-color: rgba(251, 191, 36, 0.45) !important;
  color: #fef3c7 !important;
}
.app-toast-warning [data-icon] {
  color: #fbbf24;
}
.app-toast-info {
  background: rgba(6, 182, 212, 0.16) !important;
  border-color: rgba(34, 211, 238, 0.45) !important;
  color: #cffafe !important;
}
.app-toast-info [data-icon] {
  color: #22d3ee;
}
.app-toast-success .app-toast-description,
.app-toast-error .app-toast-description,
.app-toast-warning .app-toast-description,
.app-toast-info .app-toast-description {
  color: inherit !important;
  opacity: 0.8;
}
</style>
