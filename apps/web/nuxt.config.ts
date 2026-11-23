import { assertReportEmail } from './scripts/assert-report-email.mjs';

export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  srcDir: '.',
  devtools: { enabled: false },
  hooks: {
    // Build production bắt buộc có email nhận báo cáo vi phạm.
    'nitro:build:before': () => {
      assertReportEmail(process.env.NUXT_PUBLIC_REPORT_EMAIL, process.env.NODE_ENV);
    },
  },
  modules: ['@nuxtjs/tailwindcss', '@nuxt/icon', 'shadcn-nuxt', 'nuxt-gtag'],
  // Google Analytics 4: để trống NUXT_PUBLIC_GTAG_ID thì không nạp script (dev/local không đếm traffic).
  gtag: { id: process.env.NUXT_PUBLIC_GTAG_ID || '' },
  shadcn: { prefix: '', componentDir: './components/ui' },
  css: ['~/assets/css/main.css'],
  // Mặc định build server Node (.output/server/index.mjs) để chạy trên VPS (deploy/Dockerfile.web).
  // Muốn deploy Cloudflare Pages: đặt NITRO_PRESET=cloudflare-pages trong .env/biến môi trường lúc build.
  nitro:
    process.env.NITRO_PRESET === 'cloudflare-pages'
      ? {
          preset: 'cloudflare-pages',
          output: {
            dir: '.output/public',
            publicDir: '.output/public',
            serverDir: '.output/public/_worker.js',
          },
        }
      : { preset: 'node-server' },
  // Header bảo mật cho mọi trang; trang riêng tư/quản trị thêm X-Robots-Tag để máy tìm kiếm không index.
  // Không đặt CSP ở đây vì trang tải font từ Google Fonts và dùng script inline của Nuxt.
  routeRules: {
    '/**': {
      headers: {
        'Strict-Transport-Security': 'max-age=31536000',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'SAMEORIGIN',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
      },
    },
    '/admin/**': { headers: { 'X-Robots-Tag': 'noindex, nofollow' } },
    '/history': { headers: { 'X-Robots-Tag': 'noindex, nofollow' } },
    '/tasks/**': { headers: { 'X-Robots-Tag': 'noindex, nofollow' } },
    '/share/**': { headers: { 'X-Robots-Tag': 'noindex, nofollow' } },
    '/auth/**': { headers: { 'X-Robots-Tag': 'noindex, nofollow' } },
  },
  runtimeConfig: {
    public: {
      siteUrl: process.env.NUXT_PUBLIC_SITE_URL || 'https://flowxis.app',
      apiBaseUrl: process.env.NUXT_PUBLIC_API_BASE_URL || 'http://localhost:8000',
      reportEmail: process.env.NUXT_PUBLIC_REPORT_EMAIL || '',
      zaloUrl: process.env.NUXT_PUBLIC_ZALO_URL || '',
    },
  },
  icon: {
    provider: 'server',
    serverBundle: {
      collections: ['lucide'],
    },
    clientBundle: {
      scan: true,
    },
    attrs: {
      'stroke-width': '2',
      class: 'lucide-icon',
    },
  },
  tailwindcss: {
    cssPath: '~/assets/css/main.css',
    configPath: 'tailwind.config.ts',
    exposeConfig: false,
  },
  app: {
    head: {
      htmlAttrs: {
        lang: 'vi',
        class: 'dark',
      },
      title: 'flowxis — Tạo Ảnh & Video AI',
      meta: [
        { charset: 'utf-8' },
        { name: 'theme-color', content: '#0F172A' },
        {
          name: 'viewport',
          content: 'width=device-width, initial-scale=1, maximum-scale=5',
        },
        {
          name: 'description',
          content:
            'Nền tảng tạo ảnh và video AI chuyên nghiệp: Hoán đổi khuôn mặt, Nâng ngực AI tự nhiên và Điều khiển chuyển động.',
        },
      ],
      link: [
        { rel: 'icon', type: 'image/png', href: '/favicon-96x96.png', sizes: '96x96' },
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'shortcut icon', href: '/favicon.ico' },
        { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' },
        { rel: 'manifest', href: '/site.webmanifest' },
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        {
          rel: 'preconnect',
          href: 'https://fonts.gstatic.com',
          crossorigin: '',
        },
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap',
        },
      ],
    },
  },
});
