import { Logger, OnModuleDestroy } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { RealtimeEvent } from '@flowxis/contracts';
import type { Redis } from 'ioredis';
import type { Server, Socket } from 'socket.io';
import { PrismaService } from '../../infra/prisma.service.js';
import { RedisService } from '../../infra/redis.service.js';
import type { JwtUserPayload } from '../auth/jwt.strategy.js';
import { REALTIME_CHANNEL_PREFIX } from './realtime.service.js';

function allowedOrigins(): string[] {
  const raw = (process.env.FRONTEND_URL ?? '').trim() || 'http://localhost:3000';
  return raw
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter((o) => o.length > 0);
}

/** Mỗi user một room `user:<id>`; token JWT truyền qua `handshake.auth.token`. */
@WebSocketGateway({
  path: '/socket.io',
  cors: {
    origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) =>
      cb(null, !origin || allowedOrigins().includes(origin.trim().replace(/\/+$/, ''))),
    credentials: true,
  },
})
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeGateway.name);
  private subscriber: Redis | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  @WebSocketServer() private server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  afterInit(server: Server): void {
    const sub = this.redis.createWorkerConnection();
    this.subscriber = sub;
    this.subscribeWithRetry(sub);
    // ioredis tự subscribe lại sau khi nối lại Redis; chỉ cần ghi log để lỗi không âm thầm.
    sub.on('error', (err: Error) => this.logger.warn(`Redis subscriber lỗi: ${err.message}`));
    sub.on('pmessage', (_pattern: string, channel: string, message: string) => {
      try {
        const event = JSON.parse(message) as RealtimeEvent;
        server.to(`user:${channel.slice(REALTIME_CHANNEL_PREFIX.length)}`).emit(event.type, event);
      } catch {
        // Bỏ qua gói tin hỏng.
      }
    });
  }

  /** Subscribe lỗi (Redis chưa sẵn sàng lúc khởi động) thì thử lại, tránh mất toàn bộ realtime mà không có log. */
  private subscribeWithRetry(sub: Redis, attempt = 1): void {
    sub.psubscribe(`${REALTIME_CHANNEL_PREFIX}*`).catch((err: unknown) => {
      this.logger.error(`psubscribe lần ${attempt} thất bại: ${String(err)}`);
      if (this.subscriber !== sub) return;
      const delay = Math.min(1000 * 2 ** (attempt - 1), 30_000);
      this.retryTimer = setTimeout(() => this.subscribeWithRetry(sub, attempt + 1), delay);
    });
  }

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = (client.handshake.auth as { token?: unknown } | undefined)?.token;
      if (typeof token !== 'string' || token.length === 0) throw new Error('missing token');
      const payload = await this.jwt.verifyAsync<JwtUserPayload>(token);
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { lockedAt: true },
      });
      if (!user || user.lockedAt !== null) throw new Error('user unavailable');
      await client.join(`user:${payload.sub}`);
    } catch {
      // Client sẽ nhận connect_error/disconnect và tự lấy token mới rồi kết nối lại.
      client.emit('auth_error');
      client.disconnect(true);
    }
  }

  onModuleDestroy(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.subscriber?.disconnect();
    this.subscriber = null;
  }
}
