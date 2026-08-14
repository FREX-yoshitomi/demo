import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildVlogPlan, type PlanCapture, type PlanMember } from "../plan";
import { renderPage, runFfmpeg } from "../render";

const execFileAsync = promisify(execFile);

/**
 * 実際に FFmpeg を回して Vlog を1本作る統合テスト。
 *
 * 引数の組み立てが正しくても、フィルタの相性（SAR・fps・pixel format の不一致など）は
 * 実行するまで分からない。xstack は入力の仕様が揃っていないと落ちるので、
 * 「本当に1本出来上がるか」をここで確かめる。
 *
 * 実行には drawtext を含む FFmpeg と CJK フォントが要る。
 * どちらも Dockerfile で入れている構成と同じ（ffmpeg-static には drawtext が無い）。
 */

const FFMPEG = process.env.FFMPEG_PATH ?? "/usr/bin/ffmpeg";
const FONT =
  process.env.VLOG_FONT_FILE ?? "/usr/share/fonts/truetype/fonts-japanese-gothic.ttf";
const TZ = "Asia/Tokyo";

let workDir: string;
let sourceClip: string;

/** 端末で撮った2秒動画の代わり。720x1280 / 2秒 / 無音 */
async function makeSourceClip(path: string): Promise<void> {
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
    path,
  ]);
}

async function probe(path: string): Promise<{
  width: number;
  height: number;
  durationSec: number;
  hasAudio: boolean;
}> {
  const ffprobe = FFMPEG.replace(/ffmpeg$/, "ffprobe");
  const { stdout } = await execFileAsync(ffprobe, [
    "-v",
    "error",
    "-show_entries",
    "stream=width,height,codec_type",
    "-show_entries",
    "format=duration",
    "-of",
    "json",
    path,
  ]);
  const parsed = JSON.parse(stdout) as {
    streams: { width?: number; height?: number; codec_type: string }[];
    format: { duration: string };
  };
  const video = parsed.streams.find((s) => s.codec_type === "video");
  return {
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    durationSec: Number(parsed.format.duration),
    hasAudio: parsed.streams.some((s) => s.codec_type === "audio"),
  };
}

const jst = (s: string) => new Date(`${s}+09:00`);

beforeAll(async () => {
  if (!existsSync(FFMPEG)) throw new Error(`FFmpeg が見つかりません: ${FFMPEG}`);
  if (!existsSync(FONT)) throw new Error(`フォントが見つかりません: ${FONT}`);

  workDir = await mkdtemp(join(tmpdir(), "worklog-vlog-test-"));
  sourceClip = join(workDir, "source.mp4");
  await makeSourceClip(sourceClip);
}, 120_000);

afterAll(async () => {
  if (workDir) await rm(workDir, { recursive: true, force: true });
});

function context(dir: string) {
  return {
    ffmpegPath: FFMPEG,
    fontFile: FONT,
    workDir: dir,
    concurrency: 4,
    fetchVideo: async (_videoPath: string, destPath: string) => {
      const { copyFile } = await import("node:fs/promises");
      await copyFile(sourceClip, destPath);
    },
  };
}

