import crypto from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  NotFoundException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import {
  ApiErrorCode,
  getApiErrorMessageVi,
  getValidationReasonMessageVi,
  type MotionCreateResponse,
  BodyRetouchCreateRequestSchema,
  type BodyRetouchCreateRequest,
  type FaceSwapCreateRequest,
  type OutfitChangeCreateRequest,
  type MotionCreateRequest,
  type MotionV2CreateRequest,
  type MotionV2CreateResponse,
  type RemoveWatermarkCreateRequest,
  type RemoveWatermarkCreateResponse,
  REMOVE_WATERMARK_MIN_SECONDS,
  removeWatermarkPrice,
  removeWatermarkCapSeconds,
  type ValidationReason,
  MOTION_MIN_TRIM_SECONDS,
  MOTION_ASPECT_RATIO_DEFAULT,
  getMotionAspectRatio,
  CONTENT_REMOVED_MESSAGE_VI,
  motionCapSeconds,
  motionPrice,
  type ReasonCode,
  type Task,
  type TaskListQuery,
  type TaskListResponse,
  type TaskResultResponse,
  type TaskStatus,
  type TierSnapshot,
  type TaskResultInput,
  type TaskResultParams,
  vnDateRange,
  VEO3_DURATION_SECONDS,
  veo3Price,
  type Veo3CreateRequest,
  type Veo3CreateResponse,
  MUSE_VIDEO_DURATION_SECONDS,
  MUSE_VIDEO_MAX_IMAGES,
  MUSE_VIDEO_MAX_TOTAL_BYTES,
  MUSE_VIDEO_PRICE,
  MUSE_VIDEO_RESOLUTION,
  type MuseVideoCreateRequest,
  type MuseVideoCreateResponse,
} from '@flowxis/contracts';
import type { Queue } from 'bullmq';
import { PrismaService, type PrismaTransactionClient } from '../../infra/prisma.service.js';
import type { RunningHubInstanceType } from '../../ports/index.js';
import { estimateCostUsd } from './instance-pricing.js';
import { RedisService } from '../../infra/redis.service.js';
import { assertValidTransition, isTerminal } from './task-transitions.js';
import { AccountLockedException } from '../auth/guards/account-locked.guard.js';
import { STORAGE_PORT, type StoragePort } from '../../ports/index.js';
import { PipelinesService } from '../pipelines/pipelines.service.js';
import { UploadsService } from '../storage/uploads.service.js';
import { PRICING_CONFIG, tierFromPack } from '../wallet/tier.js';
import { WalletService } from '../wallet/wallet.service.js';

/** Lỗi hệ thống tính vào ngắt mạch (Story 6.2). */
export const SYSTEM_FAILURE_REASONS: readonly ReasonCode[] = [
  'GPU_ERROR',
  'GPU_TIMEOUT',
  'GPU_SUBMIT_UNKNOWN',
  'PREP_TIMEOUT',
  'FFMPEG_ERROR',
  'INPUT_FETCH_ERROR',
  'OUTPUT_UPLOAD_ERROR',
  'OUTPUT_INVALID',
  'INTERNAL_ERROR',
];

export interface TaskPipelineStatsRow {
  pipeline: string;
  counts: Record<string, number>;
  succeeded: number;
  system_failed: number;
  avg_proc: number | null;
  p95_proc: number | null;
  /** Chi phí USD của Task succeeded. */
  ok_cost: number | null;
  /** Chi phí USD lãng phí (failed/timed_out/cancelled). */
  wasted_cost: number | null;
  ok_seconds: number | null;
  all_cost: number | null;
  /** Số Task succeeded có cost_usd (mẫu cho AVG). */
  ok_cost_n: number;
  /** Số giây ok_seconds chỉ tính Task succeeded có cost_usd (để chia per-giây). */
  ok_seconds_costed: number | null;
  /** Tổng credit đã thu (hold_amount) của Task succeeded có cost_usd; dùng cho pipeline giá theo độ phân giải. */
  ok_credits_costed: number | null;
  by_instance: Array<{ instance_type: string; tasks: number; cost_usd: number }>;
}

export const TASKS_QUEUE = 'tasks';
/** Giới hạn chờ enqueue để phản hồi tạo Task luôn dưới 2 giây khi Redis treo; bộ quét sẽ enqueue lại. */
export const ENQUEUE_TIMEOUT_MS = 1500;
export const RESULT_URL_TTL_SECONDS = 600;

/** Thứ tự hiển thị đầu vào trên trang chi tiết Task. */
const INPUT_DISPLAY_ORDER: Readonly<Record<string, readonly string[]>> = {
  face_swap: ['sourceKey', 'targetKey'],
  outfit_change: ['modelKey', 'clothingKey'],
  body_retouch: ['imageKey'],
  motion_control: ['characterKey', 'videoKey'],
  motion_control_v2: ['characterKey', 'videoKey'],
  remove_watermark: ['videoKey'],
  veo3: ['imageKey', 'firstFrameKey', 'lastFrameKey'],
  muse_video: Array.from({ length: MUSE_VIDEO_MAX_IMAGES }, (_, i) => `imageKey${i}`),
};

/** Chỉ lộ các tham số người dùng chọn; không lộ giá, kích thước nội bộ. */
function pickDisplayParams(raw: unknown): TaskResultParams {
  const p = (raw ?? {}) as Record<string, unknown>;
  const out: TaskResultParams = {};
  for (const k of ['intensity', 'seconds', 'trimStart', 'trimEnd'] as const) {
    if (Number.isInteger(p[k])) out[k] = p[k] as number;
  }
  if (typeof p.aspectRatio === 'string') out.aspectRatio = p.aspectRatio;
  if (typeof p.prompt === 'string' && p.prompt.length > 0) out.prompt = p.prompt;
  if (typeof p.resolution === 'string') out.resolution = p.resolution;
  if (typeof p.mode === 'string') out.mode = p.mode;
  return out;
}

