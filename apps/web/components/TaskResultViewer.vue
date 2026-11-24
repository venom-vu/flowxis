<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type {
  Task,
  TaskResultResponse,
  TaskShareResponse,
} from '@flowxis/contracts';
import BeforeAfterSplitSlider from '~/components/BeforeAfterSplitSlider.vue';
import { useApiClient } from '~/composables/useApiClient';
import {
  getReasonCodeMessageVi,
  resolveApiErrorMessageVi,
} from '~/utils/api-client';
import {
  getPipelineLabelVi,
  isTaskRetentionExpired,
} from '~/utils/task-format';

/**
 * Khung kết quả dùng chung: loading khi tạo/chạy Task, hiển thị Trước/Sau khi xong,
 * kèm nút Tải về và Sao chép liên kết. Dùng trong dialog công cụ và trang chi tiết Task.
 */
const props = withDefaults(
  defineProps<{
    task: Task | null;
    /** Đang gửi yêu cầu tạo Task (chưa có task). */
    submitting?: boolean;
    polling?: boolean;
    pollIntervalMs?: number;
    /** Nhãn mô tả khi chưa có Task (placeholder). */
    beforeLabelVi?: string;
    afterLabelVi?: string;
    outputFormatVi?: string;
    /** Cho phép nút "Tạo lại" ở trạng thái lỗi. */
    showRetry?: boolean;
    /** Bỏ khung card bao ngoài khi đặt bên trong card cha (ví dụ card Kết quả). */
    embedded?: boolean;
    /** Đầu ra của công cụ là video (ẩn thanh kéo Trước/Sau ngay từ trạng thái chờ). */
    videoOutput?: boolean;
  }>(),
  {
    submitting: false,
    polling: true,
    pollIntervalMs: 2500,
    beforeLabelVi: '',
    afterLabelVi: '',
    outputFormatVi: '',
    showRetry: true,
    embedded: false,
    videoOutput: false,
  },
);

const emit = defineEmits<{
  'update:task': [task: Task];
  result: [result: TaskResultResponse | null];
  settled: [task: Task];
  retry: [];
}>();

const { client } = useApiClient();

const localTask = ref<Task | null>(props.task);
const result = ref<TaskResultResponse | null>(null);
const resultErrorVi = ref<string | null>(null);
const isLoadingResult = ref<boolean>(false);
const actionErrorVi = ref<string | null>(null);
const refreshAttempts = ref<number>(0);
const mediaFailed = ref<boolean>(false);

let pollTimer: ReturnType<typeof setTimeout> | null = null;
let pollCount = 0;
let disposed = false;

const status = computed(() => localTask.value?.status ?? null);
const isQueued = computed<boolean>(() => status.value === 'queued');
const isRunning = computed<boolean>(() => status.value === 'running');
const isSucceeded = computed<boolean>(() => status.value === 'succeeded');
const isFailed = computed<boolean>(
  () =>
    status.value === 'failed' ||
    status.value === 'timed_out' ||
    status.value === 'cancelled',
);
const isWorking = computed<boolean>(
  () => props.submitting || isQueued.value || isRunning.value,
);
const isVideo = computed<boolean>(
  () =>
    props.videoOutput ||
    result.value?.mediaType === 'video' ||
    localTask.value?.pipeline === 'motion_control' ||
    localTask.value?.pipeline === 'motion_control_v2' ||
    localTask.value?.pipeline === 'veo3' ||
    localTask.value?.pipeline === 'muse_video' ||
    localTask.value?.pipeline === 'remove_watermark',
);
const isExpired = computed<boolean>(() =>
  localTask.value ? isTaskRetentionExpired(localTask.value.createdAt) : false,
);
const pipelineLabelVi = computed<string>(() =>
  localTask.value ? getPipelineLabelVi(localTask.value.pipeline) : '',
);
const failureMessageVi = computed<string>(() => {
  const t = localTask.value;
  if (!t) return '';
  if (t.status === 'cancelled')
    return 'Tác vụ đã được hủy theo yêu cầu của bạn.';
  return getReasonCodeMessageVi(t.reasonCode, t.pipeline);
});

