import { Injectable, Logger } from '@nestjs/common';
import type { RealtimeEvent } from '@flowxis/contracts';
import { RedisService } from '../../infra/redis.service.js';

export const REALTIME_CHANNEL_PREFIX = 'rt:user:';

/**
 * Phát sự kiện tới người dùng qua Redis pub/sub (worker và api là hai tiến trình khác nhau);
 * gateway ở tiến trình api nhận và đẩy xuống socket. Chỉ là gợi ý cho giao diện:
 * mất sự kiện thì client vẫn đọc lại được từ DB.
 */
@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);

  constructor(private readonly redis: RedisService) {}

  /** Không chờ và không ném lỗi: Redis lỗi không được làm hỏng luồng nghiệp vụ đã commit. */
  publish(userId: string, event: RealtimeEvent): void {
    void this.redis.client
      .publish(`${REALTIME_CHANNEL_PREFIX}${userId}`, JSON.stringify(event))
      .catch((err) => this.logger.warn(`Không phát được sự kiện realtime: ${String(err)}`));
  }
}
