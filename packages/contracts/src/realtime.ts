import type { ReasonCode, TaskPipeline, TaskStatus } from './tasks.js';
import type { TopupStatus } from './topups.js';

/** Sự kiện realtime đẩy tới đúng một người dùng qua Socket.IO: mỗi user một room `user:<id>`,
 * tên sự kiện trùng `type` ('task' | 'topup'); server gửi 'auth_error' rồi ngắt khi token không hợp lệ. */
export interface TaskRealtimeEvent {
  type: 'task';
  taskId: string;
  pipeline: TaskPipeline;
  status: TaskStatus;
  reasonCode: ReasonCode | null;
}

export interface TopupRealtimeEvent {
  type: 'topup';
  topupId: string;
  status: TopupStatus;
  credits: number | null;
  rejectReason: string | null;
}

export type RealtimeEvent = TaskRealtimeEvent | TopupRealtimeEvent;
