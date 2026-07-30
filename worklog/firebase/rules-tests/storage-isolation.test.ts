import { assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { getBytes, ref, uploadBytes } from "firebase/storage";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

import {
  createTestEnv,
  MEMBER_A,
  MEMBER_B,
  memberOf,
  seedStorage,
  TENANT_A,
  TENANT_ADMIN_A,
  TENANT_B,
  tenantAdminOf,
} from "./helpers";

/**
 * Storage 側のテナント分離（設計書 4.3）。
 * 動画は Firestore を経由せず配信されるため、ここが抜けると Firestore を固めた意味がなくなる。
 *
 * 前提：対象オブジェクトを必ず先に seed する。存在しないパスは 404 でも失敗するので、
 * seed を忘れると「拒否されている」ように見えてテストが空振りする。
 */

let env: RulesTestEnvironment;

const videoPath = (tenantId: string) =>
  `tenants/${tenantId}/captures/2026-07-26/someUser_2026-07-26_1200.mp4`;
const thumbPath = (tenantId: string) =>
  `tenants/${tenantId}/thumbs/2026-07-26/someUser_2026-07-26_1200.jpg`;
const exportPath = (tenantId: string) => `tenants/${tenantId}/exports/attendance-2026-07.csv`;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearStorage();
  await seedStorage(env);
});

describe("動画・サムネイルの読み取り", () => {
  it("自テナントの動画は読める", async () => {
    const storage = memberOf(env, TENANT_A, MEMBER_A).storage();
    await assertSucceeds(getBytes(ref(storage, videoPath(TENANT_A))));
  });

  it("自テナントのサムネイルは読める（グリッド表示 F-301）", async () => {
    const storage = memberOf(env, TENANT_A, MEMBER_A).storage();
    await assertSucceeds(getBytes(ref(storage, thumbPath(TENANT_A))));
  });

  it("他テナントの動画は読めない", async () => {
    const storage = memberOf(env, TENANT_A, MEMBER_A).storage();
    await assertFails(getBytes(ref(storage, videoPath(TENANT_B))));
  });

  it("他テナントのサムネイルも読めない", async () => {
    const storage = memberOf(env, TENANT_A, MEMBER_A).storage();
    await assertFails(getBytes(ref(storage, thumbPath(TENANT_B))));
  });

  it("tenantAdmin でも他テナントは読めない", async () => {
    const storage = tenantAdminOf(env, TENANT_A, TENANT_ADMIN_A).storage();
    await assertFails(getBytes(ref(storage, videoPath(TENANT_B))));
  });

  it("逆方向も確認（B から A は読めない）", async () => {
    const storage = memberOf(env, TENANT_B, MEMBER_B).storage();
    await assertFails(getBytes(ref(storage, videoPath(TENANT_A))));
  });

  it("Claims が無いユーザーは何も読めない", async () => {
    const storage = env.authenticatedContext("uidNoClaims", {}).storage();
    await assertFails(getBytes(ref(storage, videoPath(TENANT_A))));
  });

  it("未認証は読めない", async () => {
    const storage = env.unauthenticatedContext().storage();
    await assertFails(getBytes(ref(storage, videoPath(TENANT_A))));
  });
});

describe("エクスポート物は tenantAdmin 限定 (F-704, F-806)", () => {
  it("tenantAdmin は自テナントのCSVを読める", async () => {
    const storage = tenantAdminOf(env, TENANT_A, TENANT_ADMIN_A).storage();
    await assertSucceeds(getBytes(ref(storage, exportPath(TENANT_A))));
  });

  it("member はCSVを読めない", async () => {
    const storage = memberOf(env, TENANT_A, MEMBER_A).storage();
    await assertFails(getBytes(ref(storage, exportPath(TENANT_A))));
  });

  it("tenantAdmin でも他テナントのCSVは読めない", async () => {
    const storage = tenantAdminOf(env, TENANT_A, TENANT_ADMIN_A).storage();
    await assertFails(getBytes(ref(storage, exportPath(TENANT_B))));
  });
});

describe("クライアントからの直接 PUT は一切許可しない（署名付きURLのみ）", () => {
  const payload = new Uint8Array([9, 9, 9]);

  it("自テナントの captures にもアップロードできない", async () => {
    const storage = memberOf(env, TENANT_A, MEMBER_A).storage();
    await assertFails(
      uploadBytes(ref(storage, `tenants/${TENANT_A}/captures/2026-07-26/forged.mp4`), payload),
    );
  });

  it("既存オブジェクトを上書きできない（証跡の差し替え防止）", async () => {
    const storage = memberOf(env, TENANT_A, MEMBER_A).storage();
    await assertFails(uploadBytes(ref(storage, videoPath(TENANT_A)), payload));
  });

  it("他テナントにアップロードできない", async () => {
    const storage = memberOf(env, TENANT_A, MEMBER_A).storage();
    await assertFails(
      uploadBytes(ref(storage, `tenants/${TENANT_B}/captures/2026-07-26/forged.mp4`), payload),
    );
  });

  it("テナント配下以外にもアップロードできない", async () => {
    const storage = tenantAdminOf(env, TENANT_A, TENANT_ADMIN_A).storage();
    await assertFails(uploadBytes(ref(storage, `elsewhere/forged.mp4`), payload));
  });

  it("tenantAdmin でもエクスポート領域に書き込めない", async () => {
    const storage = tenantAdminOf(env, TENANT_A, TENANT_ADMIN_A).storage();
    await assertFails(uploadBytes(ref(storage, exportPath(TENANT_A)), payload));
  });
});
