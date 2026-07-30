import {
  buildCaptureId,
  countsAsCaptured,
  fsPath,
  type CaptureDoc,
  type UserDoc,
} from "@worklog/shared";
import { FieldValue } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";

import { db, getAllDocs, messaging } from "../lib/admin";
import type { NotificationTaskPayload } from "./schedule";

/**
 * Cloud Tasks から呼ばれて FCM を送る (F-101, F-114)。
 *
 * 通知ペイロードに businessDate / slotKey を入れ、
 * タップで撮影画面へ直行させる（設計書 第6章）。
 */
export async function deliverCaptureNotification(
  payload: NotificationTaskPayload,
): Promise<void> {
  const { tenantId, userId, businessDate, slotKey, kind } = payload;
  const firestore = db();

  const captureId = buildCaptureId(userId, businessDate, slotKey);
  const [userSnap, captureSnap] = await getAllDocs(
    firestore.doc(fsPath.user(tenantId, userId)),
    firestore.doc(fsPath.capture(tenantId, captureId)),
  );

  if (!userSnap.exists) return;
  const user = userSnap.data() as UserDoc;
  if (user.status !== "active") return;
  if (user.preferences?.notificationsEnabled === false) return;

  // 撮影済みなら送らない。再送 (F-114) はこの判定が主目的
  if (captureSnap.exists) {
    const capture = captureSnap.data() as CaptureDoc;
    if (countsAsCaptured(capture.status)) {
      logger.debug("already captured; skip notification", { tenantId, userId, slotKey, kind });
      return;
    }
  }

  const tokens = user.fcmTokens ?? [];
  if (tokens.length === 0) return;

  const title = kind === "resend" ? "まだ撮影がありません" : "撮影の時間です";
  const body =
    kind === "resend"
      ? `${slotKey} の2秒動画がまだ届いていません`
      : `${slotKey} の2秒動画を撮りましょう`;

  const response = await messaging().sendEachForMulticast({
    tokens,
    notification: { title, body },
    data: {
      type: "capture",
      tenantId,
      businessDate,
      slotKey,
      kind,
    },
    android: { priority: "high", notification: { channelId: "capture" } },
    apns: {
      payload: { aps: { sound: "default", contentAvailable: true } },
      headers: { "apns-priority": "10" },
    },
  });

  await cleanupInvalidTokens(tenantId, userId, tokens, response.responses);

  logger.info("capture notification sent", {
    tenantId,
    userId,
    slotKey,
    kind,
    success: response.successCount,
    failure: response.failureCount,
  });
}

/** 無効になったトークンは都度掃除する（設計書 第6章） */
async function cleanupInvalidTokens(
  tenantId: string,
  userId: string,
  tokens: string[],
  responses: { success: boolean; error?: { code: string } }[],
): Promise<void> {
  const invalid: string[] = [];
  responses.forEach((r, i) => {
    if (r.success) return;
    const code = r.error?.code ?? "";
    if (
      code === "messaging/registration-token-not-registered" ||
      code === "messaging/invalid-registration-token" ||
      code === "messaging/invalid-argument"
    ) {
      const token = tokens[i];
      if (token) invalid.push(token);
    }
  });

  if (invalid.length === 0) return;
  await db()
    .doc(fsPath.user(tenantId, userId))
    .update({ fcmTokens: FieldValue.arrayRemove(...invalid) });
  logger.info("removed invalid fcm tokens", { tenantId, userId, count: invalid.length });
}
