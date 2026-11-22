import { z } from 'zod';
import { DateOnlySchema, refineDateRange } from './date-range.js';
import { ConfirmedUploadKeySchema } from './uploads.js';

/** Số giây Trim tối thiểu của Motion Control. */
export const MOTION_MIN_TRIM_SECONDS = 5;

/** Số giây Trim tối đa theo chức năng Motion; giới hạn thêm bởi `maxVideoSeconds` của Tier. */
export const MOTION_MAX_SECONDS = {
  motion_control: 20,
  motion_control_v2: 15,
} as const;
export type MotionPipeline = keyof typeof MOTION_MAX_SECONDS;

/**
 * Giá Motion theo chức năng: phí cố định + đơn giá mỗi giây (credit); nơi duy nhất giữ các hằng này phía mã nguồn.
 */
export const MOTION_PRICING = {
  motion_control: { baseCredits: 150, creditsPerSecond: 15 },
  motion_control_v2: { baseCredits: 150, creditsPerSecond: 60 },
} as const;

/** Giá một Task Motion = phí cố định + đơn giá mỗi giây × số giây (mặc định tính theo `motion_control`). */
export function motionPrice(seconds: number, pipeline: MotionPipeline = 'motion_control'): number {
  if (!Number.isInteger(seconds) || seconds <= 0) {
    throw new RangeError('Số giây phải là số nguyên dương.');
  }
  const { baseCredits, creditsPerSecond } = MOTION_PRICING[pipeline];
  return baseCredits + creditsPerSecond * seconds;
}

/** Cap thực tế = nhỏ hơn giữa giới hạn của chức năng và Cap của Tier. */
export function motionCapSeconds(pipeline: MotionPipeline, tierCapSeconds: number): number {
  return Math.min(MOTION_MAX_SECONDS[pipeline], tierCapSeconds);
}

export const TASK_PIPELINES = ['face_swap', 'body_retouch', 'motion_control', 'outfit_change', 'motion_control_v2', 'veo3', 'muse_video'] as const;
export type TaskPipeline = (typeof TASK_PIPELINES)[number];
export const TaskPipelineSchema = z.enum(TASK_PIPELINES);

/** Pipeline có thể ghi đè thông báo lỗi. */
export const REASON_MESSAGE_PIPELINES = TASK_PIPELINES;
export type ReasonMessagePipeline = (typeof REASON_MESSAGE_PIPELINES)[number];

export const TASK_STATUSES = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'timed_out',
  'cancelled',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TaskStatusSchema = z.enum(TASK_STATUSES);

export const REASON_CODES = [
  'GPU_ERROR',
  'GPU_TIMEOUT',
  'GPU_SUBMIT_UNKNOWN',
  'GPU_BUDGET',
  'PREP_TIMEOUT',
  'GPU_GATE_TIMEOUT',
  'FFMPEG_ERROR',
  'INPUT_FETCH_ERROR',
  'OUTPUT_UPLOAD_ERROR',
  'OUTPUT_INVALID',
  'INTERNAL_ERROR',
  'NO_POSE',
  'NO_FACE',
  'CONTENT_BLOCKED',
  'FREE_WAIT_EXPIRED',
  'USER_CANCEL',
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];
/** Mã lý do hợp lệ cho Task `timed_out` (các mã còn lại thuộc `failed`). */
const TIMED_OUT_REASON_CODES: readonly ReasonCode[] = [
  'GPU_TIMEOUT',
  'GPU_GATE_TIMEOUT',
  'PREP_TIMEOUT',
  'FREE_WAIT_EXPIRED',
];
export const ReasonCodeSchema = z.enum(REASON_CODES);

const GENERIC_FAILURE_VI =
  'Xử lý không thành công do lỗi hệ thống. Credit đã được hoàn lại, vui lòng thử lại.';

