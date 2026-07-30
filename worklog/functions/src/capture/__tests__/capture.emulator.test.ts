import {
  ErrorCode,
  buildCaptureId,
  buildVlogId,
  fsPath,
  storagePath,
  type AttendanceDoc,
  type CaptureDoc,
  type VlogDoc,
} from "@worklog/shared";
import { Timestamp } from "firebase-admin/firestore";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  assertEmulator,
  DOMAIN_A,
  resetEmulator,
  seedDepartment,
  seedTenant,
  seedUser,
  TENANT_A,
} from "../../__tests__/helpers.emulator";
import { bucket, db } from "../../lib/admin";
import { loadTenantContext, type TenantContext } from "../../lib/context";
import { commitCapture } from "../commit";
import { deleteCapture } from "../deleteCapture";
import { issueUploadUrl } from "../issueUploadUrl";
import { handleCaptureUploaded } from "../onCaptureUploaded";

/**
 * 撮影の縦串（M3）と削除の伝播（M8 / F-9xx）の統合テスト。
 * Firestore・Auth・Storage エミュレータを使う。
 */

const UID = "uidtaro";
const DEPT = "dept-sales";
const BUSINESS_DATE = "2026-07-26";
const SLOT = "12:00";
const jst = (s: string) => new Date(`${s}+09:00`);

let ctx: TenantContext;

const codeOf = async (fn: () => Promise<unknown>): Promise<string> => {
  try {
    await fn();
  } catch (err) {
    return (err as { details?: { code?: string } }).details?.code ?? `unexpected: ${String(err)}`;
  }
  return "no error thrown";
};

beforeAll(() => {
  assertEmulator();
});

beforeEach(async () => {
  await resetEmulator();
  await seedTenant(TENANT_A);
  await seedDepartment(TENANT_A, DEPT);
  await seedUser({ tenantId: TENANT_A, uid: UID, email: `taro@${DOMAIN_A}`, departmentIds: [DEPT] });
  ctx = await loadTenantContext({ uid: UID, tenantId: TENANT_A, role: "member" });
});

async function issue(overrides: Partial<Parameters<typeof issueUploadUrl>[1]> = {}, now?: Date) {
  return issueUploadUrl(
    ctx,
    {
      businessDate: BUSINESS_DATE,
      slotKey: SLOT,
      capturedAt: jst("2026-07-26T12:04:33").toISOString(),
      camera: "back",
      ...overrides,
    },
    now ?? jst("2026-07-26T12:04:40"),
  );
}

/** 端末からの直PUTの代わりに、実ファイルを Storage に置く */
async function putVideo(captureId: string): Promise<string> {
  const path = storagePath.captureVideo(TENANT_A, BUSINESS_DATE, captureId);
  await bucket().file(path).save(Buffer.from("not-a-real-mp4"), {
    contentType: "video/mp4",
    resumable: false,
  });
  return path;
}

