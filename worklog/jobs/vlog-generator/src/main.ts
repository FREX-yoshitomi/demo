import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  fsPath,
  listSlotKeys,
  resolveBusinessDate,
  resolveEffectiveSettings,
  storagePath,
  type BusinessDate,
  type CaptureDoc,
  type DepartmentDoc,
  type TenantDoc,
  type UserDoc,
  type VlogDoc,
  type VlogPage,
} from "@worklog/shared";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { bucket, db, downloadObject, messaging, uploadObject } from "./gcp";
import { buildVlogPlan, hasRenderableContent, type PlanCapture } from "./plan";
import { pageNumber, renderPage } from "./render";
import { buildLogTargets, decideGeneration, selectShard, type LogTarget } from "./targets";

/**
 * vlog-generator（設計書 7.1 / F-306〜311, F-905）。
 *
 * Cloud Run Jobs として 23:00 JST に起動し、翌朝 7:00 までに全ログを生成する。
 * 並列実行するときは CLOUD_RUN_TASK_INDEX / CLOUD_RUN_TASK_COUNT でログを分担する。
 *
 * 環境変数
 *   TENANT_ID      省略時は active な全テナント
 *   BUSINESS_DATE  省略時はテナントのタイムゾーンで解釈した「いま」の業務日。
 *                  朝に再実行するときは明示すること（業務日が変わってしまうため）
 *   FORCE          "true" で生成済みでも作り直す
 *   VLOG_FONT_FILE 焼き込みに使う CJK フォント
 *   FFMPEG_PATH    既定 /usr/bin/ffmpeg
 */

const FFMPEG_PATH = process.env.FFMPEG_PATH ?? "/usr/bin/ffmpeg";
const FONT_FILE =
  process.env.VLOG_FONT_FILE ?? "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc";
const CONCURRENCY = Number(process.env.VLOG_CONCURRENCY ?? "4");

interface JobResult {
  generated: number;
  skipped: number;
  failed: number;
}

function log(message: string, fields: Record<string, unknown> = {}): void {
  // 構造化ログ。動画の中身・memo 本文は出さない（設計書 第10章）
  console.log(JSON.stringify({ severity: "INFO", message, ...fields }));
}

function logError(message: string, fields: Record<string, unknown> = {}): void {
  console.error(JSON.stringify({ severity: "ERROR", message, ...fields }));
}

async function listTenantIds(): Promise<string[]> {
  const explicit = process.env.TENANT_ID;
  if (explicit) return [explicit];
  const snap = await db().collection("tenants").where("status", "==", "active").get();
  return snap.docs.map((d) => d.id);
}

