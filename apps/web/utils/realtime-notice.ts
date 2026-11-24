import {
  getReasonCodeMessageVi,
  type RealtimeEvent,
} from '@flowxis/contracts';
import { getPipelineLabelVi } from '~/utils/task-format';

export interface RealtimeNotice {
  kind: 'success' | 'error' | 'warning' | 'info';
  title: string;
  description?: string;
  /** Khóa chống toast trùng khi cùng sự kiện đến nhiều lần (kết nối lại, tab đôi). */
  dedupeKey: string;
  /** Đường dẫn mở khi bấm vào thông báo. */
  href?: string;
}

const nf = new Intl.NumberFormat('vi-VN');

/** Chuyển sự kiện realtime thành thông báo; trả null nếu không cần báo (đang chạy, hàng đợi...). */
export function buildRealtimeNotice(event: RealtimeEvent): RealtimeNotice | null {
  if (event.type === 'task') {
    const label = getPipelineLabelVi(event.pipeline);
    const href = `/tasks/${event.taskId}`;
    const dedupeKey = `task:${event.taskId}:${event.status}`;
    switch (event.status) {
      case 'succeeded':
        return { kind: 'success', title: `${label} hoàn tất`, description: 'Kết quả đã sẵn sàng.', dedupeKey, href };
      case 'failed':
      case 'timed_out':
        return {
          kind: 'error',
          title: `${label} không thành công`,
          description: getReasonCodeMessageVi(event.reasonCode, event.pipeline),
          dedupeKey,
          href,
        };
      default:
        return null;
    }
  }
  const dedupeKey = `topup:${event.topupId}:${event.status}`;
  switch (event.status) {
    case 'approved':
      return {
        kind: 'success',
        title: 'Nạp credit thành công',
        description: event.credits ? `Đã cộng ${nf.format(event.credits)} credit vào tài khoản.` : 'Credit đã được cộng vào tài khoản.',
        dedupeKey,
      };
    case 'rejected':
      return {
        kind: 'error',
        title: 'Đơn nạp bị từ chối',
        description: event.rejectReason ?? 'Vui lòng liên hệ hỗ trợ nếu bạn đã chuyển khoản.',
        dedupeKey,
      };
    case 'needs_review':
      return {
        kind: 'warning',
        title: 'Đơn nạp đang được kiểm tra thêm',
        description: 'Chúng tôi sẽ cập nhật ngay khi có kết quả.',
        dedupeKey,
      };
    default:
      return null;
  }
}
