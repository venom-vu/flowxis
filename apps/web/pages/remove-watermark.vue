<script setup lang="ts">
import { REMOVE_WATERMARK_PROMPT_MAX_LENGTH } from "@flowxis/contracts";
import { usePageSeo } from "~/composables/usePageSeo";
import { useAuthDialog } from "~/composables/useAuthDialog";
import { useMotionControl } from "~/composables/useMotionControl";

usePageSeo({
  title: "Xóa Watermark, Logo, Phụ Đề Video — flowxis",
  description:
    "Xóa watermark, logo và phụ đề khỏi video bằng AI. Cắt đoạn video theo từng giây và xem giá credit ngay khi kéo thanh trượt.",
});

const { open: openAuthDialog } = useAuthDialog();
const motion = useMotionControl();
motion.variant.value = "watermark";
const {
  currentTier,
  isAuthenticated,
  activeTask,
  isSubmitting,
  submitErrorVi,
  capSeconds,
  capUsable,
  seconds,
  prompt,
  price,
  balance,
  remainingBalance,
  hasEnoughBalance,
  insufficientNoteVi,
  canSubmit,
  intakePaused,
  onTrimChange,
  submit,
  reset,
  refreshAll,
} = motion;
</script>

<template>
  <div
    class="mx-auto max-w-4xl space-y-6 py-2 sm:py-4"
    data-testid="page-remove-watermark"
  >
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
          <Icon name="lucide:eraser" class="h-6 w-6" />
        </span>
        <div class="space-y-1">
          <h1 class="font-display text-lg font-bold sm:text-2xl">
            Xóa Watermark, Logo, Phụ Đề Video
          </h1>
          <p class="text-xs text-cyber-muted sm:text-sm">
            Tải video, cắt đoạn cần xử lý theo từng giây. Giá được tính theo độ
            dài đoạn đã cắt.
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
      <div class="grid grid-cols-1 gap-5">
        <div
          class="min-w-0 space-y-3 rounded-2xl border border-cyber-border bg-cyber-surface/60 p-4 sm:p-5"
          data-testid="motion-video-section"
        >
          <div class="flex items-center gap-2.5">
            <span
              class="flex h-7 w-7 items-center justify-center rounded-lg border border-cyber-violet/40 bg-cyber-violet/15 font-mono text-xs font-bold text-cyber-violet"
            >
              1
            </span>
            <div>
              <h2 class="text-sm font-bold text-cyber-text">
                Video cần xử lý và đoạn cắt
              </h2>
              <p class="text-[11px] text-cyber-muted">
                MP4 hoặc MOV, tối đa 100 MB
              </p>
            </div>
          </div>
          <VideoTrimmer
            id-prefix="remove-watermark-video"
            :cap-seconds="capSeconds"
            :tier-name="currentTier"
            @change="onTrimChange"
          />
          <div
            class="space-y-2 rounded-xl border border-cyber-border bg-cyber-bg/60 p-3 sm:p-3.5"
          >
            <label
              for="remove-watermark-prompt"
              class="text-xs font-semibold text-cyber-text sm:text-sm"
            >
              Mô tả yêu cầu (Optional)
            </label>
            <textarea
              id="remove-watermark-prompt"
              v-model="prompt"
              data-testid="remove-watermark-prompt"
              rows="5"
              :maxlength="REMOVE_WATERMARK_PROMPT_MAX_LENGTH"
              placeholder="Ví dụ: xóa logo ở góc phải và phụ đề phía dưới, giữ nguyên nhân vật. Để trống nếu muốn hệ thống tự xử lý."
              class="w-full resize-y rounded-lg border border-cyber-border bg-cyber-surface p-3 text-sm text-cyber-text placeholder:text-cyber-muted focus:border-cyber-cyan focus:outline-none"
            />
            <p class="text-right font-mono text-[11px] text-cyber-muted">
              {{ prompt.length }}/{{ REMOVE_WATERMARK_PROMPT_MAX_LENGTH }}
            </p>
          </div>
        </div>
      </div>

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
            Vui lòng đăng nhập để tạo tác vụ Xóa watermark và lưu lịch sử.
          </p>
        </div>
        <button
          type="button"
          data-testid="motion-login-button"
          class="touch-target inline-flex min-h-[48px] shrink-0 items-center justify-center gap-2 rounded-xl bg-cyber-cyan px-4 py-2 text-xs font-bold text-black transition hover:bg-cyber-cyan/90"
          @click="openAuthDialog('login')"
        >
          <Icon name="lucide:log-in" class="h-4 w-4" />
          <span>Đăng nhập ngay</span>
        </button>
      </div>

      <div
        v-if="isAuthenticated && !capUsable && capSeconds != null"
        data-testid="motion-cap-unusable-note"
        class="rounded-xl border border-cyber-warning/40 bg-cyber-warning/10 p-4 text-xs text-cyber-warning"
      >
        Chỉ cho phép tối đa {{ capSeconds }} giây, chưa đủ để tạo đoạn xử lý.
        <NuxtLink to="/pricing" class="font-semibold underline">
          Xem bảng giá
        </NuxtLink>
      </div>

      <div
        class="flex flex-col gap-4 rounded-2xl border border-cyber-border bg-cyber-surface p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"
      >
        <div class="space-y-1">
          <div class="flex flex-wrap items-center gap-2">
            <Icon name="lucide:zap" class="h-4 w-4 text-cyber-cyan" />
            <span class="text-xs text-cyber-muted">Giá:</span>
            <span
              data-testid="motion-price"
              class="font-mono text-sm font-bold text-cyber-cyan"
            >
              {{ price == null ? "—" : `${price} Credit` }}
            </span>
            <span
              v-if="price != null"
              data-testid="motion-seconds"
              class="font-mono text-xs text-cyber-muted"
            >
              ({{ seconds }} giây)
            </span>
          </div>
          <div class="flex flex-wrap items-center gap-2 text-xs">
            <span class="text-cyber-muted">Số dư khả dụng:</span>
            <span
              data-testid="motion-balance"
              class="font-mono font-bold"
              :class="[
                hasEnoughBalance ? 'text-cyber-cyan' : 'text-cyber-warning',
              ]"
            >
              {{ balance }} Credit
            </span>
            <span
              v-if="
                remainingBalance != null && isAuthenticated && hasEnoughBalance
              "
              data-testid="motion-remaining"
              class="font-mono text-cyber-muted"
            >
              Còn lại sau khi tạo: {{ remainingBalance }}
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

        <div
          class="flex flex-col items-stretch gap-2.5 sm:flex-row sm:items-center"
        >
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
            data-testid="create-motion-button"
            :disabled="!canSubmit || intakePaused"
            class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-2 rounded-xl bg-cyber-violet px-6 py-3 text-sm font-semibold text-cyber-text transition hover:bg-cyber-violet/90 disabled:cursor-not-allowed disabled:opacity-50"
            @click="submit"
          >
            <Icon
              v-if="isSubmitting"
              name="lucide:loader-2"
              class="h-4 w-4 animate-spin"
            />
            <Icon v-else name="lucide:play" class="h-4 w-4" />
            <span>
              {{
                isSubmitting
                  ? "Đang tạo tác vụ..."
                  : price == null
                    ? "Tạo Xóa watermark"
                    : `Tạo Xóa watermark (${price} CR)`
              }}
            </span>
          </button>
        </div>
      </div>
    </section>

    <ToolSeoSection tool="remove-watermark" />
  </div>
</template>
