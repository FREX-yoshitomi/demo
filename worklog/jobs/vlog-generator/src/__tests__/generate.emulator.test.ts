import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  buildCaptureId,
  buildVlogId,
  fsPath,
  storagePath,
  type VlogDoc,
} from "@worklog/shared";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { bucket, db } from "../gcp";
import { generateForTenant } from "../main";
import { runFfmpeg } from "../render";

const execFileAsync = promisify(execFile);

/**
 * ジョブ全体の統合テスト。Firestore / Storage エミュレータ + 実 FFmpeg。
 *
 * 純ロジックのテストでは分からないところを確かめる：
 *  - 撮影を Storage から取ってきて Vlog を作り、Storage へ戻せるか
 *  - 二重起動しても作り直さないか（冪等）
 *  - 削除で立った再生成マークを拾って作り直すか (F-905)
 */

const FFMPEG = process.env.FFMPEG_PATH ?? "/usr/bin/ffmpeg";
const TENANT = "acme";
const BUSINESS_DATE = "2026-07-26";
const DEPT = "sales";
const jst = (s: string) => new Date(`${s}+09:00`);

let workDir: string;
let clipPath: string;

async function resetEmulator(): Promise<void> {
  const projectId = process.env.GCLOUD_PROJECT ?? "worklog-test";
  const host = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
  await fetch(`http://${host}/emulator/v1/projects/${projectId}/databases/(default)/documents`, {
    method: "DELETE",
  });
  await bucket().deleteFiles({ force: true });
}

async function seed(): Promise<void> {
  const firestore = db();

  await firestore.doc(fsPath.tenant(TENANT)).set({
    name: "株式会社アクメ",
    status: "active",
    allowedDomains: ["acme.co.jp"],
    timezone: "Asia/Tokyo",
    holidays: [],
    captureIntervalMin: 60,
    workingHours: { start: "09:00", end: "18:00" },
    captureGraceMin: 50,
    workTags: [],
    defaultCamera: "back",
    reportTemplate: "",
    reportDeadline: "12:00",
    gridSize: 4,
    aiMode: "text",
    retentionMonths: 13,
    autoProvisionUsers: true,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });

  await firestore.doc(fsPath.department(TENANT, DEPT)).set({
    name: "営業部",
    parentId: null,
    order: 0,
  });

  const users = [
    { id: "uidtaro", name: "山田 太郎" },
    { id: "uidhanako", name: "佐藤 花子" },
  ];
  for (const user of users) {
    await firestore.doc(fsPath.user(TENANT, user.id)).set({
      email: `${user.id}@acme.co.jp`,
      name: user.name,
      departmentIds: [DEPT],
      role: "member",
      status: "active",
      crossViewDeptIds: [],
      fcmTokens: [],
      joinedAt: Timestamp.now(),
      leftAt: null,
    });
  }
}

/** 実ファイル付きの撮影を作る */
async function seedCapture(params: {
  userId: string;
  slotKey: string;
  minute: string;
  status?: "ready" | "deleted";
}): Promise<string> {
  const captureId = buildCaptureId(params.userId, BUSINESS_DATE, params.slotKey);
  const videoPath = storagePath.captureVideo(TENANT, BUSINESS_DATE, captureId);
  const status = params.status ?? "ready";

  if (status === "ready") {
    await bucket().upload(clipPath, {
      destination: videoPath,
      contentType: "video/mp4",
      resumable: false,
    });
  }

  await db()
    .doc(fsPath.capture(TENANT, captureId))
    .set({
      userId: params.userId,
      departmentId: DEPT,
      businessDate: BUSINESS_DATE,
      slotKey: params.slotKey,
      capturedAt: Timestamp.fromDate(
        jst(`2026-07-26T${params.slotKey.slice(0, 2)}:${params.minute}:33`),
      ),
      status,
      videoPath,
      thumbPath: null,
      durationSec: 2,
      isLate: false,
      camera: "back",
      deletedAt: status === "deleted" ? Timestamp.now() : null,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });

  return captureId;
}

async function objectExists(objectPath: string): Promise<boolean> {
  const [exists] = await bucket().file(objectPath).exists();
  return exists;
}

async function probeDuration(objectPath: string): Promise<number> {
  const local = join(workDir, `probe_${Date.now()}.mp4`);
  await bucket().file(objectPath).download({ destination: local });
  const ffprobe = FFMPEG.replace(/ffmpeg$/, "ffprobe");
  const { stdout } = await execFileAsync(ffprobe, [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=nw=1:nk=1",
    local,
  ]);
  return Number(stdout.trim());
}

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("エミュレータ配下で実行してください（pnpm test:emulator）");
  }
  if (!existsSync(FFMPEG)) throw new Error(`FFmpeg が見つかりません: ${FFMPEG}`);

  workDir = await mkdtemp(join(tmpdir(), "vlog-job-test-"));
  clipPath = join(workDir, "clip.mp4");
  await runFfmpeg(FFMPEG, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=720x1280:rate=30:duration=2",
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    "-y",
    clipPath,
  ]);
}, 180_000);

