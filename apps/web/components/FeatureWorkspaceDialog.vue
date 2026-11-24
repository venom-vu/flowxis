<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  MOTION_MIN_TRIM_SECONDS,
  MUSE_VIDEO_DURATION_SECONDS,
  REMOVE_WATERMARK_PROMPT_MAX_LENGTH,
  type AccountTier,
  type Task,
} from "@flowxis/contracts";
import ImageUploader from "~/components/ImageUploader.vue";
import TaskResultViewer from "~/components/TaskResultViewer.vue";
import { useApiClient } from "~/composables/useApiClient";
import { useAuthDialog } from "~/composables/useAuthDialog";
import { useMotionControl } from "~/composables/useMotionControl";
import { useVeo3 } from "~/composables/useVeo3";
import Veo3Form from "~/components/Veo3Form.vue";
import { useMuseVideo } from "~/composables/useMuseVideo";
import MuseVideoForm from "~/components/MuseVideoForm.vue";
import { usePricingConfig } from "~/composables/usePricingConfig";
import {
  ApiErrorCode,
  INTENSITY_DEFAULT,
  INTENSITY_LABEL_ZONES,
  INTENSITY_MAX,
  INTENSITY_MIN,
  IntensitySchema,
  getIntensityLabelVi,
  resolveApiErrorMessageVi,
} from "~/utils/api-client";
import {
  calculateFeatureEstimatedCredits,
  formatNumberVi,
  type AiFeatureTool,
} from "~/utils/catalog";

const props = withDefaults(
  defineProps<{
    open: boolean;
    feature: AiFeatureTool | null;
    userTier?: AccountTier;
    userBalance?: number | null;
  }>(),
  {
    userTier: "FREE",
    userBalance: null,
  },
);

const emit = defineEmits<{
  close: [];
  submit: [
    {
      featureId: string;
      seconds: number;
      estimatedCredits: number;
      uploadedKey?: string | null;
      sourceKey?: string | null;
      targetKey?: string | null;
      modelKey?: string | null;
      clothingKey?: string | null;
      intensity?: number;
    },
  ];
}>();

const { client } = useApiClient();
const { open: openAuthDialog } = useAuthDialog();
const { refreshAll } = usePricingConfig();
const motion = useMotionControl();
// Liên kết cấp cao nhất để template tự mở `.value` (dùng chung logic với trang /motion-control).
const motionCharacterKey = motion.characterKey;
const motionCapSeconds = motion.capSeconds;
const motionSeconds = motion.seconds;
const motionPrompt = motion.prompt;
const motionInsufficientNoteVi = motion.insufficientNoteVi;
const motionSubmitErrorVi = motion.submitErrorVi;
const motionIsSubmitting = motion.isSubmitting;
const veo = useVeo3();
const veoMode = veo.mode;
const veoPrompt = veo.prompt;
const veoAspectRatio = veo.aspectRatio;
const veoResolution = veo.resolution;
const veoImageKey = veo.imageKey;
const veoFirstFrameKey = veo.firstFrameKey;
const veoLastFrameKey = veo.lastFrameKey;
const veoSubmitErrorVi = veo.submitErrorVi;
const veoIsSubmitting = veo.isSubmitting;
const veoInsufficientNoteVi = veo.insufficientNoteVi;
const muse = useMuseVideo();
const musePrompt = muse.prompt;
const museAspectRatio = muse.aspectRatio;
const museImageKeys = muse.imageKeys;
const museTotalBytes = muse.totalBytes;
const musePending = muse.pending;
const museSubmitErrorVi = muse.submitErrorVi;
const museIsSubmitting = muse.isSubmitting;
const museInsufficientNoteVi = muse.insufficientNoteVi;
const motionKey = ref<number>(0);

// Dọn sạch trạng thái Motion và buộc VideoTrimmer/ImageUploader remount.
function resetMotionState(): void {
  motion.clearState();
  motionKey.value += 1;
}
const onMotionTrimChange = motion.onTrimChange;

const compareSplitPercent = ref<number>(50);
const selectedSeconds = ref<number>(1);
const intensity = ref<number>(INTENSITY_DEFAULT);
const uploadedKey = ref<string | null>(null);
const sourceKey = ref<string | null>(null);
const targetKey = ref<string | null>(null);
const modelKey = ref<string | null>(null);
const clothingKey = ref<string | null>(null);
const activeTask = ref<Task | null>(null);
const isSubmitting = ref<boolean>(false);
const submitErrorVi = ref<string | null>(null);

