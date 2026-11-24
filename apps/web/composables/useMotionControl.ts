import { useSystemStatus } from '~/composables/useSystemStatus';
import { isPausedError } from '~/utils/system-status';
import { computed, ref, watch } from 'vue';
import {
  MOTION_ASPECT_RATIO_DEFAULT,
  MOTION_MIN_TRIM_SECONDS,
  motionCapSeconds,
  removeWatermarkCapSeconds,
  removeWatermarkPrice,
  type MotionAspectRatio,
  type Task,
} from '@flowxis/contracts';
import { useApiClient } from '~/composables/useApiClient';
import { usePricingConfig } from '~/composables/usePricingConfig';
import {
  MotionApiClientError,
  getValidationReasonMessageVi,
  motionPrice,
  resolveApiErrorMessageVi,
} from '~/utils/api-client';

export interface MotionTrimChange {
  videoKey: string | null;
  trimStart: number;
  trimEnd: number;
  durationSeconds: number;
}

/**
 * Luồng tạo Task Motion Control dùng chung cho trang `/motion-control`
 * và `FeatureWorkspaceDialog`: giá trực tiếp, điều kiện nút Tạo, chống bấm đôi,
 * xử lý lỗi tiếng Việt (kể cả TRIM_EXCEEDS_CAP).
 */
