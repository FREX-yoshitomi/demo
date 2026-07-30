import { fsPath } from "@worklog/shared";
import { FieldValue } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";

import { db } from "./admin";

/**
 * 監査ログ (F-805)。追記専用。ルール側で update/delete を禁止しているので、
 * ここでは create しかしない。
 *
 * ⚠️ memo 本文や動画の中身は detail に入れない（設計書 第10章）。
 */
export type AuditAction =
  | "auth.firstLogin"
  | "auth.claimsUpdated"
  | "capture.issueUploadUrl"
  | "capture.commit"
  | "capture.delete"
  | "capture.playback"
  | "capture.declareOff"
  | "report.submit"
  | "report.comment"
  | "attendance.correctionRequested"
  | "attendance.correctionReviewed"
  | "attendance.exportCsv"
  | "admin.userUpserted"
  | "admin.userDisabled"
  | "admin.departmentUpserted"
  | "admin.tenantSettingsUpdated"
  | "admin.shareLinkIssued"
  | "ops.tenantCreated"
  | "ops.tenantSuspended"
  | "ops.tenantDataViewed";

export async function writeAuditLog(params: {
  tenantId: string;
  actorId: string;
  action: AuditAction;
  targetPath: string;
  detail?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db().collection(fsPath.auditLogs(params.tenantId)).add({
      actorId: params.actorId,
      action: params.action,
      targetPath: params.targetPath,
      detail: params.detail ?? {},
      at: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    // 監査ログの失敗で業務処理を止めない。ただし必ず構造化ログに残す
    logger.error("audit log write failed", {
      tenantId: params.tenantId,
      action: params.action,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
