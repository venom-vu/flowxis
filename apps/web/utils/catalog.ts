import type {
  AccountTier,
  PricingConfigResponse,
  TierConfig,
} from "@flowxis/contracts";
import { motionCapSeconds, removeWatermarkCapSeconds } from "@flowxis/contracts";

export type FeatureCategoryId = "all" | "image" | "video";

export interface FeatureCategoryOption {
  id: FeatureCategoryId;
  labelVi: string;
  icon: string;
}

export const FEATURE_CATEGORIES: readonly FeatureCategoryOption[] = [
  { id: "all", labelVi: "Tất cả công cụ", icon: "lucide:layers" },
  { id: "image", labelVi: "Xử lý ảnh AI", icon: "lucide:image" },
  { id: "video", labelVi: "Chuyển động video AI", icon: "lucide:video" },
] as const;

export type FeaturePipelineId =
  | "face-swap"
  | "outfit-change"
  | "body-retouch"
  | "motion-control"
  | "motion-control-v2"
  | "veo-3"
  | "muse-video"
  | "remove-watermark";

/** Chức năng tạm ẩn khỏi kho công cụ, sitemap và trang riêng (backend giữ nguyên); xóa id khỏi đây để bật lại. */
export const HIDDEN_FEATURE_IDS: readonly FeaturePipelineId[] = [];

export interface AiFeatureTool {
  id: FeaturePipelineId;
  slug: string;
  titleVi: string;
  descriptionVi: string;
  category: Exclude<FeatureCategoryId, "all">;
  categoryLabelVi: string;
  badgeVi: string;
  icon: string;
  billingMode: "per_run" | "per_second";
  /** Phí cố định mỗi lượt (credit), chỉ có ở tính năng tính theo giây. */
  baseCredits?: number;
  unitCredits: number;
  priceBadgeVi: string;
  tierCapSeconds: number | null;
  tierCapLabelVi: string | null;
  beforeLabelVi: string;
  afterLabelVi: string;
  accentGradient: string;
  bannerUrl: string;
  bannerType: "image" | "video";
  inputRequirementVi: string;
  outputFormatVi: string;
}

export function formatNumberVi(value: number): string {
  return new Intl.NumberFormat("vi-VN").format(value);
}

export function formatVndVi(amountVnd: number): string {
  if (amountVnd === 0) {
    return "Miễn phí";
  }
  return `${formatNumberVi(amountVnd)}đ`;
}

export function formatSignedCreditsVi(amount: number): string {
  if (amount > 0) {
    return `+${formatNumberVi(amount)} credit`;
  }
  if (amount < 0) {
    return `${formatNumberVi(amount)} credit`;
  }
  return "0 credit";
}

export function resolveTierConfig(
  pricing: PricingConfigResponse,
  tier: AccountTier = "FREE",
): TierConfig {
  const matched = pricing.tiers.find((item) => item.tier === tier);
  if (matched) {
    return matched;
  }
  const fallback = pricing.tiers[0];
  if (!fallback) {
    throw new Error("Cấu hình bảng giá không có thông tin hạng tài khoản");
  }
  return fallback;
}

export function getTierCapSeconds(
  pricing: PricingConfigResponse,
  tier: AccountTier = "FREE",
): number {
  return resolveTierConfig(pricing, tier).maxVideoSeconds;
}

/**
 * Sinh danh sách Card công cụ AI từ cấu hình bảng giá `/config/pricing` và Tier hiện tại.
 * Tuyệt đối không hardcode số credit hoặc số giây trần trong UI.
 */
