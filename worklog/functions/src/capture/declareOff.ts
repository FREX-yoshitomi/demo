import {
  ErrorCode,
  buildOffDeclarationId,
  fsPath,
  listSlotKeys,
  type DeclareOffInput,
} from "@worklog/shared";
import { FieldValue } from "firebase-admin/firestore";

import { db } from "../lib/admin";
import { writeAuditLog } from "../lib/audit";
import type { TenantContext } from "../lib/context";
import { fail } from "../lib/errors";

/**
 * 「撮影しない時間」の申告 (F-113)。通知を止め、撮影率の分母からも外す。
 * 申告は上書き（差分ではなく毎回全量を送る）。
 */
export async function declareOff(
  ctx: TenantContext,
  input: DeclareOffInput,
): Promise<{ ok: true }> {
  const validSlots = new Set(
    listSlotKeys(ctx.settings.workingHours, ctx.settings.captureIntervalMin),
  );
  const unknown = input.slotKeys.filter((s) => !validSlots.has(s));
  if (unknown.length > 0) fail(ErrorCode.CAPTURE_SLOT_UNKNOWN, { slotKeys: unknown });

  const id = buildOffDeclarationId(ctx.uid, input.businessDate);
  await db()
    .doc(fsPath.offDeclaration(ctx.tenantId, id))
    .set(
      {
        userId: ctx.uid,
        businessDate: input.businessDate,
        slotKeys: [...new Set(input.slotKeys)].sort(),
        reason: input.reason ?? null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

  await writeAuditLog({
    tenantId: ctx.tenantId,
    actorId: ctx.uid,
    action: "capture.declareOff",
    targetPath: fsPath.offDeclaration(ctx.tenantId, id),
    detail: { businessDate: input.businessDate, slotCount: input.slotKeys.length },
  });

  return { ok: true };
}
