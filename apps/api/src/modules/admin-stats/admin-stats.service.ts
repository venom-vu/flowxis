import { Injectable } from "@nestjs/common";
import {
  MOTION_PRICING,
  TASK_PIPELINES,
  TASK_STATUSES,
  type MotionPipeline,
  REMOVE_WATERMARK_CREDITS_PER_SECOND,
  type AdminStatsMargin,
  type AdminStatsPipeline,
  type AdminStatsQuery,
  type AdminStatsResponse,
  type TaskPipeline,
} from "@flowxis/contracts";
import { AuthService } from "../auth/auth.service.js";
import {
  TasksService,
  type TaskPipelineStatsRow,
} from "../tasks/tasks.service.js";
import { TopupsService } from "../topups/topups.service.js";
import { PRICING_CONFIG } from "../wallet/tier.js";
import { FxRateService } from "./fx-rate.service.js";

const CONVERSION_DAYS = 30;

const EMPTY_ROW = (pipeline: string): TaskPipelineStatsRow => ({
  pipeline,
  counts: {},
  succeeded: 0,
  system_failed: 0,
  avg_proc: null,
  p95_proc: null,
  ok_cost: null,
  wasted_cost: null,
  ok_seconds: null,
  all_cost: null,
  ok_cost_n: 0,
  ok_seconds_costed: null,
  ok_credits_costed: null,
  by_instance: [],
});

export function parseBenchmarkEmails(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

@Injectable()
export class AdminStatsService {
  constructor(
    private readonly tasks: TasksService,
    private readonly topups: TopupsService,
    private readonly auth: AuthService,
    private readonly fx: FxRateService,
  ) {}

  async compute(q: AdminStatsQuery): Promise<AdminStatsResponse> {
    const usdVnd = await this.fx.getUsdVnd();
    const from = new Date(q.from);
    const to = new Date(q.to);
    const benchmark = q.scope === "benchmark";
    const benchIds = await this.auth.findUserIdsByEmails(
      parseBenchmarkEmails(process.env.BENCHMARK_USER_EMAILS),
    );

    const [rows, approvedTopups, accounts] = await Promise.all([
      this.tasks.statsByPipeline(from, to, benchIds, benchmark),
      this.topups.countApproved(from, to, benchIds, benchmark),
      this.auth.listUsersCreatedBetween(from, to, benchIds, benchmark),
    ]);

    const withTasks = await this.tasks.userIdsWithTasks(
      accounts.map((a) => a.id),
    );
    const cohort = accounts.filter((a) => withTasks.has(a.id));
    const converted = await this.topups.accountsWithApprovedWithin(
      cohort,
      CONVERSION_DAYS,
    );
    const conversionRate =
      cohort.length === 0 ? null : converted.size / cohort.length;

    const byPipeline = new Map(rows.map((r) => [r.pipeline, r]));
    const pipelines: AdminStatsPipeline[] = [];
    const margins: AdminStatsMargin[] = [];
    let totalCost = 0;

    for (const pipeline of TASK_PIPELINES as readonly TaskPipeline[]) {
      const r = byPipeline.get(pipeline) ?? EMPTY_ROW(pipeline);
      totalCost += r.all_cost ?? 0;
      const taskCounts = Object.fromEntries(
        TASK_STATUSES.map((s) => [s, r.counts[s] ?? 0]),
      ) as AdminStatsPipeline["taskCounts"];
      const denom = r.succeeded + r.system_failed;
      const okCost = r.ok_cost ?? 0;
      // AVG bỏ qua Task chưa có cost_usd (NULL).
      const avgUsd = r.ok_cost_n > 0 ? okCost / r.ok_cost_n : null;
      pipelines.push({
        pipeline,
        taskCounts,
        successRate: denom === 0 ? null : r.succeeded / denom,
        avgProcessingSeconds: r.avg_proc,
        p95ProcessingSeconds: r.p95_proc,
        avgCostUsd: avgUsd,
        wastedCostUsd: r.wasted_cost ?? 0,
        avgCostVnd: avgUsd === null ? null : avgUsd * usdVnd,
        costByInstanceType: r.by_instance.map((i) => ({
          instanceType: i.instance_type,
          tasks: i.tasks,
          costUsd: i.cost_usd,
        })),
      });

      // Biên gộp: chỉ khi có chi phí thật để tính.
      if (r.ok_cost_n === 0) continue;
      const isMotion =
        pipeline === "motion_control" ||
        pipeline === "motion_control_v2";
      let unitUsd: number;
      let unitCredits: number;
      if (isMotion) {
        const secs = r.ok_seconds_costed ?? 0;
        if (secs <= 0) continue;
        // Giá có phí cố định nên so sánh theo Task: chi phí TB một Task với doanh thu của Task dài trung bình.
        const avgSeconds = secs / r.ok_cost_n;
        unitUsd = okCost / r.ok_cost_n;
        const { baseCredits, creditsPerSecond } = MOTION_PRICING[pipeline as MotionPipeline];
        unitCredits =
          q.motionPricePerSecond !== undefined
            ? q.motionPricePerSecond * avgSeconds
            : baseCredits + creditsPerSecond * avgSeconds;
      } else if (pipeline === "remove_watermark") {
        const secs = r.ok_seconds_costed ?? 0;
        if (secs <= 0) continue;
        unitUsd = okCost / r.ok_cost_n;
        unitCredits = (REMOVE_WATERMARK_CREDITS_PER_SECOND * secs) / r.ok_cost_n;
      } else if (pipeline === "veo3" || pipeline === "muse_video") {
        // Pipeline tính theo lượt có giá riêng: doanh thu là credit thực thu (hold_amount) trung bình, không lấy giá hiện hành.
        unitUsd = okCost / r.ok_cost_n;
        unitCredits = (r.ok_credits_costed ?? 0) / r.ok_cost_n;
      } else {
        unitUsd = okCost / r.ok_cost_n;
        unitCredits =
          q.imagePrice ??
          (pipeline === "face_swap"
            ? PRICING_CONFIG.pipelines.faceSwapCredits
            : pipeline === "outfit_change"
              ? PRICING_CONFIG.pipelines.outfitChangeCredits
              : PRICING_CONFIG.pipelines.bodyRetouchCredits);
      }
      const costVnd = unitUsd * usdVnd;
      for (const pack of PRICING_CONFIG.topupPacks) {
        const revenuePer100 = (pack.priceVnd / pack.credits) * 100;
        const revenueVnd = (revenuePer100 * unitCredits) / 100;
        const marginVnd = revenueVnd - costVnd;
        margins.push({
          pipeline,
          pack: pack.id,
          revenueVnd,
          costVnd,
          marginVnd,
          marginRate: revenueVnd === 0 ? null : marginVnd / revenueVnd,
        });
      }
    }

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      scope: q.scope,
      pipelines,
      margins,
      successMetrics: {
        approvedTopups,
        conversionRate,
        gpuCostUsd: totalCost,
      },
    };
  }
}