export const REASON_CODE_MESSAGES_VI: Readonly<Record<ReasonCode, string>> = {
  GPU_ERROR: GENERIC_FAILURE_VI,
  GPU_TIMEOUT: 'Quá thời gian xử lý. Credit đã được hoàn lại, vui lòng thử lại.',
  GPU_SUBMIT_UNKNOWN: GENERIC_FAILURE_VI,
  GPU_BUDGET: GENERIC_FAILURE_VI,
  PREP_TIMEOUT: 'Quá thời gian chuẩn bị dữ liệu. Credit đã được hoàn lại, vui lòng thử lại.',
  GPU_GATE_TIMEOUT: 'Hệ thống đang quá tải. Credit đã được hoàn lại, vui lòng thử lại sau.',
  FFMPEG_ERROR: 'Không xử lý được tệp đầu vào. Credit đã được hoàn lại, vui lòng chọn file khác.',
  INPUT_FETCH_ERROR: 'Không đọc được ảnh đầu vào. Credit đã được hoàn lại, vui lòng tải lại ảnh.',
  OUTPUT_UPLOAD_ERROR: GENERIC_FAILURE_VI,
  OUTPUT_INVALID: 'Kết quả tạo ra không hợp lệ. Credit đã được hoàn lại, vui lòng thử lại.',
  INTERNAL_ERROR: GENERIC_FAILURE_VI,
  NO_POSE: 'Không nhận diện được dáng người trong ảnh/video. Credit đã được hoàn lại.',
  NO_FACE: 'Không nhận diện được khuôn mặt trong ảnh',
  CONTENT_BLOCKED: 'Ảnh/video vi phạm tiêu chuẩn cộng đồng, vui lòng chọn file khác.',
  FREE_WAIT_EXPIRED:
    'Tác vụ đã chờ quá 15 phút trong hàng đợi miễn phí. Credit đã được hoàn lại, vui lòng thử lại.',
  USER_CANCEL: 'Bạn đã hủy tác vụ. Credit đã được hoàn lại.',
};

/** Ghi đè thông báo theo pipeline. */
export const REASON_CODE_PIPELINE_OVERRIDES_VI: Readonly<
  Partial<
    Record<ReasonMessagePipeline, Readonly<Partial<Record<ReasonCode, string>>>>
  >
> = {
  body_retouch: {
    NO_POSE: 'Không tìm thấy người trong ảnh. Vui lòng chọn ảnh có người rõ thân.',
  },
  motion_control: {
    NO_POSE: 'Không nhận diện được chuyển động cơ thể trong video mẫu',
    NO_FACE: 'Không nhận diện được nhân vật trong ảnh. Vui lòng chọn ảnh toàn thân rõ người.',
  },
};

const UNKNOWN_REASON_MESSAGE_VI = 'Tác vụ không thành công. Vui lòng thử lại sau.';

export function getReasonCodeMessageVi(
  code: ReasonCode | (string & {}) | null | undefined,
  pipeline?: ReasonMessagePipeline | (string & {}) | null,
): string {
  if (!code || !Object.prototype.hasOwnProperty.call(REASON_CODE_MESSAGES_VI, code)) {
    return UNKNOWN_REASON_MESSAGE_VI;
  }
  const rc = code as ReasonCode;
  if (pipeline && Object.prototype.hasOwnProperty.call(REASON_CODE_PIPELINE_OVERRIDES_VI, pipeline)) {
    const o = REASON_CODE_PIPELINE_OVERRIDES_VI[pipeline as ReasonMessagePipeline]?.[rc];
    if (o) return o;
  }
  return REASON_CODE_MESSAGES_VI[rc];
}

/** Task với các bất biến trạng thái / reasonCode / queuePosition / resultKey. */
const TaskBaseSchema = z.object({
    id: z.string().uuid(),
    pipeline: TaskPipelineSchema,
    status: TaskStatusSchema,
    reasonCode: ReasonCodeSchema.nullable().optional(),
    queuePosition: z.number().int().positive().nullable().optional(),
    resultKey: z
      .string()
      .regex(
        new RegExp(
          '^out/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}(\\.mp4)?$',
        ), 'Khóa kết quả không hợp lệ.')
      .nullable()
      .optional(),
    creditCost: z.number().int().positive(),
    /** Thời điểm nội dung bị gỡ (vi phạm hoặc theo yêu cầu); vắng/null nghĩa là chưa gỡ. */
    filesRemovedAt: z.string().datetime().nullable().optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  });

