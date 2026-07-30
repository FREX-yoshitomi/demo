import {
  DEFAULT_TIMEZONE,
  ErrorCode,
  fsPath,
  type DomainIndexDoc,
  type EnsureTenantResult,
  type Role,
  type TenantDoc,
  type UserDoc,
  type WorklogClaims,
} from "@worklog/shared";
import { FieldValue } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";

import { auth, db } from "../lib/admin";
import { writeAuditLog } from "../lib/audit";
import { fail } from "../lib/errors";
import { checkWorkspaceIdentity } from "./domain";

/**
 * 初回ログインフロー（設計書 4.1 / F-501〜504, F-507）。
 *
 * 1. Google ログインであること・メールが検証済みであることを確認
 * 2. ドメイン（または hd）→ /ops/registry/domainIndex/{domain} でテナントを逆引き
 * 3. テナントが active か確認
 * 4. Custom Claims に tenantId / role を焼き込む (F-503)
 * 5. users/{uid} が無ければ招待または自動受け入れの設定に従って作成
 *
 * 冪等。2回目以降の呼び出しでは Claims が最新かどうかだけ確認して返す。
 */

export interface EnsureTenantIdentity {
  uid: string;
  email?: string;
  emailVerified: boolean;
  signInProvider: string;
  name?: string;
  picture?: string;
  /** blocking function 経由の場合のみ入る本物の hd */
  hd?: string;
  currentClaims: { tenantId?: unknown; role?: unknown };
}

export async function ensureTenantCore(
  identity: EnsureTenantIdentity,
): Promise<EnsureTenantResult> {
  const check = checkWorkspaceIdentity(identity);
  if (!check.ok) {
    logger.warn("ensureTenant rejected", { uid: identity.uid, reason: check.reason });
    // 個人 Gmail・未検証・Google以外はすべて「会社アカウントで入り直せ」に集約する
    fail(ErrorCode.AUTH_NOT_WORKSPACE, { reason: check.reason });
  }

  const firestore = db();
  const domainSnap = await firestore.doc(fsPath.domainIndex(check.domain)).get();
  if (!domainSnap.exists) {
    logger.warn("ensureTenant unknown domain", { uid: identity.uid, domain: check.domain });
    fail(ErrorCode.AUTH_DOMAIN_NOT_ALLOWED, { domain: check.domain });
  }
  const { tenantId } = domainSnap.data() as DomainIndexDoc;

  const tenantRef = firestore.doc(fsPath.tenant(tenantId));
  const tenantSnap = await tenantRef.get();
  if (!tenantSnap.exists) fail(ErrorCode.TENANT_NOT_FOUND, { tenantId });
  const tenant = tenantSnap.data() as TenantDoc;
  if (tenant.status !== "active") fail(ErrorCode.AUTH_TENANT_SUSPENDED, { tenantId });

  // 許可ドメインはテナント側にも持っている。domainIndex と食い違ったら信用しない
  if (!tenant.allowedDomains.map((d) => d.toLowerCase()).includes(check.domain)) {
    logger.error("domainIndex and tenant.allowedDomains disagree", {
      tenantId,
      domain: check.domain,
    });
    fail(ErrorCode.AUTH_DOMAIN_NOT_ALLOWED, { domain: check.domain });
  }

  const userRef = firestore.doc(fsPath.user(tenantId, identity.uid));
  const role = await firestore.runTransaction(async (tx): Promise<Role> => {
    const [userSnap, freshTenantSnap] = await Promise.all([tx.get(userRef), tx.get(tenantRef)]);
    const freshTenant = freshTenantSnap.data() as TenantDoc;

    if (userSnap.exists) {
      const user = userSnap.data() as UserDoc;
      if (user.status !== "active") fail(ErrorCode.AUTH_USER_DISABLED);
      return user.role;
    }

    // 招待があれば role と所属を引き継ぐ (F-508)。消費したら削除する
    const invites = freshTenant.invites ?? [];
    const email = identity.email?.toLowerCase();
    const invite = email ? invites.find((i) => i.email.toLowerCase() === email) : undefined;

    if (!invite && !freshTenant.autoProvisionUsers) {
      // 事前登録が必須の設定。管理Webで登録されるまで入れない
      fail(ErrorCode.AUTH_NOT_REGISTERED, { tenantId });
    }

    const newUser: Omit<UserDoc, "joinedAt"> & { joinedAt: FieldValue } = {
      email: identity.email ?? "",
      name: identity.name ?? identity.email ?? identity.uid,
      photoUrl: identity.picture,
      departmentIds: invite?.departmentIds ?? [],
      role: invite?.role ?? "member",
      status: "active",
      crossViewDeptIds: [],
      fcmTokens: [],
      joinedAt: FieldValue.serverTimestamp(),
      leftAt: null,
    };
    tx.set(userRef, newUser);

    if (invite) {
      tx.update(tenantRef, { invites: FieldValue.arrayRemove(invite) });
    }
    return newUser.role;
  });

  // Claims が既に正しければ書き換えない（トークン再取得を無駄に発生させない）
  const claimsUpToDate =
    identity.currentClaims.tenantId === tenantId && identity.currentClaims.role === role;

  if (!claimsUpToDate) {
    const claims: WorklogClaims = { tenantId, role };
    await auth().setCustomUserClaims(identity.uid, claims);
    await writeAuditLog({
      tenantId,
      actorId: identity.uid,
      action: identity.currentClaims.tenantId ? "auth.claimsUpdated" : "auth.firstLogin",
      targetPath: fsPath.user(tenantId, identity.uid),
      detail: { domain: check.domain, role },
    });
  }

  return {
    tenantId,
    role,
    claimsUpdated: !claimsUpToDate,
    tenantName: tenant.name,
    timezone: tenant.timezone || DEFAULT_TIMEZONE,
  };
}
