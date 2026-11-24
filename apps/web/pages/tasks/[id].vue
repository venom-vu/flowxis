<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useAsyncData, useHead, useRoute, useRouter } from '#imports';
import type { Task, TaskResultResponse } from '@flowxis/contracts';
import TaskResultViewer from '~/components/TaskResultViewer.vue';
import { useApiClient } from '~/composables/useApiClient';
import { useAuth } from '~/composables/useAuth';
import { useAuthDialog } from '~/composables/useAuthDialog';
import { resolveApiErrorMessageVi } from '~/utils/api-client';
import { isUnauthorizedError } from '~/utils/auth-session';
import {
  formatTaskTimestampVi,
  getPipelineLabelVi,
  getTaskStatusLabelVi,
} from '~/utils/task-format';

const route = useRoute();
const router = useRouter();
const { client } = useApiClient();
const { isAuthenticated, sessionChecked } = useAuth();
const { open: openAuthDialog } = useAuthDialog();

const taskId = computed<string>(() => {
  const raw = route.params.id;
  const val = Array.isArray(raw) ? raw[0] : raw;
  return typeof val === 'string' ? val : '';
});

useHead({
  title: 'Chi Tiết Tác Vụ — flowxis',
  meta: [
    {
      name: 'description',
      content: 'Xem lại đầu vào, kết quả AI, tải về hoặc sao chép liên kết chia sẻ.',
    },
  ],
});

const taskAsync = useAsyncData<Task>(
  `flowxis-task-${taskId.value}`,
  () => client.getTask(taskId.value),
);

const currentTask = ref<Task | null>(null);
watch(
  () => taskAsync.data.value,
  (t) => {
    if (t) currentTask.value = t;
  },
  { immediate: true },
);

// Đầu vào/tham số lấy từ GET /tasks/:id/result do TaskResultViewer tải.
const result = ref<TaskResultResponse | null>(null);

const isUnauthenticated = computed<boolean>(() => {
  if (isUnauthorizedError(taskAsync.error.value)) return true;
  if (import.meta.server) return false;
  if (!isAuthenticated.value && !taskAsync.pending.value) {
    if (!sessionChecked.value && taskAsync.data.value) return false;
    return true;
  }
  return false;
});

const taskErrorVi = computed<string | null>(() => {
  if (isUnauthenticated.value || !taskAsync.error.value) return null;
  return resolveApiErrorMessageVi(taskAsync.error.value);
});

const isVideoPipeline = computed<boolean>(
  () =>
    currentTask.value?.pipeline === 'motion_control' ||
    currentTask.value?.pipeline === 'motion_control_v2' ||
    currentTask.value?.pipeline === 'veo3' ||
    currentTask.value?.pipeline === 'muse_video' ||
    currentTask.value?.pipeline === 'remove_watermark',
);

const INPUT_LABELS_VI: Readonly<Record<string, string>> = {
  sourceKey: 'Ảnh mặt nguồn',
  targetKey: 'Ảnh đích',
  imageKey: 'Ảnh đầu vào',
  characterKey: 'Ảnh nhân vật',
  videoKey: 'Video mẫu',
  firstFrameKey: 'Khung hình đầu',
  lastFrameKey: 'Khung hình cuối',
  productKey1: 'Ảnh sản phẩm 1',
  productKey2: 'Ảnh sản phẩm 2',
  productKey3: 'Ảnh sản phẩm 3',
};

function inputLabelVi(role: string): string {
  const refMatch = /^imageKey(\d)$/.exec(role);
  if (refMatch) return `Ảnh tham chiếu ${Number(refMatch[1]) + 1}`;
  return INPUT_LABELS_VI[role] ?? role;
}

const inputs = computed(() => result.value?.inputs ?? []);
const params = computed(() => result.value?.params ?? null);

const paramRows = computed<{ label: string; value: string }[]>(() => {
  const p = params.value;
  if (!p) return [];
  const rows: { label: string; value: string }[] = [];
  if (p.intensity != null) rows.push({ label: 'Mức điều chỉnh', value: `${p.intensity}/10` });
  if (p.trimStart != null && p.trimEnd != null) {
    rows.push({ label: 'Đoạn cắt', value: `${p.trimStart}s → ${p.trimEnd}s` });
  }
  if (p.seconds != null) rows.push({ label: 'Thời lượng', value: `${p.seconds} giây` });
  if (p.aspectRatio) rows.push({ label: 'Khung hình', value: p.aspectRatio });
  if (p.resolution) rows.push({ label: 'Độ phân giải', value: p.resolution });
  return rows;
});