function refineTask(
  t: z.infer<typeof TaskBaseSchema>,
  ctx: z.RefinementCtx,
): void {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    const hasReason = t.reasonCode != null;
    const terminalFail =
      t.status === 'failed' || t.status === 'timed_out' || t.status === 'cancelled';
    if (terminalFail && !hasReason) {
      issue('reasonCode', `Task ${t.status} bắt buộc có reasonCode`);
    }
    if (!terminalFail && hasReason) {
      issue('reasonCode', `Task ${t.status} không được có reasonCode`);
    }
    if (t.status === 'cancelled' && hasReason && t.reasonCode !== 'USER_CANCEL') {
      issue('reasonCode', 'Task cancelled chỉ được có reasonCode USER_CANCEL');
    }
    if (t.reasonCode === 'USER_CANCEL' && t.status !== 'cancelled') {
      issue('reasonCode', 'USER_CANCEL chỉ dùng cho Task cancelled');
    }
    if (t.reasonCode === 'PREP_TIMEOUT' && t.status !== 'timed_out') {
      issue('reasonCode', 'PREP_TIMEOUT chỉ dùng cho Task timed_out');
    }
    if (t.reasonCode === 'FREE_WAIT_EXPIRED' && t.status !== 'timed_out') {
      issue('reasonCode', 'FREE_WAIT_EXPIRED chỉ dùng cho Task timed_out');
    }
    if (
      (t.reasonCode === 'GPU_TIMEOUT' || t.reasonCode === 'GPU_GATE_TIMEOUT') &&
      t.status !== 'timed_out'
    ) {
      issue('reasonCode', `${t.reasonCode} chỉ dùng cho Task timed_out`);
    }
    if (t.status === 'timed_out' && hasReason && !TIMED_OUT_REASON_CODES.includes(t.reasonCode!)) {
      issue('reasonCode', 'Task timed_out chỉ được có reasonCode hết hạn (GPU_TIMEOUT, GPU_GATE_TIMEOUT, PREP_TIMEOUT, FREE_WAIT_EXPIRED)');
    }
    if (t.status === 'queued' && t.queuePosition == null) {
      issue('queuePosition', 'Task queued bắt buộc có queuePosition');
    }
    if (t.status !== 'queued' && t.queuePosition != null) {
      issue('queuePosition', 'queuePosition chỉ có khi Task queued');
    }
    if (t.status === 'succeeded' && t.resultKey == null) {
      issue('resultKey', 'Task succeeded bắt buộc có resultKey');
    }
    if (t.status !== 'succeeded' && t.resultKey != null) {
      issue('resultKey', 'resultKey chỉ có khi Task succeeded');
    }
}

export const TaskSchema = TaskBaseSchema.superRefine(refineTask);
export type Task = z.infer<typeof TaskSchema>;

export const TaskIdParamsSchema = z.object({ id: z.string().uuid() });
export type TaskIdParams = z.infer<typeof TaskIdParamsSchema>;

/** POST /tasks/face-swap — giá do server quyết định, không nhận credit từ client. */
export const FaceSwapCreateRequestSchema = z
  .object({
    sourceKey: ConfirmedUploadKeySchema,
    targetKey: ConfirmedUploadKeySchema,
  })
  .strict();
export type FaceSwapCreateRequest = z.infer<typeof FaceSwapCreateRequestSchema>;
export const FaceSwapCreateResponseSchema = TaskSchema;
export type FaceSwapCreateResponse = Task;

/** Mức điều chỉnh Body Retouch: số nguyên 1–10, mặc định 5. */
export const INTENSITY_MIN = 1;
export const INTENSITY_MAX = 10;
export const INTENSITY_DEFAULT = 5;
export const IntensitySchema = z
  .number({ invalid_type_error: 'Mức điều chỉnh phải là số nguyên từ 1 đến 10.' })
  .int('Mức điều chỉnh phải là số nguyên từ 1 đến 10.')
  .min(INTENSITY_MIN, 'Mức điều chỉnh tối thiểu là 1.')
  .max(INTENSITY_MAX, 'Mức điều chỉnh tối đa là 10.')
  .default(INTENSITY_DEFAULT);
export type Intensity = z.infer<typeof IntensitySchema>;

/** POST /tasks/outfit-change — đổi trang phục: ảnh người mẫu + ảnh trang phục; giá do server quyết định. */
export const OutfitChangeCreateRequestSchema = z
  .object({
    modelKey: ConfirmedUploadKeySchema,
    clothingKey: ConfirmedUploadKeySchema,
  })
  .strict();
export type OutfitChangeCreateRequest = z.infer<typeof OutfitChangeCreateRequestSchema>;
export const OutfitChangeCreateResponseSchema = TaskSchema;
export type OutfitChangeCreateResponse = Task;

/** Ba vùng nhãn của thanh mức điều chỉnh (min/max gồm cả hai đầu). */
export const INTENSITY_LABEL_ZONES = [
  { min: 1, max: 3, label: 'Uốn nhẹ dáng' },
  { min: 4, max: 7, label: 'Tự nhiên' },
  { min: 8, max: 10, label: 'Đường cong tối đa' },
] as const;

