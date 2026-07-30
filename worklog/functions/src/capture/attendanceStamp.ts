import {
  buildAttendanceId,
  fsPath,
  type AttendanceDoc,
  type BusinessDate,
} from "@worklog/shared";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { db } from "../lib/admin";

/**
 * 初回撮影＝出勤時刻候補、最終撮影＝退勤時刻候補として勤怠に反映する (F-701)。
 *
 * **本人が映像を削除しても、この時刻は消さない** (F-706)。
 * 勤怠の整合性が崩れるため、削除処理からはこの関数を呼ばない。
 */
export async function stampAttendanceFromCapture(params: {
  tenantId: string;
  userId: string;
  businessDate: BusinessDate;
  capturedAt: Date;
}): Promise<void> {
  const ref = db().doc(
    fsPath.attendanceRecord(params.tenantId, buildAttendanceId(params.userId, params.businessDate)),
  );
  const stamp = Timestamp.fromDate(params.capturedAt);

  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      tx.set(ref, {
        userId: params.userId,
        businessDate: params.businessDate,
        workType: "normal",
        firstCaptureAt: stamp,
        lastCaptureAt: stamp,
        breaks: [],
        corrections: [],
        updatedAt: FieldValue.serverTimestamp(),
      });
      return;
    }

    const current = snap.data() as AttendanceDoc;
    const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };

    const firstMs = current.firstCaptureAt?.toMillis();
    if (firstMs === undefined || stamp.toMillis() < firstMs) patch.firstCaptureAt = stamp;

    const lastMs = current.lastCaptureAt?.toMillis();
    if (lastMs === undefined || stamp.toMillis() > lastMs) patch.lastCaptureAt = stamp;

    // 変化が無いなら書かない（毎正時100人の書き込みを無駄に増やさない）
    if (Object.keys(patch).length > 1) tx.update(ref, patch);
  });
}