describe("capture-issueUploadUrl", () => {
  it("決定的な captureId で予約ドキュメントを作る", async () => {
    const result = await issue();
    expect(result.captureId).toBe(buildCaptureId(UID, BUSINESS_DATE, SLOT));

    const capture = (await db().doc(fsPath.capture(TENANT_A, result.captureId)).get()).data() as CaptureDoc;
    expect(capture).toMatchObject({
      userId: UID,
      departmentId: DEPT,
      businessDate: BUSINESS_DATE,
      slotKey: SLOT,
      status: "pending",
      isLate: false,
      camera: "back",
    });
  });

  it("撮影時刻を秒精度で保存する (F-105)", async () => {
    const result = await issue();
    const capture = (await db().doc(fsPath.capture(TENANT_A, result.captureId)).get()).data() as CaptureDoc;
    expect(capture.capturedAt.toDate().toISOString()).toBe(jst("2026-07-26T12:04:33").toISOString());
  });

  it("同一スロットの二重撮影を拒否する (CAPTURE/DUPLICATE)", async () => {
    const first = await issue();
    await putVideo(first.captureId);
    await commitCapture(ctx, { captureId: first.captureId });

    expect(await codeOf(() => issue())).toBe(ErrorCode.CAPTURE_DUPLICATE);
  });

  it("アップロード前（pending）なら撮り直せる", async () => {
    const first = await issue();
    const second = await issue();
    expect(second.captureId).toBe(first.captureId);
  });

  it("猶予超過の後追いは遅延フラグ付きで受理する (F-110)", async () => {
    const result = await issue(
      { capturedAt: jst("2026-07-26T13:30:00").toISOString() },
      jst("2026-07-26T13:30:05"),
    );
    expect(result.isLate).toBe(true);

    const capture = (await db().doc(fsPath.capture(TENANT_A, result.captureId)).get()).data() as CaptureDoc;
    expect(capture.isLate).toBe(true);
  });

  it("休日は拒否する（運用ケース「休日・祝日」）", async () => {
    await seedTenant(TENANT_A, { holidays: [BUSINESS_DATE] });
    ctx = await loadTenantContext({ uid: UID, tenantId: TENANT_A, role: "member" });
    expect(await codeOf(() => issue())).toBe(ErrorCode.CAPTURE_HOLIDAY);
  });

  it("存在しないスロットは拒否する", async () => {
    expect(await codeOf(() => issue({ slotKey: "03:00" }))).toBe(ErrorCode.CAPTURE_SLOT_UNKNOWN);
  });

  it("部署の上書き設定が効く（30分間隔の部署では 12:30 が有効 F-111）", async () => {
    await seedDepartment(TENANT_A, DEPT, { overrides: { captureIntervalMin: 30 } });
    ctx = await loadTenantContext({ uid: UID, tenantId: TENANT_A, role: "member" });

    const result = await issue(
      { slotKey: "12:30", capturedAt: jst("2026-07-26T12:31:00").toISOString() },
      jst("2026-07-26T12:31:05"),
    );
    expect(result.isLate).toBe(false);
  });
});

describe("capture-commit", () => {
  it("実ファイルが無ければ拒否する", async () => {
    const { captureId } = await issue();
    expect(await codeOf(() => commitCapture(ctx, { captureId }))).toBe(
      ErrorCode.CAPTURE_NOT_UPLOADED,
    );
  });

  it("メモと作業タグを保存し、状態を進める", async () => {
    const { captureId } = await issue();
    await putVideo(captureId);

    const { capture } = await commitCapture(ctx, {
      captureId,
      memo: "A社訪問",
      workTag: "営業",
    });
    expect(capture.status).toBe("uploaded");

    const doc = (await db().doc(fsPath.capture(TENANT_A, captureId)).get()).data() as CaptureDoc;
    expect(doc).toMatchObject({ memo: "A社訪問", workTag: "営業", status: "uploaded" });
  });

  it("テナントに定義されていない作業タグは拒否する (F-108)", async () => {
    const { captureId } = await issue();
    await putVideo(captureId);
    expect(await codeOf(() => commitCapture(ctx, { captureId, workTag: "存在しないタグ" }))).toBe(
      ErrorCode.INVALID_ARGUMENT,
    );
  });

  it("他人の撮影には commit できない", async () => {
    const { captureId } = await issue();
    await putVideo(captureId);
    const otherId = buildCaptureId("uidhanako", BUSINESS_DATE, SLOT);
    expect(await codeOf(() => commitCapture(ctx, { captureId: otherId }))).toBe(
      ErrorCode.AUTH_FORBIDDEN,
    );
  });

  it("初回撮影が出勤時刻候補として勤怠に入る (F-701)", async () => {
    const { captureId } = await issue();
    await putVideo(captureId);
    await commitCapture(ctx, { captureId });

    const record = (
      await db().doc(fsPath.attendanceRecord(TENANT_A, `${UID}_${BUSINESS_DATE}`)).get()
    ).data() as AttendanceDoc;
    expect(record.firstCaptureAt?.toDate().toISOString()).toBe(
      jst("2026-07-26T12:04:33").toISOString(),
    );
    expect(record.lastCaptureAt?.toDate().toISOString()).toBe(
      jst("2026-07-26T12:04:33").toISOString(),
    );
  });

  it("後の撮影で退勤時刻候補だけが更新される (F-701)", async () => {
    const first = await issue();
    await putVideo(first.captureId);
    await commitCapture(ctx, { captureId: first.captureId });

    const second = await issue(
      { slotKey: "16:00", capturedAt: jst("2026-07-26T16:02:00").toISOString() },
      jst("2026-07-26T16:02:10"),
    );
    await putVideo(second.captureId);
    await commitCapture(ctx, { captureId: second.captureId });

    const record = (
      await db().doc(fsPath.attendanceRecord(TENANT_A, `${UID}_${BUSINESS_DATE}`)).get()
    ).data() as AttendanceDoc;
    expect(record.firstCaptureAt?.toDate().toISOString()).toBe(
      jst("2026-07-26T12:04:33").toISOString(),
    );
    expect(record.lastCaptureAt?.toDate().toISOString()).toBe(
      jst("2026-07-26T16:02:00").toISOString(),
    );
  });
});