/** Nhãn tiếng Việt theo mức; ngoài 1–10 hoặc không nguyên trả `null`. */
export function getIntensityLabelVi(n: number): string | null {
  if (!Number.isInteger(n)) return null;
  const zone = INTENSITY_LABEL_ZONES.find((item) => n >= item.min && n <= item.max);
  return zone ? zone.label : null;
}

/** POST /tasks/body-retouch — không nhận credit/consent từ client (ToS đồng ý khi đăng nhập). */
export const BodyRetouchCreateRequestSchema = z
  .object({
    imageKey: ConfirmedUploadKeySchema,
    intensity: IntensitySchema,
  })
  .strict();
export type BodyRetouchCreateRequest = z.input<typeof BodyRetouchCreateRequestSchema>;
export const BodyRetouchCreateResponseSchema = TaskSchema;
export type BodyRetouchCreateResponse = Task;

/** POST /tasks/motion — giá, Cap và độ dài do server quyết định; không nhận credit/consent. */
const TrimSecondSchema = (label: string) =>
  z
    .number({ invalid_type_error: `${label} phải là số nguyên giây.` })
    .int(`${label} phải là số nguyên giây.`)
    .nonnegative(`${label} không được âm.`);
/** Khung hình phổ biến cho video Motion Control (rộng x cao tính bằng pixel, bội số 16). */
export const MOTION_ASPECT_RATIOS = [
  { id: '9:16', labelVi: 'Dọc 9:16 (TikTok, Reels, Shorts)', width: 576, height: 1024 },
  { id: '16:9', labelVi: 'Ngang 16:9 (YouTube)', width: 1024, height: 576 },
  { id: '1:1', labelVi: 'Vuông 1:1 (Instagram, Facebook)', width: 768, height: 768 },
  { id: '4:5', labelVi: 'Dọc 4:5 (Instagram, Facebook feed)', width: 640, height: 800 },
  { id: '3:4', labelVi: 'Dọc 3:4', width: 672, height: 896 },
  { id: '4:3', labelVi: 'Ngang 4:3', width: 896, height: 672 },
] as const;
export type MotionAspectRatio = (typeof MOTION_ASPECT_RATIOS)[number]['id'];
export const MOTION_ASPECT_RATIO_DEFAULT: MotionAspectRatio = '9:16';
export const MotionAspectRatioSchema = z.enum(
  MOTION_ASPECT_RATIOS.map((a) => a.id) as [MotionAspectRatio, ...MotionAspectRatio[]],
);
export const MOTION_PROMPT_MAX_LENGTH = 300;
export function getMotionAspectRatio(id: MotionAspectRatio) {
  return MOTION_ASPECT_RATIOS.find((a) => a.id === id)!;
}

export const MotionCreateRequestSchema = z
  .object({
    characterKey: ConfirmedUploadKeySchema,
    videoKey: ConfirmedUploadKeySchema,
    trimStart: TrimSecondSchema('Điểm bắt đầu cắt'),
    trimEnd: TrimSecondSchema('Điểm kết thúc cắt'),
    aspectRatio: MotionAspectRatioSchema.default(MOTION_ASPECT_RATIO_DEFAULT),
    prompt: z
      .string()
      .trim()
      .max(MOTION_PROMPT_MAX_LENGTH, `Prompt tối đa ${MOTION_PROMPT_MAX_LENGTH} ký tự.`)
      .default(''),
  })
  .strict();
export type MotionCreateRequest = z.input<typeof MotionCreateRequestSchema>;
/** Task Motion kèm `price` (bằng `creditCost`, = `motionPrice(số giây, pipeline)`). */
function refineMotionTask(
  t: { price: number; creditCost: number; pipeline: MotionPipeline } & Parameters<typeof refineTask>[0],
  ctx: z.RefinementCtx,
): void {
  refineTask(t, ctx);
  if (t.price !== t.creditCost) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['price'],
      message: 'price phải bằng creditCost',
    });
  }
  // Giá = phí cố định + đơn giá × số giây nguyên (>= 1): phần dư sau phí cố định phải chia hết cho đơn giá.
  const { baseCredits, creditsPerSecond } = MOTION_PRICING[t.pipeline];
  const rest = t.price - baseCredits;
  if (rest < creditsPerSecond || rest % creditsPerSecond !== 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['price'],
      message: 'price Motion phải bằng phí cố định cộng bội của giá mỗi giây',
    });
  }
}
export const MotionCreateResponseSchema = TaskBaseSchema.extend({
  pipeline: z.literal('motion_control'),
  price: z.number().int().positive(),
}).superRefine(refineMotionTask);
export type MotionCreateResponse = z.infer<typeof MotionCreateResponseSchema>;

