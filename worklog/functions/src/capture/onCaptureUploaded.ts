import {
  canAdvanceCaptureStatus,
  fsPath,
  parseCaptureVideoPath,
  storagePath,
  THUMB_SPEC,
  type CaptureDoc,
} from "@worklog/shared";
import { FieldValue } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";

import { bucket, db } from "../lib/admin";
import { extractThumbnail } from "../lib/thumbnail";
import { stampAttendanceFromCapture } from "./attendanceStamp";

/**
 * Storage トリガ（設計書 5.2 の注記）。
 * アップロード完了を検知してサムネイルを生成し、状態を ready へ進める。
 *
 * 冪等であることが必須：
 *  - 同じイベントが2回来ても結果が変わらない
 *  - `capture-commit` と順序が逆でも収束する（状態は単調増加のみ）
 *  - すでに削除済みなら、アップロードされた実ファイルを消して削除を勝たせる (F-903)
 */
export async function handleCaptureUploaded(objectName: string): Promise<void> {
  const parsed = parseCaptureVideoPath(objectName);
  if (!parsed) {
    // thumbs/ や vlogs/ の書き込みで再入しないための門番
    return;
  }
  const { tenantId, businessDate, captureId } = parsed;

  const ref = db().doc(fsPath.capture(tenantId, captureId));
  const snap = await ref.get();

  if (!snap.exists) {
    // 予約ドキュメントが無いのに実ファイルがある＝失効した署名付きURLの再利用など。
    // 素性の分からないオブジェクトは残さない
    logger.error("orphan capture object; deleting", { tenantId, captureId, objectName });
    await bucket().file(objectName).delete({ ignoreNotFound: true });
    return;
  }

  const capture = snap.data() as CaptureDoc;

  if (capture.status === "deleted") {
    // 削除が先に走っていた。映像は残さない (F-904 管理者でも復元できない)
    logger.warn("upload arrived for deleted capture; removing object", { tenantId, captureId });
    await bucket().file(objectName).delete({ ignoreNotFound: true });
    return;
  }

  if (capture.status === "ready" && capture.thumbPath) {
    // すでに完了している（イベント重複）
    return;
  }

  if (canAdvanceCaptureStatus(capture.status, "processing")) {
    await ref.update({ status: "processing", updatedAt: FieldValue.serverTimestamp() });
  }

  const thumbObjectPath = storagePath.captureThumb(tenantId, businessDate, captureId);
  try {
    const [videoBuffer] = await bucket().file(objectName).download();
    const thumb = await extractThumbnail({ videoBuffer });
    await bucket().file(thumbObjectPath).save(thumb, {
      contentType: THUMB_SPEC.contentType,
      resumable: false,
      metadata: { cacheControl: "private, max-age=3600" },
    });
  } catch (err) {
    logger.error("thumbnail generation failed", {
      tenantId,
      captureId,
      error: err instanceof Error ? err.message : String(err),
    });
    // サムネイルが作れなくても撮影自体は成立している。
    // グリッドはプレースホルダを出し、ready には進める
    await ref.update({ status: "ready", updatedAt: FieldValue.serverTimestamp() });
    return;
  }

  // 削除と競合していないか最終確認してから ready にする
  await db().runTransaction(async (tx) => {
    const fresh = await tx.get(ref);
    if (!fresh.exists) return;
    const current = fresh.data() as CaptureDoc;
    if (current.status === "deleted") return;
    tx.update(ref, {
      status: "ready",
      thumbPath: thumbObjectPath,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  const after = (await ref.get()).data() as CaptureDoc | undefined;
  if (after?.status === "deleted") {
    await bucket().file(thumbObjectPath).delete({ ignoreNotFound: true });
    await bucket().file(objectName).delete({ ignoreNotFound: true });
    return;
  }

  // commit が来ないまま終わる経路（アプリが落ちた等）でも勤怠は残す (F-701)
  await stampAttendanceFromCapture({
    tenantId,
    userId: capture.userId,
    businessDate,
    capturedAt: capture.capturedAt.toDate(),
  });

  logger.info("capture ready", { tenantId, captureId });
}