export async function generateForTenant(
  tenantId: string,
  options: { businessDate?: BusinessDate; force?: boolean } = {},
): Promise<JobResult> {
  const firestore = db();
  const result: JobResult = { generated: 0, skipped: 0, failed: 0 };

  const tenantSnap = await firestore.doc(fsPath.tenant(tenantId)).get();
  if (!tenantSnap.exists) {
    logError("tenant not found", { tenantId });
    return result;
  }
  const tenant = tenantSnap.data() as TenantDoc;

  const [deptSnap, userSnap] = await Promise.all([
    firestore.collection(fsPath.departments(tenantId)).get(),
    firestore.collection(fsPath.users(tenantId)).get(),
  ]);

  const departments = new Map<string, DepartmentDoc>();
  for (const d of deptSnap.docs) departments.set(d.id, d.data() as DepartmentDoc);

  const users = userSnap.docs.map((d) => ({ id: d.id, ...(d.data() as UserDoc) }));
  const userById = new Map(users.map((u) => [u.id, u]));

  const businessDate =
    options.businessDate ??
    resolveBusinessDate(new Date(), tenant.timezone, tenant.workingHours);

  const allTargets = buildLogTargets({
    businessDate,
    departments: deptSnap.docs.map((d) => ({ id: d.id })),
    users: users.map((u) => ({
      id: u.id,
      departmentIds: u.departmentIds,
      status: u.status,
    })),
  });

  const taskIndex = Number(process.env.CLOUD_RUN_TASK_INDEX ?? "0");
  const taskCount = Number(process.env.CLOUD_RUN_TASK_COUNT ?? "1");
  const targets = selectShard(allTargets, taskIndex, taskCount);

  log("vlog generation started", {
    tenantId,
    businessDate,
    targets: targets.length,
    totalTargets: allTargets.length,
    taskIndex,
    taskCount,
  });

  // 業務日ぶんの撮影を1回だけ読む（ログごとに読み直さない）
  const capturesSnap = await firestore
    .collection(fsPath.captures(tenantId))
    .where("businessDate", "==", businessDate)
    .get();
  const captures = capturesSnap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as CaptureDoc),
  }));

  for (const target of targets) {
    try {
      const generated = await generateOne({
        tenantId,
        tenant,
        businessDate,
        target,
        captures,
        userById,
        departments,
        force: options.force ?? false,
      });
      if (generated) result.generated += 1;
      else result.skipped += 1;
    } catch (err) {
      result.failed += 1;
      logError("vlog generation failed", {
        tenantId,
        vlogId: target.vlogId,
        error: err instanceof Error ? err.message : String(err),
      });
      await firestore
        .doc(fsPath.vlog(tenantId, target.vlogId))
        .set(
          { status: "failed", scope: target.scope, targetId: target.targetId, businessDate },
          { merge: true },
        );
    }
  }

  log("vlog generation finished", { tenantId, businessDate, ...result });
  return result;
}

