import { assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, setDoc, deleteDoc, updateDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createTestEnv,
  deptAdminOf,
  memberOf,
  MEMBER_A,
  MEMBER_B,
  NO_CLAIMS,
  OTHER_A,
  seed,
  TENANT_A,
  TENANT_ADMIN_A,
  TENANT_B,
  TENANT_COLLECTIONS,
  tenantAdminOf,
} from "./helpers";

/**
 * 受け入れ基準 #1「テナントAの認証情報でテナントBのデータに一切アクセスできない」
 * 設計書 4.4 の4ケースをすべてカバーする。CIで毎回回す。
 */

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await seed(env);
});

describe("4.4-1 テナント越境の読み取りが全コレクションで拒否される", () => {
  // 最も権限の強い tenantAdmin で試す。これが通らなければ member も当然通らない
  it.each(TENANT_COLLECTIONS.map((c) => c.name))(
    "tenantAdmin(A) は tenants/tenant-b/%s の単体取得ができない",
    async (name) => {
      const db = tenantAdminOf(env, TENANT_A, TENANT_ADMIN_A).firestore();
      const target = TENANT_COLLECTIONS.find((c) => c.name === name)!;
      await assertFails(getDoc(doc(db, `tenants/${TENANT_B}/${name}/${target.docId}`)));
    },
  );

  it.each(TENANT_COLLECTIONS.map((c) => c.name))(
    "tenantAdmin(A) は tenants/tenant-b/%s の一覧取得ができない",
    async (name) => {
      const db = tenantAdminOf(env, TENANT_A, TENANT_ADMIN_A).firestore();
      await assertFails(getDocs(collection(db, `tenants/${TENANT_B}/${name}`)));
    },
  );

  it("テナントB のテナント設定ドキュメント自体も読めない", async () => {
    const db = tenantAdminOf(env, TENANT_A, TENANT_ADMIN_A).firestore();
    await assertFails(getDoc(doc(db, `tenants/${TENANT_B}`)));
  });

  it("自テナントの同じパスは読める（テストが「常に失敗」で通っていないことの確認）", async () => {
    const db = tenantAdminOf(env, TENANT_A, TENANT_ADMIN_A).firestore();
    await assertSucceeds(getDoc(doc(db, `tenants/${TENANT_A}`)));
    await assertSucceeds(getDocs(collection(db, `tenants/${TENANT_A}/captures`)));
  });

  it("テナントB のメンバーはテナントA を読めない（逆方向も確認）", async () => {
    const db = memberOf(env, TENANT_B, MEMBER_B).firestore();
    await assertFails(getDoc(doc(db, `tenants/${TENANT_A}/captures/someUser_2026-07-26_1200`)));
  });

  it("tenantId クレームを偽装しても、Claims 側の値しか効かない", async () => {
    // クライアントが送るデータではなくトークンのクレームで判定している (F-503)
    const db = env.authenticatedContext(MEMBER_A, { tenantId: TENANT_A, role: "tenantAdmin" }).firestore();
    await assertFails(getDoc(doc(db, `tenants/${TENANT_B}/users/someUser`)));
  });
});

describe("4.4-2 Claims の無いログイン済みユーザーは何も読めない", () => {
  it("tenantId クレームが無い", async () => {
    const db = env.authenticatedContext(NO_CLAIMS, {}).firestore();
    await assertFails(getDoc(doc(db, `tenants/${TENANT_A}`)));
    for (const col of TENANT_COLLECTIONS) {
      await assertFails(getDoc(doc(db, `tenants/${TENANT_A}/${col.name}/${col.docId}`)));
    }
  });

  it("tenantId が空文字でも通らない", async () => {
    const db = env.authenticatedContext(NO_CLAIMS, { tenantId: "", role: "tenantAdmin" }).firestore();
    await assertFails(getDoc(doc(db, `tenants/${TENANT_A}`)));
  });

  it("未認証はもちろん読めない", async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, `tenants/${TENANT_A}`)));
    await assertFails(getDoc(doc(db, `tenants/${TENANT_A}/captures/someUser_2026-07-26_1200`)));
  });
});

