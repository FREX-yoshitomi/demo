import {
  DEFAULT_CAPTURE_GRACE_MIN,
  DEFAULT_GRID_SIZE,
  DEFAULT_RETENTION_MONTHS,
  DEFAULT_TIMEZONE,
  fsPath,
  type Role,
  type TenantDoc,
} from "@worklog/shared";
import { Timestamp } from "firebase-admin/firestore";

import { auth, bucket, db } from "../lib/admin";

/** エミュレータ用の共通セットアップ。emulators:exec の配下で動く前提 */

export const TENANT_A = "tenant-a";
export const TENANT_B = "tenant-b";
export const DOMAIN_A = "acme.co.jp";
export const DOMAIN_B = "beta.example.com";

export function assertEmulator(): void {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error(
      "FIRESTORE_EMULATOR_HOST が設定されていません。pnpm test:emulator から実行してください",
    );
  }
}

export function tenantFixture(overrides: Partial<TenantDoc> = {}): Record<string, unknown> {
  return {
    name: "テスト株式会社",
    status: "active",
    allowedDomains: [DOMAIN_A],
    timezone: DEFAULT_TIMEZONE,
    holidays: [],
    captureIntervalMin: 60,
    workingHours: { start: "09:00", end: "18:00" },
    captureGraceMin: DEFAULT_CAPTURE_GRACE_MIN,
    workTags: ["営業", "開発", "会議"],
    defaultCamera: "back",
    reportTemplate: "本日の業務／進捗／課題／明日の予定",
    reportDeadline: "12:00",
    gridSize: DEFAULT_GRID_SIZE,
    aiMode: "text",
    retentionMonths: DEFAULT_RETENTION_MONTHS,
    autoProvisionUsers: true,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    ...overrides,
  };
}

export async function resetEmulator(): Promise<void> {
  const projectId = process.env.GCLOUD_PROJECT ?? "worklog-test";
  const host = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
  await fetch(`http://${host}/emulator/v1/projects/${projectId}/databases/(default)/documents`, {
    method: "DELETE",
  });

  const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  if (authHost) {
    await fetch(`http://${authHost}/emulator/v1/projects/${projectId}/accounts`, {
      method: "DELETE",
    });
  }

  // Storage も必ず消す。captureId は決定的なので、前のテストの実ファイルが残っていると
  // 「アップロード済み」と誤判定されてテストが空振りする
  if (process.env.STORAGE_EMULATOR_HOST) {
    await bucket().deleteFiles({ force: true });
  }
}

export async function seedTenant(
  tenantId: string,
  overrides: Partial<TenantDoc> = {},
): Promise<void> {
  await db().doc(fsPath.tenant(tenantId)).set(tenantFixture(overrides));
}

export async function seedDomain(domain: string, tenantId: string): Promise<void> {
  await db().doc(fsPath.domainIndex(domain)).set({ tenantId, addedAt: Timestamp.now() });
}

export async function seedUser(params: {
  tenantId: string;
  uid: string;
  email: string;
  role?: Role;
  departmentIds?: string[];
  status?: "active" | "disabled";
  crossViewDeptIds?: string[];
}): Promise<void> {
  await db()
    .doc(fsPath.user(params.tenantId, params.uid))
    .set({
      email: params.email,
      name: params.email.split("@")[0],
      departmentIds: params.departmentIds ?? ["dept-sales"],
      role: params.role ?? "member",
      status: params.status ?? "active",
      crossViewDeptIds: params.crossViewDeptIds ?? [],
      fcmTokens: [],
      joinedAt: Timestamp.fromDate(new Date("2026-01-01T00:00:00Z")),
      leftAt: null,
    });
}

export async function seedDepartment(
  tenantId: string,
  deptId: string,
  overrides?: Record<string, unknown>,
): Promise<void> {
  await db()
    .doc(fsPath.department(tenantId, deptId))
    .set({ name: deptId, parentId: null, order: 0, ...overrides });
}

/** Auth エミュレータにユーザーを作る（setCustomUserClaims の対象にするため） */
export async function createAuthUser(uid: string, email: string): Promise<void> {
  try {
    await auth().createUser({ uid, email, emailVerified: true });
  } catch (err) {
    if (!(err instanceof Error) || !err.message.includes("already exists")) throw err;
  }
}
