import { fsPath, type RegisterFcmTokenInput, type UpdateProfileInput } from "@worklog/shared";
import { FieldValue } from "firebase-admin/firestore";

import { db } from "../lib/admin";
import type { AuthContext } from "../lib/context";

/** 最大保持トークン数。端末を替えても古いトークンが無限に溜まらないようにする */
const MAX_FCM_TOKENS = 10;

export async function registerFcmToken(
  ctx: AuthContext,
  input: RegisterFcmTokenInput,
): Promise<{ ok: true }> {
  const ref = db().doc(fsPath.user(ctx.tenantId, ctx.uid));

  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const current = (snap.data()?.fcmTokens as string[] | undefined) ?? [];
    const next = [input.token, ...current.filter((t) => t !== input.token)].slice(
      0,
      MAX_FCM_TOKENS,
    );
    tx.update(ref, { fcmTokens: next });
  });

  return { ok: true };
}

export async function updateProfile(
  ctx: AuthContext,
  input: UpdateProfileInput,
): Promise<{ ok: true }> {
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.photoUrl !== undefined) patch.photoUrl = input.photoUrl;
  if (input.camera !== undefined) patch["preferences.camera"] = input.camera;
  if (input.notificationsEnabled !== undefined) {
    patch["preferences.notificationsEnabled"] = input.notificationsEnabled;
  }
  // role / status / departmentIds は本人からは変更させない（管理Web経由のみ）

  if (Object.keys(patch).length === 0) return { ok: true };
  patch.updatedAt = FieldValue.serverTimestamp();

  await db().doc(fsPath.user(ctx.tenantId, ctx.uid)).update(patch);
  return { ok: true };
}