async function generateOne(params: {
  tenantId: string;
  tenant: TenantDoc;
  businessDate: BusinessDate;
  target: LogTarget;
  captures: (CaptureDoc & { id: string })[];
  userById: Map<string, UserDoc & { id: string }>;
  departments: Map<string, DepartmentDoc>;
  force: boolean;
}): Promise<boolean> {
  const { tenantId, tenant, businessDate, target, force } = params;
  const firestore = db();
  const vlogRef = firestore.doc(fsPath.vlog(tenantId, target.vlogId));

  const existingSnap = await vlogRef.get();
  const decision = decideGeneration({
    existing: existingSnap.exists ? (existingSnap.data() as VlogDoc) : null,
    now: new Date(),
    force,
  });
  if (!decision.generate) {
    log("skip vlog", { tenantId, vlogId: target.vlogId, reason: decision.reason });
    return false;
  }

  const department = target.departmentId ? params.departments.get(target.departmentId) : undefined;
  const settings = resolveEffectiveSettings(tenant, department ?? null);
  const slotKeys = listSlotKeys(settings.workingHours, settings.captureIntervalMin);

  const members = target.memberIds
    .map((id) => params.userById.get(id))
    .filter((u): u is UserDoc & { id: string } => Boolean(u))
    .map((u) => ({ userId: u.id, name: u.name }));

  const memberIdSet = new Set(target.memberIds);
  const planCaptures: PlanCapture[] = params.captures
    .filter((c) => memberIdSet.has(c.userId))
    .map((c) => ({
      captureId: c.id,
      userId: c.userId,
      slotKey: c.slotKey,
      status: c.status,
      capturedAt: c.capturedAt.toDate(),
      videoPath: c.videoPath,
    }));

  const plan = buildVlogPlan({
    members,
    captures: planCaptures,
    slotKeys,
    gridSize: settings.gridSize,
    timezone: settings.timezone,
  });

  if (!hasRenderableContent(plan)) {
    // 1本も撮影が無い日は Vlog を作らない
    log("no captures; skip vlog", { tenantId, vlogId: target.vlogId });
    return false;
  }

  await vlogRef.set(
    {
      scope: target.scope,
      targetId: target.targetId,
      businessDate,
      status: "generating",
      generatedAt: Timestamp.now(),
    },
    { merge: true },
  );

  const workDir = await mkdtemp(join(tmpdir(), `worklog-vlog-${target.vlogId}-`));
  try {
    const pages: VlogPage[] = [];

    for (const page of plan) {
      const localPath = await renderPage(page, {
        ffmpegPath: FFMPEG_PATH,
        fontFile: FONT_FILE,
        workDir,
        concurrency: CONCURRENCY,
        fetchVideo: downloadObject,
        onProgress: (message) => log(message, { tenantId, vlogId: target.vlogId }),
      });

      const objectPath = storagePath.vlogPage(
        tenantId,
        businessDate,
        target.vlogId,
        pageNumber(page),
      );
      await uploadObject({ localPath, objectPath, contentType: "video/mp4" });
      pages.push({ videoPath: objectPath, memberIds: page.memberIds });
    }

    // 前回より少ないページ数になった場合、古いページが残らないように消す
    await removeStalePages(tenantId, businessDate, target.vlogId, pages.length);

    await vlogRef.set(
      {
        scope: target.scope,
        targetId: target.targetId,
        businessDate,
        status: "ready",
        pages,
        generatedAt: Timestamp.now(),
        regenerateRequestedAt: FieldValue.delete(),
      },
      { merge: true },
    );

    await notifyReady({ tenantId, target, businessDate, userById: params.userById });

    log("vlog ready", {
      tenantId,
      vlogId: target.vlogId,
      pages: pages.length,
      reason: decision.reason,
    });
    return true;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

/** ページ数が減ったとき、前回の余分なページファイルを消す */
async function removeStalePages(
  tenantId: string,
  businessDate: BusinessDate,
  vlogId: string,
  pageCount: number,
): Promise<void> {
  const [files] = await bucket().getFiles({
    prefix: `tenants/${tenantId}/vlogs/${businessDate}/${vlogId}_p`,
  });
  await Promise.all(
    files
      .filter((file) => {
        const match = /_p(\d+)\.mp4$/.exec(file.name);
        return match ? Number(match[1]) > pageCount : false;
      })
      .map((file) => file.delete({ ignoreNotFound: true })),
  );
}

/** 生成完了を本人へ通知する (F-311) */
async function notifyReady(params: {
  tenantId: string;
  target: LogTarget;
  businessDate: BusinessDate;
  userById: Map<string, UserDoc & { id: string }>;
}): Promise<void> {
  // 部署ログの完了で全員に通知すると多すぎるので、個人ログのみ通知する
  if (params.target.scope !== "personal") return;

  const user = params.userById.get(params.target.targetId);
  const tokens = user?.fcmTokens ?? [];
  if (tokens.length === 0) return;
  if (user?.preferences?.notificationsEnabled === false) return;

  try {
    await messaging().sendEachForMulticast({
      tokens,
      notification: {
        title: "今日のVlogができました",
        body: `${params.businessDate} の記録を確認できます`,
      },
      data: {
        type: "vlog",
        tenantId: params.tenantId,
        businessDate: params.businessDate,
        vlogId: params.target.vlogId,
      },
    });
  } catch (err) {
    // 通知の失敗で生成結果を失わない
    logError("vlog notification failed", {
      tenantId: params.tenantId,
      vlogId: params.target.vlogId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function main(): Promise<void> {
  const businessDate = process.env.BUSINESS_DATE;
  const force = process.env.FORCE === "true";

  const tenantIds = await listTenantIds();
  let failed = 0;

  for (const tenantId of tenantIds) {
    try {
      const result = await generateForTenant(tenantId, { businessDate, force });
      failed += result.failed;
    } catch (err) {
      failed += 1;
      // 1テナントの失敗で他テナントを止めない
      logError("tenant generation failed", {
        tenantId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (failed > 0) {
    // Cloud Run Jobs にリトライさせる
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void main().catch((err: unknown) => {
    logError("job crashed", { error: err instanceof Error ? err.message : String(err) });
    process.exitCode = 1;
  });
}