describe("4.4-3 auditLogs は追記専用で、tenantAdmin でも消せない (F-805)", () => {
  it("tenantAdmin は読める", async () => {
    const db = tenantAdminOf(env, TENANT_A, TENANT_ADMIN_A).firestore();
    await assertSucceeds(getDoc(doc(db, `tenants/${TENANT_A}/auditLogs/log1`)));
  });

  it("member は読めない", async () => {
    const db = memberOf(env, TENANT_A, MEMBER_A).firestore();
    await assertFails(getDoc(doc(db, `tenants/${TENANT_A}/auditLogs/log1`)));
  });

  it("tenantAdmin でも update できない", async () => {
    const db = tenantAdminOf(env, TENANT_A, TENANT_ADMIN_A).firestore();
    await assertFails(updateDoc(doc(db, `tenants/${TENANT_A}/auditLogs/log1`), { action: "tampered" }));
  });

  it("tenantAdmin でも delete できない", async () => {
    const db = tenantAdminOf(env, TENANT_A, TENANT_ADMIN_A).firestore();
    await assertFails(deleteDoc(doc(db, `tenants/${TENANT_A}/auditLogs/log1`)));
  });

  it("tenantAdmin でも create できない（追記も Functions 経由のみ）", async () => {
    const db = tenantAdminOf(env, TENANT_A, TENANT_ADMIN_A).firestore();
    await assertFails(
      setDoc(doc(db, `tenants/${TENANT_A}/auditLogs/forged`), {
        actorId: "x",
        action: "forged",
        targetPath: "y",
        at: new Date(),
      }),
    );
  });
});

describe("4.4-4 クライアントからの直接 write は全コレクションで拒否される", () => {
  it.each(TENANT_COLLECTIONS.map((c) => c.name))("member は %s に create できない", async (name) => {
    const db = memberOf(env, TENANT_A, MEMBER_A).firestore();
    await assertFails(setDoc(doc(db, `tenants/${TENANT_A}/${name}/forged`), { userId: MEMBER_A }));
  });

  it.each(TENANT_COLLECTIONS.map((c) => c.name))("tenantAdmin でも %s に create できない", async (name) => {
    const db = tenantAdminOf(env, TENANT_A, TENANT_ADMIN_A).firestore();
    await assertFails(setDoc(doc(db, `tenants/${TENANT_A}/${name}/forged2`), { userId: MEMBER_A }));
  });

  it("自分の capture でも直接更新・削除できない（削除は Functions 経由 F-901）", async () => {
    const db = memberOf(env, TENANT_A, MEMBER_A).firestore();
    const path = `tenants/${TENANT_A}/captures/someUser_2026-07-26_1200`;
    await assertFails(updateDoc(doc(db, path), { memo: "書き換え" }));
    await assertFails(deleteDoc(doc(db, path)));
  });

  it("自分の日報でも直接書き込めない（report-save 経由のみ）", async () => {
    const db = memberOf(env, TENANT_A, MEMBER_A).firestore();
    await assertFails(
      updateDoc(doc(db, `tenants/${TENANT_A}/reports/${MEMBER_A}_2026-07-26`), { body: "直書き" }),
    );
  });

  it("テナント設定を書き換えられない（F-506 の変更は Functions 経由）", async () => {
    const db = tenantAdminOf(env, TENANT_A, TENANT_ADMIN_A).firestore();
    await assertFails(updateDoc(doc(db, `tenants/${TENANT_A}`), { allowedDomains: ["evil.com"] }));
  });

  it("自分の users ドキュメントで role を昇格できない", async () => {
    const db = memberOf(env, TENANT_A, MEMBER_A).firestore();
    await assertFails(
      updateDoc(doc(db, `tenants/${TENANT_A}/users/someUser`), { role: "tenantAdmin" }),
    );
  });
});

describe("/ops 配下はクライアントから一切触れない (F-509)", () => {
  const opsPaths = [
    "ops/registry",
    `ops/registry/tenantsIndex/${TENANT_A}`,
    "ops/registry/domainIndex/tenant-a.example.com",
    "ops/registry/operators/opsUser",
  ];

  it.each(opsPaths)("%s を読めない", async (path) => {
    const db = tenantAdminOf(env, TENANT_A, TENANT_ADMIN_A).firestore();
    await assertFails(getDoc(doc(db, path)));
  });

  it("ops クレームを持っていても Firestore からは読めない（/ops 専用Webは Admin SDK 経由）", async () => {
    const db = env.authenticatedContext("opsUser", { ops: true, role: "ops" }).firestore();
    await assertFails(getDoc(doc(db, `ops/registry/tenantsIndex/${TENANT_A}`)));
  });

  it("domainIndex を書き換えて他テナントに入り込めない", async () => {
    const db = tenantAdminOf(env, TENANT_A, TENANT_ADMIN_A).firestore();
    await assertFails(
      setDoc(doc(db, "ops/registry/domainIndex/evil.example.com"), { tenantId: TENANT_B }),
    );
  });
});

