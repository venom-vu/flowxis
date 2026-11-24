// Các trang công khai được đưa vào sitemap. Trang cá nhân/quản trị (history, admin, tasks, share, auth) không liệt kê.
export const SITEMAP_PATHS = [
  '/',
  '/face-swap',
  '/outfit-change',
  '/body-retouch',
  '/motion-control',
  '/motion-control-v2',
  '/veo-3',
  '/muse-video',
  '/remove-watermark',
  '/tiktok-downloader',
  '/pricing',
  '/terms',
  '/privacy',
] as const;

// Các đường dẫn crawler không nên truy cập.
export const ROBOTS_DISALLOW = ['/admin', '/history', '/tasks', '/share', '/auth'] as const;

export function buildSitemapXml(origin: string): string {
  const base = origin.replace(/\/$/, '');
  const urls = SITEMAP_PATHS.map((p) => `  <url><loc>${base}${p === '/' ? '/' : p}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

// Bot thu thập dữ liệu để huấn luyện mô hình AI: chặn toàn site.
export const AI_TRAINING_BOTS = [
  'Amazonbot',
  'Applebot-Extended',
  'Bytespider',
  'CCBot',
  'ClaudeBot',
  'anthropic-ai',
  'Claude-Web',
  'cohere-ai',
  'Diffbot',
  'GPTBot',
  'Google-Extended',
  'GoogleOther',
  'meta-externalagent',
  'MistralAI-Training',
  'omgili',
] as const;

// Bot tìm kiếm/trích dẫn AI: cho phép để nội dung được dẫn nguồn trong câu trả lời.
export const AI_SEARCH_BOTS = [
  'OAI-SearchBot',
  'ChatGPT-User',
  'PerplexityBot',
  'Perplexity-User',
  'Claude-SearchBot',
  'Claude-User',
] as const;

export function buildRobotsTxt(origin: string): string {
  const base = origin.replace(/\/$/, '');
  const rules = ROBOTS_DISALLOW.map((p) => `Disallow: ${p}`).join('\n');
  const group = (agents: readonly string[], body: string) =>
    `${agents.map((a) => `User-agent: ${a}`).join('\n')}\n${body}\n`;
  // Nhóm riêng của một bot thay thế hẳn nhóm `*`, nên bot tìm kiếm AI phải lặp lại các Disallow.
  return [
    group(['*'], `Allow: /\n${rules}`),
    group(AI_SEARCH_BOTS, `Allow: /\n${rules}`),
    group(AI_TRAINING_BOTS, 'Disallow: /'),
    `Sitemap: ${base}/sitemap.xml\n`,
  ].join('\n');
}
