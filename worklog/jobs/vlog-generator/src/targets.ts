import { buildVlogId, type BusinessDate, type VlogDoc } from "@worklog/shared";

/**
 * 生成対象のログの列挙と、「作り直すべきか」の判定。
 * Firestore を触らない形にしてテストできるようにしてある。
 */

export interface LogTarget {
  scope: "department" | "personal";
  targetId: string;
  vlogId: string;
  /** このログに含まれるメンバー */
  memberIds: string[];
  /** 部署ログのときだけ。実効設定の解決に使う */
  departmentId: string | null;
}

export function buildLogTargets(params: {
  businessDate: BusinessDate;
  departments: readonly { id: string }[];
  users: readonly { id: string; departmentIds: string[]; status: string }[];
}): LogTarget[] {
  const activeUsers = params.users.filter((u) => u.status === "active");
  const targets: LogTarget[] = [];

  // 部署ログ (F-201)。所属＝参加なので招待コードのような概念は無い
  for (const dept of params.departments) {
    const memberIds = activeUsers
      .filter((u) => u.departmentIds.includes(dept.id))
      .map((u) => u.id);
    if (memberIds.length === 0) continue;
    targets.push({
      scope: "department",
      targetId: dept.id,
      vlogId: buildVlogId("department", dept.id, params.businessDate),
      memberIds,
      departmentId: dept.id,
    });
  }

  // 個人ログ (F-202)。全メンバーが自動で1つ持つ
  for (const user of activeUsers) {
    targets.push({
      scope: "personal",
      targetId: user.id,
      vlogId: buildVlogId("personal", user.id, params.businessDate),
      memberIds: [user.id],
      departmentId: user.departmentIds[0] ?? null,
    });
  }

  return targets;
}

export type GenerateDecision =
  | { generate: true; reason: "new" | "regenerate" | "retryFailed" | "forced" }
  | { generate: false; reason: "alreadyReady" | "inProgress" };

/**
 * 既存の Vlog を見て作り直すか決める。
 *
 * - 生成済みで再生成要求も無ければ作らない（夜間バッチが二重に走っても無駄が出ない）
 * - `regenerateRequestedAt` が立っていれば作り直す。本人の削除で立つ (F-905)
 * - 前回失敗していれば作り直す
 * - `generating` のまま止まっているものは、一定時間を過ぎたら引き取る
 */
export function decideGeneration(params: {
  existing: Pick<VlogDoc, "status" | "generatedAt" | "regenerateRequestedAt"> | null;
  now: Date;
  /** generating のまま放置されたとみなすまでの分数 */
  staleAfterMin?: number;
  force?: boolean;
}): GenerateDecision {
  const { existing, now, force } = params;
  const staleAfterMin = params.staleAfterMin ?? 60;

  if (force) return { generate: true, reason: "forced" };
  if (!existing) return { generate: true, reason: "new" };

  if (existing.regenerateRequestedAt) {
    const requestedAt = existing.regenerateRequestedAt.toMillis();
    const generatedAt = existing.generatedAt?.toMillis() ?? 0;
    // 再生成要求の後に生成し直していれば、もう作り直す必要はない
    if (requestedAt > generatedAt) return { generate: true, reason: "regenerate" };
  }

  switch (existing.status) {
    case "ready":
      return { generate: false, reason: "alreadyReady" };
    case "failed":
      return { generate: true, reason: "retryFailed" };
    case "pending":
      return { generate: true, reason: "new" };
    case "generating": {
      const startedAt = existing.generatedAt?.toMillis() ?? 0;
      const stale = now.getTime() - startedAt > staleAfterMin * 60_000;
      return stale
        ? { generate: true, reason: "retryFailed" }
        : { generate: false, reason: "inProgress" };
    }
  }
}

/**
 * Cloud Run Jobs の並列実行でログを分担する（設計書 7.1「ログ単位でタスク分割」）。
 * CLOUD_RUN_TASK_INDEX / CLOUD_RUN_TASK_COUNT をそのまま渡す。
 */
export function selectShard<T>(items: readonly T[], taskIndex: number, taskCount: number): T[] {
  if (taskCount < 1) throw new Error(`invalid taskCount: ${taskCount}`);
  if (taskIndex < 0 || taskIndex >= taskCount) {
    throw new Error(`invalid taskIndex: ${taskIndex} (taskCount=${taskCount})`);
  }
  return items.filter((_, i) => i % taskCount === taskIndex);
}