/** Veo 3: chế độ tạo video; mỗi chế độ nhận số ảnh đầu vào khác nhau. */
export const VEO3_MODES = ['text_to_video', 'image_to_video', 'frames_to_video'] as const;
export type Veo3Mode = (typeof VEO3_MODES)[number];
export const Veo3ModeSchema = z.enum(VEO3_MODES);
export const VEO3_ASPECT_RATIOS = ['16:9', '9:16'] as const;
export type Veo3AspectRatio = (typeof VEO3_ASPECT_RATIOS)[number];
export const Veo3AspectRatioSchema = z.enum(VEO3_ASPECT_RATIOS);
export const VEO3_RESOLUTIONS = ['720p', '1080p', '4k'] as const;
export type Veo3Resolution = (typeof VEO3_RESOLUTIONS)[number];
export const Veo3ResolutionSchema = z.enum(VEO3_RESOLUTIONS);
/** Veo 3 luôn tạo video 8 giây. */
export const VEO3_DURATION_SECONDS = 8;
export const VEO3_PROMPT_MIN_LENGTH = 5;
export const VEO3_PROMPT_MAX_LENGTH = 8000;
/** Giá mỗi lần gọi (credit) theo độ phân giải; nơi duy nhất giữ các hằng này phía mã nguồn. */
export const VEO3_PRICING = { '720p': 500, '1080p': 700, '4k': 950 } as const;
export function veo3Price(resolution: Veo3Resolution): number {
  return VEO3_PRICING[resolution];
}

const Veo3PromptSchema = z
  .string({ required_error: 'Vui lòng nhập mô tả video.' })
  .trim()
  .min(VEO3_PROMPT_MIN_LENGTH, `Mô tả video tối thiểu ${VEO3_PROMPT_MIN_LENGTH} ký tự.`)
  .max(VEO3_PROMPT_MAX_LENGTH, `Mô tả video tối đa ${VEO3_PROMPT_MAX_LENGTH} ký tự.`);

/** POST /tasks/veo3 — union theo `mode`; giá do server quyết định theo `resolution`. */
export const Veo3CreateRequestSchema = z.discriminatedUnion('mode', [
  z
    .object({
      mode: z.literal('text_to_video'),
      prompt: Veo3PromptSchema,
      aspectRatio: Veo3AspectRatioSchema,
      resolution: Veo3ResolutionSchema,
    })
    .strict(),
  z
    .object({
      mode: z.literal('image_to_video'),
      prompt: Veo3PromptSchema,
      aspectRatio: Veo3AspectRatioSchema,
      resolution: Veo3ResolutionSchema,
      imageKey: ConfirmedUploadKeySchema,
    })
    .strict(),
  z
    .object({
      mode: z.literal('frames_to_video'),
      prompt: Veo3PromptSchema,
      aspectRatio: Veo3AspectRatioSchema,
      resolution: Veo3ResolutionSchema,
      firstFrameKey: ConfirmedUploadKeySchema,
      lastFrameKey: ConfirmedUploadKeySchema.optional(),
    })
    .strict(),
]);
export type Veo3CreateRequest = z.input<typeof Veo3CreateRequestSchema>;
export const Veo3CreateResponseSchema = TaskBaseSchema.extend({
  pipeline: z.literal('veo3'),
  price: z.number().int().positive(),
}).superRefine((t, ctx) => {
  refineTask(t, ctx);
  if (t.price !== t.creditCost) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['price'], message: 'price phải bằng creditCost' });
  }
});
export type Veo3CreateResponse = z.infer<typeof Veo3CreateResponseSchema>;

/** Muse Video (Meta, RunningHub `meta/muse-video/economy`): chỉ image-to-video, 1-9 ảnh tham chiếu, video ~10 giây 720p. */
export const MUSE_VIDEO_PROMPT_MIN_LENGTH = 1;
export const MUSE_VIDEO_PROMPT_MAX_LENGTH = 4000;
export const MUSE_VIDEO_MIN_IMAGES = 1;
export const MUSE_VIDEO_MAX_IMAGES = 9;
/** Tổng dung lượng tối đa của các ảnh tham chiếu (11 MB), tính theo kích thước ảnh đã lưu sau khi xác nhận (có thể đã thu nhỏ), không phải tệp gốc. */
export const MUSE_VIDEO_MAX_TOTAL_BYTES = 11 * 1024 * 1024;
/** Muse Video luôn tạo video khoảng 10 giây. */
export const MUSE_VIDEO_DURATION_SECONDS = 10;
export const MUSE_VIDEO_RESOLUTION = '720p';
/** Giá cố định mỗi video (credit). */
export const MUSE_VIDEO_PRICE = 250;
export const MUSE_VIDEO_ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3'] as const;
export type MuseVideoAspectRatio = (typeof MUSE_VIDEO_ASPECT_RATIOS)[number];
export const MuseVideoAspectRatioSchema = z.enum(MUSE_VIDEO_ASPECT_RATIOS);