export interface SweepRow {
  id: string;
  user_id?: string;
  enqueue_attempts: number;
  priority: number;
  deadline_at: Date | null;
  prep_deadline_at: Date | null;
  gate_deadline: Date | null;
}

export class TaskLimitException extends HttpException {
  constructor() {
    super(
      { code: ApiErrorCode.TASK_LIMIT, message: getApiErrorMessageVi(ApiErrorCode.TASK_LIMIT) },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly uploads: UploadsService,
    @InjectQueue(TASKS_QUEUE) private readonly queue: Queue,
    private readonly redis: RedisService,
    private readonly pipelines: PipelinesService,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
  ) {}

  /**
   * Cửa duy nhất đổi trạng thái Task (compare-and-set). Trả applied=false khi Task không còn ở `from`.
   */
  async transition(
    taskId: string,
    from: TaskStatus,
    to: TaskStatus,
    reasonCode?: ReasonCode | null,
    opts: { resultKey?: string; gpuCoins?: number; orphanForMs?: number } = {},
  ): Promise<{ applied: boolean }> {
    assertValidTransition(from, to, reasonCode);
    const resultKey = opts.resultKey ?? null;
    const gpuCoins = opts.gpuCoins ?? null;
    const orphanMs = opts.orphanForMs ?? null;
    if (gpuCoins !== null && !Number.isInteger(gpuCoins)) throw new Error('gpuCoins phải là số nguyên');
    if (orphanMs !== null && !(Number.isInteger(orphanMs) && orphanMs >= 0)) {
      throw new Error('orphanForMs phải là số nguyên không âm');
    }
    const terminal = isTerminal(to);
    const toRunning = to === 'running';
    if (to === 'succeeded') {
      if (!resultKey || !/^out\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.mp4)?$/i.test(resultKey)) {
        throw new Error('Chuyển sang succeeded cần resultKey dạng out/<userId>/<uuid>[.mp4]');
      }
    } else if (resultKey !== null) {
      throw new Error('resultKey chỉ dùng khi chuyển sang succeeded');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; user_id: string }>>`
        UPDATE tasks
        SET status = ${to}, reason_code = ${reasonCode ?? null}, result_key = ${resultKey}, updated_at = now(),
          finished_at = CASE WHEN ${terminal}::boolean THEN now() ELSE finished_at END,
          running_at = CASE WHEN ${toRunning}::boolean THEN now() ELSE running_at END,
          prep_deadline_at = CASE WHEN ${toRunning}::boolean THEN now() + interval '120 seconds' ELSE prep_deadline_at END,
          gate_deadline = CASE WHEN ${toRunning}::boolean THEN now() + interval '15 minutes' ELSE gate_deadline END,
          gpu_coins = COALESCE(${gpuCoins}::int, gpu_coins),
          rh_orphan_until = CASE WHEN ${orphanMs}::int IS NOT NULL
            THEN now() + (${orphanMs}::int * interval '1 millisecond') ELSE rh_orphan_until END
        WHERE id = ${taskId}::uuid AND status = ${from}
        RETURNING id, user_id`;
      if (rows.length === 0) return { applied: false };
      if (resultKey !== null && !resultKey.startsWith(`out/${rows[0].user_id}/`)) {
        throw new Error('resultKey không thuộc chủ Task');
      }
      if (to === 'succeeded') await this.wallet.capture(tx, taskId);
      else if (to === 'failed' || to === 'timed_out' || to === 'cancelled') {
        await this.wallet.release(tx, taskId);
      }
      return { applied: true };
    });
    if (result.applied && isTerminal(to)) {
      // Chỉ là gợi ý nên không chờ: Redis treo không được làm trễ phản hồi sau khi DB đã commit.
      void this.redis.client.set(`task:terminal:${taskId}`, '1', 'EX', 30, 'NX').catch(() => {});
    }
    if (result.applied && isTerminal(to)) this.emitTerminal();
    return result;
  }

  private readonly terminalListeners: Array<() => Promise<unknown>> = [];

  /** Đăng ký bên nghe Task kết thúc (ops dùng cho ngắt mạch, tránh vòng phụ thuộc module). */
  onTerminal(listener: () => Promise<unknown>): void {
    this.terminalListeners.push(listener);
  }

  /** Phát tín hiệu sau commit; lỗi của bên nghe không bao giờ làm hỏng transition. Chờ được (bộ quét dùng). */
  emitTerminal(): Promise<void> {
    return Promise.all(
      this.terminalListeners.map((l) =>
        Promise.resolve()
          .then(l)
          .catch((err) => this.logger.error(`Bên nghe Task kết thúc lỗi: ${String(err)}`)),
      ),
    ).then(() => undefined);
  }

  /**
   * Số liệu cửa sổ cho ngắt mạch: chỉ Task có finished_at sau mốc reset. Mẫu số gồm succeeded và lỗi hệ thống;
   * lỗi do người dùng/nội dung/hủy/hết ngân sách bị loại và không cắt chuỗi lỗi liên tiếp.
   */
  async breakerWindowStats(
    windowMs: number,
    resetAt: Date | null,
  ): Promise<{ eligible: number; systemFailures: number; consecutiveFailures: number }> {
    const reasons = [...SYSTEM_FAILURE_REASONS];
    const rows = await this.prisma.$queryRaw<Array<{ failure: boolean }>>`
      SELECT (status <> 'succeeded') AS failure
      FROM tasks
      WHERE finished_at IS NOT NULL
        AND finished_at > now() - (${windowMs}::int * interval '1 millisecond')
        AND (${resetAt}::timestamptz IS NULL OR finished_at > ${resetAt}::timestamptz)
        AND (status = 'succeeded' OR (status IN ('failed','timed_out') AND reason_code = ANY(${reasons}::text[])))
      ORDER BY finished_at DESC, id`;
    let systemFailures = 0;
    let consecutiveFailures = 0;
    let streak = true;
    for (const r of rows) {
      if (r.failure) {
        systemFailures++;
        if (streak) consecutiveFailures++;
      } else streak = false;
    }
    return { eligible: rows.length, systemFailures, consecutiveFailures };
  }

  /** Thống kê Task theo pipeline trong [from, to] (created_at); `benchmark` chọn nhóm user của `userIds`. */
  async statsByPipeline(from: Date, to: Date, userIds: string[], benchmark: boolean): Promise<TaskPipelineStatsRow[]> {
    const reasons = [...SYSTEM_FAILURE_REASONS];
    const rows = await this.prisma.$queryRaw<Array<Omit<TaskPipelineStatsRow, 'counts' | 'by_instance'>>>`
      SELECT pipeline,
        SUM(ok)::int AS succeeded,
        SUM(sys_fail)::int AS system_failed,
        AVG(proc)::float8 AS avg_proc,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY proc)::float8 AS p95_proc,
        SUM(ok_cost)::float8 AS ok_cost,
        SUM(wasted)::float8 AS wasted_cost,
        SUM(ok_seconds)::float8 AS ok_seconds,
        SUM(all_cost)::float8 AS all_cost,
        COUNT(ok_cost)::int AS ok_cost_n,
        SUM(ok_seconds_costed)::float8 AS ok_seconds_costed,
        SUM(ok_credits_costed)::float8 AS ok_credits_costed
      FROM (
        SELECT pipeline,
          (status = 'succeeded')::int AS ok,
          (status IN ('failed','timed_out') AND reason_code = ANY(${reasons}::text[]))::int AS sys_fail,
          CASE WHEN status = 'succeeded' AND finished_at IS NOT NULL AND running_at IS NOT NULL
            THEN EXTRACT(EPOCH FROM (finished_at - running_at)) END AS proc,
          CASE WHEN status = 'succeeded' THEN cost_usd END AS ok_cost,
          CASE WHEN status IN ('failed','timed_out','cancelled') THEN COALESCE(cost_usd, 0) ELSE 0 END AS wasted,
          CASE WHEN status = 'succeeded' AND jsonb_typeof(params->'seconds') = 'number'
            THEN (params->>'seconds')::float8 ELSE 0 END AS ok_seconds,
          CASE WHEN status = 'succeeded' AND cost_usd IS NOT NULL AND jsonb_typeof(params->'seconds') = 'number'
            THEN (params->>'seconds')::float8 ELSE 0 END AS ok_seconds_costed,
          CASE WHEN status = 'succeeded' AND cost_usd IS NOT NULL THEN hold_amount ELSE 0 END AS ok_credits_costed,
          COALESCE(cost_usd, 0) AS all_cost
        FROM tasks
        WHERE created_at >= ${from}::timestamptz AND created_at <= ${to}::timestamptz
          AND ((user_id = ANY(${userIds}::uuid[])) = ${benchmark}::boolean)
      ) t
      GROUP BY pipeline`;
    const countRows = await this.prisma.$queryRaw<Array<{ pipeline: string; status: string; n: number }>>`
      SELECT pipeline, status, COUNT(*)::int AS n FROM tasks
      WHERE created_at >= ${from}::timestamptz AND created_at <= ${to}::timestamptz
        AND ((user_id = ANY(${userIds}::uuid[])) = ${benchmark}::boolean)
      GROUP BY pipeline, status`;
    const instRows = await this.prisma.$queryRaw<Array<{ pipeline: string; instance_type: string; tasks: number; cost_usd: number }>>`
      SELECT pipeline, COALESCE(instance_type, 'unknown') AS instance_type, COUNT(*)::int AS tasks,
        COALESCE(SUM(cost_usd), 0)::float8 AS cost_usd
      FROM tasks
      WHERE created_at >= ${from}::timestamptz AND created_at <= ${to}::timestamptz
        AND ((user_id = ANY(${userIds}::uuid[])) = ${benchmark}::boolean)
        AND instance_type IS NOT NULL
      GROUP BY pipeline, instance_type`;
    return rows.map((r) => {
      const counts: Record<string, number> = {};
      for (const c of countRows) if (c.pipeline === r.pipeline) counts[c.status] = c.n;
      const by_instance = instRows
        .filter((i) => i.pipeline === r.pipeline)
        .map((i) => ({ instance_type: i.instance_type, tasks: i.tasks, cost_usd: i.cost_usd }));
      return { ...r, counts, by_instance };
    });
  }

  /** Tập user (trong `userIds`) có ít nhất một Task. */
  async userIdsWithTasks(userIds: string[]): Promise<Set<string>> {
    if (userIds.length === 0) return new Set();
    const rows = await this.prisma.$queryRaw<Array<{ user_id: string }>>`
      SELECT DISTINCT user_id FROM tasks WHERE user_id = ANY(${userIds}::uuid[])`;
    return new Set(rows.map((r) => r.user_id));
  }

  /** Số tài khoản đã từng có Task. */
  async countUsersWithTasks(): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ n: number }>>`SELECT COUNT(DISTINCT user_id)::int AS n FROM tasks`;
    return rows[0]?.n ?? 0;
  }

  /** Bộ quét: Task queued quá `olderThanMs` kể từ queued_at. */
  async sweepQueued(olderThanMs: number, limit = 100) {
    return this.prisma.$queryRaw<SweepRow[]>`
      SELECT id, enqueue_attempts, (tier_snapshot->>'priority')::int AS priority,
        deadline_at, prep_deadline_at, gate_deadline
      FROM tasks
      WHERE status = 'queued' AND queued_at < now() - (${olderThanMs}::int * interval '1 millisecond')
      ORDER BY queued_at LIMIT ${limit}`;
  }

  /** Bộ quét: Task FREE (Priority của Tier Snapshot) queued quá `waitMs` kể từ queued_at. */
  async sweepFreeExpired(waitMs: number, limit = 100) {
    const freePriority = PRICING_CONFIG.tiers.find((t) => t.tier === 'FREE')!.priority;
    return this.prisma.$queryRaw<SweepRow[]>`
      SELECT id, user_id, enqueue_attempts, (tier_snapshot->>'priority')::int AS priority,
        deadline_at, prep_deadline_at, gate_deadline
      FROM tasks
      WHERE status = 'queued' AND (tier_snapshot->>'priority')::int = ${freePriority}::int
        AND queued_at < now() - (${waitMs}::int * interval '1 millisecond')
      ORDER BY queued_at LIMIT ${limit}`;
  }

  /** Bộ quét: Task running chưa qua cổng mà gate_deadline hoặc prep_deadline_at đã qua. */
  async sweepRunningExpired(limit = 100) {
    return this.prisma.$queryRaw<SweepRow[]>`
      SELECT id, enqueue_attempts, (tier_snapshot->>'priority')::int AS priority,
        deadline_at, prep_deadline_at, gate_deadline
      FROM tasks
      WHERE status = 'running' AND (deadline_at IS NULL
        AND (gate_deadline <= now() OR prep_deadline_at <= now())) IS TRUE
      ORDER BY running_at LIMIT ${limit}`;
  }

  /** Bộ quét: Task running chưa quá hạn (để kiểm tra job còn sống). */
  async sweepRunningLive(limit = 100) {
    return this.prisma.$queryRaw<SweepRow[]>`
      SELECT id, enqueue_attempts, (tier_snapshot->>'priority')::int AS priority,
        deadline_at, prep_deadline_at, gate_deadline
      FROM tasks
      WHERE status = 'running' AND (deadline_at IS NULL
        AND (gate_deadline <= now() OR prep_deadline_at <= now())) IS NOT TRUE
      ORDER BY running_at LIMIT ${limit}`;
  }

  /** Tăng enqueue_attempts khi Task còn queued. Trả true nếu áp dụng. */
  async bumpEnqueueAttempts(taskId: string): Promise<boolean> {
    const n = await this.prisma.$executeRaw`
      UPDATE tasks SET enqueue_attempts = enqueue_attempts + 1 WHERE id = ${taskId}::uuid AND status = 'queued'`;
    return n > 0;
  }

  /** Đọc Task cho worker (chỉ đọc). */
  async getWorkerRow(taskId: string) {
    return this.prisma.task.findUnique({ where: { id: taskId } });
  }

  /** Số slot RunningHub đang bị chiếm: Task running đã qua cổng + Task kết thúc còn orphan. */
  async countGateOccupied(): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*)::bigint AS n FROM tasks
      WHERE (status = 'running' AND deadline_at IS NOT NULL)
         OR (status IN ('succeeded','failed','timed_out','cancelled') AND rh_orphan_until > now())`;
    return Number(rows[0]?.n ?? 0n);
  }

  /** Đặt deadline_at = COALESCE(deadline_at, now()+ms) khi Task còn running. Trả true nếu Task còn running. */
  async setDeadlineIfNull(taskId: string, ms: number): Promise<boolean> {
    const n = await this.prisma.$executeRaw`
      UPDATE tasks SET deadline_at = COALESCE(deadline_at, now() + (${ms}::int * interval '1 millisecond')),
        updated_at = now()
      WHERE id = ${taskId}::uuid AND status = 'running'`;
    return n > 0;
  }

  /** Đặt submit_started_at một lần duy nhất; false nếu đã đặt hoặc Task không còn running. */
  async markSubmitStarted(taskId: string, instanceType: RunningHubInstanceType): Promise<boolean> {
    const n = await this.prisma.$executeRaw`
      UPDATE tasks SET submit_started_at = now(), instance_type = ${instanceType}, updated_at = now()
      WHERE id = ${taskId}::uuid AND status = 'running' AND submit_started_at IS NULL`;
    return n > 0;
  }

  /**
   * Ghi chi phí GPU thật khi RunningHub báo SUCCESS/FAILED (chỉ khi Task đang running).
   * Có costUsd hợp lệ: 'reported'. Ngược lại có costSeconds > 0 và Task có instance_type: 'estimated'. Không có gì: để NULL.
   * cost_seconds luôn được lưu nếu có.
   */
  async recordCost(taskId: string, cost: { costUsd?: number; costSeconds?: number }): Promise<boolean> {
    const secs =
      typeof cost.costSeconds === 'number' && Number.isFinite(cost.costSeconds) && cost.costSeconds > 0
        ? Math.round(cost.costSeconds)
        : null;
    const reported =
      typeof cost.costUsd === 'number' && Number.isFinite(cost.costUsd) && cost.costUsd >= 0 ? cost.costUsd : null;
    if (reported === null && secs === null) return false;
    const row = await this.prisma.task.findUnique({ where: { id: taskId }, select: { instanceType: true, status: true } });
    if (!row || row.status !== 'running') return false;
    let usd: number | null = null;
    let source: 'reported' | 'estimated' | null = null;
    if (reported !== null) {
      usd = reported;
      source = 'reported';
    } else {
      const est = estimateCostUsd(row.instanceType, secs);
      if (est !== undefined) {
        usd = est;
        source = 'estimated';
      }
    }
    const n = await this.prisma.$executeRaw`
      UPDATE tasks SET cost_usd = ${usd}::numeric, cost_source = ${source}, cost_seconds = ${secs}::int, updated_at = now()
      WHERE id = ${taskId}::uuid AND status = 'running'`;
    return n > 0;
  }

  async setRunninghubTaskId(taskId: string, rhId: string): Promise<boolean> {
    const n = await this.prisma.$executeRaw`
      UPDATE tasks SET runninghub_task_id = ${rhId}, updated_at = now()
      WHERE id = ${taskId}::uuid AND status = 'running' AND runninghub_task_id IS NULL`;
    return n > 0;
  }

  async cancel(userId: string, taskId: string): Promise<Task> {
    const row = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!row || row.userId !== userId) throw this.apiError(NotFoundException, ApiErrorCode.NOT_FOUND);
    if (row.status !== 'queued') throw this.apiError(ConflictException, ApiErrorCode.CONFLICT);
    const { applied } = await this.transition(taskId, 'queued', 'cancelled', 'USER_CANCEL');
    if (!applied) throw this.apiError(ConflictException, ApiErrorCode.CONFLICT);
    try {
      const job = await this.queue.getJob(taskId);
      await job?.remove();
    } catch (err) {
      this.logger.warn(`Không xóa được job của Task ${taskId}: ${String(err)}`);
    }
    return this.getById(userId, taskId);
  }

  /** Tra cứu Task cho Admin (kèm email chủ). */
  async findForAdmin(taskId: string) {
    return this.prisma.task.findUnique({ where: { id: taskId }, include: { user: { select: { email: true } } } });
  }

  /** Đặt files_removed_at = now() nếu còn null (CAS). Trả thời điểm hiện hành và `applied`. */
  async markFilesRemoved(taskId: string, client: PrismaService | PrismaTransactionClient = this.prisma): Promise<{ filesRemovedAt: Date; applied: boolean }> {
    const now = new Date();
    const r = await client.task.updateMany({ where: { id: taskId, filesRemovedAt: null }, data: { filesRemovedAt: now } });
    if (r.count > 0) return { filesRemovedAt: now, applied: true };
    const row = await client.task.findUnique({ where: { id: taskId }, select: { filesRemovedAt: true } });
    if (!row?.filesRemovedAt) throw this.apiError(NotFoundException, ApiErrorCode.NOT_FOUND);
    return { filesRemovedAt: row.filesRemovedAt, applied: false };
  }

  async getById(userId: string, taskId: string): Promise<Task> {
    const row = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!row || row.userId !== userId) throw this.apiError(NotFoundException, ApiErrorCode.NOT_FOUND);
    const queued = row.status === 'queued';
    return {
      id: row.id,
      pipeline: row.pipeline as Task['pipeline'],
      status: row.status as TaskStatus,
      reasonCode: (row.reasonCode as ReasonCode | null) ?? null,
      queuePosition: queued ? await this.queuePosition(row.id) : null,
      resultKey: row.resultKey ?? null,
      creditCost: row.holdAmount,
      filesRemovedAt: row.filesRemovedAt ? row.filesRemovedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async list(userId: string, query: TaskListQuery): Promise<TaskListResponse> {
    const pageSize = query.pageSize ?? 20;
    const cursor = query.cursor;

    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (cursor) {
      if (!UUID_REGEX.test(cursor)) {
        throw this.apiError(BadRequestException, ApiErrorCode.VALIDATION_FAILED);
      }
      const cursorOwner = await this.prisma.task.findFirst({
        where: { id: cursor, userId },
        select: { id: true },
      });
      if (!cursorOwner) {
        throw this.apiError(BadRequestException, ApiErrorCode.VALIDATION_FAILED);
      }
    }

    const range = vnDateRange(query.from, query.to);
    // Cột id kiểu uuid không hỗ trợ startsWith qua Prisma nên tra mã theo đầu UUID bằng SQL.
    let codeIds: string[] | undefined;
    if (query.code) {
      const rowsByCode = await this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id::text AS id FROM tasks WHERE user_id = ${userId}::uuid AND id::text LIKE ${query.code.toLowerCase() + '%'}`;
      codeIds = rowsByCode.map((r) => r.id);
    }
    const where = {
      userId,
      ...(query.pipeline ? { pipeline: query.pipeline } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(range.gte || range.lt ? { createdAt: range } : {}),
      ...(codeIds ? { id: { in: codeIds } } : {}),
    };

    let rows;
    let total: number;
    try {
      [rows, total] = await Promise.all([
        this.prisma.task.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: pageSize + 1,
          ...(cursor
            ? {
                cursor: { id: cursor },
                skip: 1,
              }
            : {}),
        }),
        this.prisma.task.count({ where }),
      ]);
    } catch (err) {
      if ((err as { code?: unknown }).code === 'P2025') {
        throw this.apiError(BadRequestException, ApiErrorCode.VALIDATION_FAILED);
      }
      throw err;
    }

    const hasMore = rows.length > pageSize;
    const items = hasMore ? rows.slice(0, pageSize) : rows;
    const nextCursor = hasMore && items.length > 0 ? items[items.length - 1].id : null;

    const mappedItems: Task[] = await Promise.all(
      items.map(async (row) => {
        const queued = row.status === 'queued';
        let queuePos: number | null = null;
        if (queued) {
          try {
            queuePos = await this.queuePosition(row.id);
          } catch {
            queuePos = 1;
          }
        }
        return {
          id: row.id,
          pipeline: row.pipeline as Task['pipeline'],
          status: row.status as TaskStatus,
          reasonCode: (row.reasonCode as ReasonCode | null) ?? null,
          queuePosition: queuePos,
          resultKey: row.resultKey ?? null,
          creditCost: row.holdAmount,
          filesRemovedAt: row.filesRemovedAt ? row.filesRemovedAt.toISOString() : null,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        };
      }),
    );

    return {
      items: mappedItems,
      pageSize,
      hasMore,
      total,
      nextCursor,
    };
  }

  /** URL ký ngắn hạn tới kết quả và (nếu còn) ảnh gốc. Không bao giờ trả link RunningHub. */
  async getResult(userId: string, taskId: string): Promise<TaskResultResponse> {
    const row = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!row || row.userId !== userId) throw this.apiError(NotFoundException, ApiErrorCode.NOT_FOUND);
    if (row.filesRemovedAt) {
      throw new ConflictException({ code: ApiErrorCode.CONFLICT, message: CONTENT_REMOVED_MESSAGE_VI });
    }
    if (row.status !== 'succeeded' || !row.resultKey) {
      throw this.apiError(ConflictException, ApiErrorCode.CONFLICT);
    }
    const resultUrl = await this.storage.presignGet(row.resultKey, RESULT_URL_TTL_SECONDS);
    const [inputs, params] = [await this.presignInputs(taskId, row.pipeline, row.inputKeys), pickDisplayParams(row.params)];

    if (row.resultKey.endsWith('.mp4')) {
      const seconds = ((row.params ?? {}) as Record<string, unknown>).seconds;
      if (!Number.isInteger(seconds) || (seconds as number) <= 0) {
        throw new Error(`Task ${taskId} thiếu params.seconds hợp lệ`);
      }
      const posterUrl = await this.storage.presignGet(row.resultKey.replace(/\.mp4$/, '.jpg'), RESULT_URL_TTL_SECONDS);
      return { mediaType: 'video', resultUrl, sourceUrl: null, posterUrl, durationSeconds: seconds as number, inputs, params };
    }

    let sourceUrl: string | null = null;
    const refKey = this.pipelines.getConfig(row.pipeline)?.referenceInputKey;
    const refInput = refKey ? inputs.find((i) => i.role === refKey) : undefined;
    if (refInput) sourceUrl = refInput.url;
    return { resultUrl, sourceUrl, inputs, params };
  }

  /** URL ký cho các đầu vào còn lưu (đã quá hạn dọn dẹp thì bỏ qua, không báo lỗi). */
  private async presignInputs(
    taskId: string,
    pipeline: string,
    inputKeys: unknown,
  ): Promise<TaskResultInput[]> {
    const keys = (inputKeys ?? {}) as Record<string, string | undefined>;
    const order = INPUT_DISPLAY_ORDER[pipeline] ?? Object.keys(keys);
    const out: TaskResultInput[] = [];
    for (const role of order) {
      const key = keys[role];
      if (!key) continue;
      try {
        if (!(await this.storage.head(key))) continue;
        out.push({
          role,
          mediaType: role === 'videoKey' ? 'video' : 'image',
          url: await this.storage.presignGet(key, RESULT_URL_TTL_SECONDS),
        });
      } catch (err) {
        this.logger.warn(`Không ký được đầu vào ${role} của Task ${taskId}: ${String(err)}`);
      }
    }
    return out;
  }

  private apiError(
    Ctor: new (body: { code: ApiErrorCode; message: string }) => Error,
    code: ApiErrorCode,
  ): Error {
    return new Ctor({ code, message: getApiErrorMessageVi(code) });
  }

  async createFaceSwap(userId: string, req: FaceSwapCreateRequest): Promise<Task> {
    return this.createPipelineTask(userId, {
      pipeline: 'face_swap',
      amount: PRICING_CONFIG.pipelines.faceSwapCredits,
      inputKeys: { sourceKey: req.sourceKey, targetKey: req.targetKey },
      params: {},
    });
  }

  async createOutfitChange(userId: string, req: OutfitChangeCreateRequest): Promise<Task> {
    if (req.modelKey === req.clothingKey) {
      throw new BadRequestException({
        code: ApiErrorCode.VALIDATION_FAILED,
        message: getApiErrorMessageVi(ApiErrorCode.VALIDATION_FAILED),
      });
    }
    return this.createPipelineTask(userId, {
      pipeline: 'outfit_change',
      amount: PRICING_CONFIG.pipelines.outfitChangeCredits,
      inputKeys: { modelKey: req.modelKey, clothingKey: req.clothingKey },
      params: {},
    });
  }

  async createBodyRetouch(userId: string, req: BodyRetouchCreateRequest): Promise<Task> {
    // Phòng thủ: parse lại để áp mặc định intensity=5 và chặn giá trị sai khi gọi từ nơi khác controller.
    const parsed = BodyRetouchCreateRequestSchema.safeParse(req);
    if (!parsed.success) {
      throw new BadRequestException({
        code: ApiErrorCode.VALIDATION_FAILED,
        message: getApiErrorMessageVi(ApiErrorCode.VALIDATION_FAILED),
      });
    }
    return this.createPipelineTask(userId, {
      pipeline: 'body_retouch',
      amount: PRICING_CONFIG.pipelines.bodyRetouchCredits,
      inputKeys: { imageKey: parsed.data.imageKey },
      params: { intensity: parsed.data.intensity },
    });
  }

  private trimError(reason: ValidationReason, cap?: number): BadRequestException {
    return new BadRequestException({
      code: ApiErrorCode.VALIDATION_FAILED,
      message: getValidationReasonMessageVi(reason, cap),
      details: { reason, ...(cap !== undefined ? { cap } : {}) },
    });
  }

  async createMotionControl(userId: string, req: MotionCreateRequest): Promise<MotionCreateResponse> {
    const frame = getMotionAspectRatio(req.aspectRatio ?? MOTION_ASPECT_RATIO_DEFAULT);
    const prompt = (req.prompt ?? '').trim();
    const task = await this.createMotionTask(userId, 'motion_control', req, {
      aspectRatio: frame.id,
      width: frame.width,
      height: frame.height,
      prompt,
    });
    return task as MotionCreateResponse;
  }

  /** Motion Control v2: cùng cách tính giá/Trim, không có khung hình và prompt. */
  async createMotionControlV2(userId: string, req: MotionV2CreateRequest): Promise<MotionV2CreateResponse> {
    const task = await this.createMotionTask(userId, 'motion_control_v2', req, {});
    return task as MotionV2CreateResponse;
  }

  /** Xóa watermark/logo/phụ đề: chỉ video đã cắt; giá = đơn giá × số giây; Cap = min(giới hạn chức năng, Cap Tier). */
  async createRemoveWatermark(userId: string, req: RemoveWatermarkCreateRequest): Promise<RemoveWatermarkCreateResponse> {
    const { videoKey, trimStart, trimEnd } = req;
    const prompt = (req.prompt ?? '').trim();
    if (!Number.isInteger(trimStart) || !Number.isInteger(trimEnd)) {
      throw this.trimError('TRIM_NOT_WHOLE_SECOND');
    }
    const durationSeconds = await this.uploads.getConfirmedVideoDuration(userId, videoKey);
    if (durationSeconds === null) {
      throw new BadRequestException({
        code: ApiErrorCode.VALIDATION_FAILED,
        message: getApiErrorMessageVi(ApiErrorCode.VALIDATION_FAILED),
      });
    }
    if (trimStart < 0 || trimEnd > durationSeconds) throw this.trimError('TRIM_OUT_OF_VIDEO');
    const seconds = trimEnd - trimStart;
    if (seconds < REMOVE_WATERMARK_MIN_SECONDS) throw this.trimError('TRIM_TOO_SHORT');
    const price = removeWatermarkPrice(seconds);
    const task = await this.createPipelineTask(userId, {
      pipeline: 'remove_watermark',
      amount: price,
      inputKeys: { videoKey },
      params: { trimStart, trimEnd, seconds, price, ...(prompt ? { prompt } : {}) },
      keysVerified: true,
      // Giới hạn riêng của chức năng (không theo Cap Tier); kiểm tra trong transaction để rollback cả HOLD.
      postHold: () => {
        const cap = removeWatermarkCapSeconds();
        if (seconds > cap) throw this.trimError('TRIM_EXCEEDS_CAP', cap);
      },
    });
    return { ...task, pipeline: 'remove_watermark', price } as RemoveWatermarkCreateResponse;
  }

  /** Veo 3: giá theo độ phân giải; số ảnh đầu vào theo chế độ (0-2); luôn 8 giây. */
  async createVeo3(userId: string, req: Veo3CreateRequest): Promise<Veo3CreateResponse> {
    // `req` đã qua Veo3CreateRequestSchema ở controller; không parse lại.
    const parsed = req;
    const inputKeys: Record<string, string> = {};
    if (parsed.mode === 'image_to_video') inputKeys.imageKey = parsed.imageKey;
    if (parsed.mode === 'frames_to_video') {
      inputKeys.firstFrameKey = parsed.firstFrameKey;
      if (parsed.lastFrameKey) inputKeys.lastFrameKey = parsed.lastFrameKey;
    }
    // Khung đầu và khung cuối được phép trùng nhau (video loop); kiểm tra sở hữu tự khử khóa trùng.
    const keys = Object.values(inputKeys);
    const price = veo3Price(parsed.resolution);
    const task = await this.createPipelineTask(userId, {
      pipeline: 'veo3',
      amount: price,
      inputKeys,
      params: {
        mode: parsed.mode,
        prompt: parsed.prompt,
        aspectRatio: parsed.aspectRatio,
        resolution: parsed.resolution,
        seconds: VEO3_DURATION_SECONDS,
        price,
      },
      // Text-to-video không có ảnh: bỏ qua kiểm tra sở hữu (danh sách rỗng).
      keysVerified: keys.length === 0,
    });
    return { ...task, pipeline: 'veo3', price } as Veo3CreateResponse;
  }

  /** Muse Video: giá cố định; 1-9 ảnh tham chiếu (tổng <= 11 MB) giữ thứ tự qua khóa imageKey0..8; luôn ~10 giây 720p. */
  async createMuseVideo(userId: string, req: MuseVideoCreateRequest): Promise<MuseVideoCreateResponse> {
    // `req` đã qua MuseVideoCreateRequestSchema ở controller (1-9 khóa không trùng, prompt đã trim).
    const inputKeys: Record<string, string> = {};
    req.imageKeys.forEach((key, i) => {
      inputKeys[`imageKey${i}`] = key;
    });
    const totalBytes = await this.uploads.getConfirmedImagesTotalBytes(userId, req.imageKeys);
    if (totalBytes === null) {
      throw new BadRequestException({
        code: ApiErrorCode.VALIDATION_FAILED,
        message: getApiErrorMessageVi(ApiErrorCode.VALIDATION_FAILED),
      });
    }
    if (totalBytes > MUSE_VIDEO_MAX_TOTAL_BYTES) {
      throw new BadRequestException({
        code: ApiErrorCode.VALIDATION_FAILED,
        message: `Tổng dung lượng ảnh tham chiếu vượt quá giới hạn ${MUSE_VIDEO_MAX_TOTAL_BYTES / (1024 * 1024)} MB. Vui lòng bỏ bớt ảnh hoặc dùng ảnh nhẹ hơn.`,
      });
    }
    const price = MUSE_VIDEO_PRICE;
    const task = await this.createPipelineTask(userId, {
      pipeline: 'muse_video',
      amount: price,
      inputKeys,
      params: {
        prompt: req.prompt,
        ...(req.aspectRatio ? { aspectRatio: req.aspectRatio } : {}),
        resolution: MUSE_VIDEO_RESOLUTION,
        imageCount: req.imageKeys.length,
        seconds: MUSE_VIDEO_DURATION_SECONDS,
        price,
      },
      keysVerified: true,
    });
    return { ...task, pipeline: 'muse_video', price } as MuseVideoCreateResponse;
  }

  private async createMotionTask(
    userId: string,
    pipeline: 'motion_control' | 'motion_control_v2',
    req: { characterKey: string; videoKey: string; trimStart: number; trimEnd: number },
    extraParams: Record<string, unknown>,
  ) {
    const { characterKey, videoKey, trimStart, trimEnd } = req;
    if (!Number.isInteger(trimStart) || !Number.isInteger(trimEnd)) {
      throw this.trimError('TRIM_NOT_WHOLE_SECOND');
    }
    const invalid = () =>
      new BadRequestException({
        code: ApiErrorCode.VALIDATION_FAILED,
        message: getApiErrorMessageVi(ApiErrorCode.VALIDATION_FAILED),
      });
    if (characterKey === videoKey) throw invalid();
    const [imageOk, durationSeconds] = await Promise.all([
      this.uploads.areConfirmedKeysOwnedBy(userId, [characterKey], 'image'),
      this.uploads.getConfirmedVideoDuration(userId, videoKey),
    ]);
    if (!imageOk || durationSeconds === null) throw invalid();
    if (trimStart < 0 || trimEnd > durationSeconds) throw this.trimError('TRIM_OUT_OF_VIDEO');
    const seconds = trimEnd - trimStart;
    if (seconds < MOTION_MIN_TRIM_SECONDS) throw this.trimError('TRIM_TOO_SHORT');
    const price = motionPrice(seconds, pipeline);
    const task = await this.createPipelineTask(userId, {
      pipeline,
      amount: price,
      inputKeys: { characterKey, videoKey },
      params: { trimStart, trimEnd, seconds, price, ...extraParams },
      keysVerified: true,
      postHold: (snapshot) => {
        // Cap = min(giới hạn của chức năng, Cap Tier Snapshot do ví đọc trong transaction); ném lỗi để rollback cả HOLD.
        const tierCap = snapshot.maxVideoSeconds;
        if (!Number.isFinite(tierCap) || tierCap < MOTION_MIN_TRIM_SECONDS) {
          throw new Error(`Cap Tier Snapshot không hợp lệ: ${String(tierCap)}`);
        }
        const cap = motionCapSeconds(pipeline, tierCap);
        if (seconds > cap) {
          throw this.trimError('TRIM_EXCEEDS_CAP', cap);
        }
      },
    });
    return { ...task, pipeline, price };
  }

  private async createPipelineTask(
    userId: string,
    spec: {
      pipeline: 'face_swap' | 'outfit_change' | 'body_retouch' | 'motion_control' | 'motion_control_v2' | 'veo3' | 'muse_video' | 'remove_watermark';
      amount: number;
      inputKeys: Record<string, string>;
      params: Record<string, unknown>;
      keysVerified?: boolean;
      postHold?: (snapshot: TierSnapshot) => void;
    },
  ): Promise<Task> {
    if (!spec.keysVerified) {
      const owned = await this.uploads.areConfirmedKeysOwnedBy(userId, Object.values(spec.inputKeys));
      if (!owned) {
        throw new BadRequestException({
          code: ApiErrorCode.VALIDATION_FAILED,
          message: getApiErrorMessageVi(ApiErrorCode.VALIDATION_FAILED),
        });
      }
    }

    const taskId = crypto.randomUUID();
    const amount = spec.amount;

    const { snapshot, task } = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ tos_version: string; locked_at: Date | null; tier_pack: string | null }>>`
        SELECT tos_version, locked_at, tier_pack FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
      if (rows.length !== 1) {
        throw new BadRequestException({
          code: ApiErrorCode.VALIDATION_FAILED,
          message: getApiErrorMessageVi(ApiErrorCode.VALIDATION_FAILED),
        });
      }
      if (rows[0].locked_at !== null) throw new AccountLockedException();
      const active = await tx.task.count({
        where: { userId, status: { in: ['queued', 'running'] } },
      });
      const tierCfg = PRICING_CONFIG.tiers.find((t) => t.tier === tierFromPack(rows[0].tier_pack))!;
      if (active >= tierCfg.maxActiveTasks) throw new TaskLimitException();

      const snapshot: TierSnapshot = await this.wallet.hold(tx, userId, taskId, amount);
      spec.postHold?.(snapshot);
      const task = await tx.task.create({
        data: {
          id: taskId,
          userId,
          pipeline: spec.pipeline,
          status: 'queued',
          tierSnapshot: snapshot as unknown as object,
          consent: true, // đã đồng ý ToS một lần lúc đăng nhập
          tosVersion: rows[0].tos_version,
          inputKeys: spec.inputKeys,
          params: spec.params as object,
          holdAmount: amount,
        },
      });
      return { snapshot, task };
    });

    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.queue.add(
          'process',
          { taskId },
          {
            jobId: taskId,
            priority: snapshot.priority,
            removeOnComplete: true,
            removeOnFail: true,
          },
        ),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`enqueue quá ${ENQUEUE_TIMEOUT_MS}ms`)),
            ENQUEUE_TIMEOUT_MS,
          );
        }),
      ]);
    } catch (err) {
      this.logger.error(`Không enqueue được Task ${taskId}: ${String(err)}`);
    } finally {
      clearTimeout(timer);
    }

    let queuePosition = 1;
    try {
      queuePosition = await this.queuePosition(taskId);
    } catch (err) {
      this.logger.warn(`Không tính được vị trí hàng đợi của Task ${taskId}: ${String(err)}`);
    }
    return {
      id: task.id,
      pipeline: spec.pipeline,
      status: 'queued',
      queuePosition,
      creditCost: task.holdAmount,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
    };
  }

  /** Vị trí (bắt đầu từ 1) theo (priority, queued_at, id) trong số Task queued, so với chính dòng trong DB. */
  private async queuePosition(taskId: string): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*)::bigint AS n FROM tasks t
      WHERE t.status = 'queued'
        AND ((t.tier_snapshot->>'priority')::int, t.queued_at, t.id)
          <= (SELECT (r.tier_snapshot->>'priority')::int, r.queued_at, r.id FROM tasks r WHERE r.id = ${taskId}::uuid)`;
    return Math.max(1, Number(rows[0]?.n ?? 1n));
  }
}
