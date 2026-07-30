import {
  NOTIFICATION_RESEND_AFTER_MIN,
  NOTIFICATION_SCHEDULER_INTERVAL_MIN,
  buildAttendanceId,
  buildCaptureId,
  buildOffDeclarationId,
  countsAsCaptured,
  fsPath,
  isNotifiableDay,
  resolveEffectiveSettings,
  type AttendanceDoc,
  type CaptureDoc,
  type DepartmentDoc,
  type OffDeclarationDoc,
  type TenantDoc,
  type UserDoc,
} from "@worklog/shared";
import { getFunctions } from "firebase-admin/functions";
import * as logger from "firebase-functions/logger";

import { db, getAllDocs } from "../lib/admin";
import { buildNotificationTasks, slotsStartingWithin, type NotificationTask } from "./plan";

/** Cloud Tasks のキュー名は、onTaskDispatched でデプロイされる関数名と一致させる必要がある */
export const NOTIFICATION_QUEUE = "deliverCaptureNotificationQueue";

/**
 * 通知スケジューラ（設計書 第6章 / F-101, F-114, F-116）。
 * Cloud Scheduler から10分おきに起動される。
 *
 * ここでは「誰に・いつ送るか」を決めて Cloud Tasks に積むだけ。
 * FCM の送信は deliver.ts が行う。スケジューラ自身は重い処理をしない。
 */
export async function scheduleNotifications(now: Date = new Date()): Promise<{
  tenants: number;
  enqueued: number;
  skipped: number;
}> {
  const firestore = db();
  const tenantsSnap = await firestore
    .collection("tenants")
    .where("status", "==", "active")
    .get();

  let enqueued = 0;
  let skipped = 0;

  for (const tenantSnap of tenantsSnap.docs) {
    const tenantId = tenantSnap.id;
    const tenant = tenantSnap.data() as TenantDoc;

    try {
      const result = await scheduleForTenant(tenantId, tenant, now);
      enqueued += result.enqueued;
      skipped += result.skipped;
    } catch (err) {
      // 1テナントの失敗で他テナントを止めない
      logger.error("scheduleNotifications failed for tenant", {
        tenantId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info("scheduleNotifications done", {
    tenants: tenantsSnap.size,
    enqueued,
    skipped,
  });
  return { tenants: tenantsSnap.size, enqueued, skipped };
}

async function scheduleForTenant(
  tenantId: string,
  tenant: TenantDoc,
  now: Date,
): Promise<{ enqueued: number; skipped: number }> {
  const firestore = db();

  const [usersSnap, deptsSnap] = await Promise.all([
    firestore.collection(fsPath.users(tenantId)).where("status", "==", "active").get(),
    firestore.collection(fsPath.departments(tenantId)).get(),
  ]);

  const departments = new Map<string, DepartmentDoc>();
  for (const d of deptsSnap.docs) departments.set(d.id, d.data() as DepartmentDoc);

  const tasks: NotificationTask[] = [];
  let skipped = 0;

  for (const userSnap of usersSnap.docs) {
    const user = userSnap.data() as UserDoc;
    if (user.preferences?.notificationsEnabled === false) {
      skipped += 1;
      continue;
    }
    if (user.fcmTokens.length === 0) {
      skipped += 1;
      continue;
    }

    // 部署ごとに撮影間隔・稼働時間帯が違いうる (F-111)
    const deptId = user.departmentIds[0] ?? null;
    const settings = resolveEffectiveSettings(tenant, deptId ? departments.get(deptId) : null);

    const items = slotsStartingWithin(now, NOTIFICATION_SCHEDULER_INTERVAL_MIN, settings);
    if (items.length === 0) continue;

    for (const item of items) {
      const eligible = await isUserEligible(tenantId, userSnap.id, item.businessDate, item.slotKey, settings.holidays);
      if (!eligible) {
        skipped += 1;
        continue;
      }
      tasks.push(
        ...buildNotificationTasks({
          tenantId,
          userId: userSnap.id,
          item,
          now,
          resendAfterMin: NOTIFICATION_RESEND_AFTER_MIN,
        }),
      );
    }
  }

  const enqueued = await enqueueAll(tasks);
  return { enqueued, skipped };
}

/**
 * 通知を送らない条件（運用ケース / F-113）
 *  - 有給・欠勤・休日 → 分母からも外す
 *  - 「撮影しない時間」に申告済みのスロット
 *  - すでに撮影済みのスロット
 */
async function isUserEligible(
  tenantId: string,
  userId: string,
  businessDate: string,
  slotKey: string,
  holidays: readonly string[],
): Promise<boolean> {
  const firestore = db();
  const [attendanceSnap, offSnap, captureSnap] = await getAllDocs(
    firestore.doc(fsPath.attendanceRecord(tenantId, buildAttendanceId(userId, businessDate))),
    firestore.doc(fsPath.offDeclaration(tenantId, buildOffDeclarationId(userId, businessDate))),
    firestore.doc(fsPath.capture(tenantId, buildCaptureId(userId, businessDate, slotKey))),
  );

  const workType = attendanceSnap.exists
    ? (attendanceSnap.data() as AttendanceDoc).workType
    : undefined;
  if (!isNotifiableDay(holidays, businessDate, workType)) return false;

  if (offSnap.exists) {
    const off = offSnap.data() as OffDeclarationDoc;
    if (off.slotKeys?.includes(slotKey)) return false;
  }

  if (captureSnap.exists) {
    const capture = captureSnap.data() as CaptureDoc;
    if (countsAsCaptured(capture.status)) return false;
  }

  return true;
}

async function enqueueAll(tasks: NotificationTask[]): Promise<number> {
  if (tasks.length === 0) return 0;
  const queue = getFunctions().taskQueue<NotificationTaskPayload>(NOTIFICATION_QUEUE);

  const results = await Promise.allSettled(
    tasks.map((task) =>
      queue.enqueue(
        {
          tenantId: task.tenantId,
          userId: task.userId,
          businessDate: task.businessDate,
          slotKey: task.slotKey,
          kind: task.kind,
        },
        { scheduleDelaySeconds: task.delaySeconds, id: task.dedupeId, dispatchDeadlineSeconds: 60 },
      ),
    ),
  );

  let ok = 0;
  for (const [index, r] of results.entries()) {
    if (r.status === "fulfilled") {
      ok += 1;
      continue;
    }
    const message = r.reason instanceof Error ? r.reason.message : String(r.reason);
    // 重複排除で弾かれたのは正常（スケジューラの二重起動）
    if (message.includes("task-already-exists") || message.includes("ALREADY_EXISTS")) continue;
    logger.error("enqueue notification failed", {
      tenantId: tasks[index]?.tenantId,
      slotKey: tasks[index]?.slotKey,
      error: message,
    });
  }
  return ok;
}

export interface NotificationTaskPayload {
  tenantId: string;
  userId: string;
  businessDate: string;
  slotKey: string;
  kind: "initial" | "resend";
}
