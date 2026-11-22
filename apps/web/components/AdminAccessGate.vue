<script setup lang="ts">
import { Button } from '@/components/ui/button';

defineProps<{ pending: boolean; admin: boolean }>();
</script>

<template>
  <!-- Chờ kiểm tra phiên xong mới quyết định, tránh nhấp nháy 403 -->
  <section
    v-if="pending"
    data-testid="admin-auth-loading-state"
    class="flex min-h-[320px] flex-col items-center justify-center gap-3 text-center"
  >
    <Icon name="lucide:loader-2" class="h-6 w-6 animate-spin text-muted-foreground" />
    <p class="text-sm text-muted-foreground">Đang kiểm tra quyền quản trị viên...</p>
  </section>

  <!-- Không phải admin: giả như trang không tồn tại, không lộ giao diện quản trị -->
  <section
    v-else-if="!admin"
    data-testid="admin-not-found-state"
    class="flex min-h-[320px] flex-col items-center justify-center text-center"
  >
    <h1 class="text-2xl font-semibold tracking-tight">404 — Không tìm thấy trang</h1>
    <p class="mt-2 max-w-md text-base text-muted-foreground">
      Trang bạn tìm kiếm không tồn tại hoặc đã bị di chuyển.
    </p>
    <div class="mt-6">
      <Button as-child variant="outline">
        <NuxtLink to="/">
          <Icon name="lucide:arrow-left" class="h-4 w-4" />
          <span>Về trang chủ</span>
        </NuxtLink>
      </Button>
    </div>
  </section>

  <slot v-else />
</template>
