<script setup lang="ts">
import type { AiFeatureTool } from "~/utils/catalog";

const props = defineProps<{
  feature: AiFeatureTool;
}>();

const emit = defineEmits<{
  select: [feature: AiFeatureTool];
}>();

// Mỗi banner ảnh có bản AVIF cùng tên cạnh bản WebP (nhỏ hơn ~30–50%); WebP là phương án dự phòng.
const avifUrl = computed(() =>
  props.feature.bannerUrl.replace(/\.(webp|png|jpe?g)$/i, ".avif"),
);

// Poster video là ảnh WebP cùng tên với hậu tố `-poster`, hiện ngay trong lúc video chưa tải.
const posterUrl = computed(() =>
  props.feature.bannerUrl.replace(/\.mp4$/i, "-poster.webp"),
);

// Chỉ gán src cho video khi card vào viewport (tránh tải 3–4MB/video khi chưa cuộn tới);
// cuộn ra ngoài thì tạm dừng để tiết kiệm băng thông và CPU.
const videoEl = ref<HTMLVideoElement | null>(null);
const videoSrc = ref<string | undefined>(undefined);
let observer: IntersectionObserver | null = null;

onMounted(() => {
  const el = videoEl.value;
  if (!el || props.feature.bannerType !== "video") return;
  if (typeof IntersectionObserver === "undefined") {
    videoSrc.value = props.feature.bannerUrl;
    return;
  }
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          videoSrc.value ??= props.feature.bannerUrl;
          void el.play().catch(() => undefined);
        } else {
          el.pause();
        }
      }
    },
    { rootMargin: "200px" },
  );
  observer.observe(el);
});

onBeforeUnmount(() => observer?.disconnect());

function handleOpenWorkspace(): void {
  emit("select", props.feature);
}
</script>

<template>
  <article
    :data-testid="`feature-card-${feature.id}`"
    class="group flex flex-col justify-between overflow-hidden rounded-2xl border border-cyber-border bg-cyber-surface transition duration-200 hover:border-cyber-violet"
  >
    <!-- Khung minh họa Before/After đặc trưng Slate Cyber -->
    <div
      class="cursor-pointer"
      role="button"
      tabindex="0"
      :aria-label="`Mở không gian làm việc cho ${feature.titleVi}`"
      @click="handleOpenWorkspace"
      @keydown.enter="handleOpenWorkspace"
      @keydown.space.prevent="handleOpenWorkspace"
    >
      <div
        class="relative h-56 w-full overflow-hidden border-b border-cyber-border bg-gradient-to-br p-4"
        :class="feature.accentGradient"
      >
        <video
          v-if="feature.bannerType === 'video'"
          ref="videoEl"
          :src="videoSrc"
          :poster="posterUrl"
          class="absolute inset-0 h-full w-full object-cover"
          autoplay
          loop
          muted
          playsinline
          preload="none"
          aria-hidden="true"
        />
        <picture v-else>
          <source :srcset="avifUrl" type="image/avif" />
          <img
            :src="feature.bannerUrl"
            :alt="`Ảnh minh họa ${feature.titleVi}`"
            class="absolute inset-0 h-full w-full object-cover"
            loading="lazy"
            decoding="async"
          />
        </picture>
        <div class="relative flex items-center justify-between gap-2">
          <span
            class="inline-flex items-center gap-1.5 rounded-full border border-cyber-border bg-cyber-bg/80 px-2.5 py-1 text-xs font-medium text-cyber-text"
          >
            <Icon :name="feature.icon" class="h-3.5 w-3.5 text-cyber-violet" />
            <span>{{ feature.categoryLabelVi }}</span>
          </span>

          <span
            v-if="feature.badgeVi"
            class="rounded-full border border-cyber-violet/40 bg-cyber-violet/20 px-2.5 py-1 font-mono text-[11px] font-semibold text-cyber-text"
          >
            {{ feature.badgeVi }}
          </span>
        </div>
      </div>

      <!-- Nội dung mô tả tính năng & đơn giá động từ /config/pricing -->
      <div class="space-y-3 p-5">
        <div>
          <h2 class="font-display text-lg font-bold text-cyber-text">
            {{ feature.titleVi }}
          </h2>
        </div>

        <p class="text-sm leading-relaxed text-cyber-muted">
          {{ feature.descriptionVi }}
        </p>

        <div class="flex flex-wrap items-center gap-2 pt-1">
          <span
            :data-testid="`feature-price-${feature.id}`"
            class="inline-flex items-center gap-1.5 rounded-lg border border-cyber-cyan/40 bg-cyber-cyan/10 px-2.5 py-1 font-mono text-xs font-semibold text-cyber-cyan"
          >
            <Icon name="lucide:zap" class="h-3.5 w-3.5 shrink-0" />
            <span>{{ feature.priceBadgeVi }}</span>
          </span>

          <span
            v-if="feature.tierCapLabelVi"
            :data-testid="`feature-cap-${feature.id}`"
            class="inline-flex items-center gap-1.5 rounded-lg border border-cyber-border bg-cyber-bg/70 px-2.5 py-1 font-mono text-xs text-cyber-muted"
          >
            <Icon
              name="lucide:timer"
              class="h-3.5 w-3.5 shrink-0 text-cyber-violet"
            />
            <span>{{ feature.tierCapLabelVi }}</span>
          </span>
        </div>
      </div>
    </div>

    <!-- Nút mở Centered Dialog làm việc (vùng chạm >= 48px) -->
    <div class="border-t border-cyber-border/70 p-4 pt-3">
      <button
        type="button"
        :data-testid="`open-workspace-${feature.id}`"
        class="touch-target inline-flex min-h-[48px] min-w-[48px] w-full items-center justify-center gap-2 rounded-xl bg-cyber-violet px-4 py-3 text-sm font-semibold text-cyber-text transition hover:bg-cyber-violet/90"
        @click="handleOpenWorkspace"
      >
        <Icon name="lucide:wand-sparkles" class="h-4 w-4 shrink-0" />
        <span>Mở Không Gian Làm Việc</span>
      </button>
    </div>
  </article>
</template>