const intensityLabelVi = computed<string>(
  () => getIntensityLabelVi(intensity.value) ?? "Tự nhiên",
);

const isValidIntensity = computed<boolean>(
  () => IntensitySchema.safeParse(intensity.value).success,
);

watch(
  () => props.feature,
  (nextFeature) => {
    compareSplitPercent.value = 50;
    intensity.value = INTENSITY_DEFAULT;
    uploadedKey.value = null;
    sourceKey.value = null;
    targetKey.value = null;
    modelKey.value = null;
    clothingKey.value = null;
    activeTask.value = null;
    submitErrorVi.value = null;
    resetMotionState();
    veo.clearState();
    muse.clearState();
    if (nextFeature?.tierCapSeconds) {
      selectedSeconds.value = Math.min(
        MOTION_MIN_TRIM_SECONDS,
        nextFeature.tierCapSeconds,
      );
    } else {
      selectedSeconds.value = 1;
    }
  },
  { immediate: true },
);

function syncScrollLock(locked: boolean): void {
  if (typeof document === "undefined") return;
  const body = document.body;
  const html = document.documentElement;
  if (!body?.style) return;
  if (body.dataset) {
    if (locked) {
      body.dataset.lockWorkspace = "1";
    } else {
      delete body.dataset.lockWorkspace;
    }
  }
  const stillLocked = body.dataset
    ? Boolean(
        body.dataset.lockWorkspace ||
        body.dataset.lockVietqr ||
        body.dataset.lockAuth,
      )
    : locked;
  const overflow = stillLocked ? "hidden" : "";
  body.style.overflow = overflow;
  if (html?.style) {
    html.style.overflow = overflow;
  }
}

watch(
  () => Boolean(props.open && props.feature),
  (isLocked) => {
    syncScrollLock(isLocked);
  },
  { immediate: true },
);

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) {
      intensity.value = INTENSITY_DEFAULT;
      uploadedKey.value = null;
      sourceKey.value = null;
      targetKey.value = null;
      modelKey.value = null;
      clothingKey.value = null;
      activeTask.value = null;
      submitErrorVi.value = null;
      resetMotionState();
      veo.clearState();
      muse.clearState();
    }
  },
  { immediate: true },
);

// Xóa lỗi cũ khi người dùng thay đổi dữ liệu đầu vào hoặc mức intensity
watch(
  [uploadedKey, sourceKey, targetKey, modelKey, clothingKey, intensity],
  () => {
    submitErrorVi.value = null;
  },
  { flush: "sync" },
);

const anySubmitting = computed<boolean>(
  () =>
    isSubmitting.value ||
    motionIsSubmitting.value ||
    veoIsSubmitting.value ||
    museIsSubmitting.value,
);

// Task đang xếp hàng/chạy: khóa nút tạo để tránh tạo trùng.
const isTaskWorking = computed<boolean>(
  () =>
    activeTask.value?.status === "queued" ||
    activeTask.value?.status === "running",
);

const isAuthenticated = computed<boolean>(() => {
  return typeof props.userBalance === "number";
});

const isMotion = computed<boolean>(
  () =>
    props.feature?.id === "motion-control" ||
    props.feature?.id === "motion-control-v2" ||
    props.feature?.id === "remove-watermark",
);
const isVeo3 = computed<boolean>(() => props.feature?.id === "veo-3");
const isMuseVideo = computed<boolean>(() => props.feature?.id === "muse-video");
const isRemoveWatermark = computed<boolean>(
  () => props.feature?.id === "remove-watermark",
);
const motionVariant = computed<"v1" | "v2" | "watermark">(() =>
  isRemoveWatermark.value
    ? "watermark"
    : props.feature?.id === "motion-control-v2"
      ? "v2"
      : "v1",
);
watch(
  motionVariant,
  (v) => {
    motion.variant.value = v;
  },
  { immediate: true, flush: "sync" },
);

const estimatedCredits = computed<number>(() => {
  if (!props.feature) {
    return 0;
  }
  if (isMotion.value) {
    return motion.price.value ?? 0;
  }
  if (isVeo3.value) return veo.price.value;
  if (isMuseVideo.value) return muse.price.value;
  return calculateFeatureEstimatedCredits(props.feature, selectedSeconds.value);
});

const hasEnoughBalance = computed<boolean>(() => {
  if (isVeo3.value) return isAuthenticated.value && veo.hasEnoughBalance.value;
  if (isMuseVideo.value)
    return isAuthenticated.value && muse.hasEnoughBalance.value;
  if (isMotion.value) {
    return (
      isAuthenticated.value &&
      motion.isAuthenticated.value &&
      motion.hasEnoughBalance.value
    );
  }
  if (!isAuthenticated.value || typeof props.userBalance !== "number") {
    return false;
  }
  return props.userBalance >= estimatedCredits.value;
});

