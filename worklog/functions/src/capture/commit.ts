import {
  ErrorCode,
  MEMO_MAX_LENGTH,
  canAdvanceCaptureStatus,
  fsPath,
  parseCaptureId,
  type CaptureDoc,
  type CaptureView,
  type CommitCaptureInput,
} from "@worklog/shared";
import { FieldValue } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";

import { bucket, db } from "../lib/admin";
import { writeAuditLog } from "../lib/audit";
import type { TenantContext } from "../lib/context";
import { fail } from "../lib/errors";
import { stampAttendanceFromCapture } from "./attendanceStamp";

/**
 * アップロード完了後にクライアントが呼ぶ (設計書 5.2)。
 * メモ・作業タグを載せ、Storage 上の実ファイルの存在を確認して状態を進める。
 *
 * `onCaptureUploaded`（Storageトリガ）とどちらが先に走るか決まらないので、
 * 状態は canAdvanceCaptureStatus で単調増加にしか更新しない。
 */
export async function commitCapture(
  ctx: TenantContext,
  input: CommitCaptureInput,
): Promise<{ capture: CaptureView }> {
  const parsed = parseCaptureId(input.captureId);
  if (!parsed) fail(ErrorCode.INVALID_ARGUMENT, { captureId: input.captureId });
  // 他人の撮影に memo を付けられないようにする
  if (parsed.uid !== ctx.uid) fail(ErrorCode.AUTH_FORBIDDEN);
  if (input.memo && input.memo.length > MEMO_MAX_LENGTH) fail(ErrorCode.INVALID_ARGUMENT);

  const ref = db().doc(fsPath.capture(ctx.tenantId, input.captureId));
  const snap = await ref.get();
  if (!snap.exists) fail(ErrorCode.CAPTURE_NOT_FOUND, { captureId: input.captureId });

  const capture = snap.data() as CaptureDoc;
  if (capture.status === "deleted") fail(ErrorCode.CAPTURE_NOT_FOUND, { captureId: input.captureId });

  const [exists] = await bucket().file(capture.videoPath).exists();
  if (!exists) fail(ErrorCode.CAPTURE_NOT_UPLOADED, { captureId: input.captureId });

  const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (input.memo !== undefined) patch.memo = input.memo;
  if (input.workTag !== undefined) {
    // テナントで定義された作業タグ以外は受け付けない (F-108)
    if (input.workTag !== "" && !ctx.settings.workTags.includes(input.workTag)) {
      fail(ErrorCode.INVALID_ARGUMENT, { workTag: input.workTag });
    }
    patch.workTag = input.workTag;
  }
  if (canAdvanceCaptureStatus(capture.status, "uploaded")) patch.status = "uploaded";

  await ref.update(patch);

  // 勤怠の出退勤候補を更新 (F-701)
  await stampAttendanceFromCapture({
    tenantId: ctx.tenantId,
    userId: ctx.uid,
    businessDate: capture.businessDate,
    capturedAt: capture.capturedAt.toDate(),
  });

  await writeAuditLog({
    tenantId: ctx.tenantId,
    actorId: ctx.uid,
    action: "capture.commit",
    targetPath: fsPath.capture(ctx.tenantId, input.captureId),
    // memo 本文は残さない。付いたかどうかだけ
    detail: { slotKey: capture.slotKey, hasMemo: Boolean(input.memo), workTag: input.workTag },
  });

  logger.info("capture committed", {
    tenantId: ctx.tenantId,
    uid: ctx.uid,
    captureId: input.captureId,
  });

  const status = (patch.status as CaptureDoc["status"] | undefined) ?? capture.status;
  return {
    capture: {
      captureId: input.captureId,
      userId: capture.userId,
      departmentId: capture.departmentId,
      businessDate: capture.businessDate,
      slotKey: capture.slotKey,
      capturedAtIso: capture.capturedAt.toDate().toISOString(),
      status,
      memo: input.memo ?? capture.memo,
      workTag: input.workTag ?? capture.workTag,
      isLate: capture.isLate,
    },
  };
}