/** POST /tasks/muse-video — giá cố định do server quyết định; không gửi `aspectRatio` = theo ảnh tham chiếu. */
export const MuseVideoCreateRequestSchema = z
  .object({
    prompt: z
      .string({ required_error: 'Vui lòng nhập mô tả video.' })
      .trim()
      .min(MUSE_VIDEO_PROMPT_MIN_LENGTH, 'Vui lòng nhập mô tả video.')
      .max(MUSE_VIDEO_PROMPT_MAX_LENGTH, `Mô tả video tối đa ${MUSE_VIDEO_PROMPT_MAX_LENGTH} ký tự.`),
    imageKeys: z
      .array(ConfirmedUploadKeySchema)
      .min(MUSE_VIDEO_MIN_IMAGES, 'Vui lòng chọn ít nhất 1 ảnh tham chiếu.')
      .max(MUSE_VIDEO_MAX_IMAGES, `Tối đa ${MUSE_VIDEO_MAX_IMAGES} ảnh tham chiếu.`)
      .superRefine((keys, ctx) => {
        if (new Set(keys).size !== keys.length) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Ảnh tham chiếu không được trùng nhau.' });
        }
      }),
    aspectRatio: MuseVideoAspectRatioSchema.optional(),
  })
  .strict();
export type MuseVideoCreateRequest = z.input<typeof MuseVideoCreateRequestSchema>;
export const MuseVideoCreateResponseSchema = TaskBaseSchema.extend({
  pipeline: z.literal('muse_video'),
  price: z.number().int().positive(),
}).superRefine((t, ctx) => {
  refineTask(t, ctx);
  if (t.price !== t.creditCost) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['price'], message: 'price phải bằng creditCost' });
  }
});
export type MuseVideoCreateResponse = z.infer<typeof MuseVideoCreateResponseSchema>;

/** POST /tasks/motion-v2 — Motion Control v2: chỉ ảnh nhân vật + đoạn video đã cắt (không khung hình/prompt); giá riêng (`MOTION_PRICING`). */
export const MotionV2CreateRequestSchema = z
  .object({
    characterKey: ConfirmedUploadKeySchema,
    videoKey: ConfirmedUploadKeySchema,
    trimStart: TrimSecondSchema('Điểm bắt đầu cắt'),
    trimEnd: TrimSecondSchema('Điểm kết thúc cắt'),
  })
  .strict();
export type MotionV2CreateRequest = z.input<typeof MotionV2CreateRequestSchema>;
export const MotionV2CreateResponseSchema = TaskBaseSchema.extend({
  pipeline: z.literal('motion_control_v2'),
  price: z.number().int().positive(),
}).superRefine(refineMotionTask);
export type MotionV2CreateResponse = z.infer<typeof MotionV2CreateResponseSchema>;

/** `details.reason` của VALIDATION_FAILED cho video/Trim. */
export const VALIDATION_REASONS = [
  'VIDEO_UNREADABLE',
  'VIDEO_TOO_SHORT',
  'TRIM_TOO_SHORT',
  'TRIM_EXCEEDS_CAP',
  'TRIM_OUT_OF_VIDEO',
  'TRIM_NOT_WHOLE_SECOND',
  'REASON_REQUIRED',
  'TASK_NOT_FINISHED',
  'ADJUST_OVER_LIMIT',
  'ADJUST_INSUFFICIENT_BALANCE',
] as const;
export type ValidationReason = (typeof VALIDATION_REASONS)[number];
export const ValidationReasonSchema = z.enum(VALIDATION_REASONS);

export const ValidationDetailsSchema = z
  .object({
    reason: ValidationReasonSchema,
    cap: z.number().int().positive().optional(),
  })
  .superRefine((d, ctx) => {
    if (d.reason === 'TRIM_EXCEEDS_CAP' && d.cap == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cap'],
        message: 'TRIM_EXCEEDS_CAP bắt buộc có cap',
      });
    }
    if (d.reason !== 'TRIM_EXCEEDS_CAP' && d.cap != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cap'],
        message: 'cap chỉ dùng cho TRIM_EXCEEDS_CAP',
      });
    }
  });