const statusTone = computed<string>(() => {
  switch (currentTask.value?.status) {
    case 'succeeded':
      return 'border-cyber-emerald/50 bg-cyber-emerald/15 text-cyber-emerald';
    case 'failed':
    case 'timed_out':
      return 'border-cyber-danger/50 bg-cyber-danger/15 text-cyber-danger';
    case 'running':
      return 'border-cyber-violet/50 bg-cyber-violet/15 text-cyber-violet';
    case 'queued':
      return 'border-cyber-cyan/50 bg-cyber-cyan/15 text-cyber-cyan';
    default:
      return 'border-cyber-border bg-cyber-bg text-cyber-muted';
  }
});

const idCopied = ref<boolean>(false);
async function copyTaskId(): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return;
  try {
    await navigator.clipboard.writeText(taskId.value);
    idCopied.value = true;
    setTimeout(() => {
      idCopied.value = false;
    }, 2000);
  } catch {
    // Bỏ qua: người dùng có thể chọn thủ công mã.
  }
}

function getPipelineRoute(pipeline?: string): string {
  if (pipeline === 'body_retouch') return '/body-retouch';
  if (pipeline === 'outfit_change') return '/outfit-change';
  if (pipeline === 'motion_control') return '/motion-control';
  if (pipeline === 'motion_control_v2') return '/motion-control-v2';
  if (pipeline === 'veo3') return '/veo-3';
  if (pipeline === 'muse_video') return '/muse-video';
  if (pipeline === 'remove_watermark') return '/remove-watermark';
  return '/face-swap';
}

function handleGoBack(): void {
  if (window.history.length > 1) {
    router.back();
  } else {
    void router.push('/history');
  }
}

function handleCreateNewTask(): void {
  void router.push(getPipelineRoute(currentTask.value?.pipeline));
}
</script>

