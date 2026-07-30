import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";

export const PROJECT_ID = "worklog-test";

export const TENANT_A = "tenant-a";
export const TENANT_B = "tenant-b";

/** テナントAの一般メンバー */
export const MEMBER_A = "uidMemberA";
/** テナントAの別メンバー（他人のデータが見えないことの確認用） */
export const OTHER_A = "uidOtherA";
export const DEPT_ADMIN_A = "uidDeptAdminA";
export const TENANT_ADMIN_A = "uidTenantAdminA";
/** テナントBのメンバー */
export const MEMBER_B = "uidMemberB";
/** Claims が付いていないログイン済みユーザー（初回ログイン直後の状態） */
export const NO_CLAIMS = "uidNoClaims";

const rulesFile = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), "utf8");

export async function createTestEnv(): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: rulesFile("firestore.rules"),
      host: "127.0.0.1",
      port: 8080,
    },
    storage: {
      rules: rulesFile("storage.rules"),
      host: "127.0.0.1",
      port: 9199,
    },
  });
}

export function memberOf(env: RulesTestEnvironment, tenantId: string, uid: string) {
  return env.authenticatedContext(uid, { tenantId, role: "member" });
}

export function deptAdminOf(env: RulesTestEnvironment, tenantId: string, uid: string) {
  return env.authenticatedContext(uid, { tenantId, role: "deptAdmin" });
}

export function tenantAdminOf(env: RulesTestEnvironment, tenantId: string, uid: string) {
  return env.authenticatedContext(uid, { tenantId, role: "tenantAdmin" });
}

/**
 * テナント配下の全コレクション。
 *
 * ⚠️ 新しいコレクションを追加したら、必ずここに1行足すこと。
 *    firestore.rules 側の列挙とこの表がズレると、越境テストが「存在しないコレクション」を
 *    見ているだけになって無意味になる。PRのレビュー項目にする（設計書 4.4）。
 */
export const TENANT_COLLECTIONS = [
  { name: "users", docId: "someUser", data: () => ({ email: "x@example.com", name: "X", role: "member", status: "active", departmentIds: [], crossViewDeptIds: [], fcmTokens: [] }) },
  { name: "departments", docId: "dept1", data: () => ({ name: "営業部", parentId: null, order: 0 }) },
  { name: "captures", docId: "someUser_2026-07-26_1200", data: () => ({ userId: "someUser", businessDate: "2026-07-26", slotKey: "12:00", status: "ready", isLate: false }) },
  { name: "offDeclarations", docId: "someUser_2026-07-26", data: () => ({ userId: "someUser", businessDate: "2026-07-26", slotKeys: ["12:00"] }) },
  { name: "vlogs", docId: "department_dept1_2026-07-26", data: () => ({ scope: "department", targetId: "dept1", businessDate: "2026-07-26", status: "ready", pages: [] }) },
  { name: "reports", docId: "someUser_2026-07-26", data: () => ({ userId: "someUser", businessDate: "2026-07-26", body: "", status: "draft", comments: [] }) },
  { name: "attendance", docId: "someUser_2026-07-26", data: () => ({ userId: "someUser", businessDate: "2026-07-26", workType: "normal", breaks: [], corrections: [] }) },
  { name: "dailyStats", docId: "2026-07-26", data: () => ({ businessDate: "2026-07-26", byDept: {} }) },
  { name: "auditLogs", docId: "log1", data: () => ({ actorId: "someUser", action: "capture.view", targetPath: "x", at: new Date() }) },
] as const;

/** 両テナントに同じ形のデータを投入する。ルールを無効化した状態で書く */
export async function seed(env: RulesTestEnvironment): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const tenantId of [TENANT_A, TENANT_B]) {
      await db.doc(`tenants/${tenantId}`).set({
        name: tenantId,
        status: "active",
        allowedDomains: [`${tenantId}.example.com`],
        timezone: "Asia/Tokyo",
      });
      for (const col of TENANT_COLLECTIONS) {
        await db.doc(`tenants/${tenantId}/${col.name}/${col.docId}`).set(col.data());
      }
      // 本人／他人の判定を確かめるための日報・勤怠
      await db.doc(`tenants/${tenantId}/reports/${MEMBER_A}_2026-07-26`).set({
        userId: MEMBER_A,
        businessDate: "2026-07-26",
        body: "本人の日報",
        status: "draft",
        comments: [],
      });
      await db.doc(`tenants/${tenantId}/reports/${OTHER_A}_2026-07-26`).set({
        userId: OTHER_A,
        businessDate: "2026-07-26",
        body: "他人の日報",
        status: "draft",
        comments: [],
      });
      await db.doc(`tenants/${tenantId}/attendance/${OTHER_A}_2026-07-26`).set({
        userId: OTHER_A,
        businessDate: "2026-07-26",
        workType: "normal",
        breaks: [],
        corrections: [],
      });
      await db.doc(`tenants/${tenantId}/offDeclarations/${OTHER_A}_2026-07-26`).set({
        userId: OTHER_A,
        businessDate: "2026-07-26",
        slotKeys: ["12:00"],
      });
    }

    // 提供者側データ (F-509)
    await db.doc("ops/registry").set({ note: "ops root" });
    await db.doc(`ops/registry/tenantsIndex/${TENANT_A}`).set({ name: "A", status: "active", userCount: 1 });
    await db.doc(`ops/registry/domainIndex/tenant-a.example.com`).set({ tenantId: TENANT_A });
    await db.doc(`ops/registry/operators/opsUser`).set({ email: "ops@frex.works", role: "ops" });
  });
}

/** テナントごとに1つずつ動画・サムネイル・エクスポートを置く */
export async function seedStorage(env: RulesTestEnvironment): Promise<void> {
  const { ref, uploadBytes } = await import("firebase/storage");
  await env.withSecurityRulesDisabled(async (ctx) => {
    const storage = ctx.storage();
    const payload = new Uint8Array([0, 1, 2, 3]);
    for (const tenantId of [TENANT_A, TENANT_B]) {
      await uploadBytes(
        ref(storage, `tenants/${tenantId}/captures/2026-07-26/someUser_2026-07-26_1200.mp4`),
        payload,
        { contentType: "video/mp4" },
      );
      await uploadBytes(
        ref(storage, `tenants/${tenantId}/thumbs/2026-07-26/someUser_2026-07-26_1200.jpg`),
        payload,
        { contentType: "image/jpeg" },
      );
      await uploadBytes(
        ref(storage, `tenants/${tenantId}/exports/attendance-2026-07.csv`),
        payload,
        { contentType: "text/csv" },
      );
    }
  });
}
