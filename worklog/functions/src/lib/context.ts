import {
  ErrorCode,
  fsPath,
  resolveEffectiveSettings,
  type EffectiveSettings,
  type Role,
  type TenantDoc,
  type UserDoc,
} from "@worklog/shared";
import type { CallableRequest } from "firebase-functions/https";

import { db, getAllDocs } from "./admin";
import { fail } from "./errors";

/**
 * 認証済みリクエストの文脈。
 * tenantId は **必ず Custom Claims から取る**。リクエストボディの値は一切見ない (F-503)。
 */
export interface AuthContext {
  uid: string;
  tenantId: string;
  role: Role;
  email?: string;
}

export function requireAuth(req: CallableRequest<unknown>): AuthContext {
  const auth = req.auth;
  if (!auth) fail(ErrorCode.AUTH_FORBIDDEN);

  const tenantId = auth.token["tenantId"];
  const role = auth.token["role"];
  if (typeof tenantId !== "string" || tenantId === "") {
    // ensureTenant を通っていない。クライアントはログイン直後に必ず呼ぶ
    fail(ErrorCode.AUTH_NOT_REGISTERED);
  }
  if (role !== "member" && role !== "deptAdmin" && role !== "tenantAdmin") {
    fail(ErrorCode.AUTH_NOT_REGISTERED);
  }

  return {
    uid: auth.uid,
    tenantId,
    role,
    email: typeof auth.token.email === "string" ? auth.token.email : undefined,
  };
}

export function requireRole(ctx: AuthContext, allowed: readonly Role[]): void {
  if (!allowed.includes(ctx.role)) fail(ErrorCode.AUTH_FORBIDDEN);
}

export interface TenantContext extends AuthContext {
  tenant: TenantDoc;
  user: UserDoc;
  /** テナント設定 + 主所属部署の上書きを反映した実効設定 (F-111) */
  settings: EffectiveSettings;
  /** 主所属部署。未所属なら null */
  primaryDepartmentId: string | null;
}

/**
 * テナント・ユーザー・実効設定をまとめて読み込む。
 * 停止テナント / 無効ユーザーはここで弾く (F-507, F-606)。
 */
export async function loadTenantContext(ctx: AuthContext): Promise<TenantContext> {
  const firestore = db();
  const [tenantSnap, userSnap] = await getAllDocs(
    firestore.doc(fsPath.tenant(ctx.tenantId)),
    firestore.doc(fsPath.user(ctx.tenantId, ctx.uid)),
  );

  if (!tenantSnap.exists) fail(ErrorCode.TENANT_NOT_FOUND);
  const tenant = tenantSnap.data() as TenantDoc;
  if (tenant.status !== "active") fail(ErrorCode.AUTH_TENANT_SUSPENDED);

  if (!userSnap.exists) fail(ErrorCode.AUTH_NOT_REGISTERED);
  const user = userSnap.data() as UserDoc;
  if (user.status !== "active") fail(ErrorCode.AUTH_USER_DISABLED);

  const primaryDepartmentId = user.departmentIds[0] ?? null;
  const department = primaryDepartmentId
    ? await firestore.doc(fsPath.department(ctx.tenantId, primaryDepartmentId)).get()
    : null;

  return {
    ...ctx,
    tenant,
    user,
    settings: resolveEffectiveSettings(
      tenant,
      department?.exists ? (department.data() as { overrides?: never }) : null,
    ),
    primaryDepartmentId,
  };
}