<template>
  <div data-testid="page-task-result" class="mx-auto w-full max-w-6xl space-y-5">
    <!-- Thanh tiêu đề -->
    <header
      class="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-cyber-border bg-cyber-surface p-4 sm:p-5"
    >
      <div class="flex min-w-0 items-center gap-3">
        <button
          type="button"
          data-testid="back-button"
          aria-label="Quay lại"
          class="touch-target inline-flex min-h-[48px] min-w-[48px] shrink-0 items-center justify-center gap-1.5 rounded-xl border border-cyber-border bg-cyber-bg px-3.5 py-2 text-xs font-bold text-cyber-text transition hover:border-cyber-violet"
          @click="handleGoBack"
        >
          <Icon name="lucide:arrow-left" class="h-4 w-4" />
          <span class="hidden sm:inline">Lịch sử</span>
        </button>
        <div v-if="currentTask" class="min-w-0">
          <h1 class="truncate font-display text-base font-bold sm:text-lg">
            {{ getPipelineLabelVi(currentTask.pipeline) }}
          </h1>
          <p class="font-mono text-xs text-cyber-muted">
            {{ formatTaskTimestampVi(currentTask.createdAt) }}
          </p>
        </div>
      </div>

      <span
        v-if="currentTask"
        data-testid="task-status-badge"
        class="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-xs font-bold"
        :class="statusTone"
      >
        <Icon v-if="currentTask.status === 'succeeded'" name="lucide:check-circle-2" class="h-3.5 w-3.5" />
        <span>{{ getTaskStatusLabelVi(currentTask) }}</span>
      </span>
    </header>

    <!-- Chưa đăng nhập -->
    <div
      v-if="isUnauthenticated"
      data-testid="result-unauthenticated"
      class="flex flex-col items-center justify-center rounded-2xl border border-cyber-border bg-cyber-surface p-10 text-center sm:p-12"
    >
      <div class="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-cyber-violet/40 bg-cyber-violet/15 text-cyber-violet">
        <Icon name="lucide:log-in" class="h-7 w-7" />
      </div>
      <h2 class="font-display text-lg font-bold">Yêu Cầu Đăng Nhập</h2>
      <p class="mt-1.5 max-w-sm text-sm text-cyber-muted">Vui lòng đăng nhập để xem chi tiết tác vụ này.</p>
      <button
        type="button"
        class="touch-target mt-5 inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-2 rounded-xl bg-cyber-violet px-6 py-2.5 text-xs font-semibold text-cyber-text transition hover:bg-cyber-violet/90"
        @click="openAuthDialog('login')"
      >
        <Icon name="lucide:log-in" class="h-4 w-4" />
        <span>Đăng nhập ngay</span>
      </button>
    </div>

    <!-- Đang tải -->
    <div
      v-else-if="taskAsync.pending.value && !currentTask"
      data-testid="result-skeleton"
      class="grid gap-5 lg:grid-cols-12"
    >
      <div class="h-80 animate-pulse rounded-2xl border border-cyber-border bg-cyber-surface/50 lg:col-span-5" />
      <div class="h-96 animate-pulse rounded-2xl border border-cyber-border bg-cyber-surface/50 lg:col-span-7" />
    </div>

    <!-- Lỗi tải Task -->
    <div
      v-else-if="taskErrorVi"
      data-testid="task-error-state"
      class="flex flex-col items-center justify-center rounded-2xl border border-cyber-border bg-cyber-surface p-10 text-center sm:p-12"
    >
      <div class="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-cyber-danger/40 bg-cyber-danger/15 text-cyber-danger">
        <Icon name="lucide:alert-circle" class="h-7 w-7" />
      </div>
      <h2 class="font-display text-lg font-bold text-cyber-danger">Không Thể Tải Tác Vụ</h2>
      <p class="mt-1.5 max-w-sm text-sm text-cyber-muted">{{ taskErrorVi }}</p>
      <button
        type="button"
        class="touch-target mt-5 inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-2 rounded-xl border border-cyber-border bg-cyber-bg px-5 py-2.5 text-xs font-semibold text-cyber-text transition hover:border-cyber-violet"
        @click="() => taskAsync.refresh()"
      >
        <Icon name="lucide:refresh-cw" class="h-4 w-4" />
        <span>Thử lại</span>
      </button>
    </div>

    <!-- Nội dung chính: Đầu vào (trái) + Kết quả (phải) -->
    <div
      v-else-if="currentTask"
      data-testid="result-success-view"
      class="grid gap-5 lg:grid-cols-12"
    >
      <!-- Cột trái -->
      <aside class="space-y-5 lg:col-span-5">
        <section
          data-testid="task-inputs-card"
          class="rounded-2xl border border-cyber-border bg-cyber-surface p-4 sm:p-5"
        >
          <h2 class="mb-3 flex items-center gap-2 font-display text-sm font-bold">
            <Icon name="lucide:upload-cloud" class="h-4 w-4 text-cyber-violet" />
            <span>Đầu vào</span>
          </h2>

          <div v-if="inputs.length" class="space-y-3">
            <figure
              v-for="item in inputs"
              :key="item.role"
              :data-testid="`task-input-${item.role}`"
              class="overflow-hidden rounded-xl border border-cyber-border bg-cyber-bg/70"
            >
              <figcaption class="flex items-center justify-between border-b border-cyber-border/70 px-3 py-2 text-xs font-semibold text-cyber-text">
                <span>{{ inputLabelVi(item.role) }}</span>
                <Icon
                  :name="item.mediaType === 'video' ? 'lucide:video' : 'lucide:image'"
                  class="h-3.5 w-3.5 text-cyber-muted"
                />
              </figcaption>
              <video
                v-if="item.mediaType === 'video'"
                :src="item.url"
                playsinline
                controls
                preload="metadata"
                class="max-h-64 w-full bg-black object-contain"
              />
              <a v-else :href="item.url" target="_blank" rel="noopener" class="block">
                <img
                  :src="item.url"
                  :alt="inputLabelVi(item.role)"
                  loading="lazy"
                  class="max-h-64 w-full bg-black/40 object-contain"
                />
              </a>
            </figure>
          </div>
          <p
            v-else-if="currentTask.status === 'succeeded'"
            data-testid="task-inputs-empty"
            class="rounded-xl border border-dashed border-cyber-border px-3 py-6 text-center text-xs text-cyber-muted"
          >
            Tệp đầu vào đã hết hạn lưu hoặc không còn khả dụng.
          </p>
          <p
            v-else
            class="rounded-xl border border-dashed border-cyber-border px-3 py-6 text-center text-xs text-cyber-muted"
          >
            Đầu vào sẽ hiển thị sau khi tác vụ hoàn tất.
          </p>

          <div
            v-if="params?.prompt"
            data-testid="task-prompt"
            class="mt-3 rounded-xl border border-cyber-border bg-cyber-bg/70 p-3"
          >
            <p class="mb-1 text-[11px] font-bold uppercase tracking-wider text-cyber-muted">Mô tả hành vi</p>
            <p class="whitespace-pre-wrap break-words text-xs text-cyber-text">{{ params.prompt }}</p>
          </div>
        </section>

        <section
          data-testid="task-info-card"
          class="rounded-2xl border border-cyber-border bg-cyber-surface p-4 sm:p-5"
        >
          <h2 class="mb-3 flex items-center gap-2 font-display text-sm font-bold">
            <Icon name="lucide:info" class="h-4 w-4 text-cyber-cyan" />
            <span>Thông tin tác vụ</span>
          </h2>
          <dl class="divide-y divide-cyber-border/60 text-xs">
            <div class="flex items-center justify-between gap-3 py-2">
              <dt class="text-cyber-muted">Công cụ</dt>
              <dd class="font-semibold text-cyber-text">{{ getPipelineLabelVi(currentTask.pipeline) }}</dd>
            </div>
            <div class="flex items-center justify-between gap-3 py-2">
              <dt class="text-cyber-muted">Chi phí</dt>
              <dd class="font-mono font-semibold text-cyber-cyan">{{ currentTask.creditCost }} CR</dd>
            </div>
            <div v-for="row in paramRows" :key="row.label" class="flex items-center justify-between gap-3 py-2">
              <dt class="text-cyber-muted">{{ row.label }}</dt>
              <dd class="font-mono font-semibold text-cyber-text">{{ row.value }}</dd>
            </div>
            <div class="flex items-center justify-between gap-3 py-2">
              <dt class="text-cyber-muted">Tạo lúc</dt>
              <dd class="font-mono text-cyber-text">{{ formatTaskTimestampVi(currentTask.createdAt) }}</dd>
            </div>
            <div class="flex items-center justify-between gap-3 py-2">
              <dt class="text-cyber-muted">Cập nhật</dt>
              <dd class="font-mono text-cyber-text">{{ formatTaskTimestampVi(currentTask.updatedAt) }}</dd>
            </div>
            <div class="flex items-center justify-between gap-3 py-2">
              <dt class="text-cyber-muted">Mã tác vụ</dt>
              <dd class="flex min-w-0 items-center gap-1.5">
                <span class="truncate font-mono text-cyber-text">{{ currentTask.id.slice(0, 8) }}…</span>
                <button
                  type="button"
                  data-testid="copy-task-id-button"
                  :aria-label="idCopied ? 'Đã sao chép mã' : 'Sao chép mã tác vụ'"
                  class="touch-target inline-flex h-8 w-8 items-center justify-center rounded-lg text-cyber-muted transition hover:bg-cyber-bg hover:text-cyber-text"
                  @click="copyTaskId"
                >
                  <Icon :name="idCopied ? 'lucide:check' : 'lucide:copy'" class="h-3.5 w-3.5" />
                </button>
              </dd>
            </div>
          </dl>
        </section>
      </aside>

      <!-- Cột phải: Kết quả (loading, kết quả video hoặc so sánh Trước/Sau, tải về, sao chép liên kết) -->
      <section class="space-y-4 lg:col-span-7">
        <div class="rounded-2xl border border-cyber-border bg-cyber-surface p-4 sm:p-5">
          <TaskResultViewer
            :task="currentTask"
            :video-output="isVideoPipeline"
            embedded
            @update:task="currentTask = $event"
            @result="result = $event"
            @retry="handleCreateNewTask"
          >
            <template #header-title>
              <h2 class="flex items-center gap-2 font-display text-sm font-bold">
                <Icon name="lucide:sparkles" class="h-4 w-4 text-cyber-violet" />
                <span>{{ isVideoPipeline ? 'Video kết quả' : 'Kết quả' }}</span>
              </h2>
            </template>
          </TaskResultViewer>
        </div>

        <NuxtLink
          :to="getPipelineRoute(currentTask.pipeline)"
          data-testid="create-similar-link"
          class="touch-target inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border border-cyber-border bg-cyber-surface px-4 py-2.5 text-xs font-bold text-cyber-text transition hover:border-cyber-violet"
        >
          <Icon name="lucide:sparkles" class="h-4 w-4 text-cyber-violet" />
          <span>{{ isVideoPipeline ? 'Tạo video khác' : `Tạo tác vụ ${getPipelineLabelVi(currentTask.pipeline)} khác` }}</span>
        </NuxtLink>
      </section>
    </div>
  </div>
</template>
