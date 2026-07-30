import { ErrorCode, fsPath, type UserDoc } from "@worklog/shared";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  assertEmulator,
  createAuthUser,
  DOMAIN_A,
  DOMAIN_B,
  resetEmulator,
  seedDomain,
  seedTenant,
  seedUser,
  TENANT_A,
  TENANT_B,
} from "../../__tests__/helpers.emulator";
import { auth, db } from "../../lib/admin";
import { ensureTenantCore, type EnsureTenantIdentity } from "../ensureTenant";

/** 初回ログインフロー（設計書 4.1 / F-501〜504, F-507, F-508） */

const identity = (overrides: Partial<EnsureTenantIdentity> = {}): EnsureTenantIdentity => ({
  uid: "uid-taro",
  email: `taro@${DOMAIN_A}`,
  emailVerified: true,
  signInProvider: "google.com",
  name: "山田太郎",
  currentClaims: {},
  ...overrides,
});

/** HttpsError の details.code を取り出す */
const codeOf = async (fn: () => Promise<unknown>): Promise<string> => {
  try {
    await fn();
  } catch (err) {
    const details = (err as { details?: { code?: string } }).details;
    return details?.code ?? `unexpected: ${String(err)}`;
  }
  return "no error thrown";
};

beforeAll(() => {
  assertEmulator();
});

beforeEach(async () => {
  await resetEmulator();
  await seedTenant(TENANT_A);
  await seedDomain(DOMAIN_A, TENANT_A);
  await createAuthUser("uid-taro", `taro@${DOMAIN_A}`);
});

describe("初回ログイン", () => {
  it("ドメインからテナントを確定し Claims を焼き込む (F-502, F-503)", async () => {
    const result = await ensureTenantCore(identity());

    expect(result).toMatchObject({ tenantId: TENANT_A, role: "member", claimsUpdated: true });

    const user = await auth().getUser("uid-taro");
    expect(user.customClaims).toMatchObject({ tenantId: TENANT_A, role: "member" });
  });

  it("users ドキュメントを作る", async () => {
    await ensureTenantCore(identity());
    const snap = await db().doc(fsPath.user(TENANT_A, "uid-taro")).get();
    expect(snap.exists).toBe(true);
    expect(snap.data()).toMatchObject({
      email: `taro@${DOMAIN_A}`,
      name: "山田太郎",
      role: "member",
      status: "active",
    });
  });

  it("監査ログに初回ログインを残す (F-805)", async () => {
    await ensureTenantCore(identity());
    const logs = await db().collection(fsPath.auditLogs(TENANT_A)).get();
    expect(logs.docs.map((d) => d.data().action)).toContain("auth.firstLogin");
  });
});

describe("拒否されるログイン", () => {
  it("個人 Gmail は入れない (F-504)", async () => {
    expect(await codeOf(() => ensureTenantCore(identity({ email: "taro@gmail.com" })))).toBe(
      ErrorCode.AUTH_NOT_WORKSPACE,
    );
  });

  it("Google 以外のプロバイダは入れない (F-501)", async () => {
    expect(await codeOf(() => ensureTenantCore(identity({ signInProvider: "password" })))).toBe(
      ErrorCode.AUTH_NOT_WORKSPACE,
    );
  });

  it("未登録ドメインは入れない", async () => {
    expect(
      await codeOf(() => ensureTenantCore(identity({ email: "taro@unknown.example.com" }))),
    ).toBe(ErrorCode.AUTH_DOMAIN_NOT_ALLOWED);
  });

  it("停止中のテナントは入れない", async () => {
    await seedTenant(TENANT_A, { status: "suspended" });
    expect(await codeOf(() => ensureTenantCore(identity()))).toBe(ErrorCode.AUTH_TENANT_SUSPENDED);
  });

  it("無効化されたユーザーは入れない (F-507, F-606)", async () => {
    await seedUser({ tenantId: TENANT_A, uid: "uid-taro", email: `taro@${DOMAIN_A}`, status: "disabled" });
    expect(await codeOf(() => ensureTenantCore(identity()))).toBe(ErrorCode.AUTH_USER_DISABLED);
  });

  it("domainIndex とテナントの許可ドメインが食い違う場合は拒否する", async () => {
    // 運用ミスでインデックスだけ残った状態。緩い側に倒さない
    await seedDomain(DOMAIN_B, TENANT_A);
    expect(await codeOf(() => ensureTenantCore(identity({ email: `taro@${DOMAIN_B}` })))).toBe(
      ErrorCode.AUTH_DOMAIN_NOT_ALLOWED,
    );
  });

  it("事前登録必須の設定では、招待が無いと入れない", async () => {
    await seedTenant(TENANT_A, { autoProvisionUsers: false });
    expect(await codeOf(() => ensureTenantCore(identity()))).toBe(ErrorCode.AUTH_NOT_REGISTERED);
  });

  it("拒否された場合は Claims が付かない", async () => {
    await codeOf(() => ensureTenantCore(identity({ email: "taro@gmail.com" })));
    const user = await auth().getUser("uid-taro");
    expect(user.customClaims ?? {}).not.toHaveProperty("tenantId");
  });
});

