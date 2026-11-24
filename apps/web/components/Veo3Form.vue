<script setup lang="ts">
import { computed } from "vue";
import {
  VEO3_ASPECT_RATIOS,
  VEO3_PRICING,
  VEO3_PROMPT_MAX_LENGTH,
  VEO3_RESOLUTIONS,
  type Veo3AspectRatio,
  type Veo3Mode,
  type Veo3Resolution,
} from "@flowxis/contracts";
import ImageUploader from "~/components/ImageUploader.vue";

/** Các ô nhập của Veo 3; đổi theo chế độ (text-to-video không ảnh, image-to-video 1 ảnh, frames-to-video ảnh đầu + ảnh cuối tùy chọn). */
defineProps<{ idPrefix?: string; maintenanceNote?: boolean }>();

const mode = defineModel<Veo3Mode>("mode", { required: true });
const prompt = defineModel<string>("prompt", { required: true });
const aspectRatio = defineModel<Veo3AspectRatio>("aspectRatio", {
  required: true,
});
const resolution = defineModel<Veo3Resolution>("resolution", {
  required: true,
});
const imageKey = defineModel<string | null>("imageKey", { default: null });
const firstFrameKey = defineModel<string | null>("firstFrameKey", {
  default: null,
});
const lastFrameKey = defineModel<string | null>("lastFrameKey", {
  default: null,
});

const MODE_OPTIONS: ReadonlyArray<{
  id: Veo3Mode;
  labelVi: string;
  hintVi: string;
  icon: string;
}> = [
  {
    id: "text_to_video",
    labelVi: "Text to Video",
    hintVi: "Chỉ cần mô tả",
    icon: "lucide:type",
  },
  {
    id: "image_to_video",
    labelVi: "Image to Video",
    hintVi: "1 ảnh + mô tả",
    icon: "lucide:image",
  },
  {
    id: "frames_to_video",
    labelVi: "Frames Video",
    hintVi: "Ảnh đầu + cuối",
    icon: "lucide:film",
  },
];

const ASPECT_LABELS_VI: Readonly<Record<Veo3AspectRatio, string>> = {
  "16:9": "Ngang 16:9",
  "9:16": "Dọc 9:16",
};

const promptPlaceholder = computed<string>(() =>
  mode.value === "text_to_video"
    ? "Mô tả cảnh, chuyển động camera và âm thanh bạn muốn..."
    : "Mô tả chuyển động bạn muốn thấy từ ảnh...",
);

const pid = (suffix: string): string => `veo3-${suffix}`;
</script>