describe("テナント内の閲覧範囲（キャッチオールで無効化されていないことの確認）", () => {
  it("日報は本人なら読める", async () => {
    const db = memberOf(env, TENANT_A, MEMBER_A).firestore();
    await assertSucceeds(getDoc(doc(db, `tenants/${TENANT_A}/reports/${MEMBER_A}_2026-07-26`)));
  });

  it("日報は同僚には読めない (F-407)", async () => {
    const db = memberOf(env, TENANT_A, MEMBER_A).firestore();
    await assertFails(getDoc(doc(db, `tenants/${TENANT_A}/reports/${OTHER_A}_2026-07-26`)));
  });

  it("日報の一覧は member には引けない", async () => {
    const db = memberOf(env, TENANT_A, MEMBER_A).firestore();
    await assertFails(getDocs(collection(db, `tenants/${TENANT_A}/reports`)));
  });

  it("部署管理者は自テナントの日報を一覧できる (F-407)", async () => {
    const db = deptAdminOf(env, TENANT_A, "uidDeptAdminA").firestore();
    await assertSucceeds(getDocs(collection(db, `tenants/${TENANT_A}/reports`)));
  });

  it("部署管理者でも他テナントの日報は一覧できない", async () => {
    const db = deptAdminOf(env, TENANT_A, "uidDeptAdminA").firestore();
    await assertFails(getDocs(collection(db, `tenants/${TENANT_B}/reports`)));
  });

  it("勤怠は同僚には読めない", async () => {
    const db = memberOf(env, TENANT_A, MEMBER_A).firestore();
    await assertFails(getDoc(doc(db, `tenants/${TENANT_A}/attendance/${OTHER_A}_2026-07-26`)));
  });

  it("撮影しない時間の申告は同僚には読めない (F-113)", async () => {
    const db = memberOf(env, TENANT_A, MEMBER_A).firestore();
    await assertFails(getDoc(doc(db, `tenants/${TENANT_A}/offDeclarations/${OTHER_A}_2026-07-26`)));
  });

  it("撮影率の集計は member には読めない (F-802/803)", async () => {
    const db = memberOf(env, TENANT_A, MEMBER_A).firestore();
    await assertFails(getDoc(doc(db, `tenants/${TENANT_A}/dailyStats/2026-07-26`)));
  });

  it("サムネイルグリッドのために captures と users は同一テナント内で読める (F-301)", async () => {
    const db = memberOf(env, TENANT_A, MEMBER_A).firestore();
    await assertSucceeds(getDoc(doc(db, `tenants/${TENANT_A}/captures/someUser_2026-07-26_1200`)));
    await assertSucceeds(getDocs(collection(db, `tenants/${TENANT_A}/users`)));
  });
});

describe("ルールに列挙されていないパスは拒否される", () => {
  it("未知のコレクションは読めない（列挙漏れは「読めない」側に倒れる）", async () => {
    const db = tenantAdminOf(env, TENANT_A, TENANT_ADMIN_A).firestore();
    await assertFails(getDoc(doc(db, `tenants/${TENANT_A}/unknownCollection/x`)));
    await assertFails(getDoc(doc(db, `somewhereElse/x`)));
  });

  it("列挙表とルールの整合が取れている（自テナントは全コレクション読めること）", async () => {
    const db = tenantAdminOf(env, TENANT_A, TENANT_ADMIN_A).firestore();
    const results = await Promise.all(
      TENANT_COLLECTIONS.map(async (col) => {
        try {
          await getDoc(doc(db, `tenants/${TENANT_A}/${col.name}/${col.docId}`));
          return { name: col.name, ok: true };
        } catch {
          return { name: col.name, ok: false };
        }
      }),
    );
    // tenantAdmin は自テナントの全コレクションを読める。読めないものがあれば
    // ルールの列挙漏れ（= 越境テストが空振りしている可能性）
    expect(results.filter((r) => !r.ok)).toEqual([]);
  });
});
