import { onScopeDispose } from 'vue';
import type { RealtimeEvent } from '@flowxis/contracts';

type Listener = (event: RealtimeEvent) => void;

const listeners = new Set<Listener>();

/** Bên nghe sự kiện realtime (ví dụ trang nạp tiền cập nhật ngay đơn đang mở). Tự hủy khi scope kết thúc. */
export function onRealtimeEvent(listener: Listener): () => void {
  listeners.add(listener);
  const off = () => listeners.delete(listener);
  onScopeDispose(off);
  return off;
}

export function dispatchRealtimeEvent(event: RealtimeEvent): void {
  for (const l of listeners) {
    try {
      l(event);
    } catch {
      // Lỗi của một bên nghe không ảnh hưởng bên khác.
    }
  }
}
