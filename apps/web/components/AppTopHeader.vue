<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "#imports";
import type { AccountTier, UserRole } from "@flowxis/contracts";
import { useAuthDialog } from "~/composables/useAuthDialog";
import { formatNumberVi } from "~/utils/catalog";

const props = withDefaults(
  defineProps<{
    balance?: number | null;
    held?: number | null;
    tier?: AccountTier | null;
    email?: string | null;
    role?: UserRole | null;
    authPending?: boolean;
  }>(),
  {
    balance: null,
    held: null,
    tier: null,
    email: null,
    role: null,
    authPending: false,
  },
);

const route = useRoute();
const { open: openAuthDialog } = useAuthDialog();

const baseNavItems = [
  {
    to: "/",
    labelVi: "Kho Công Cụ AI",
    icon: "lucide:layout-grid",
  },
  {
    to: "/tiktok-downloader",
    labelVi: "Tải TikTok",
    icon: "lucide:download",
  },
] as const;

const isLoggedIn = computed<boolean>(() => Boolean(props.email));

// Lịch sử tác vụ chỉ hiển thị khi đã đăng nhập, đứng ngay sau Tải TikTok.
const navItems = computed(() =>
  isLoggedIn.value
    ? [
        ...baseNavItems,
        {
          to: "/tasks",
          labelVi: "Lịch sử tác vụ",
          icon: "lucide:history",
        },
      ]
    : baseNavItems,
);

const formattedBalance = computed<string>(() => {
  if (typeof props.balance !== "number" || !Number.isFinite(props.balance)) {
    return "---";
  }
  return formatNumberVi(props.balance);
});

const tierLabel = computed<string>(() => props.tier ?? "FREE");

function openLogin(): void {
  openAuthDialog("login");
}

function isActiveRoute(targetPath: string): boolean {
  if (targetPath === "/") {
    return route.path === "/";
  }
  return route.path.startsWith(targetPath);
}
</script>

<template>
  <header
    data-testid="app-top-header"
    class="fixed inset-x-0 top-0 z-40 h-[68px] w-full border-b border-cyber-border bg-cyber-bg"
  >
    <div
      class="mx-auto flex h-full max-w-7xl items-center gap-2 px-3 sm:gap-6 sm:px-6 lg:px-8"
    >
      <NuxtLink
        to="/"
        aria-label="Trang chủ flowxis"
        class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center gap-2.5 rounded-lg pr-2 text-cyber-text transition hover:text-cyber-violet"
      >
        <img
          src="/flowxis.png"
          alt=""
          width="228"
          height="166"
          class="h-8 w-auto shrink-0"
        />
        <span class="font-display text-2xl font-bold tracking-tight">
          FlowXis
        </span>
      </NuxtLink>

      <!-- Điều hướng Desktop (>= 1024px): Không dùng Sidebar trái -->
      <nav
        aria-label="Điều hướng chính trên máy tính"
        class="hidden items-center gap-1 lg:flex"
      >
        <NuxtLink
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition"
          :class="
            isActiveRoute(item.to)
              ? 'bg-cyber-surface text-cyber-text border border-cyber-violet/60'
              : 'text-cyber-muted hover:bg-cyber-surface/60 hover:text-cyber-text'
          "
        >
          <Icon :name="item.icon" class="h-4 w-4 shrink-0" />
          <span>{{ item.labelVi }}</span>
        </NuxtLink>
      </nav>

      <!-- Khách: Bảng giá. Đã đăng nhập: số dư credit, Nạp Credit và avatar -->
      <div class="ml-auto flex items-center gap-2">
        <NuxtLink
          v-if="!isLoggedIn"
          to="/pricing"
          data-testid="pricing-link"
          class="touch-target hidden min-h-[48px] min-w-[48px] items-center rounded-lg px-3 text-sm font-medium transition sm:inline-flex"
          :class="[
            authPending ? 'invisible' : '',
            isActiveRoute('/pricing')
              ? 'text-cyber-text'
              : 'text-cyber-muted hover:text-cyber-text',
          ]"
        >
          Bảng giá
        </NuxtLink>

        <NuxtLink
          v-if="isLoggedIn"
          to="/pricing"
          data-testid="credit-badge"
          class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center gap-2 rounded-xl border border-cyber-cyan/40 bg-cyber-surface px-3 py-2 text-xs transition hover:border-cyber-cyan"
        >
          <Icon name="lucide:coins" class="h-4 w-4 shrink-0 text-cyber-cyan" />
          <div class="flex flex-col text-left leading-tight">
            <span class="font-mono text-xs font-semibold text-cyber-cyan">
              {{ formattedBalance }} CR
            </span>
            <span class="font-mono text-[10px] text-cyber-muted">
              Hạng {{ tierLabel }}
            </span>
          </div>
        </NuxtLink>

        <NuxtLink
          v-if="isLoggedIn"
          to="/pricing"
          data-testid="topup-link"
          class="touch-target hidden min-h-[48px] min-w-[48px] items-center gap-1.5 rounded-xl bg-cyber-violet px-4 py-2.5 text-xs font-semibold text-cyber-text transition hover:bg-cyber-violet/90 sm:inline-flex"
        >
          <Icon name="lucide:plus-circle" class="h-4 w-4 shrink-0" />
          <span>Nạp Credit</span>
        </NuxtLink>

        <!-- Khung chờ khi đang khôi phục phiên: tránh nháy UI khách -->
        <div
          v-if="!isLoggedIn && authPending"
          data-testid="auth-pending"
          aria-busy="true"
          aria-label="Đang kiểm tra phiên đăng nhập"
          class="flex items-center gap-2"
        >
          <div
            class="h-[48px] w-[104px] animate-pulse rounded-xl border border-cyber-border bg-cyber-surface"
          />
          <div
            class="h-[48px] w-[48px] animate-pulse rounded-full border border-cyber-border bg-cyber-surface"
          />
        </div>

        <AccountPopover v-if="isLoggedIn" :email="email" :role="role" />

        <button
          v-else-if="!authPending"
          type="button"
          data-testid="login-button"
          aria-label="Đăng nhập tài khoản"
          class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-2 rounded-xl border border-cyber-border bg-cyber-surface px-4 py-2 text-xs font-medium text-cyber-text transition hover:border-cyber-violet"
          @click="openLogin"
        >
          <Icon
            name="lucide:log-in"
            class="h-4 w-4 shrink-0 text-cyber-violet"
          />
          <span>Đăng nhập</span>
        </button>
      </div>
    </div>
  </header>
</template>