function stopPolling(): void {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

function schedulePoll(): void {
  stopPolling();
  const t = localTask.value;
  if (
    disposed ||
    !props.polling ||
    !t ||
    (t.status !== 'queued' && t.status !== 'running')
  ) {
    return;
  }
  // Sau ~75s giảm tần suất thăm dò xuống 5s.
  const delay = pollCount >= 30 ? 5000 : props.pollIntervalMs;
  pollTimer = setTimeout(async () => {
    pollCount += 1;
    try {
      const updated = await client.getTask(t.id);
      if (disposed || localTask.value?.id !== updated.id) return;
      actionErrorVi.value = null;
      localTask.value = updated;
      emit('update:task', updated);
      if (updated.status !== 'queued' && updated.status !== 'running') {
        emit('settled', updated);
      }
    } catch (error: unknown) {
      // Mạng chập chờn không làm dừng vòng thăm dò.
      actionErrorVi.value = resolveApiErrorMessageVi(error);
    }
    schedulePoll();
  }, delay);
}

async function loadResult(): Promise<void> {
  const t = localTask.value;
  if (!t || t.status !== 'succeeded' || isExpired.value) return;
  isLoadingResult.value = true;
  resultErrorVi.value = null;
  try {
    result.value = await client.getTaskResult(t.id);
    mediaFailed.value = false;
    emit('result', result.value);
  } catch (error: unknown) {
    resultErrorVi.value = resolveApiErrorMessageVi(error);
  } finally {
    isLoadingResult.value = false;
  }
}

async function handleRefreshResult(): Promise<void> {
  refreshAttempts.value = 0;
  await loadResult();
}

function handleMediaError(): void {
  if (isLoadingResult.value) return;
  // Thử lấy lại URL ký mới tối đa 1 lần để tránh vòng lặp vô hạn.
  if (refreshAttempts.value < 1) {
    refreshAttempts.value += 1;
    void loadResult();
  } else {
    mediaFailed.value = true;
  }
}

watch(
  () => props.task,
  (next, prev) => {
    localTask.value = next;
    if (next?.id !== prev?.id) {
      result.value = null;
      resultErrorVi.value = null;
      actionErrorVi.value = null;
      refreshAttempts.value = 0;
      mediaFailed.value = false;
      shareData.value = null;
      pollCount = 0;
      emit('result', null);
    }
  },
);

watch(
  [
    () => localTask.value?.id,
    () => localTask.value?.status,
    () => props.polling,
  ],
  () => {
    schedulePoll();
    if (
      localTask.value?.status === 'succeeded' &&
      !result.value &&
      !isLoadingResult.value
    ) {
      void loadResult();
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  disposed = true;
  stopPolling();
});

// ---- Hủy Task khi còn xếp hàng ----
const isCancelling = ref<boolean>(false);
async function handleCancel(): Promise<void> {
  if (!localTask.value || !isQueued.value || isCancelling.value) return;
  isCancelling.value = true;
  actionErrorVi.value = null;
  try {
    const cancelled = await client.cancelTask(localTask.value.id);
    stopPolling();
    localTask.value = cancelled;
    emit('update:task', cancelled);
    emit('settled', cancelled);
  } catch (error: unknown) {
    actionErrorVi.value = resolveApiErrorMessageVi(error);
  } finally {
    isCancelling.value = false;
  }
}

// ---- Tải về ----
const isDownloading = ref<boolean>(false);
const downloadErrorVi = ref<string | null>(null);

function resolveImageExtension(mimeType?: string): string {
  if (mimeType === 'image/jpeg') return '.jpg';
  if (mimeType === 'image/webp') return '.webp';
  return '.png';
}

async function handleDownload(): Promise<void> {
  let url = result.value?.resultUrl;
  if (!url || isDownloading.value || !localTask.value) return;
  isDownloading.value = true;
  downloadErrorVi.value = null;
  try {
    let response: Response | null = null;
    try {
      const res = await fetch(url);
      if (res.ok) response = res;
    } catch {
      // CORS hoặc lỗi mạng: thử lấy URL ký mới bên dưới.
    }
    if (!response) {
      await loadResult();
      url = result.value?.resultUrl;
      if (!url) throw new Error('Không thể làm mới đường dẫn tải về');
      response = await fetch(url);
      if (!response.ok) throw new Error('Không thể tải kết quả');
    }
    const blob = await response.blob();
    const ext = isVideo.value ? '.mp4' : resolveImageExtension(blob.type);
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `flowxis-${localTask.value.pipeline}-${localTask.value.id.slice(0, 8)}${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1500);
  } catch (err) {
    downloadErrorVi.value = resolveApiErrorMessageVi(err);
  } finally {
    isDownloading.value = false;
  }
}

// ---- Sao chép liên kết chia sẻ công khai ----
const shareData = ref<TaskShareResponse | null>(null);
const isSharing = ref<boolean>(false);
const isRevoking = ref<boolean>(false);
const toastVi = ref<string | null>(null);
const shareErrorVi = ref<string | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | null = null;

function showToast(message: string): void {
  toastVi.value = message;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastVi.value = null;
  }, 3500);
}
onBeforeUnmount(() => {
  if (toastTimer) clearTimeout(toastTimer);
});

async function writeClipboard(text: string): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

async function handleCopyLink(): Promise<void> {
  if (!localTask.value || isSharing.value || isRevoking.value) return;
  shareErrorVi.value = null;
  if (!shareData.value) {
    isSharing.value = true;
    try {
      const res = await client.shareTask(localTask.value.id);
      const shareUrl =
        typeof window !== 'undefined'
          ? `${window.location.origin}/share/${res.token}`
          : res.shareUrl;
      shareData.value = { ...res, shareUrl };
    } catch (err) {
      shareErrorVi.value = resolveApiErrorMessageVi(err);
      return;
    } finally {
      isSharing.value = false;
    }
  }
  const url = shareData.value.shareUrl;
  showToast(
    (await writeClipboard(url))
      ? 'Đã sao chép liên kết chia sẻ.'
      : `Liên kết chia sẻ: ${url}`,
  );
}

async function handleRevokeShare(): Promise<void> {
  if (!localTask.value || isRevoking.value || isSharing.value) return;
  isRevoking.value = true;
  shareErrorVi.value = null;
  try {
    await client.revokeTaskShare(localTask.value.id);
    shareData.value = null;
    showToast('Đã ngừng chia sẻ liên kết công khai.');
  } catch (err) {
    shareErrorVi.value = resolveApiErrorMessageVi(err);
  } finally {
    isRevoking.value = false;
  }
}

const sliderPercent = ref<number>(50);
</script>

<template>
  <div
    :class="
      embedded ? '' : 'rounded-xl border border-cyber-border bg-cyber-bg/70 p-4'
    "
    data-testid="task-result-viewer"
    :data-state="
      isWorking
        ? 'working'
        : isSucceeded
          ? 'succeeded'
          : isFailed
            ? 'failed'
            : 'idle'
    "
  >
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <slot name="header-title">
        <span
          class="flex items-center gap-2 text-sm font-semibold text-cyber-text"
        >
          <Icon
            :name="isVideo ? 'lucide:film' : 'lucide:split-square-horizontal'"
            class="h-4 w-4 text-cyber-violet"
          />
          <span>{{
            isVideo ? "Video kết quả" : "So sánh Trước / Sau AI"
          }}</span>
        </span>
      </slot>
      <span
        v-if="isQueued"
        data-testid="queue-position-badge"
        class="inline-flex items-center gap-1.5 rounded-full border border-cyber-cyan/50 bg-cyber-cyan/15 px-2.5 py-0.5 font-mono text-[11px] font-bold text-cyber-cyan"
      >
        <Icon name="lucide:users" class="h-3 w-3" />
        <span>Vị trí #{{ localTask?.queuePosition ?? 1 }}</span>
      </span>
      <span
        v-else-if="isSucceeded"
        data-testid="succeeded-status-badge"
        class="inline-flex items-center gap-1.5 rounded-full border border-cyber-emerald/50 bg-cyber-emerald/15 px-2.5 py-0.5 font-mono text-[11px] font-bold text-cyber-emerald"
      >
        <Icon name="lucide:check" class="h-3 w-3" />
        <span>Hoàn tất</span>
      </span>
      <span
        v-else-if="!isWorking && !isFailed && !isVideo"
        class="font-mono text-xs text-cyber-cyan"
      >
        {{ sliderPercent }}%
      </span>
    </div>

    <!-- Khung hiển thị chính -->
    <!-- 1. Đang gửi / xếp hàng / xử lý: loading ngay trong khung -->
    <div
      v-if="isWorking"
      data-testid="task-working-state"
      class="relative flex h-64 flex-col items-center justify-center gap-4 overflow-hidden rounded-xl border border-cyber-border bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 px-6 text-center sm:h-72"
    >
      <div class="absolute inset-0 animate-pulse bg-cyber-violet/5" />
      <span
        class="relative flex h-14 w-14 items-center justify-center rounded-2xl border border-cyber-violet/50 bg-cyber-violet/20 text-cyber-violet"
      >
        <Icon
          :name="isQueued ? 'lucide:clock' : 'lucide:loader-2'"
          class="h-7 w-7"
          :class="{ 'animate-spin': !isQueued }"
        />
      </span>
      <div class="relative space-y-1">
        <p class="font-display text-sm font-bold text-cyber-text">
          {{
            submitting && !localTask
              ? "Đang gửi yêu cầu..."
              : isQueued
                ? "Đang trong hàng đợi xử lý"
                : `Đang xử lý ${pipelineLabelVi}...`
          }}
        </p>
        <p class="text-xs text-cyber-muted">
          {{
            isVideo
              ? "Video thường mất vài phút. Bạn có thể đóng cửa sổ, kết quả vẫn lưu trong Lịch sử."
              : "Thường mất khoảng 10–25 giây. Kết quả sẽ hiện ngay tại đây."
          }}
        </p>
      </div>
      <div
        role="progressbar"
        aria-label="Tiến trình xử lý AI"
        class="relative h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-cyber-bg"
      >
        <div
          class="absolute inset-y-0 left-0 w-1/2 animate-[pulse_1.5s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-cyber-violet to-cyber-cyan"
        />
      </div>
      <button
        v-if="isQueued"
        type="button"
        data-testid="cancel-task-button"
        :disabled="isCancelling"
        class="touch-target relative inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-cyber-danger/50 bg-cyber-danger/15 px-3.5 py-2 text-xs font-semibold text-cyber-danger transition hover:bg-cyber-danger/25 disabled:opacity-50"
        @click="handleCancel"
      >
        <Icon
          :name="isCancelling ? 'lucide:loader-2' : 'lucide:ban'"
          class="h-3.5 w-3.5"
          :class="{ 'animate-spin': isCancelling }"
        />
        <span>{{ isCancelling ? "Đang hủy..." : "Hủy tác vụ" }}</span>
      </button>
    </div>

    <!-- 2. Thất bại / quá hạn / hủy -->
    <div
      v-else-if="isFailed && localTask"
      data-testid="task-failed-state"
      class="space-y-3"
    >
      <div
        class="flex flex-col items-center gap-3 rounded-xl border border-cyber-danger/30 bg-cyber-danger/5 px-5 py-8 text-center"
      >
        <span
          class="flex h-12 w-12 items-center justify-center rounded-2xl border"
          :class="
            localTask.status === 'cancelled'
              ? 'border-cyber-muted/40 bg-cyber-muted/15 text-cyber-muted'
              : 'border-cyber-danger/50 bg-cyber-danger/20 text-cyber-danger'
          "
        >
          <Icon
            :name="
              localTask.status === 'cancelled'
                ? 'lucide:ban'
                : 'lucide:alert-triangle'
            "
            class="h-6 w-6"
          />
        </span>
        <p
          class="font-display text-sm font-bold"
          :class="
            localTask.status === 'cancelled'
              ? 'text-cyber-muted'
              : 'text-cyber-danger'
          "
        >
          {{
            localTask.status === "cancelled"
              ? "Tác vụ đã được hủy"
              : localTask.status === "timed_out"
                ? "Tác vụ quá thời gian xử lý"
                : "Xử lý tác vụ thất bại"
          }}
        </p>
        <p class="max-w-sm text-xs text-cyber-text">{{ failureMessageVi }}</p>
        <p
          data-testid="credit-refund-note"
          class="flex items-center gap-2 font-mono text-xs font-semibold text-cyber-emerald"
        >
          <Icon name="lucide:shield-check" class="h-4 w-4 shrink-0" />
          <span>Đã hoàn trả 100% credit ({{ localTask.creditCost }} CR).</span>
        </p>
        <NuxtLink
          v-if="localTask.reasonCode === 'FREE_WAIT_EXPIRED'"
          to="/pricing"
          data-testid="upgrade-tier-button"
          class="touch-target inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-cyber-warning/50 bg-cyber-warning/20 px-3.5 py-2 text-xs font-semibold text-cyber-warning"
        >
          <Icon name="lucide:zap" class="h-4 w-4" />
          <span>Nạp Credit ưu tiên</span>
        </NuxtLink>
      </div>
      <button
        v-if="showRetry"
        type="button"
        data-testid="retry-task-button"
        class="touch-target inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-cyber-violet px-5 py-2.5 text-xs font-semibold text-cyber-text transition hover:bg-cyber-violet/90"
        @click="emit('retry')"
      >
        <Icon name="lucide:refresh-cw" class="h-4 w-4" />
        <span>Tạo lại tác vụ</span>
      </button>
    </div>

    <!-- 3. Thành công -->
    <div
      v-else-if="isSucceeded"
      data-testid="task-succeeded-state"
      class="space-y-3"
    >
      <div
        v-if="isExpired"
        data-testid="retention-expired-view"
        class="flex h-56 flex-col items-center justify-center gap-2 rounded-xl border border-cyber-warning/30 bg-cyber-warning/5 px-5 text-center"
      >
        <Icon name="lucide:clock-alert" class="h-7 w-7 text-cyber-warning" />
        <p class="font-display text-sm font-bold text-cyber-warning">
          Kết quả đã hết hạn lưu trữ
        </p>
        <p class="max-w-sm text-xs text-cyber-muted">
          {{ isVideo ? "Video" : "Ảnh" }} kết quả đã quá 30 ngày và được dọn dẹp
          tự động theo chính sách của hệ thống.
        </p>
      </div>

      <div
        v-else-if="resultErrorVi || mediaFailed"
        data-testid="result-fetch-error"
        class="flex flex-col items-center gap-3 rounded-xl border border-cyber-danger/40 bg-cyber-danger/10 p-5 text-center"
      >
        <Icon name="lucide:alert-circle" class="h-6 w-6 text-cyber-danger" />
        <p class="text-xs text-cyber-danger">
          {{
            resultErrorVi ||
            (isVideo
              ? "Không thể tải video kết quả"
              : "Không thể tải ảnh kết quả")
          }}. Đường dẫn có thể đã hết hạn.
        </p>
        <button
          type="button"
          :disabled="isLoadingResult"
          class="touch-target inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-cyber-danger/50 bg-cyber-danger/20 px-4 py-2 text-xs font-semibold text-cyber-danger disabled:opacity-50"
          @click="handleRefreshResult"
        >
          <Icon
            :name="
              isLoadingResult ? 'lucide:loader-circle' : 'lucide:refresh-cw'
            "
            class="h-4 w-4"
            :class="{ 'animate-spin': isLoadingResult }"
          />
          <span>{{
            isLoadingResult ? "Đang làm mới..." : "Lấy lại link mới"
          }}</span>
        </button>
      </div>

      <div
        v-else-if="!result"
        class="h-64 animate-pulse rounded-xl border border-cyber-border sm:h-72"
        :class="embedded ? 'bg-cyber-bg/70' : 'bg-cyber-surface/50'"
      />

      <template v-else>
        <div
          v-if="isVideo"
          data-testid="result-video-frame"
          class="overflow-hidden rounded-xl border border-cyber-border bg-black"
        >
          <video
            :key="result.resultUrl"
            data-testid="result-video"
            :src="result.resultUrl"
            :poster="result.posterUrl"
            playsinline
            controls
            preload="metadata"
            class="max-h-[50vh] w-full bg-black object-contain"
            @error="handleMediaError"
          />
        </div>
        <BeforeAfterSplitSlider
          v-else
          :result-url="result.resultUrl"
          :source-url="result.sourceUrl"
          :alt="`Kết quả ${pipelineLabelVi}`"
          :surface="embedded ? 'recessed' : 'card'"
          @image-error="handleMediaError"
          @position-change="sliderPercent = Math.round($event)"
        />

        <!-- Hành động: Tải về + Sao chép liên kết -->
        <div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <button
            type="button"
            data-testid="download-result-button"
            :disabled="isDownloading"
            class="touch-target inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-cyber-violet px-4 py-2.5 text-sm font-semibold text-cyber-text transition hover:bg-cyber-violet/90 disabled:cursor-not-allowed disabled:opacity-60"
            @click="handleDownload"
          >
            <Icon
              :name="isDownloading ? 'lucide:loader-circle' : 'lucide:download'"
              class="h-4 w-4"
              :class="{ 'animate-spin': isDownloading }"
            />
            <span>{{
              isDownloading
                ? "Đang tải..."
                : isVideo
                  ? "Tải về (MP4)"
                  : "Tải ảnh HD"
            }}</span>
          </button>
          <button
            type="button"
            data-testid="copy-link-button"
            :disabled="isSharing || isRevoking"
            class="touch-target inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-cyber-cyan/50 bg-cyber-cyan/15 px-4 py-2.5 text-xs font-bold text-cyber-cyan transition hover:bg-cyber-cyan/25 disabled:cursor-not-allowed disabled:opacity-60"
            @click="handleCopyLink"
          >
            <Icon
              :name="isSharing ? 'lucide:loader-circle' : 'lucide:link'"
              class="h-4 w-4"
              :class="{ 'animate-spin': isSharing }"
            />
            <span>{{
              isSharing ? "Đang tạo liên kết..." : "Sao chép liên kết"
            }}</span>
          </button>
        </div>

        <div
          v-if="shareData"
          data-testid="shared-link-card"
          class="flex items-center justify-between gap-2 rounded-xl border border-cyber-border bg-cyber-surface/70 px-3 py-2"
        >
          <p
            class="min-w-0 flex-1 truncate font-mono text-[11px] text-cyber-muted"
          >
            {{ shareData.shareUrl }}
          </p>
          <button
            type="button"
            data-testid="revoke-share-button"
            :disabled="isRevoking"
            class="touch-target inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-cyber-danger transition hover:bg-cyber-danger/15 disabled:opacity-50"
            @click="handleRevokeShare"
          >
            <Icon name="lucide:link-2-off" class="h-3.5 w-3.5" />
            <span>Ngừng chia sẻ</span>
          </button>
        </div>
      </template>
    </div>

    <!-- 4. Chưa có Task: khung chờ cho video (không có thanh kéo Trước/Sau), hoặc slider minh họa cho ảnh -->
    <div
      v-else-if="isVideo"
      data-testid="video-idle-state"
      class="space-y-3"
    >
      <div
        data-testid="video-idle-frame"
        class="relative flex h-64 flex-col items-center justify-center gap-3 overflow-hidden rounded-xl border border-cyber-border bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 px-6 text-center sm:h-72"
      >
        <span
          class="flex h-14 w-14 items-center justify-center rounded-2xl border border-cyber-violet/40 bg-cyber-violet/15 text-cyber-violet"
        >
          <Icon name="lucide:film" class="h-7 w-7" />
        </span>
        <div class="max-w-xs space-y-1">
          <p class="font-display text-sm font-bold text-cyber-text">
            {{ afterLabelVi || "Khung hiển thị video kết quả" }}
          </p>
          <p class="text-xs text-cyber-muted">
            Thiết lập thông số bên trái và bấm Tạo Tác Vụ AI để bắt đầu xử lý.
          </p>
        </div>
      </div>
      <p v-if="outputFormatVi" class="text-xs text-cyber-muted">
        Đầu ra: {{ outputFormatVi }}
      </p>
    </div>

    <div v-else class="space-y-3">
      <div
        class="relative h-48 overflow-hidden rounded-xl border border-cyber-border bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900"
      >
        <div
          class="absolute inset-0 flex flex-col justify-between bg-cyber-surface/90 p-4"
        >
          <span
            class="w-fit rounded bg-cyber-bg/80 px-2 py-0.5 font-mono text-[10px] uppercase text-cyber-muted"
            >Trước xử lý</span
          >
          <p class="text-xs font-medium text-cyber-text">{{ beforeLabelVi }}</p>
        </div>
        <div
          class="absolute inset-0 flex flex-col justify-between bg-cyber-cyan/15 p-4 backdrop-blur-[1px]"
          :style="{ clipPath: `inset(0 0 0 ${sliderPercent}%)` }"
        >
          <span
            class="ml-auto w-fit rounded border border-cyber-cyan/40 bg-cyber-bg/90 px-2 py-0.5 font-mono text-[10px] uppercase text-cyber-cyan"
            >Sau xử lý AI</span
          >
          <p class="text-right text-xs font-medium text-cyber-cyan">
            {{ afterLabelVi }}
          </p>
        </div>
        <div
          class="pointer-events-none absolute inset-y-0 w-0.5 bg-cyber-cyan shadow-[0_0_10px_#06B6D4]"
          :style="{ left: `${sliderPercent}%` }"
        >
          <div
            class="absolute top-1/2 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-cyber-cyan text-black shadow-md"
          >
            <Icon name="lucide:arrow-left-right" class="h-3.5 w-3.5" />
          </div>
        </div>
      </div>
      <label for="before-after-slider" class="sr-only"
        >Thanh kéo so sánh trước và sau</label
      >
      <input
        id="before-after-slider"
        v-model.number="sliderPercent"
        type="range"
        min="0"
        max="100"
        step="1"
        class="touch-target min-h-[48px] w-full cursor-pointer accent-cyber-violet"
      />
      <p v-if="outputFormatVi" class="text-xs text-cyber-muted">
        Đầu ra: {{ outputFormatVi }}
      </p>
    </div>

    <!-- Thông báo -->
    <p
      v-if="actionErrorVi"
      class="mt-3 rounded-xl border border-cyber-danger/40 bg-cyber-danger/10 p-2.5 text-xs text-cyber-danger"
    >
      {{ actionErrorVi }}
    </p>
    <p
      v-if="downloadErrorVi"
      data-testid="download-error"
      class="mt-3 rounded-xl border border-cyber-danger/40 bg-cyber-danger/10 p-2.5 text-xs text-cyber-danger"
    >
      {{ downloadErrorVi }}
    </p>
    <p
      v-if="shareErrorVi"
      data-testid="share-error"
      class="mt-3 rounded-xl border border-cyber-danger/40 bg-cyber-danger/10 p-2.5 text-xs text-cyber-danger"
    >
      {{ shareErrorVi }}
    </p>
    <p
      v-if="toastVi"
      data-testid="share-toast"
      role="status"
      class="mt-3 flex items-center gap-2 rounded-xl border border-cyber-emerald/40 bg-cyber-emerald/10 p-2.5 text-xs text-cyber-emerald"
    >
      <Icon name="lucide:check-circle-2" class="h-4 w-4 shrink-0" />
      <span class="break-all">{{ toastVi }}</span>
    </p>
  </div>
</template>