export type ValidationDetails = z.infer<typeof ValidationDetailsSchema>;

export const VALIDATION_REASON_MESSAGES_VI: Readonly<Record<ValidationReason, string>> = {
  VIDEO_UNREADABLE: 'Không đọc được video. Vui lòng chọn video MP4 hoặc MOV khác.',
  VIDEO_TOO_SHORT: `Video quá ngắn, cần dài ít nhất ${MOTION_MIN_TRIM_SECONDS} giây.`,
  TRIM_TOO_SHORT: `Đoạn cắt cần dài ít nhất ${MOTION_MIN_TRIM_SECONDS} giây.`,
  TRIM_EXCEEDS_CAP: 'Chỉ cho phép tối đa {cap} giây',
  TRIM_OUT_OF_VIDEO: 'Đoạn cắt nằm ngoài độ dài của video.',
  TRIM_NOT_WHOLE_SECOND: 'Đoạn cắt phải tính theo từng giây nguyên.',
  REASON_REQUIRED: 'Vui lòng nhập lý do.',
  TASK_NOT_FINISHED: 'Tác vụ chưa kết thúc nên chưa thể gỡ nội dung.',
  ADJUST_OVER_LIMIT: 'Số credit điều chỉnh vượt quá giới hạn cho phép.',
  ADJUST_INSUFFICIENT_BALANCE: 'Số dư tài khoản không đủ để trừ số credit này.',
};

/** Thông báo thay cho nội dung đã bị gỡ (Task có `filesRemovedAt`). */
export const CONTENT_REMOVED_MESSAGE_VI =
  'Nội dung đã bị gỡ do vi phạm hoặc theo yêu cầu';

const API_VALIDATION_FALLBACK_VI = 'Dữ liệu không hợp lệ.';

export function getValidationReasonMessageVi(
  reason: ValidationReason | (string & {}) | null | undefined,
  cap?: number | null,
): string {
  if (!reason || !Object.prototype.hasOwnProperty.call(VALIDATION_REASON_MESSAGES_VI, reason)) {
    return API_VALIDATION_FALLBACK_VI;
  }
  if (reason === 'TRIM_EXCEEDS_CAP' && cap == null) return API_VALIDATION_FALLBACK_VI;
  return VALIDATION_REASON_MESSAGES_VI[reason as ValidationReason].replace(
    '{cap}',
    cap == null ? '' : String(cap),
  );
}

/** GET /tasks — phân trang cursor, mới nhất trước. */
export const TaskListQuerySchema = z
  .object({
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().min(1).optional(),
    pipeline: TaskPipelineSchema.optional(),
    status: TaskStatusSchema.optional(),
    /** Lọc theo khoảng ngày tạo (YYYY-MM-DD, giờ Việt Nam, gồm cả hai đầu). */
    from: DateOnlySchema.optional(),
    to: DateOnlySchema.optional(),
    /** Mã tác vụ: đầu của UUID (hex và dấu gạch, tối thiểu 4 ký tự). */
    code: z
      .string()
      .trim()
      .regex(/^[0-9a-fA-F-]{4,36}$/, 'Mã tác vụ không hợp lệ.')
      .optional(),
  })
  .superRefine(refineDateRange);
export type TaskListQuery = z.infer<typeof TaskListQuerySchema>;

export const TaskListResponseSchema = z
  .object({
    items: z.array(TaskSchema),
    pageSize: z.number().int().min(1).max(100),
    hasMore: z.boolean(),
    /** Tổng số bản ghi khớp bộ lọc (không phụ thuộc cursor) để dựng thanh số trang. */
    total: z.number().int().min(0),
    nextCursor: z.string().min(1).nullable(),
  })
  .superRefine((res, ctx) => {
    if (res.items.length > res.pageSize) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['items'],
        message: 'Số Task không được vượt quá pageSize',
      });
    }
    if (res.hasMore !== (res.nextCursor !== null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['nextCursor'],
        message: 'hasMore phải khớp với việc có nextCursor',
      });
    }
  });
export type TaskListResponse = z.infer<typeof TaskListResponseSchema>;

/** GET /tasks/{id} */
export const TaskGetResponseSchema = TaskSchema;
export type TaskGetResponse = Task;

/** POST /tasks/{id}/cancel — CONFLICT nếu Task đã running. */
export const TaskCancelResponseSchema = TaskSchema;
export type TaskCancelResponse = Task;

