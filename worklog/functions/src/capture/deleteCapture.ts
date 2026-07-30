import {
  ErrorCode,
  buildVlogId,
  fsPath,
  parseCaptureId,
  storagePath,
  type CaptureDoc,
  type DeleteCaptureInput,
} from "@worklog/shared";
import { FieldValue } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";

import { bucket, db } from "../lib/admin";
import { writeAuditLog } from "../lib/audit";
import type { TenantContext } from "../lib/context";
import { fail } from "../lib/errors";

/**
 * 本人による撮影の削除 (F-901〜905)。
 *
 * 順序が重要：
 *  1. Storage の実ファイル（動画・サムネイル）を消す ← 配信経路を先に断つ (F-903)
 *  2. ドキュメントを status: deleted に更新。**capturedAt は残す** (F-706, F-902)
 *  3. 生成済み Vlog に再生成マークを付ける (F-905)
 *  4. 監査ログに残す (F-904)
 *
 * 管理者による復元手段は用意しない。実ファイルを消しているので技術的にも戻せない。
 */
export async function deleteCapture(
  ctx: TenantContext,
  input: DeleteCaptureInput,
): Promise<{ ok: true }> {
  const parsed = parseCaptureId(input.captureId);
  if (!parsed) fail(ErrorCode.INVALID_ARGUMENT, { captureId: input.captureId });
  // 削除できるのは本人だけ (F-901)。管理者にも他人の映像は消させない
  if (parsed.uid !== ctx.uid) fail(ErrorCode.AUTH_FORBIDDEN);

  const ref = db().doc(fsPath.capture(ctx.tenantId, input.captureId));
  const snap = await ref.get();
  if (!snap.exists) fail(ErrorCode.CAPTURE_NOT_FOUND, { captureId: input.captureId });

  const capture = snap.data() as CaptureDoc;
  if (capture.userId !== ctx.uid) fail(ErrorCode.AUTH_FORBIDDEN);

  if (capture.status === "deleted") {
    // 冪等：二重削除は成功として返す
    return { ok: true };
  }

  const thumbObjectPath =
    capture.thumbPath ??
    storagePath.captureThumb(ctx.tenantId, capture.businessDate, input.captureId);

  await Promise.all([
    bucket().file(capture.videoPath).delete({ ignoreNotFound: true }),
    bucket().file(thumbObjectPath).delete({ ignoreNotFound: true }),
  ]);

  await ref.update({
    status: "deleted",
    deletedAt: FieldValue.serverTimestamp(),
    deleteReason: input.reason ?? null,
    thumbPath: null,
    // capturedAt / slotKey / isLate はそのまま残す。枠と時刻は消えない (F-902, F-706)
    updatedAt: FieldValue.serverTimestamp(),
  });

  await requestVlogRegeneration(ctx, capture);

  await writeAuditLog({
    tenantId: ctx.tenantId,
    actorId: ctx.uid,
    action: "capture.delete",
    targetPath: fsPath.capture(ctx.tenantId, input.captureId),
    detail: {
      slotKey: capture.slotKey,
      businessDate: capture.businessDate,
      hasReason: Boolean(input.reason),
    },
  });

  logger.info("capture deleted", {
    tenantId: ctx.tenantId,
    uid: ctx.uid,
    captureId: input.captureId,
  });

  return { ok: true };
}

/**
 * 該当コマを含む Vlog に再生成マークを付ける (F-905)。
 * 実際の再生成は vlog-generator（Cloud Run Jobs）が拾う。
 * 対象は「本人の個人ログ」と「撮影時に所属していた部署のログ」。
 */
async function requestVlogRegeneration(ctx: TenantContext, capture: CaptureDoc): Promise<void> {
  const vlogIds = [buildVlogId("personal", capture.userId, capture.businessDate)];
  if (capture.departmentId) {
    vlogIds.push(buildVlogId("department", capture.departmentId, capture.businessDate));
  }

  const batch = db().batch();
  const snaps = await db().getAll(...vlogIds.map((id) => db().doc(fsPath.vlog(ctx.tenantId, id))));
  let touched = 0;
  for (const snap of snaps) {
    if (!snap.exists) continue;
    batch.update(snap.ref, {
      status: "pending",
      regenerateRequestedAt: FieldValue.serverTimestamp(),
    });
    touched += 1;
  }
  if (touched > 0) await batch.commit();
}