describe("onCaptureUploaded の冪等性（設計書 5.2 の注記）", () => {
  it("captures 以外のパスでは何もしない（サムネ書き込みでの再入防止）", async () => {
    await handleCaptureUploaded(storagePath.captureThumb(TENANT_A, BUSINESS_DATE, "x"));
    await handleCaptureUploaded(storagePath.vlogPage(TENANT_A, BUSINESS_DATE, "v1", 1));
    // 例外にならなければよい
  });

  it("予約ドキュメントの無い孤児オブジェクトは削除する", async () => {
    const orphanId = buildCaptureId("uidghost", BUSINESS_DATE, SLOT);
    const path = await putVideo(orphanId);

    await handleCaptureUploaded(path);

    const [exists] = await bucket().file(path).exists();
    expect(exists).toBe(false);
  });

  it("すでに削除済みなら、届いた実ファイルを消して削除を勝たせる (F-903)", async () => {
    const { captureId } = await issue();
    await db().doc(fsPath.capture(TENANT_A, captureId)).update({ status: "deleted" });
    const path = await putVideo(captureId);

    await handleCaptureUploaded(path);

    const [exists] = await bucket().file(path).exists();
    expect(exists).toBe(false);
    const doc = (await db().doc(fsPath.capture(TENANT_A, captureId)).get()).data() as CaptureDoc;
    expect(doc.status).toBe("deleted");
  });

  it("commit が先に走っていても状態が後退しない", async () => {
    const { captureId } = await issue();
    const path = await putVideo(captureId);
    await commitCapture(ctx, { captureId, memo: "先に commit" });

    await handleCaptureUploaded(path);

    const doc = (await db().doc(fsPath.capture(TENANT_A, captureId)).get()).data() as CaptureDoc;
    // サムネイル生成は不正なmp4なので失敗するが、ready まで進む
    expect(doc.status).toBe("ready");
    expect(doc.memo).toBe("先に commit");
  });

  it("2回同じイベントが来ても壊れない", async () => {
    const { captureId } = await issue();
    const path = await putVideo(captureId);
    await handleCaptureUploaded(path);
    await handleCaptureUploaded(path);

    const doc = (await db().doc(fsPath.capture(TENANT_A, captureId)).get()).data() as CaptureDoc;
    expect(doc.status).toBe("ready");
  });
});