/** GET /tasks/{id}/result — CONFLICT nếu Task chưa succeeded. */
export const MEDIA_TYPES = ['image', 'video'] as const;
export const MediaTypeSchema = z.enum(MEDIA_TYPES);
export type MediaType = z.infer<typeof MediaTypeSchema>;

/** Một đầu vào của Task (ảnh/video người dùng đã tải lên) kèm URL ký ngắn hạn; chỉ trả khi tệp còn lưu. */
export const TaskResultInputSchema = z.object({
  /** Khóa trong tasks.input_keys, vd. `sourceKey`, `targetKey`, `imageKey`, `characterKey`, `videoKey`. */
  role: z.string().min(1),
  mediaType: MediaTypeSchema,
  url: z.string().url(),
});
export type TaskResultInput = z.infer<typeof TaskResultInputSchema>;

/** Tham số người dùng đã chọn khi tạo Task (chỉ các trường an toàn để hiển thị). */
export const TaskResultParamsSchema = z.object({
  intensity: z.number().int().optional(),
  seconds: z.number().int().positive().optional(),
  trimStart: z.number().int().optional(),
  trimEnd: z.number().int().optional(),
  aspectRatio: z.string().optional(),
  prompt: z.string().optional(),
  resolution: z.string().optional(),
  mode: z.string().optional(),
});
export type TaskResultParams = z.infer<typeof TaskResultParamsSchema>;

/** Video có `posterUrl` và `durationSeconds`; ảnh không có. `sourceUrl` của Motion luôn rỗng. */
export const TaskResultResponseSchema = z
  .object({
    /** Đầu vào gốc của Task để trang chi tiết hiển thị lại; vắng nghĩa là BE cũ. */
    inputs: z.array(TaskResultInputSchema).optional(),
    params: TaskResultParamsSchema.optional(),
    /** Vắng mặt nghĩa là `image` (tương thích BE Epic 2–4 cho đến khi 5.6 điền trường này). */
    mediaType: MediaTypeSchema.optional(),
    resultUrl: z.string().url(),
    sourceUrl: z.string().url().nullable(),
    posterUrl: z.string().url().optional(),
    durationSeconds: z.number().int().positive().optional(),
  })
  .superRefine((r, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    if (r.mediaType === 'video') {
      if (r.posterUrl == null) issue('posterUrl', 'Kết quả video bắt buộc có posterUrl');
      if (r.durationSeconds == null) issue('durationSeconds', 'Kết quả video bắt buộc có durationSeconds');
      if (r.sourceUrl != null) issue('sourceUrl', 'Kết quả video không có sourceUrl');
    } else {
      if (r.posterUrl != null) issue('posterUrl', 'Kết quả ảnh không có posterUrl');
      if (r.durationSeconds != null) issue('durationSeconds', 'Kết quả ảnh không có durationSeconds');
    }
  });
export type TaskResultResponse = z.infer<typeof TaskResultResponseSchema>;

/** POST /tasks/{id}/share, DELETE /tasks/{id}/share */
export const TaskShareResponseSchema = z.object({
  token: z.string().min(1),
  shareUrl: z.string().url(),
});
export type TaskShareResponse = z.infer<typeof TaskShareResponseSchema>;
export const TaskShareRevokeResponseSchema = z.object({ revoked: z.literal(true) });
export type TaskShareRevokeResponse = z.infer<typeof TaskShareRevokeResponseSchema>;

/** GET /s/{token} — thành công là chuyển hướng (không có body); 404 dùng ApiError. */
export const SharePublicParamsSchema = z.object({ token: z.string().min(1) });
export type SharePublicParams = z.infer<typeof SharePublicParamsSchema>;

/** GET /s/{token}/info */
export const ShareInfoResponseSchema = z
  .object({
    mediaType: MediaTypeSchema,
    durationSeconds: z.number().int().positive().optional(),
  })
  .superRefine((r, ctx) => {
    if (r.mediaType === 'video' && r.durationSeconds == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['durationSeconds'],
        message: 'Chia sẻ video bắt buộc có durationSeconds',
      });
    }
    if (r.mediaType === 'image' && r.durationSeconds != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['durationSeconds'],
        message: 'Chia sẻ ảnh không có durationSeconds',
      });
    }
  });
export type ShareInfoResponse = z.infer<typeof ShareInfoResponseSchema>;

/** GET /s/{token}/poster — thành công là chuyển hướng (không có body); 404 dùng ApiError. */
export const SharePosterParamsSchema = SharePublicParamsSchema;
export type SharePosterParams = SharePublicParams;
