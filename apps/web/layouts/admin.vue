<script setup lang="ts">
import { provide } from 'vue';
import { useHead, useRoute } from '#imports';
import { UI_VARIANT_KEY } from '~/utils/form-ui';
import { useAdminAccess } from '~/composables/useAdminAccess';

provide(UI_VARIANT_KEY, 'admin');

// Geist chỉ dùng ở trang quản trị nên chỉ nạp tại đây, không tải cho trang người dùng.
useHead({
  link: [
    {
      rel: 'stylesheet',
      href: 'https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap',
    },
  ],
});

const route = useRoute();
// Chỉ admin mới thấy khung quản trị (header/sidebar); người khác chỉ thấy trang 404.
const { isAdmin } = useAdminAccess();

// Chỉ giữ các mục đã hoàn thiện; mục chưa làm xong không hiện trong menu.
const adminNavItems = [
  {
    to: '/admin/stats',
    labelVi: 'Thống kê',
    icon: 'lucide:bar-chart-3',
  },
  {
    to: '/admin/topups',
    labelVi: 'Duyệt đơn VietQR',
    icon: 'lucide:receipt',
  },
  {
    to: '/admin/ops',
    labelVi: 'Trạng thái hệ thống',
    icon: 'lucide:server-cog',
  },
  {
    to: '/admin/users',
    labelVi: 'Tài khoản',
    icon: 'lucide:users',
  },
  {
    to: '/admin/takedown',
    labelVi: 'Gỡ nội dung',
    icon: 'lucide:shield-x',
  },
  {
    to: '/admin/audit',
    labelVi: 'Nhật ký Admin',
    icon: 'lucide:scroll-text',
  },
] as const;
</script>

<template>
  <!-- Layout Admin phong cách Vercel Docs: nền #0A0A0A, viền 1px, font Geist, Left Sidebar 220px -->
  <div
    data-testid="layout-admin"
    class="flex min-h-dvh w-full max-w-[100vw] flex-col overflow-x-hidden bg-background font-geist text-foreground antialiased"
  >
    <header
      v-if="isAdmin"
      class="fixed inset-x-0 top-0 z-40 flex h-16 items-center justify-between border-b bg-background px-4 sm:px-6"
    >
      <div class="flex min-w-0 items-center gap-3 text-sm">
        <NuxtLink
          to="/"
          class="touch-target flex min-h-[48px] items-center gap-2 font-semibold tracking-tight text-[#EDEDED]"
        >
          <Icon name="lucide:triangle" class="h-4 w-4 fill-current" />
          <span>flowxis</span>
        </NuxtLink>
        <span class="text-muted-foreground/50">/</span>
        <NuxtLink to="/admin" class="truncate text-muted-foreground transition hover:text-foreground">
          Quản trị
        </NuxtLink>
      </div>
      <NuxtLink
        to="/"
        class="touch-target inline-flex min-h-[48px] items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
      >
        <Icon name="lucide:arrow-up-left" class="h-4 w-4" />
        <span class="hidden sm:inline">Về Kho Công Cụ AI</span>
      </NuxtLink>
    </header>

    <!-- Chừa chỗ cho header cố định cao 64px; desktop chừa thêm 220px cho sidebar cố định -->
    <div
      class="flex min-w-0 flex-1 flex-col"
      :class="isAdmin ? 'pt-16 lg:pl-[220px]' : ''"
    >
      <!-- Mobile: thanh menu ngang dính dưới header. Desktop: sidebar cố định bên trái, cuộn riêng khi dài -->
      <aside
        v-if="isAdmin"
        aria-label="Thanh điều hướng quản trị"
        data-testid="admin-left-sidebar"
        class="sticky top-16 z-30 w-full shrink-0 border-b bg-background lg:fixed lg:bottom-0 lg:left-0 lg:top-16 lg:w-[220px] lg:overflow-y-auto lg:border-b-0 lg:border-r"
      >
        <nav class="p-3 lg:py-6">
          <p class="px-3 pb-2 text-sm font-medium text-muted-foreground">Quản trị</p>
          <ul class="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
            <li v-for="item in adminNavItems" :key="item.to" class="shrink-0 lg:shrink">
              <NuxtLink
                :to="item.to"
                class="touch-target flex min-h-[48px] min-w-[48px] items-center gap-2.5 rounded-md px-3 py-2 text-[15px] transition lg:min-h-[44px]"
                :class="
                  route.path === item.to
                    ? 'bg-accent font-medium text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground'
                "
              >
                <Icon :name="item.icon" class="h-4 w-4 shrink-0" />
                <span class="truncate">{{ item.labelVi }}</span>
              </NuxtLink>
            </li>
          </ul>
        </nav>
      </aside>

      <main class="min-w-0 flex-1 px-4 py-8 sm:px-8 lg:px-12 lg:py-10">
        <div class="mx-auto w-full max-w-6xl">
          <slot />
        </div>
      </main>
    </div>
  </div>
</template>