describe("capture-delete (F-901〜905)", () => {
  async function readyCapture(): Promise<string> {
    const { captureId } = await issue();
    const videoPath = await putVideo(captureId);
    await commitCapture(ctx, { captureId, memo: "写り込みあり" });
    // サムネイルがある状態を模す
    const thumb = storagePath.captureThumb(TENANT_A, BUSINESS_DATE, captureId);
    await bucket().file(thumb).save(Buffer.from("jpg"), { contentType: "image/jpeg", resumable: false });
    await db().doc(fsPath.capture(TENANT_A, captureId)).update({ status: "ready", thumbPath: thumb });
    expect(videoPath).toBeTruthy();
    return captureId;
  }

  it("本人はいつでも削除できる (F-901)", async () => {
    const captureId = await readyCapture();
    await expect(deleteCapture(ctx, { captureId, reason: "同僚が写った" })).resolves.toEqual({
      ok: true,
    });
  });

  it("映像とサムネイルが Storage から消える (F-903)", async () => {
    const captureId = await readyCapture();
    await deleteCapture(ctx, { captureId });

    const [video] = await bucket()
      .file(storagePath.captureVideo(TENANT_A, BUSINESS_DATE, captureId))
      .exists();
    const [thumb] = await bucket()
      .file(storagePath.captureThumb(TENANT_A, BUSINESS_DATE, captureId))
      .exists();
    expect(video).toBe(false);
    expect(thumb).toBe(false);
  });

  it("枠と撮影時刻は残る (F-902, F-706)", async () => {
    const captureId = await readyCapture();
    await deleteCapture(ctx, { captureId });

    const doc = (await db().doc(fsPath.capture(TENANT_A, captureId)).get()).data() as CaptureDoc;
    expect(doc.status).toBe("deleted");
    expect(doc.deletedAt).toBeTruthy();
    expect(doc.thumbPath).toBeNull();
    // 勤怠の整合性のために時刻は保持する
    expect(doc.capturedAt.toDate().toISOString()).toBe(jst("2026-07-26T12:04:33").toISOString());
    expect(doc.slotKey).toBe(SLOT);
  });

  it("勤怠の出退勤候補は削除後も残る (F-706)", async () => {
    const captureId = await readyCapture();
    await deleteCapture(ctx, { captureId });

    const record = (
      await db().doc(fsPath.attendanceRecord(TENANT_A, `${UID}_${BUSINESS_DATE}`)).get()
    ).data() as AttendanceDoc;
    expect(record.firstCaptureAt?.toDate().toISOString()).toBe(
      jst("2026-07-26T12:04:33").toISOString(),
    );
  });

  it("生成済み Vlog に再生成マークが付く (F-905)", async () => {
    const captureId = await readyCapture();
    const deptVlogId = buildVlogId("department", DEPT, BUSINESS_DATE);
    const personalVlogId = buildVlogId("personal", UID, BUSINESS_DATE);
    for (const id of [deptVlogId, personalVlogId]) {
      await db().doc(fsPath.vlog(TENANT_A, id)).set({
        scope: id.startsWith("department") ? "department" : "personal",
        targetId: id.startsWith("department") ? DEPT : UID,
        businessDate: BUSINESS_DATE,
        status: "ready",
        pages: [],
        generatedAt: Timestamp.now(),
      });
    }

    await deleteCapture(ctx, { captureId });

    for (const id of [deptVlogId, personalVlogId]) {
      const vlog = (await db().doc(fsPath.vlog(TENANT_A, id)).get()).data() as VlogDoc;
      expect(vlog.status).toBe("pending");
      expect(vlog.regenerateRequestedAt).toBeTruthy();
    }
  });

  it("監査ログに残る (F-904)", async () => {
    const captureId = await readyCapture();
    await deleteCapture(ctx, { captureId });

    const logs = await db().collection(fsPath.auditLogs(TENANT_A)).get();
    const deleteLog = logs.docs.find((d) => d.data().action === "capture.delete");
    expect(deleteLog).toBeTruthy();
    // 削除理由の本文はログに残さない
    expect(deleteLog?.data().detail).toMatchObject({ slotKey: SLOT, hasReason: false });
  });

  it("二重削除は成功として返す（冪等）", async () => {
    const captureId = await readyCapture();
    await deleteCapture(ctx, { captureId });
    await expect(deleteCapture(ctx, { captureId })).resolves.toEqual({ ok: true });
  });

  it("他人の撮影は削除できない（管理者でも本人以外は不可 F-901）", async () => {
    const otherId = buildCaptureId("uidhanako", BUSINESS_DATE, SLOT);
    expect(await codeOf(() => deleteCapture(ctx, { captureId: otherId }))).toBe(
      ErrorCode.AUTH_FORBIDDEN,
    );
  });

  it("削除後は同じスロットで撮り直せる（枠は残るが再撮影は可能）", async () => {
    const captureId = await readyCapture();
    await deleteCapture(ctx, { captureId });

    const again = await issue(
      { capturedAt: jst("2026-07-26T12:40:00").toISOString() },
      jst("2026-07-26T12:40:05"),
    );
    expect(again.captureId).toBe(captureId);
    const doc = (await db().doc(fsPath.capture(TENANT_A, captureId)).get()).data() as CaptureDoc;
    expect(doc.status).toBe("pending");
    // 前回のメモは引き継がない
    expect(doc.memo).toBeUndefined();
  });
});
