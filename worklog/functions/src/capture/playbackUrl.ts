import {
  ErrorCode,
  fsPath,
  type CaptureDoc,
  type PlaybackUrlResult,
} from "@worklog/shared";

import { db } from "../lib/admin";
import { writeAuditLog } from "../lib/audit";
import type { TenantContext } from "../lib/context";
import { fail } from "../lib/errors";
import { createPlaybackUrl } from "../lib/signing";

/**
 * 単体再生用の署名付きURL (F-303)。有効期限1時間。
 *
 * 「誰がいつ誰のデータを閲覧したか」を監査ログに残す (F-805)。
 * 他人の映像を見た場合のみ記録し、自分の分でログを埋めない。
 */
export async function issuePlaybackUrl(
  ctx: TenantContext,
  input: { captureId: string },
): Promise<PlaybackUrlResult> {
  const snap = await db().doc(fsPath.capture(ctx.tenantId, input.captureId)).get();
  if (!snap.exists) fail(ErrorCode.CAPTURE_NOT_FOUND, { captureId: input.captureId });

  const capture = snap.data() as CaptureDoc;
  if (capture.status === "deleted") fail(ErrorCode.CAPTURE_NOT_FOUND, { captureId: input.captureId });
  if (capture.status === "pending") fail(ErrorCode.CAPTURE_NOT_UPLOADED, { captureId: input.captureId });

  if (!canViewCapture(ctx, capture)) fail(ErrorCode.AUTH_FORBIDDEN);

  const { url, expiresAt } = await createPlaybackUrl(capture.videoPath);

  if (capture.userId !== ctx.uid) {
    await writeAuditLog({
      tenantId: ctx.tenantId,
      actorId: ctx.uid,
      action: "capture.playback",
      targetPath: fsPath.capture(ctx.tenantId, input.captureId),
      detail: { subjectId: capture.userId, businessDate: capture.businessDate },
    });
  }

  return { url, expiresAt: expiresAt.toISOString() };
}

/**
 * 閲覧範囲 (F-603, F-604)。
 * ルール側はテナント境界までしか見ないので、部署単位の絞り込みはここで行う（設計書 4.2）。
 */
export function canViewCapture(
  ctx: Pick<TenantContext, "uid" | "role" | "user">,
  capture: Pick<CaptureDoc, "userId" | "departmentId">,
): boolean {
  if (capture.userId === ctx.uid) return true;
  if (ctx.role === "tenantAdmin") return true;

  const deptId = capture.departmentId;
  if (!deptId) return false;

  // 部署管理者は自部署配下のみ (F-603)
  if (ctx.role === "deptAdmin" && ctx.user.departmentIds.includes(deptId)) return true;
  // 横断閲覧権限 (F-604)
  if (ctx.user.crossViewDeptIds?.includes(deptId)) return true;

  return false;
}
