import { watch } from 'vue';
import { toast } from 'vue-sonner';
import { io, type Socket } from 'socket.io-client';
import { defineNuxtPlugin, navigateTo, refreshNuxtData, useRuntimeConfig } from '#imports';
import type { RealtimeEvent } from '@flowxis/contracts';
import { ME_KEY, refreshShared, useApiClient } from '~/composables/useApiClient';
import { dispatchRealtimeEvent } from '~/composables/useRealtime';
import { buildRealtimeNotice } from '~/utils/realtime-notice';

const EVENT_TYPES = ['task', 'topup'] as const;
const SEEN_LIMIT = 200;
const TERMINAL_TASK_STATUSES: ReadonlySet<string> = new Set(['succeeded', 'failed', 'timed_out', 'cancelled']);
// Gateway ngắt kết nối khi token sai/hết hạn/tài khoản khóa: thử lấy token mới có giới hạn để không lặp vô hạn.
const MAX_AUTH_RETRIES = 5;
const AUTH_RETRY_BASE_MS = 1000;
const AUTH_RETRY_MAX_MS = 30_000;

// Giữ kết nối Socket.IO khi đã đăng nhập: toast kết quả Task/nạp tiền ở mọi trang.
export default defineNuxtPlugin(() => {
  const { client, accessToken, setAccessToken } = useApiClient();
  const baseUrl = String(useRuntimeConfig().public.apiBaseUrl || 'http://localhost:8000');
  const seen = new Set<string>();
  let socket: Socket | null = null;

  function remember(key: string): boolean {
    if (seen.has(key)) return false;
    seen.add(key);
    if (seen.size > SEEN_LIMIT) seen.delete(seen.values().next().value as string);
    return true;
  }

  let meTimer: ReturnType<typeof setTimeout> | null = null;

  // Gộp các sự kiện dồn dập (gửi nhiều Task cùng lúc) thành một lần tải lại hồ sơ.
  function scheduleMeRefresh(): void {
    if (meTimer !== null) return;
    meTimer = setTimeout(() => {
      meTimer = null;
      void refreshNuxtData(ME_KEY).catch(() => {});
    }, 400);
  }

  // Credit chỉ đổi khi Task kết thúc (hoàn/thu) hoặc đơn nạp đổi trạng thái; queued/running thì không.
  function affectsBalance(event: RealtimeEvent): boolean {
    return event.type === 'topup' || TERMINAL_TASK_STATUSES.has(event.status);
  }

  function handle(event: RealtimeEvent): void {
    if (affectsBalance(event)) scheduleMeRefresh();
    dispatchRealtimeEvent(event);
    const notice = buildRealtimeNotice(event);
    if (!notice || !remember(notice.dedupeKey)) return;
    const { href } = notice;
    toast[notice.kind](notice.title, {
      description: notice.description,
      duration: notice.kind === 'error' ? 8000 : 6000,
      action: href ? { label: 'Xem', onClick: () => void navigateTo(href) } : undefined,
    });
  }

  let authRetries = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  /** Đổi cookie refresh lấy token mới rồi nối lại; lỗi mạng thoáng qua thì thử lại với backoff. */
  async function recoverFromAuthError(): Promise<void> {
    if (!socket || retryTimer !== null) return;
    if (authRetries >= MAX_AUTH_RETRIES) return;
    authRetries += 1;
    const outcome = await refreshShared(() => client.refreshSession(), setAccessToken);
    // 'invalid': phiên đã mất, xử lý đăng xuất nằm ở luồng 401 chung nên ở đây dừng hẳn.
    if (outcome === 'invalid' || !socket) return;
    const delay =
      outcome === 'ok'
        ? 300
        : Math.min(AUTH_RETRY_BASE_MS * 2 ** (authRetries - 1), AUTH_RETRY_MAX_MS);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      socket?.connect();
    }, delay);
  }

  function connect(): void {
    if (socket) return;
    socket = io(baseUrl, {
      path: '/socket.io',
      // Mặc định của Socket.IO: mở bằng long-polling rồi nâng lên WebSocket nếu proxy cho phép.
      // Không đặt ['websocket'] đứng đầu: khi proxy chặn upgrade thì client không có đường lùi.
      transports: ['polling', 'websocket'],
      withCredentials: true,
      // Gọi lại mỗi lần (kết nối lại) để luôn dùng access token mới nhất.
      auth: (cb) => cb({ token: accessToken.value }),
      reconnectionDelayMax: 15_000,
    });
    for (const type of EVENT_TYPES) socket.on(type, handle);
    socket.on('connect', () => {
      authRetries = 0;
    });
    socket.on('auth_error', () => void recoverFromAuthError());
    // Mất kết nối rồi nối lại: có thể đã lỡ sự kiện nên đồng bộ lại số dư.
    socket.io.on('reconnect', scheduleMeRefresh);
  }

  function disconnect(): void {
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    if (meTimer !== null) {
      clearTimeout(meTimer);
      meTimer = null;
    }
    authRetries = 0;
    socket?.disconnect();
    socket = null;
    seen.clear();
  }

  watch(
    () => Boolean(accessToken.value),
    (loggedIn) => (loggedIn ? connect() : disconnect()),
    { immediate: true },
  );
});