const canSubmit = computed<boolean>(() => {
  if (isTaskWorking.value) {
    return false;
  }
  if (isVeo3.value) {
    return isAuthenticated.value && veo.canSubmit.value;
  }
  if (isMuseVideo.value) {
    return isAuthenticated.value && muse.canSubmit.value;
  }
  if (isMotion.value) {
    return (
      isAuthenticated.value &&
      motion.isAuthenticated.value &&
      !motionIsSubmitting.value &&
      motion.canSubmit.value
    );
  }
  if (!isAuthenticated.value || !hasEnoughBalance.value || isSubmitting.value) {
    return false;
  }
  if (props.feature?.id === "face-swap") {
    return Boolean(sourceKey.value && targetKey.value);
  }
  if (props.feature?.id === "outfit-change") {
    return Boolean(modelKey.value && clothingKey.value);
  }
  if (props.feature?.id === "body-retouch") {
    return Boolean(uploadedKey.value && isValidIntensity.value);
  }
  return Boolean(uploadedKey.value);
});

async function handleSubmit(): Promise<void> {
  if (!props.feature || isSubmitting.value || isTaskWorking.value) {
    return;
  }

  if (props.feature.id === "body-retouch" && !isValidIntensity.value) {
    submitErrorVi.value = resolveApiErrorMessageVi(
      ApiErrorCode.VALIDATION_FAILED,
    );
    return;
  }

  if (!canSubmit.value) {
    return;
  }

  if (isVeo3.value) {
    const credits = veo.price.value;
    const task = await veo.submit();
    if (task) {
      activeTask.value = task;
      emit("submit", {
        featureId: props.feature.id,
        seconds: 8,
        estimatedCredits: credits,
      });
    }
    return;
  }

  if (isMuseVideo.value) {
    const credits = muse.price.value;
    const task = await muse.submit();
    if (task) {
      activeTask.value = task;
      emit("submit", {
        featureId: props.feature.id,
        seconds: MUSE_VIDEO_DURATION_SECONDS,
        estimatedCredits: credits,
      });
    }
    return;
  }

  if (isMotion.value) {
    // Logic tạo Task dùng chung với trang /motion-control (composable useMotionControl).
    const seconds = motion.seconds.value;
    const credits = motion.price.value ?? 0;
    const task = await motion.submit();
    if (task) {
      activeTask.value = task;
      emit("submit", {
        featureId: props.feature.id,
        seconds,
        estimatedCredits: credits,
        uploadedKey: motion.characterKey.value,
      });
    }
    return;
  }

  if (props.feature.id === "face-swap") {
    isSubmitting.value = true;
    submitErrorVi.value = null;
    try {
      const task = await client.createFaceSwapTask({
        sourceKey: sourceKey.value!,
        targetKey: targetKey.value!,
      });
      activeTask.value = task;
      void refreshAll();
      emit("submit", {
        featureId: props.feature.id,
        seconds: selectedSeconds.value,
        estimatedCredits: estimatedCredits.value,
        sourceKey: sourceKey.value,
        targetKey: targetKey.value,
      });
    } catch (error: unknown) {
      submitErrorVi.value = resolveApiErrorMessageVi(error);
    } finally {
      isSubmitting.value = false;
    }
  } else if (props.feature.id === "outfit-change") {
    isSubmitting.value = true;
    submitErrorVi.value = null;
    try {
      const task = await client.createOutfitChangeTask({
        modelKey: modelKey.value!,
        clothingKey: clothingKey.value!,
      });
      activeTask.value = task;
      void refreshAll();
      emit("submit", {
        featureId: props.feature.id,
        seconds: selectedSeconds.value,
        estimatedCredits: estimatedCredits.value,
        modelKey: modelKey.value,
        clothingKey: clothingKey.value,
      });
    } catch (error: unknown) {
      submitErrorVi.value = resolveApiErrorMessageVi(error);
    } finally {
      isSubmitting.value = false;
    }
  } else if (props.feature.id === "body-retouch") {
    isSubmitting.value = true;
    submitErrorVi.value = null;
    try {
      const parsedIntensity = IntensitySchema.parse(intensity.value);
      const task = await client.createBodyRetouchTask({
        imageKey: uploadedKey.value!,
        intensity: parsedIntensity,
      });
      activeTask.value = task;
      void refreshAll();
      emit("submit", {
        featureId: props.feature.id,
        seconds: selectedSeconds.value,
        estimatedCredits: estimatedCredits.value,
        uploadedKey: uploadedKey.value,
        intensity: parsedIntensity,
      });
    } catch (error: unknown) {
      submitErrorVi.value = resolveApiErrorMessageVi(error);
    } finally {
      isSubmitting.value = false;
    }
  } else {
    emit("submit", {
      featureId: props.feature.id,
      seconds: selectedSeconds.value,
      estimatedCredits: estimatedCredits.value,
      uploadedKey: uploadedKey.value,
    });
  }
}