export function buildAiFeatureCatalog(
  pricing: PricingConfigResponse,
  currentTier: AccountTier = "FREE",
): AiFeatureTool[] {
  const activeTierConfig = resolveTierConfig(pricing, currentTier);
  const tierCapSeconds = activeTierConfig.maxVideoSeconds;
  const motionV1Cap = motionCapSeconds("motion_control", tierCapSeconds);
  const motionV2Cap = motionCapSeconds("motion_control_v2", tierCapSeconds);
  const watermarkCap = removeWatermarkCapSeconds();
  const {
    faceSwapCredits,
    outfitChangeCredits,
    bodyRetouchCredits,
    motionControlBaseCredits,
    motionControlCreditsPerSecond,
    motionControlV2BaseCredits,
    motionControlV2CreditsPerSecond,
    veo3Credits720p,
    museVideoCredits,
    removeWatermarkCreditsPerSecond,
  } = pricing.pipelines;

  const all: AiFeatureTool[] = [
    {
      id: "face-swap",
      slug: "face-swap",
      titleVi: "Hoán Đổi Khuôn Mặt",
      descriptionVi:
        "Thay khuôn mặt trong ảnh bằng khuôn mặt bạn chọn. Giữ nguyên ánh sáng, góc nghiêng và kết cấu da nên ảnh trông tự nhiên, sắc nét.",
      category: "image",
      categoryLabelVi: "Xử lý ảnh AI",
      badgeVi: "",
      icon: "lucide:scan-face",
      billingMode: "per_run",
      unitCredits: faceSwapCredits,
      priceBadgeVi: `${formatNumberVi(faceSwapCredits)} CR / lượt`,
      tierCapSeconds: null,
      tierCapLabelVi: null,
      beforeLabelVi: "Ảnh gốc tham chiếu",
      afterLabelVi: "Khuôn mặt đã đồng bộ AI",
      bannerUrl: "/banner/face-swap.webp",
      bannerType: "image",
      accentGradient: "from-violet-600/30 via-slate-900 to-cyan-500/20",
      inputRequirementVi: "1 ảnh khuôn mặt nguồn + 1 ảnh đích rõ mặt",
      outputFormatVi:
        "Ảnh PNG/JPEG chất lượng cao (kèm nhãn EXIF AI Generator)",
    },
    {
      id: "outfit-change",
      slug: "outfit-change",
      titleVi: "Đổi Trang Phục",
      descriptionVi:
        "Tải ảnh người mẫu và ảnh trang phục, AI mặc bộ đồ mới lên người mẫu. Giữ nguyên dáng người, khuôn mặt và bối cảnh.",
      category: "image",
      categoryLabelVi: "Xử lý ảnh AI",
      badgeVi: "Phổ biến",
      icon: "lucide:shirt",
      billingMode: "per_run",
      unitCredits: outfitChangeCredits,
      priceBadgeVi: `${formatNumberVi(outfitChangeCredits)} CR / lượt`,
      tierCapSeconds: null,
      tierCapLabelVi: null,
      beforeLabelVi: "Ảnh người mẫu gốc",
      afterLabelVi: "Người mẫu đã đổi trang phục",
      bannerUrl: "/banner/change-outfit.webp",
      bannerType: "image",
      accentGradient: "from-cyan-500/25 via-slate-900 to-violet-600/25",
      inputRequirementVi: "1 ảnh người mẫu rõ dáng + 1 ảnh trang phục cần mặc",
      outputFormatVi:
        "Ảnh PNG/JPEG chất lượng cao (kèm nhãn EXIF AI Generator)",
    },
    {
      id: "body-retouch",
      slug: "body-retouch",
      titleVi: "Nâng Ngực",
      descriptionVi:
        "AI tự nhận diện và nâng vòng một theo mức bạn chọn từ 1 đến 10. Giữ nguyên trang phục và hậu cảnh, không làm biến dạng ảnh.",
      category: "image",
      categoryLabelVi: "Xử lý ảnh AI",
      badgeVi: "",
      icon: "lucide:sparkles",
      billingMode: "per_run",
      unitCredits: bodyRetouchCredits,
      priceBadgeVi: `${formatNumberVi(bodyRetouchCredits)} CR / lượt`,
      tierCapSeconds: null,
      tierCapLabelVi: null,
      beforeLabelVi: "Tỷ lệ khung hình gốc",
      afterLabelVi: "Vòng 1 đã nâng tự nhiên AI",
      bannerUrl: "/banner/breast-augmentation.webp",
      bannerType: "image",
      accentGradient: "from-cyan-500/25 via-slate-900 to-violet-600/25",
      inputRequirementVi: "1 ảnh toàn thân hoặc bán thân đủ ánh sáng",
      outputFormatVi:
        "Ảnh PNG/JPEG chất lượng cao (kèm nhãn EXIF AI Generator)",
    },
    {
      id: "motion-control",
      slug: "motion-control",
      titleVi: "Điều Khiển Chuyển Động Video",
      descriptionVi:
        "Cho nhân vật trong ảnh chuyển động y như video mẫu. Cắt đoạn cần dùng theo từng giây, dài tối đa 20 giây và tính phí đúng theo độ dài.",
      category: "video",
      categoryLabelVi: "Chuyển động video AI",
      badgeVi: "Phổ biến",
      icon: "lucide:clapperboard",
      billingMode: "per_second",
      baseCredits: motionControlBaseCredits,
      unitCredits: motionControlCreditsPerSecond,
      priceBadgeVi: `${formatNumberVi(motionControlBaseCredits)} + ${formatNumberVi(motionControlCreditsPerSecond)} CR / giây`,
      tierCapSeconds: motionV1Cap,
      tierCapLabelVi: `Tối đa ${formatNumberVi(motionV1Cap)} giây`,
      beforeLabelVi: "Ảnh nhân vật + Video mẫu",
      afterLabelVi: "Video chuyển động đồng bộ",
      bannerUrl: "/banner/motion-control.mp4",
      bannerType: "video",
      accentGradient: "from-violet-600/35 via-indigo-950 to-cyan-500/30",
      inputRequirementVi: "1 ảnh nhân vật rõ dáng + 1 video chuyển động mẫu",
      outputFormatVi: "Video MP4 H.264",
    },
    {
      id: "motion-control-v2",
      slug: "motion-control-v2",
      titleVi: "Điều Khiển Chuyển Động Video V2",
      descriptionVi:
        "Chất lượng video cao hơn V1: độ phân giải lớn hơn, bitrate cao hơn, giữ chi tiết tốt hơn. Hình ảnh sắc nét, rõ ràng, ít suy giảm do nén.",
      category: "video",
      categoryLabelVi: "Chuyển động video AI",
      badgeVi: "Mới",
      icon: "lucide:clapperboard",
      billingMode: "per_second",
      baseCredits: motionControlV2BaseCredits,
      unitCredits: motionControlV2CreditsPerSecond,
      priceBadgeVi: `${formatNumberVi(motionControlV2BaseCredits)} + ${formatNumberVi(motionControlV2CreditsPerSecond)} CR / giây`,
      tierCapSeconds: motionV2Cap,
      tierCapLabelVi: `Tối đa ${formatNumberVi(motionV2Cap)} giây`,
      beforeLabelVi: "Ảnh nhân vật + Video mẫu",
      afterLabelVi: "Video chuyển động đồng bộ",
      bannerUrl: "/banner/motion-control-v2.mp4",
      bannerType: "video",
      accentGradient: "from-violet-600/35 via-indigo-950 to-cyan-500/30",
      inputRequirementVi: "1 ảnh nhân vật rõ dáng + 1 video chuyển động mẫu",
      outputFormatVi: "Video MP4 H.264",
    },
    {
      id: "veo-3",
      slug: "veo-3",
      titleVi: "Veo 3 Tạo Video AI",
      descriptionVi:
        "Tạo video 8 giây có âm thanh từ mô tả văn bản, từ một ảnh hoặc từ khung hình đầu và cuối. Chọn tỉ lệ khung 16:9 hoặc 9:16 và độ phân giải tới 4K.",
      category: "video",
      categoryLabelVi: "Chuyển động video AI",
      badgeVi: "Mới",
      icon: "lucide:film",
      billingMode: "per_run",
      unitCredits: veo3Credits720p,
      priceBadgeVi: `Từ ${formatNumberVi(veo3Credits720p)} CR / video`,
      tierCapSeconds: null,
      tierCapLabelVi: null,
      beforeLabelVi: "Mô tả hoặc ảnh đầu vào",
      afterLabelVi: "Video 8 giây có âm thanh",
      bannerUrl: "/banner/veo-3.webp",
      bannerType: "image",
      accentGradient: "from-cyan-500/30 via-indigo-950 to-violet-600/30",
      inputRequirementVi: "Mô tả video, tùy chọn 1 ảnh hoặc 2 khung hình",
      outputFormatVi: "Video MP4 H.264 kèm âm thanh",
    },
    {
      id: "muse-video",
      slug: "muse-video",
      titleVi: "Muse Video",
      descriptionVi:
        "Tạo video khoảng 10 giây, 720p, có âm thanh từ 1 đến 9 ảnh tham chiếu và mô tả. Chọn tỉ lệ khung hoặc để AI theo tỉ lệ ảnh.",
      category: "video",
      categoryLabelVi: "Chuyển động video AI",
      badgeVi: "Mới",
      icon: "lucide:images",
      billingMode: "per_run",
      unitCredits: museVideoCredits,
      priceBadgeVi: `${formatNumberVi(museVideoCredits)} CR / video`,
      tierCapSeconds: null,
      tierCapLabelVi: null,
      beforeLabelVi: "1-9 ảnh tham chiếu + mô tả",
      afterLabelVi: "Video 10 giây có âm thanh",
      bannerUrl: "/banner/muse-video.webp",
      bannerType: "image",
      accentGradient: "from-violet-600/30 via-indigo-950 to-cyan-500/30",
      inputRequirementVi: "Mô tả video và 1-9 ảnh tham chiếu (tổng ≤ 11 MB)",
      outputFormatVi: "Video MP4 H.264 kèm âm thanh",
    },
    {
      id: "remove-watermark",
      slug: "remove-watermark",
      titleVi: "Xóa Watermark, Logo, Phụ Đề",
      descriptionVi:
        "Xóa watermark, logo và phụ đề khỏi video. Cắt đoạn cần xử lý theo từng giây và xem giá credit ngay khi kéo thanh trượt.",
      category: "video",
      categoryLabelVi: "Chuyển động video AI",
      badgeVi: "Mới",
      icon: "lucide:eraser",
      billingMode: "per_second",
      unitCredits: removeWatermarkCreditsPerSecond,
      priceBadgeVi: `${formatNumberVi(removeWatermarkCreditsPerSecond)} CR / giây`,
      tierCapSeconds: watermarkCap,
      tierCapLabelVi: `Tối đa ${formatNumberVi(watermarkCap)} giây`,
      beforeLabelVi: "Video có watermark, logo, phụ đề",
      afterLabelVi: "Video sạch",
      bannerUrl: "/banner/remove-watermark.mp4",
      bannerType: "video",
      accentGradient: "from-cyan-500/30 via-indigo-950 to-violet-600/30",
      inputRequirementVi: "1 video MP4 hoặc MOV cần xóa watermark, logo hoặc phụ đề",
      outputFormatVi: "Video MP4 H.264",
    },
  ];
  // Chức năng video lên đầu; sort ổn định nên thứ tự trong từng nhóm giữ nguyên.
  return all
    .filter((f) => !HIDDEN_FEATURE_IDS.includes(f.id))
    .sort(
      (a, b) => Number(b.category === "video") - Number(a.category === "video"),
    );
}

export function calculateFeatureEstimatedCredits(
  feature: AiFeatureTool,
  durationSeconds = 1,
): number {
  if (feature.billingMode === "per_second") {
    const maxSec = feature.tierCapSeconds ?? Math.max(1, durationSeconds);
    const clampedSeconds = Math.min(
      Math.max(1, Math.round(durationSeconds)),
      maxSec,
    );
    return (feature.baseCredits ?? 0) + clampedSeconds * feature.unitCredits;
  }
  return feature.unitCredits;
}