describe("招待 (F-508)", () => {
  it("招待された role と所属を引き継ぐ", async () => {
    await seedTenant(TENANT_A, {
      autoProvisionUsers: false,
      invites: [{ email: `taro@${DOMAIN_A}`, role: "tenantAdmin", departmentIds: ["dept-hq"] }],
    });

    const result = await ensureTenantCore(identity());
    expect(result.role).toBe("tenantAdmin");

    const user = (await db().doc(fsPath.user(TENANT_A, "uid-taro")).get()).data() as UserDoc;
    expect(user.departmentIds).toEqual(["dept-hq"]);
  });

  it("招待は消費されて消える（使い回しできない）", async () => {
    await seedTenant(TENANT_A, {
      autoProvisionUsers: false,
      invites: [{ email: `taro@${DOMAIN_A}`, role: "tenantAdmin" }],
    });
    await ensureTenantCore(identity());

    const tenant = (await db().doc(fsPath.tenant(TENANT_A)).get()).data();
    expect(tenant?.invites ?? []).toEqual([]);
  });

  it("大文字小文字を無視して招待を照合する", async () => {
    await seedTenant(TENANT_A, {
      autoProvisionUsers: false,
      invites: [{ email: `TARO@${DOMAIN_A.toUpperCase()}`, role: "deptAdmin" }],
    });
    const result = await ensureTenantCore(identity());
    expect(result.role).toBe("deptAdmin");
  });
});

describe("2回目以降の呼び出し（冪等性）", () => {
  it("Claims が最新なら書き換えない", async () => {
    await ensureTenantCore(identity());
    const second = await ensureTenantCore(
      identity({ currentClaims: { tenantId: TENANT_A, role: "member" } }),
    );
    expect(second.claimsUpdated).toBe(false);
  });

  it("既存ユーザーの role を上書きしない（自動昇格させない）", async () => {
    await seedUser({
      tenantId: TENANT_A,
      uid: "uid-taro",
      email: `taro@${DOMAIN_A}`,
      role: "tenantAdmin",
    });
    await seedTenant(TENANT_A, {
      invites: [{ email: `taro@${DOMAIN_A}`, role: "member" }],
    });

    const result = await ensureTenantCore(identity());
    expect(result.role).toBe("tenantAdmin");
  });

  it("Claims が古い role を持っていたら Firestore 側に合わせて更新する", async () => {
    await seedUser({
      tenantId: TENANT_A,
      uid: "uid-taro",
      email: `taro@${DOMAIN_A}`,
      role: "deptAdmin",
    });
    const result = await ensureTenantCore(
      identity({ currentClaims: { tenantId: TENANT_A, role: "member" } }),
    );
    expect(result).toMatchObject({ role: "deptAdmin", claimsUpdated: true });

    const user = await auth().getUser("uid-taro");
    expect(user.customClaims).toMatchObject({ role: "deptAdmin" });
  });

  it("別テナントに移った場合も Claims が付け替わる", async () => {
    await seedTenant(TENANT_B, { allowedDomains: [DOMAIN_B] });
    await seedDomain(DOMAIN_B, TENANT_B);
    await createAuthUser("uid-hanako", `hanako@${DOMAIN_B}`);

    const result = await ensureTenantCore(
      identity({
        uid: "uid-hanako",
        email: `hanako@${DOMAIN_B}`,
        currentClaims: { tenantId: TENANT_A, role: "member" },
      }),
    );
    expect(result.tenantId).toBe(TENANT_B);
    const user = await auth().getUser("uid-hanako");
    expect(user.customClaims).toMatchObject({ tenantId: TENANT_B });
  });
});
