import {
  CAPTURE_DURATION_SEC,
  ErrorCode,
  buildCaptureId,
  buildOffDeclarationId,
  fsPath,
  storagePath,
  type CaptureDoc,
  type IssueUploadUrlResult,
  type OffDeclarationDoc,
} from "@worklog/shared";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";

import { db } from "../lib/admin";
import { fail } from "../lib/errors";
import { createUploadUrl } from "../lib/signing";
import type { TenantContext } from "../lib/context";
import { decideSlot } from "./slotPolicy";
import type { IssueUploadUrlInput } from "@worklog/shared";

/**
 * 署名付きURLの発行 (F-115, 設計書 5.2)。
 *
 * ここで決定的な captureId でドキュメントを作ってスロットを予約するので、
 * 同一スロットへの二重撮影はトランザクションで弾ける (CAPTURE/DUPLICATE)。
 * 実ファイルは端末から Storage へ直接 PUT され、完了は onCaptureUploaded で拾う。
 */
export async function issueUploadUrl(
  ctx: TenantContext,
  input: IssueUploadUrlInput,
  now: Date = new Date(),
): Promise<IssueUploadUrlResult> {
  const firestore = db();

  const offSnap = await firestore
    .doc(fsPath.offDeclaration(ctx.tenantId, buildOffDeclarationId(ctx.uid, input.businessDate)))
    .get();
  const declaredOffSlots = offSnap.exists
    ? ((offSnap.data() as OffDeclarationDoc).slotKeys ?? [])
    : [];

  const decision = decideSlot({
    businessDate: input.businessDate,
    slotKey: input.slotKey,
    clientCapturedAt: new Date(input.capturedAt),
    now,
    settings: ctx.settings,
    declaredOffSlots,
  });

  if (!decision.ok) {
    switch (decision.reason) {
      case "holiday":
        fail(ErrorCode.CAPTURE_HOLIDAY, { businessDate: input.businessDate });
      case "unknownSlot":
        fail(ErrorCode.CAPTURE_SLOT_UNKNOWN, { slotKey: input.slotKey });
      case "closed":
        fail(ErrorCode.CAPTURE_SLOT_CLOSED, { slotKey: input.slotKey });
    }
  }

  const captureId = buildCaptureId(ctx.uid, input.businessDate, input.slotKey);
  const videoPath = storagePath.captureVideo(ctx.tenantId, input.businessDate, captureId);
  const captureRef = firestore.doc(fsPath.capture(ctx.tenantId, captureId));

  await firestore.runTransaction(async (tx) => {
    const snap = await tx.get(captureRef);
    if (snap.exists) {
      const existing = snap.data() as CaptureDoc;
      // 削除済みの枠は撮り直しを許す（猶予内なら再撮影できる仕様）
      if (existing.status !== "pending" && existing.status !== "deleted") {
        fail(ErrorCode.CAPTURE_DUPLICATE, { captureId });
      }
    }

    // 書き込みペイロードは FieldValue のセンチネルを含むので CaptureDoc 型では表せない
    const doc: Record<string, unknown> = {
      userId: ctx.uid,
      departmentId: ctx.primaryDepartmentId,
      businessDate: input.businessDate,
      slotKey: input.slotKey,
      capturedAt: Timestamp.fromDate(decision.capturedAt),
      status: "pending",
      videoPath,
      thumbPath: null,
      durationSec: CAPTURE_DURATION_SEC,
      isLate: decision.isLate,
      camera: input.camera,
      deletedAt: null,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (snap.exists) {
      // 再撮影：memo / workTag は引き継がずリセットする
      tx.set(captureRef, { ...doc, deleteReason: FieldValue.delete(), memo: FieldValue.delete(), workTag: FieldValue.delete() }, { merge: true });
    } else {
      tx.set(captureRef, { ...doc, createdAt: FieldValue.serverTimestamp() });
    }
  });

  const signed = await createUploadUrl(videoPath);

  logger.info("upload url issued", {
    tenantId: ctx.tenantId,
    uid: ctx.uid,
    captureId,
    slotKey: input.slotKey,
    isLate: decision.isLate,
  });

  return {
    captureId,
    uploadUrl: signed.uploadUrl,
    requiredHeaders: signed.requiredHeaders,
    expiresAt: signed.expiresAt.toISOString(),
    isLate: decision.isLate,
    videoPath,
  };
}