<template>
  <div class="space-y-3.5" data-testid="veo3-form">
    <div
      role="tablist"
      aria-label="Chế độ tạo video Veo 3"
      class="grid grid-cols-1 gap-2 sm:grid-cols-3"
      data-testid="veo3-mode-tabs"
    >
      <button
        v-for="opt in MODE_OPTIONS"
        :key="opt.id"
        type="button"
        role="tab"
        :aria-selected="mode === opt.id"
        :data-testid="`veo3-mode-${opt.id}`"
        class="touch-target flex min-h-[48px] items-center gap-2 rounded-xl border px-3 py-2 text-left transition"
        :class="
          mode === opt.id
            ? 'border-cyber-cyan/60 bg-cyber-cyan/15 text-cyber-cyan'
            : 'border-cyber-border bg-cyber-bg/60 text-cyber-muted hover:border-cyber-cyan/40'
        "
        @click="mode = opt.id"
      >
        <Icon :name="opt.icon" class="h-4 w-4 shrink-0" />
        <span class="min-w-0">
          <span class="block text-xs font-semibold">{{ opt.labelVi }}</span>
          <span class="block text-[11px] opacity-80">{{ opt.hintVi }}</span>
        </span>
      </button>
    </div>

    <div
      v-if="mode === 'image_to_video'"
      class="space-y-2.5 rounded-xl border border-cyber-border bg-cyber-bg/60 p-3 sm:p-3.5"
      data-testid="veo3-image-input"
    >
      <p class="text-xs font-semibold text-cyber-text sm:text-sm">
        Ảnh đầu vào
      </p>
      <ImageUploader
        v-model="imageKey"
        :maintenance-note="maintenanceNote"
        :id-prefix="`${idPrefix ?? 'veo3'}-image`"
        label-vi="Chọn ảnh đầu vào"
        description-vi="JPG/PNG/WebP ≤ 10 MB"
      />
    </div>

    <div
      v-else-if="mode === 'frames_to_video'"
      class="space-y-3"
      data-testid="veo3-frames-inputs"
    >
      <div
        class="space-y-2.5 rounded-xl border border-cyber-border bg-cyber-bg/60 p-3 sm:p-3.5"
      >
        <p class="text-xs font-semibold text-cyber-text sm:text-sm">
          Khung hình đầu (bắt buộc)
        </p>
        <ImageUploader
          v-model="firstFrameKey"
          :maintenance-note="maintenanceNote"
          :id-prefix="`${idPrefix ?? 'veo3'}-first-frame`"
          label-vi="Chọn khung hình đầu"
          description-vi="JPG/PNG/WebP ≤ 10 MB"
        />
      </div>
      <div
        class="space-y-2.5 rounded-xl border border-cyber-border bg-cyber-bg/60 p-3 sm:p-3.5"
      >
        <p class="text-xs font-semibold text-cyber-text sm:text-sm">
          Khung hình cuối (tùy chọn)
        </p>
        <ImageUploader
          v-model="lastFrameKey"
          :maintenance-note="maintenanceNote"
          :id-prefix="`${idPrefix ?? 'veo3'}-last-frame`"
          label-vi="Chọn khung hình cuối"
          description-vi="JPG/PNG/WebP ≤ 10 MB"
        />
      </div>
    </div>

    <div
      class="space-y-2 rounded-xl border border-cyber-border bg-cyber-bg/60 p-3 sm:p-3.5"
    >
      <label
        :for="pid('prompt')"
        class="text-xs font-semibold text-cyber-text sm:text-sm"
      >
        Mô tả video
      </label>
      <textarea
        :id="pid('prompt')"
        v-model="prompt"
        data-testid="veo3-prompt"
        rows="5"
        :maxlength="VEO3_PROMPT_MAX_LENGTH"
        :placeholder="promptPlaceholder"
        class="w-full resize-y rounded-lg border border-cyber-border bg-cyber-surface p-3 text-sm text-cyber-text placeholder:text-cyber-muted focus:border-cyber-cyan focus:outline-none"
      />
      <p class="text-right font-mono text-[11px] text-cyber-muted">
        {{ prompt.length }}/{{ VEO3_PROMPT_MAX_LENGTH }}
      </p>
    </div>

    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <fieldset
        class="space-y-2 rounded-xl border border-cyber-border bg-cyber-bg/60 p-3"
      >
        <legend class="px-1 text-xs font-semibold text-cyber-text">
          Tỉ lệ khung
        </legend>
        <div class="flex gap-2">
          <button
            v-for="ar in VEO3_ASPECT_RATIOS"
            :key="ar"
            type="button"
            :data-testid="`veo3-aspect-${ar.replace(':', '-')}`"
            :aria-pressed="aspectRatio === ar"
            class="touch-target min-h-[48px] flex-1 rounded-lg border px-2 text-xs font-semibold transition"
            :class="
              aspectRatio === ar
                ? 'border-cyber-cyan/60 bg-cyber-cyan/15 text-cyber-cyan'
                : 'border-cyber-border text-cyber-muted hover:border-cyber-cyan/40'
            "
            @click="aspectRatio = ar"
          >
            {{ ASPECT_LABELS_VI[ar] }}
          </button>
        </div>
      </fieldset>

      <fieldset
        class="space-y-2 rounded-xl border border-cyber-border bg-cyber-bg/60 p-3"
      >
        <legend class="px-1 text-xs font-semibold text-cyber-text">
          Độ phân giải
        </legend>
        <div class="flex gap-2">
          <button
            v-for="res in VEO3_RESOLUTIONS"
            :key="res"
            type="button"
            :data-testid="`veo3-resolution-${res}`"
            :aria-pressed="resolution === res"
            class="touch-target min-h-[48px] flex-1 rounded-lg border px-1 text-xs font-semibold transition"
            :class="
              resolution === res
                ? 'border-cyber-cyan/60 bg-cyber-cyan/15 text-cyber-cyan'
                : 'border-cyber-border text-cyber-muted hover:border-cyber-cyan/40'
            "
            @click="resolution = res"
          >
            <span class="block">{{ res }}</span>
            <span class="block font-mono text-[10px] opacity-80"
              >{{ VEO3_PRICING[res] }} CR</span
            >
          </button>
        </div>
      </fieldset>
    </div>
    <p class="text-[11px] text-cyber-muted">
      Video dài 8 giây, có âm thanh. Giá tính theo độ phân giải.
    </p>
  </div>
</template>