describe("Vlog の生成（実際に FFmpeg を回す）", () => {
  const members: PlanMember[] = [
    { userId: "u1", name: "山田 太郎" },
    { userId: "u2", name: "佐藤 花子" },
    { userId: "u3", name: "鈴木 一郎" },
    { userId: "u4", name: "O'Brien:100%" },
  ];

  const capture = (overrides: Partial<PlanCapture>): PlanCapture => ({
    captureId: "c",
    userId: "u1",
    slotKey: "09:00",
    status: "ready",
    capturedAt: jst("2026-07-26T09:04:33"),
    videoPath: "tenants/acme/captures/2026-07-26/c.mp4",
    ...overrides,
  });

  it("4分割・2スロットの部署ログが1本の mp4 になる", async () => {
    const plan = buildVlogPlan({
      members,
      captures: [
        capture({ captureId: "a1", userId: "u1", slotKey: "09:00" }),
        capture({ captureId: "a2", userId: "u2", slotKey: "09:00" }),
        // u3 は 09:00 未撮影 → 空きコマ
        capture({ captureId: "a4", userId: "u4", slotKey: "09:00" }),
        capture({ captureId: "b1", userId: "u1", slotKey: "10:00" }),
        // u2 は削除済み → 削除済みコマ
        capture({ captureId: "b2", userId: "u2", slotKey: "10:00", status: "deleted" }),
        capture({ captureId: "b3", userId: "u3", slotKey: "10:00" }),
      ],
      slotKeys: ["09:00", "10:00", "11:00"],
      gridSize: 4,
      timezone: TZ,
    });

    expect(plan).toHaveLength(1);
    // 11:00 は誰も撮っていないので入らない
    expect(plan[0]?.slots.map((s) => s.slotKey)).toEqual(["09:00", "10:00"]);

    const dir = await mkdtemp(join(workDir, "case1-"));
    const output = await renderPage(plan[0]!, context(dir));

    expect(existsSync(output)).toBe(true);
    const info = await probe(output);

    // 2x2 のグリッド → 720x1280
    expect(info.width).toBe(720);
    expect(info.height).toBe(1280);
    // 2秒 × 2スロット
    expect(info.durationSec).toBeGreaterThan(3.8);
    expect(info.durationSec).toBeLessThan(4.3);
    // Vlog は既定ミュート（設計書 3.3）
    expect(info.hasAudio).toBe(false);

    expect((await stat(output)).size).toBeGreaterThan(1000);
  }, 180_000);

  it("12分割・空席ありのページも合成できる（最終ページの余りで xstack が落ちない）", async () => {
    const many: PlanMember[] = Array.from({ length: 14 }, (_, i) => ({
      userId: `u${i}`,
      name: `社員${String(i).padStart(2, "0")}`,
    }));
    const plan = buildVlogPlan({
      members: many,
      captures: many.map((m, i) =>
        capture({ captureId: `c${i}`, userId: m.userId, slotKey: "09:00" }),
      ),
      slotKeys: ["09:00"],
      gridSize: 12,
      timezone: TZ,
    });

    // 14人 → 2ページ（12 + 2）。2ページ目は10席が空席
    expect(plan).toHaveLength(2);
    const lastPage = plan[1]!;
    expect(lastPage.slots[0]?.cells.filter((c) => c.kind === "vacant")).toHaveLength(10);

    const dir = await mkdtemp(join(workDir, "case2-"));
    const output = await renderPage(lastPage, context(dir));

    const info = await probe(output);
    // 3x4 のグリッド → 1080x2560
    expect(info.width).toBe(1080);
    expect(info.height).toBe(2560);
    expect(info.durationSec).toBeGreaterThan(1.8);
  }, 300_000);

  it("1人だけの個人ログも生成できる (F-202)", async () => {
    // xstack は入力2本以上が必須なので、1コマのときは合成せずコマをそのまま使う。
    // 全メンバーが個人ログを持つため、ここが落ちると全員のVlogが失敗する
    const plan = buildVlogPlan({
      members: [{ userId: "solo", name: "一人 太郎" }],
      captures: [
        capture({ captureId: "s1", userId: "solo", slotKey: "09:00" }),
        capture({ captureId: "s2", userId: "solo", slotKey: "10:00" }),
      ],
      slotKeys: ["09:00", "10:00"],
      gridSize: 12,
      timezone: TZ,
    });

    expect(plan[0]?.dimensions.cellCount).toBe(1);

    const dir = await mkdtemp(join(workDir, "solo-"));
    const output = await renderPage(plan[0]!, context(dir));

    const info = await probe(output);
    // 1コマなのでコマの解像度そのまま
    expect(info.width).toBe(360);
    expect(info.height).toBe(640);
    // 2秒 × 2スロット
    expect(info.durationSec).toBeGreaterThan(3.8);
    expect(info.durationSec).toBeLessThan(4.3);
    expect(info.hasAudio).toBe(false);
  }, 180_000);

  it("同じ計画を2回流しても同じ結果になる（再生成が冪等）", async () => {
    const plan = buildVlogPlan({
      members: members.slice(0, 2),
      captures: [
        capture({ captureId: "x1", userId: "u1" }),
        capture({ captureId: "x2", userId: "u2" }),
      ],
      slotKeys: ["09:00"],
      gridSize: 4,
      timezone: TZ,
    });

    const dir1 = await mkdtemp(join(workDir, "idem1-"));
    const dir2 = await mkdtemp(join(workDir, "idem2-"));
    const first = await probe(await renderPage(plan[0]!, context(dir1)));
    const second = await probe(await renderPage(plan[0]!, context(dir2)));

    expect(second.width).toBe(first.width);
    expect(second.height).toBe(first.height);
    expect(second.durationSec).toBeCloseTo(first.durationSec, 1);
  }, 180_000);
});