afterAll(async () => {
  if (workDir) await rm(workDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await resetEmulator();
  await seed();
});

const deptVlogId = buildVlogId("department", DEPT, BUSINESS_DATE);
const personalVlogId = buildVlogId("personal", "uidtaro", BUSINESS_DATE);

describe("generateForTenant", () => {
  it("部署ログと個人ログの Vlog を作り、Storage に置く (F-306)", async () => {
    await seedCapture({ userId: "uidtaro", slotKey: "09:00", minute: "04" });
    await seedCapture({ userId: "uidhanako", slotKey: "09:00", minute: "07" });

    const result = await generateForTenant(TENANT, { businessDate: BUSINESS_DATE });
    expect(result.failed).toBe(0);
    expect(result.generated).toBeGreaterThanOrEqual(2);

    const vlog = (await db().doc(fsPath.vlog(TENANT, deptVlogId)).get()).data() as VlogDoc;
    expect(vlog.status).toBe("ready");
    expect(vlog.scope).toBe("department");
    expect(vlog.pages).toHaveLength(1);
    expect(vlog.pages[0]?.memberIds.sort()).toEqual(["uidhanako", "uidtaro"]);

    expect(await objectExists(vlog.pages[0]!.videoPath)).toBe(true);
  }, 300_000);

  it("スロット数ぶんの長さになる（時系列に結合される F-306）", async () => {
    await seedCapture({ userId: "uidtaro", slotKey: "09:00", minute: "04" });
    await seedCapture({ userId: "uidtaro", slotKey: "10:00", minute: "02" });
    await seedCapture({ userId: "uidtaro", slotKey: "11:00", minute: "31" });

    await generateForTenant(TENANT, { businessDate: BUSINESS_DATE });

    const vlog = (await db().doc(fsPath.vlog(TENANT, personalVlogId)).get()).data() as VlogDoc;
    const duration = await probeDuration(vlog.pages[0]!.videoPath);
    // 2秒 × 3スロット
    expect(duration).toBeGreaterThan(5.8);
    expect(duration).toBeLessThan(6.4);
  }, 300_000);

  it("1本も撮影が無い日は Vlog を作らない", async () => {
    const result = await generateForTenant(TENANT, { businessDate: BUSINESS_DATE });
    expect(result.generated).toBe(0);
    expect((await db().doc(fsPath.vlog(TENANT, deptVlogId)).get()).exists).toBe(false);
  }, 120_000);

  it("2回流しても作り直さない（夜間バッチの二重起動に耐える）", async () => {
    await seedCapture({ userId: "uidtaro", slotKey: "09:00", minute: "04" });

    const first = await generateForTenant(TENANT, { businessDate: BUSINESS_DATE });
    expect(first.generated).toBeGreaterThan(0);

    const second = await generateForTenant(TENANT, { businessDate: BUSINESS_DATE });
    expect(second.generated).toBe(0);
    expect(second.skipped).toBeGreaterThan(0);
  }, 300_000);

  it("強制指定なら作り直す", async () => {
    await seedCapture({ userId: "uidtaro", slotKey: "09:00", minute: "04" });
    await generateForTenant(TENANT, { businessDate: BUSINESS_DATE });

    const forced = await generateForTenant(TENANT, { businessDate: BUSINESS_DATE, force: true });
    expect(forced.generated).toBeGreaterThan(0);
  }, 300_000);

  it("削除で立った再生成マークを拾って作り直す (F-905)", async () => {
    await seedCapture({ userId: "uidtaro", slotKey: "09:00", minute: "04" });
    await seedCapture({ userId: "uidhanako", slotKey: "09:00", minute: "07" });
    await generateForTenant(TENANT, { businessDate: BUSINESS_DATE });

    const before = (await db().doc(fsPath.vlog(TENANT, deptVlogId)).get()).data() as VlogDoc;
    expect(before.status).toBe("ready");

    // capture-delete が行うのと同じ更新をする（functions/src/capture/deleteCapture.ts）
    const captureId = buildCaptureId("uidhanako", BUSINESS_DATE, "09:00");
    await db().doc(fsPath.capture(TENANT, captureId)).update({
      status: "deleted",
      deletedAt: Timestamp.now(),
      thumbPath: null,
    });
    await db().doc(fsPath.vlog(TENANT, deptVlogId)).update({
      status: "pending",
      regenerateRequestedAt: FieldValue.serverTimestamp(),
    });

    const result = await generateForTenant(TENANT, { businessDate: BUSINESS_DATE });
    expect(result.generated).toBeGreaterThan(0);

    const after = (await db().doc(fsPath.vlog(TENANT, deptVlogId)).get()).data() as VlogDoc;
    expect(after.status).toBe("ready");
    expect(after.regenerateRequestedAt ?? null).toBeNull();
    // 削除されたコマは空きコマになるが、Vlog 自体は残る
    expect(await objectExists(after.pages[0]!.videoPath)).toBe(true);
  }, 420_000);

  it("全員が削除した日は Vlog を作らない（作り直しで空の動画を作らない）", async () => {
    await seedCapture({ userId: "uidtaro", slotKey: "09:00", minute: "04", status: "deleted" });

    const result = await generateForTenant(TENANT, { businessDate: BUSINESS_DATE });
    expect(result.generated).toBe(0);
  }, 120_000);

  it("Cloud Run Jobs の分担指定でログを分けられる", async () => {
    await seedCapture({ userId: "uidtaro", slotKey: "09:00", minute: "04" });
    await seedCapture({ userId: "uidhanako", slotKey: "09:00", minute: "07" });

    process.env.CLOUD_RUN_TASK_COUNT = "2";
    process.env.CLOUD_RUN_TASK_INDEX = "0";
    const shard0 = await generateForTenant(TENANT, { businessDate: BUSINESS_DATE });

    process.env.CLOUD_RUN_TASK_INDEX = "1";
    const shard1 = await generateForTenant(TENANT, { businessDate: BUSINESS_DATE });

    delete process.env.CLOUD_RUN_TASK_COUNT;
    delete process.env.CLOUD_RUN_TASK_INDEX;

    // 部署ログ1 + 個人ログ2 = 3ログを2タスクで分担する
    expect(shard0.generated + shard1.generated).toBe(3);
    expect(shard0.generated).toBeGreaterThan(0);
    expect(shard1.generated).toBeGreaterThan(0);
  }, 420_000);
});