export function useMotionControl() {
  const { me, currentTier, currentTierCapSeconds, refreshAll } =
    usePricingConfig();
  const { client } = useApiClient();

  /** v1: có khung hình + prompt; v2: chỉ ảnh nhân vật + đoạn video; watermark: chỉ video (xóa watermark/logo/phụ đề). */
  const variant = ref<'v1' | 'v2' | 'watermark'>('v1');
  const needsCharacter = computed<boolean>(() => variant.value !== 'watermark');
  const characterKey = ref<string | null>(null);
  const videoKey = ref<string | null>(null);
  const trimStart = ref<number>(0);
  const trimEnd = ref<number>(0);
  const aspectRatio = ref<MotionAspectRatio>(MOTION_ASPECT_RATIO_DEFAULT);
  const prompt = ref<string>('');
  const activeTask = ref<Task | null>(null);
  const { intakePaused, markPaused } = useSystemStatus();
  const isSubmitting = ref<boolean>(false);
  const submitErrorVi = ref<string | null>(null);
  // Cap do server vừa báo (TRIM_EXCEEDS_CAP); luôn lấy giá trị nhỏ hơn với Cap từ cấu hình.
  const serverCapOverride = ref<number | null>(null);

  const isAuthenticated = computed<boolean>(() => Boolean(me.value));

  const capSeconds = computed<number | null>(() => {
    const tierCap = currentTierCapSeconds.value;
    const override = serverCapOverride.value;
    const featureCap =
      variant.value === 'watermark'
        ? removeWatermarkCapSeconds()
        : tierCap == null
        ? null
        : motionCapSeconds(
            variant.value === 'v2' ? 'motion_control_v2' : 'motion_control',
            tierCap,
          );
    if (featureCap == null) return override;
    return override == null ? featureCap : Math.min(featureCap, override);
  });

  const capUsable = computed<boolean>(
    () => capSeconds.value != null && capSeconds.value >= MOTION_MIN_TRIM_SECONDS,
  );

  const seconds = computed<number>(() => trimEnd.value - trimStart.value);

  const hasValidTrim = computed<boolean>(
    () => Number.isInteger(seconds.value) && seconds.value >= MOTION_MIN_TRIM_SECONDS,
  );

  const overCap = computed<boolean>(
    () => capSeconds.value != null && seconds.value > capSeconds.value,
  );

  /** Giá theo contracts (motionPrice); null khi chưa có đoạn Trim hợp lệ. */
  const price = computed<number | null>(() =>
    Number.isInteger(seconds.value) && seconds.value > 0
      ? variant.value === 'watermark'
        ? removeWatermarkPrice(seconds.value)
        : motionPrice(
          seconds.value,
          variant.value === 'v2' ? 'motion_control_v2' : 'motion_control',
        )
      : null,
  );

  const balance = computed<number>(() => me.value?.balance ?? 0);

  const remainingBalance = computed<number | null>(() =>
    price.value == null ? null : balance.value - price.value,
  );

  const hasEnoughBalance = computed<boolean>(() => {
    if (price.value == null) return true;
    if (typeof me.value?.balance !== 'number') return true;
    return me.value.balance >= price.value;
  });

  const insufficientNoteVi = computed<string | null>(() => {
    if (!isAuthenticated.value || price.value == null || hasEnoughBalance.value) {
      return null;
    }
    return `Bạn đang có ${balance.value} credit (cần ${price.value} cr để tạo đoạn ${seconds.value}s). Hãy nạp thêm credit để tiếp tục.`;
  });

  const canSubmit = computed<boolean>(() =>
    Boolean(
      !intakePaused.value &&
        isAuthenticated.value &&
        (characterKey.value || !needsCharacter.value) &&
        videoKey.value &&
        capUsable.value &&
        hasValidTrim.value &&
        !overCap.value &&
        hasEnoughBalance.value &&
        !isSubmitting.value,
    ),
  );

  watch(
    [characterKey, videoKey, trimStart, trimEnd],
    () => {
      submitErrorVi.value = null;
    },
    { flush: 'sync' },
  );

  function onTrimChange(payload: MotionTrimChange): void {
    videoKey.value = payload.videoKey;
    trimStart.value = payload.trimStart;
    trimEnd.value = payload.trimEnd;
  }

  async function handleSubmitError(error: unknown): Promise<void> {
    if (
      error instanceof MotionApiClientError &&
      error.details?.reason === 'TRIM_EXCEEDS_CAP'
    ) {
      const cap = Number(error.details.cap);
      if (Number.isInteger(cap) && cap > 0) {
        serverCapOverride.value = cap;
        try {
          await refreshAll();
        } catch {
          // Giữ thông báo cũ nếu tải lại thất bại.
        }
        submitErrorVi.value = `Chức năng này cho phép tối đa ${cap} giây`;
        return;
      }
    }
    if (error instanceof MotionApiClientError) {
      const reason = error.details?.reason;
      if (typeof reason === 'string') {
        const cap =
          typeof error.details?.cap === 'number' ? error.details.cap : null;
        const message = getValidationReasonMessageVi(reason, cap);
        if (message !== getValidationReasonMessageVi(null)) {
          submitErrorVi.value = message;
          return;
        }
      }
    }
    if (isPausedError(error)) markPaused();
    submitErrorVi.value = resolveApiErrorMessageVi(error);
  }

  async function submit(): Promise<Task | null> {
    // Chống bấm đôi: cờ đặt đồng bộ trước mọi await.
    if (isSubmitting.value || !canSubmit.value) return null;
    isSubmitting.value = true;
    submitErrorVi.value = null;
    try {
      const trim = {
        videoKey: videoKey.value!,
        trimStart: trimStart.value,
        trimEnd: trimEnd.value,
      };
      const base = { ...trim, characterKey: characterKey.value! };
      const task =
        variant.value === 'watermark'
          ? await client.createRemoveWatermarkTask({ ...trim, prompt: prompt.value.trim() })
          : variant.value === 'v2'
          ? await client.createMotionControlV2Task(base)
          : await client.createMotionControlTask({
            ...base,
            aspectRatio: aspectRatio.value,
            prompt: prompt.value.trim(),
          });
      activeTask.value = task;
      refreshAll().catch(() => {});
      return task;
    } catch (error: unknown) {
      await handleSubmitError(error);
      return null;
    } finally {
      isSubmitting.value = false;
    }
  }

  /** Xóa mọi trạng thái nhập/lỗi (không tải lại ví). */
  function clearState(): void {
    activeTask.value = null;
    submitErrorVi.value = null;
    serverCapOverride.value = null;
    characterKey.value = null;
    videoKey.value = null;
    trimStart.value = 0;
    trimEnd.value = 0;
    aspectRatio.value = MOTION_ASPECT_RATIO_DEFAULT;
    prompt.value = '';
  }

  function reset(): void {
    clearState();
    refreshAll().catch(() => {});
  }

  return {
    me,
    currentTier,
    refreshAll,
    isAuthenticated,
    variant,
    needsCharacter,
    characterKey,
    videoKey,
    trimStart,
    trimEnd,
    aspectRatio,
    prompt,
    activeTask,
    isSubmitting,
    submitErrorVi,
    capSeconds,
    capUsable,
    seconds,
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
    clearState,
  };
}