function handleRetry(): void {
  activeTask.value = null;
  submitErrorVi.value = null;
  if (isMotion.value) resetMotionState();
  if (isVeo3.value) veo.clearState();
  if (isMuseVideo.value) muse.clearState();
}

function handleKeydown(event: KeyboardEvent): void {
  if (props.open && event.key === "Escape") {
    emit("close");
  }
}

onMounted(() => {
  if (typeof window !== "undefined") {
    window.addEventListener("keydown", handleKeydown);
  }
});

onBeforeUnmount(() => {
  if (typeof window !== "undefined") {
    window.removeEventListener("keydown", handleKeydown);
  }
  syncScrollLock(false);
});
</script>

<template>
  <!-- Centered Dialog đồng nhất trên cả Mobile (360px) và Desktop (>= 1024px), max-width: 980px -->
  <div
    v-if="open && feature"
    role="dialog"
    aria-modal="true"
    :aria-labelledby="`workspace-dialog-title-${feature.id}`"
    data-testid="feature-workspace-dialog"
    class="fixed inset-0 !m-0 z-50 flex items-center justify-center overscroll-contain bg-cyber-bg/80 p-3 backdrop-blur-sm sm:p-6"
  >
    <div
      class="relative max-h-[90dvh] w-full max-w-[980px] overflow-y-auto overscroll-contain rounded-2xl border border-cyber-border bg-cyber-surface text-cyber-text shadow-2xl"
    >
      <!-- Header của Centered Dialog -->
      <div
        class="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-cyber-border bg-cyber-surface/95 px-4 py-3.5 backdrop-blur sm:px-6"
      >
        <div class="flex items-center gap-3">
          <span
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyber-violet/40 bg-cyber-violet/15 text-cyber-violet"
          >
            <Icon :name="feature.icon" class="h-5 w-5" />
          </span>
          <div>
            <h2
              :id="`workspace-dialog-title-${feature.id}`"
              class="font-display text-base font-bold sm:text-lg"
            >
              {{ feature.titleVi }}
            </h2>
            <p class="text-xs text-cyber-muted">
              {{ feature.categoryLabelVi }} • Hạng hiện tại:
              <span class="font-mono font-semibold text-cyber-cyan">
                {{ userTier }}
              </span>
            </p>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <NuxtLink
            v-if="
              feature.id === 'face-swap' ||
              feature.id === 'veo-3' ||
              feature.id === 'muse-video' ||
              feature.id === 'outfit-change' ||
              feature.id === 'body-retouch' ||
              isMotion
            "
            :to="
              feature.id === 'veo-3'
                ? '/veo-3'
                : feature.id === 'muse-video'
                  ? '/muse-video'
                  : feature.id === 'body-retouch'
                    ? '/body-retouch'
                    : feature.id === 'motion-control'
                      ? '/motion-control'
                      : feature.id === 'motion-control-v2'
                        ? '/motion-control-v2'
                        : feature.id === 'remove-watermark'
                          ? '/remove-watermark'
                          : feature.id === 'outfit-change'
                            ? '/outfit-change'
                            : '/face-swap'
            "
            data-testid="workspace-open-standalone-link"
            class="touch-target inline-flex min-h-[48px] items-center gap-1.5 rounded-xl border border-cyber-border bg-cyber-bg px-3 py-2 text-xs font-semibold text-cyber-muted transition hover:border-cyber-cyan hover:text-cyber-cyan"
            @click="emit('close')"
          >
            <Icon name="lucide:maximize-2" class="h-3.5 w-3.5" />
            <span>Mở trang riêng</span>
          </NuxtLink>

          <button
            type="button"
            aria-label="Đóng hộp thoại làm việc"
            data-testid="close-workspace-dialog"
            class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center rounded-xl border border-cyber-border bg-cyber-bg/80 p-2.5 text-cyber-muted transition hover:border-cyber-violet hover:text-cyber-text"
            @click="emit('close')"
          >
            <Icon name="lucide:x" class="h-5 w-5" />
          </button>
        </div>
      </div>

      <!-- Nội dung 2 cột trên Desktop, 1 cột trên Mobile khi chưa có activeTask -->
      <div class="grid grid-cols-1 gap-5 p-4 sm:p-6 lg:grid-cols-12">
        <!-- Cột trái: Tải tệp & Điều chỉnh thông số (Trimmer bước 1 giây cho video) -->
        <div class="space-y-3.5 lg:col-span-6">
          <!-- Veo 3: ô nhập đổi theo chế độ (text / image / frames) -->
          <Veo3Form
            v-if="isVeo3"
            v-model:mode="veoMode"
            v-model:prompt="veoPrompt"
            v-model:aspect-ratio="veoAspectRatio"
            v-model:resolution="veoResolution"
            v-model:image-key="veoImageKey"
            v-model:first-frame-key="veoFirstFrameKey"
            v-model:last-frame-key="veoLastFrameKey"
            id-prefix="workspace-veo3"
            :maintenance-note="veo.intakePaused.value"
          />

          <!-- Muse Video: 1-9 ảnh tham chiếu + mô tả + tỉ lệ khung -->
          <MuseVideoForm
            v-else-if="isMuseVideo"
            v-model:prompt="musePrompt"
            v-model:aspect-ratio="museAspectRatio"
            v-model:image-keys="museImageKeys"
            v-model:total-bytes="museTotalBytes"
            v-model:pending="musePending"
            id-prefix="workspace-muse-video"
            :maintenance-note="muse.intakePaused.value"
          />

          <!-- Trường hợp Face Swap: Yêu cầu 2 ảnh (mặt nguồn + đích) theo Story 2.11 -->
          <div
            v-else-if="feature.id === 'face-swap'"
            class="space-y-3"
            data-testid="workspace-face-swap-inputs"
          >
            <!-- 1. Ảnh mặt nguồn -->
            <div
              class="space-y-2.5 rounded-xl border border-cyber-border bg-cyber-bg/60 p-3 sm:p-3.5"
            >
              <div class="flex items-center gap-2">
                <span
                  class="flex h-5 w-5 items-center justify-center rounded-md border border-cyber-cyan/40 bg-cyber-cyan/15 font-mono text-[11px] font-bold text-cyber-cyan"
                >
                  1
                </span>
                <p class="text-xs font-semibold text-cyber-text sm:text-sm">
                  Ảnh mặt nguồn (Khuôn mặt cần lấy)
                </p>
              </div>
              <ImageUploader
                v-model="sourceKey"
                id-prefix="workspace-source-face"
                label-vi="Chọn ảnh mặt nguồn"
                description-vi="Ảnh chân dung rõ mặt, JPG/PNG/WebP ≤ 10 MB"
              />
            </div>

            <!-- 2. Ảnh đích -->
            <div
              class="space-y-2.5 rounded-xl border border-cyber-border bg-cyber-bg/60 p-3 sm:p-3.5"
            >
              <div class="flex items-center gap-2">
                <span
                  class="flex h-5 w-5 items-center justify-center rounded-md border border-cyber-violet/40 bg-cyber-violet/15 font-mono text-[11px] font-bold text-cyber-violet"
                >
                  2
                </span>
                <p class="text-xs font-semibold text-cyber-text sm:text-sm">
                  Ảnh đích (Bối cảnh muốn ghép)
                </p>
              </div>
              <ImageUploader
                v-model="targetKey"
                id-prefix="workspace-target-face"
                label-vi="Chọn ảnh đích"
                description-vi="Ảnh có người rõ dáng, JPG/PNG/WebP ≤ 10 MB"
              />
            </div>
          </div>

          <!-- Đổi trang phục: 2 ảnh (người mẫu + trang phục) -->
          <div
            v-else-if="feature.id === 'outfit-change'"
            class="space-y-3"
            data-testid="workspace-outfit-change-inputs"
          >
            <div
              class="space-y-2.5 rounded-xl border border-cyber-border bg-cyber-bg/60 p-3 sm:p-3.5"
            >
              <div class="flex items-center gap-2">
                <span
                  class="flex h-5 w-5 items-center justify-center rounded-md border border-cyber-cyan/40 bg-cyber-cyan/15 font-mono text-[11px] font-bold text-cyber-cyan"
                >
                  1
                </span>
                <p class="text-xs font-semibold text-cyber-text sm:text-sm">
                  Ảnh người mẫu (Người cần thay trang phục)
                </p>
              </div>
              <ImageUploader
                v-model="modelKey"
                id-prefix="workspace-outfit-model"
                label-vi="Chọn ảnh người mẫu"
                description-vi="Ảnh người rõ dáng, JPG/PNG/WebP ≤ 10 MB"
              />
            </div>

            <div
              class="space-y-2.5 rounded-xl border border-cyber-border bg-cyber-bg/60 p-3 sm:p-3.5"
            >
              <div class="flex items-center gap-2">
                <span
                  class="flex h-5 w-5 items-center justify-center rounded-md border border-cyber-violet/40 bg-cyber-violet/15 font-mono text-[11px] font-bold text-cyber-violet"
                >
                  2
                </span>
                <p class="text-xs font-semibold text-cyber-text sm:text-sm">
                  Ảnh trang phục (Quần áo muốn mặc)
                </p>
              </div>
              <ImageUploader
                v-model="clothingKey"
                id-prefix="workspace-outfit-clothing"
                label-vi="Chọn ảnh trang phục"
                description-vi="Ảnh quần áo rõ nét, JPG/PNG/WebP ≤ 10 MB"
              />
            </div>
          </div>

          <!-- Các công cụ AI khác: Thành phần tải ảnh đơn dùng chung (Story 2.10) -->
          <div
            v-else-if="!isRemoveWatermark"
            class="rounded-xl border border-cyber-border bg-cyber-bg/60 p-3 sm:p-3.5"
          >
            <div class="mb-2.5 flex items-start gap-2.5">
              <Icon
                name="lucide:upload-cloud"
                class="mt-0.5 h-5 w-5 shrink-0 text-cyber-violet"
              />
              <div class="min-w-0 flex-1 space-y-0.5">
                <p class="text-xs font-semibold text-cyber-text sm:text-sm">
                  Tải dữ liệu đầu vào
                </p>
                <p
                  class="truncate text-[11px] text-cyber-muted sm:whitespace-normal sm:text-xs"
                >
                  {{ feature.inputRequirementVi }}
                </p>
              </div>
            </div>

            <ImageUploader
              v-if="isMotion && !isRemoveWatermark"
              :key="`motion-char-${motionKey}`"
              v-model="motionCharacterKey"
              id-prefix="workspace-motion-character"
              label-vi="Chọn ảnh nhân vật"
              description-vi="Ảnh toàn thân rõ dáng, JPG/PNG/WebP ≤ 10 MB"
            />
            <ImageUploader
              v-else-if="!isRemoveWatermark"
              v-model="uploadedKey"
              id-prefix="workspace-input"
              :label-vi="
                feature.titleVi
                  ? `Tải ảnh cho ${feature.titleVi}`
                  : 'Tải ảnh lên'
              "
              :description-vi="feature.inputRequirementVi"
            />
          </div>

          <!-- Thanh trượt mức điều chỉnh nâng ngực (Body Retouch: intensity 1..10, bước 1, mặc định 5) -->
          <div
            v-if="feature.id === 'body-retouch'"
            data-testid="workspace-intensity-section"
            class="space-y-3 rounded-xl border border-cyber-border bg-cyber-bg/60 p-3 sm:p-3.5"
          >
            <div class="flex flex-wrap items-center justify-between gap-2">
              <label
                for="workspace-intensity-range"
                class="flex items-center gap-2 text-xs font-semibold text-cyber-text sm:text-sm"
              >
                <Icon
                  name="lucide:sliders-horizontal"
                  class="h-4 w-4 text-cyber-cyan"
                />
                <span>Mức độ nâng ngực</span>
              </label>
              <span
                data-testid="workspace-intensity-badge"
                class="inline-flex items-center gap-1.5 rounded-full border border-cyber-cyan/40 bg-cyber-cyan/15 px-3 py-1 font-mono text-xs font-bold text-cyber-cyan"
              >
                <span data-testid="workspace-intensity-value"
                  >Mức {{ intensity }}/{{ INTENSITY_MAX }}</span
                >
                <span>•</span>
                <span data-testid="workspace-intensity-label">{{
                  intensityLabelVi
                }}</span>
              </span>
            </div>

            <input
              id="workspace-intensity-range"
              v-model.number="intensity"
              type="range"
              :min="INTENSITY_MIN"
              :max="INTENSITY_MAX"
              step="1"
              data-testid="workspace-intensity-slider"
              aria-label="Mức điều chỉnh nâng ngực từ 1 đến 10"
              :aria-valuenow="intensity"
              :aria-valuemin="INTENSITY_MIN"
              :aria-valuemax="INTENSITY_MAX"
              :aria-valuetext="intensityLabelVi"
              class="touch-target min-h-[48px] w-full cursor-pointer accent-cyber-cyan"
            />

            <div
              data-testid="workspace-intensity-zones"
              class="grid grid-cols-3 gap-2 text-center text-[11px]"
            >
              <div
                v-for="zone in INTENSITY_LABEL_ZONES"
                :key="zone.label"
                :data-testid="`workspace-intensity-zone-${zone.min}-${zone.max}`"
                class="rounded-lg border px-2 py-1.5 transition"
                :class="[
                  intensity >= zone.min && intensity <= zone.max
                    ? 'border-cyber-cyan/50 bg-cyber-cyan/15 font-semibold text-cyber-cyan'
                    : 'border-cyber-border/60 bg-cyber-surface/40 text-cyber-muted',
                ]"
              >
                <div class="font-mono text-[10px]">
                  {{ zone.min }}–{{ zone.max }}
                </div>
                <div>{{ zone.label }}</div>
              </div>
            </div>
          </div>

          <!-- Banner lỗi nếu có -->
          <div
            v-if="
              submitErrorVi ||
              motionSubmitErrorVi ||
              veoSubmitErrorVi ||
              museSubmitErrorVi
            "
            data-testid="workspace-submit-error-banner"
            role="alert"
            aria-live="assertive"
            class="rounded-xl border border-cyber-danger/40 bg-cyber-danger/10 p-3 text-xs text-cyber-danger"
          >
            {{
              submitErrorVi ||
              motionSubmitErrorVi ||
              veoSubmitErrorVi ||
              museSubmitErrorVi
            }}
          </div>

          <p
            v-if="isVeo3 && veoInsufficientNoteVi"
            data-testid="workspace-insufficient-note"
            class="text-xs font-semibold text-cyber-warning"
          >
            {{ veoInsufficientNoteVi }}
          </p>
          <p
            v-if="isMuseVideo && museInsufficientNoteVi"
            data-testid="workspace-insufficient-note"
            class="text-xs font-semibold text-cyber-warning"
          >
            {{ museInsufficientNoteVi }}
          </p>

          <!-- Bộ cắt video bước 1 giây (VideoTrimmer, chỉ với Motion Control) -->
          <div
            v-if="isMotion"
            data-testid="workspace-video-trimmer"
            class="min-w-0 space-y-2.5 rounded-xl border border-cyber-border bg-cyber-bg/60 p-3 sm:p-3.5"
          >
            <p
              class="flex items-center gap-2 text-xs font-semibold text-cyber-text sm:text-sm"
            >
              <Icon name="lucide:scissors" class="h-4 w-4 text-cyber-cyan" />
              <span>{{
                isRemoveWatermark
                  ? "Video cần xử lý và đoạn cắt (bước 1 giây)"
                  : "Video mẫu và đoạn cắt (bước 1 giây)"
              }}</span>
            </p>
            <VideoTrimmer
              :key="`motion-video-${motionKey}`"
              id-prefix="workspace-motion-video"
              :cap-seconds="motionCapSeconds"
              :tier-name="userTier"
              @change="onMotionTrimChange"
            />
            <div
              v-if="isRemoveWatermark"
              class="space-y-2 rounded-xl border border-cyber-border bg-cyber-bg/60 p-3 sm:p-3.5"
            >
              <label
                for="workspace-watermark-prompt"
                class="text-xs font-semibold text-cyber-text sm:text-sm"
              >
                Mô tả yêu cầu (Optional)
              </label>
              <textarea
                id="workspace-watermark-prompt"
                v-model="motionPrompt"
                data-testid="workspace-watermark-prompt"
                rows="5"
                :maxlength="REMOVE_WATERMARK_PROMPT_MAX_LENGTH"
                placeholder="Ví dụ: xóa logo ở góc phải và phụ đề phía dưới, giữ nguyên nhân vật. Để trống nếu muốn hệ thống tự xử lý."
                class="w-full resize-y rounded-lg border border-cyber-border bg-cyber-surface p-3 text-sm text-cyber-text placeholder:text-cyber-muted focus:border-cyber-cyan focus:outline-none"
              />
              <p class="text-right font-mono text-[11px] text-cyber-muted">
                {{ motionPrompt.length }}/{{
                  REMOVE_WATERMARK_PROMPT_MAX_LENGTH
                }}
              </p>
            </div>
            <p
              v-if="motionSeconds > 0"
              data-testid="workspace-motion-seconds"
              class="font-mono text-xs text-cyber-muted"
            >
              Đoạn đã chọn: {{ motionSeconds }} giây
            </p>
            <p
              v-if="motionInsufficientNoteVi"
              data-testid="workspace-insufficient-note"
              class="text-xs font-semibold text-cyber-warning"
            >
              {{ motionInsufficientNoteVi }}
            </p>
          </div>
        </div>

        <!-- Cột phải: Khung kết quả AI; loading và kết quả hiển thị ngay tại đây -->
        <div class="space-y-4 lg:col-span-6">
          <TaskResultViewer
            :task="activeTask"
            :submitting="anySubmitting"
            :video-output="feature.category === 'video'"
            :before-label-vi="feature.beforeLabelVi"
            :after-label-vi="feature.afterLabelVi"
            :output-format-vi="feature.outputFormatVi"
            @update:task="activeTask = $event"
            @settled="void refreshAll()"
            @retry="handleRetry"
          />
        </div>
      </div>

      <!-- Footer hành động của Centered Dialog: Ghim cố định ở đáy (sticky bottom-0 z-10) -->
      <div
        class="sticky bottom-0 z-10 flex flex-col gap-3 border-t border-cyber-border bg-cyber-surface/95 px-4 py-3.5 backdrop-blur sm:flex-row sm:items-center sm:justify-between sm:px-6"
      >
        <!-- Đơn giá công cụ và cam kết sử dụng -->
        <div class="space-y-1">
          <div class="flex items-center gap-2">
            <Icon name="lucide:zap" class="h-4 w-4 text-cyber-cyan" />
            <div class="flex items-center gap-1.5 text-xs">
              <span class="text-cyber-muted">Đơn giá công cụ:</span>
              <span class="font-mono font-bold text-cyber-cyan">
                {{ feature.priceBadgeVi }}
              </span>
            </div>
          </div>
          <p
            class="text-[11px] text-cyber-muted"
            data-testid="workspace-tos-note"
          >
            Bằng việc tải lên, bạn xác nhận đủ 18 tuổi và đồng ý với
            <NuxtLink
              to="/terms"
              target="_blank"
              rel="noopener"
              class="text-cyber-cyan underline"
              >Điều khoản</NuxtLink
            >
            và
            <NuxtLink
              to="/privacy"
              target="_blank"
              rel="noopener"
              class="text-cyber-cyan underline"
              >Chính sách quyền riêng tư</NuxtLink
            >.
          </p>
        </div>

        <div
          class="flex shrink-0 flex-col items-stretch gap-2 sm:flex-row sm:items-center"
        >
          <!-- Nút đăng nhập cho khách chưa đăng nhập -->
          <button
            v-if="!isAuthenticated"
            type="button"
            data-testid="workspace-login-button"
            class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-2 rounded-xl border border-cyber-cyan/50 bg-cyber-cyan/15 px-4 py-2.5 text-xs font-semibold text-cyber-cyan transition hover:bg-cyber-cyan/25"
            @click="openAuthDialog('login')"
          >
            <Icon name="lucide:log-in" class="h-4 w-4" />
            <span>Đăng nhập để tạo tác vụ</span>
          </button>

          <NuxtLink
            v-else-if="!hasEnoughBalance"
            to="/pricing"
            class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-2 rounded-xl border border-cyber-warning/50 bg-cyber-warning/15 px-4 py-2.5 text-xs font-semibold text-cyber-warning"
            @click="emit('close')"
          >
            <Icon name="lucide:alert-circle" class="h-4 w-4" />
            <span>Số dư không đủ — Nạp thêm Credit</span>
          </NuxtLink>

          <button
            type="button"
            data-testid="submit-task-button"
            :disabled="!canSubmit"
            class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-2 rounded-xl bg-cyber-violet px-6 py-3 text-sm font-semibold text-cyber-text transition hover:bg-cyber-violet/90 disabled:cursor-not-allowed disabled:opacity-50"
            @click="handleSubmit"
          >
            <Icon
              v-if="anySubmitting || isTaskWorking"
              name="lucide:loader-2"
              class="h-4 w-4 animate-spin"
            />
            <Icon v-else name="lucide:play" class="h-4 w-4" />
            <span>
              {{
                anySubmitting
                  ? "Đang gửi yêu cầu..."
                  : isTaskWorking
                    ? "Đang xử lý..."
                    : activeTask
                      ? `Tạo lại (${formatNumberVi(estimatedCredits)} CR)`
                      : `Tạo Tác Vụ AI (${formatNumberVi(estimatedCredits)} CR)`
              }}
            </span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
