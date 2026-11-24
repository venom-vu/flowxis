<script setup lang="ts">
import { usePageSeo } from '~/composables/usePageSeo';
import { useAuthDialog } from '~/composables/useAuthDialog';
import { useVeo3 } from '~/composables/useVeo3';

usePageSeo({
  title: 'Veo 3 Tạo Video AI (Text, Ảnh, Khung hình) — flowxis',
  description:
    'Tạo video 8 giây có âm thanh bằng Veo 3 từ mô tả văn bản, một ảnh hoặc khung hình đầu và cuối. Chọn tỉ lệ khung và độ phân giải, xem giá credit ngay.',
});

const { open: openAuthDialog } = useAuthDialog();
const veo = useVeo3();
const {
  isAuthenticated,
  mode,
  prompt,
  aspectRatio,
  resolution,
  imageKey,
  firstFrameKey,
  lastFrameKey,
  activeTask,
  isSubmitting,
  submitErrorVi,
  price,
  balance,
  hasEnoughBalance,
  insufficientNoteVi,
  canSubmit,
  intakePaused,
  submit,
  reset,
  refreshAll,
} = veo;
</script>

<template>
  <div class="mx-auto max-w-4xl space-y-6 py-2 sm:py-4" data-testid="page-veo-3">
    <MaintenanceBanner />
    <div class="flex items-center justify-between">
      <NuxtLink
        to="/"
        class="touch-target inline-flex min-h-[48px] items-center gap-2 text-xs font-semibold text-cyber-muted transition hover:text-cyber-cyan"
      >
        <Icon name="lucide:arrow-left" class="h-4 w-4" />
        <span>Quay lại Kho Công Cụ AI</span>
      </NuxtLink>
    </div>

    <section
      class="rounded-2xl border border-cyber-border bg-gradient-to-br from-cyber-surface via-slate-900 to-cyber-bg p-5 sm:p-6"
    >
      <div class="flex items-start gap-4">
        <span
          class="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-cyber-cyan/50 bg-cyber-cyan/20 text-cyber-cyan"
        >
          <Icon name="lucide:film" class="h-6 w-6" />
        </span>
        <div class="space-y-1">
          <h1 class="font-display text-lg font-bold sm:text-2xl">Tạo Video Với Veo 3 AI</h1>
          <p class="text-xs text-cyber-muted sm:text-sm">
            Tạo video 8 giây có âm thanh từ mô tả, một ảnh hoặc khung hình đầu và cuối.
          </p>
        </div>
      </div>
    </section>

    <section v-if="activeTask" class="space-y-4">
      <TaskResultViewer
        :task="activeTask"
        @update:task="activeTask = $event"
        @retry="reset"
        @settled="void refreshAll()"
      />
    </section>

    <section v-else class="space-y-6">
      <Veo3Form
        v-model:mode="mode"
        v-model:prompt="prompt"
        v-model:aspect-ratio="aspectRatio"
        v-model:resolution="resolution"
        v-model:image-key="imageKey"
        v-model:first-frame-key="firstFrameKey"
        v-model:last-frame-key="lastFrameKey"
        id-prefix="veo3-page"
        :maintenance-note="intakePaused"
      />

      <div
        v-if="submitErrorVi"
        data-testid="submit-error-banner"
        role="alert"
        aria-live="assertive"
        class="rounded-xl border border-cyber-danger/40 bg-cyber-danger/10 p-4 text-xs text-cyber-danger"
      >
        <div class="flex items-center gap-2">
          <Icon name="lucide:alert-circle" class="h-4 w-4 shrink-0" />
          <span>{{ submitErrorVi }}</span>
        </div>
      </div>

      <div
        v-if="!isAuthenticated"
        data-testid="guest-login-notice"
        class="flex flex-col gap-3 rounded-xl border border-cyber-cyan/40 bg-cyber-cyan/10 p-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <div class="flex items-center gap-3">
          <Icon name="lucide:log-in" class="h-5 w-5 shrink-0 text-cyber-cyan" />
          <p class="text-xs text-cyber-cyan sm:text-sm">
            Vui lòng đăng nhập để tạo video Veo 3 và lưu lịch sử.
          </p>
        </div>
        <button
          type="button"
          data-testid="veo3-login-button"
          class="touch-target inline-flex min-h-[48px] shrink-0 items-center justify-center gap-2 rounded-xl bg-cyber-cyan px-4 py-2 text-xs font-bold text-black transition hover:bg-cyber-cyan/90"
          @click="openAuthDialog('login')"
        >
          <Icon name="lucide:log-in" class="h-4 w-4" />
          <span>Đăng nhập ngay</span>
        </button>
      </div>

      <div
        class="flex flex-col gap-4 rounded-2xl border border-cyber-border bg-cyber-surface p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"
      >
        <div class="space-y-1">
          <div class="flex flex-wrap items-center gap-2">
            <Icon name="lucide:zap" class="h-4 w-4 text-cyber-cyan" />
            <span class="text-xs text-cyber-muted">Giá:</span>
            <span data-testid="veo3-price" class="font-mono text-sm font-bold text-cyber-cyan">
              {{ price }} Credit
            </span>
          </div>
          <div class="flex flex-wrap items-center gap-2 text-xs">
            <span class="text-cyber-muted">Số dư khả dụng:</span>
            <span
              data-testid="veo3-balance"
              class="font-mono font-bold"
              :class="[hasEnoughBalance ? 'text-cyber-cyan' : 'text-cyber-warning']"
            >
              {{ balance }} Credit
            </span>
          </div>
          <p
            v-if="insufficientNoteVi"
            data-testid="insufficient-credit-note"
            class="text-xs font-semibold text-cyber-warning"
          >
            {{ insufficientNoteVi }}
          </p>
        </div>

        <div class="flex flex-col items-stretch gap-2.5 sm:flex-row sm:items-center">
          <NuxtLink
            v-if="insufficientNoteVi"
            to="/pricing"
            data-testid="topup-credit-button"
            class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-2 rounded-xl border border-cyber-warning/50 bg-cyber-warning/15 px-4 py-2.5 text-xs font-semibold text-cyber-warning transition hover:bg-cyber-warning/25"
          >
            <Icon name="lucide:plus-circle" class="h-4 w-4" />
            <span>Nạp thêm Credit</span>
          </NuxtLink>
          <button
            type="button"
            data-testid="create-veo3-button"
            :disabled="!canSubmit || intakePaused"
            class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-2 rounded-xl bg-cyber-violet px-6 py-3 text-sm font-semibold text-cyber-text transition hover:bg-cyber-violet/90 disabled:cursor-not-allowed disabled:opacity-50"
            @click="submit"
          >
            <Icon v-if="isSubmitting" name="lucide:loader-2" class="h-4 w-4 animate-spin" />
            <Icon v-else name="lucide:play" class="h-4 w-4" />
            <span>{{ isSubmitting ? 'Đang tạo tác vụ...' : `Tạo video Veo 3 (${price} CR)` }}</span>
          </button>
        </div>
      </div>
    </section>

    <ToolSeoSection tool="veo-3" />
  </div>
</template>
