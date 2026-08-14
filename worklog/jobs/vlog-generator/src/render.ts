import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  buildCellArgs,
  buildConcatArgs,
  buildConcatList,
  buildPlaceholderArgs,
  buildStackArgs,
  needsStacking,
} from "./ffmpeg";
import type { PlanCell, PlanPage } from "./plan";

const execFileAsync = promisify(execFile);

/**
 * 計画（plan.ts）に従って実際に FFmpeg を回す層。
 *
 * 手順は設計書 7.1 のとおり：
 *   各コマを前処理 → スロットごとに xstack で合成 → スロット順に concat
 *
 * 動画の取得を `fetchVideo` として外から渡すので、
 * GCS を使わずローカルの合成パイプラインだけをテストできる。
 */

export interface RenderContext {
  ffmpegPath: string;
  /** 日本語を焼き込むための CJK フォント。Dockerfile で入れる */
  fontFile: string;
  workDir: string;
  /** Storage のオブジェクトパス → ローカルの実ファイル */
  fetchVideo: (videoPath: string, destPath: string) => Promise<void>;
  /** 同時に走らせる FFmpeg の数 */
  concurrency?: number;
  onProgress?: (message: string) => void;
}

const PLACEHOLDER_TEXT: Record<string, string> = {
  empty: "未撮影",
  deleted: "削除済み",
};

export async function runFfmpeg(ffmpegPath: string, args: readonly string[]): Promise<void> {
  try {
    await execFileAsync(ffmpegPath, [...args], {
      maxBuffer: 16 * 1024 * 1024,
      timeout: 10 * 60_000,
    });
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? "";
    throw new Error(`ffmpeg failed: ${stderr.trim() || String(err)}`);
  }
}

/** 決まった数だけ並列に走らせる。毎正時の生成でCPUを食い尽くさないため */
async function pool<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await task(items[index] as T, index);
    }
  });

  await Promise.all(workers);
  return results;
}

/**
 * 1ページぶんの Vlog を生成してローカルパスを返す。
 * 呼び出し側が Storage へアップロードする。
 */
export async function renderPage(page: PlanPage, ctx: RenderContext): Promise<string> {
  const concurrency = ctx.concurrency ?? 4;
  const pageDir = join(ctx.workDir, `page_${page.pageIndex}`);
  await mkdir(pageDir, { recursive: true });

  // プレースホルダは種類ごとに1本だけ作って使い回す。
  // 12分割×9スロットだと、作り直すと100本以上の無駄になる
  const placeholders = new Map<string, string>();
  const placeholderFor = async (kind: Exclude<PlanCell["kind"], "capture">): Promise<string> => {
    const cached = placeholders.get(kind);
    if (cached) return cached;

    const output = join(pageDir, `placeholder_${kind}.mp4`);
    const text = PLACEHOLDER_TEXT[kind];
    let textFile: string | undefined;
    if (text) {
      textFile = join(pageDir, `placeholder_${kind}.txt`);
      await writeFile(textFile, text, "utf8");
    }

    await runFfmpeg(
      ctx.ffmpegPath,
      buildPlaceholderArgs({ kind, outputPath: output, fontFile: ctx.fontFile, textFile }),
    );
    placeholders.set(kind, output);
    return output;
  };

  const segmentPaths: string[] = [];

  for (const [slotIndex, slot] of page.slots.entries()) {
    const slotDir = join(pageDir, `slot_${String(slotIndex).padStart(2, "0")}`);
    await mkdir(slotDir, { recursive: true });

    // 実動画のコマだけ並列で用意する（ダウンロード + 前処理）
    const cellPaths: string[] = new Array(slot.cells.length);

    const captureCells = slot.cells.filter((cell) => cell.kind === "capture");
    await pool(captureCells, concurrency, async (cell) => {
      const sourcePath = join(slotDir, `src_${cell.seatIndex}.mp4`);
      const cellPath = join(slotDir, `cell_${cell.seatIndex}.mp4`);
      const labelPath = join(slotDir, `label_${cell.seatIndex}.txt`);

      await ctx.fetchVideo(cell.videoPath as string, sourcePath);
      await writeFile(labelPath, cell.label ?? "", "utf8");
      await runFfmpeg(
        ctx.ffmpegPath,
        buildCellArgs({
          inputPath: sourcePath,
          outputPath: cellPath,
          drawText: { textFile: labelPath, fontFile: ctx.fontFile },
        }),
      );
      cellPaths[cell.seatIndex] = cellPath;
    });

    for (const cell of slot.cells) {
      if (cell.kind === "capture") continue;
      cellPaths[cell.seatIndex] = await placeholderFor(cell.kind);
    }

    if (needsStacking(page.dimensions)) {
      const segmentPath = join(slotDir, "segment.mp4");
      await runFfmpeg(
        ctx.ffmpegPath,
        buildStackArgs({
          inputPaths: cellPaths,
          dimensions: page.dimensions,
          outputPath: segmentPath,
        }),
      );
      segmentPaths.push(segmentPath);
    } else {
      // 個人ログ (F-202) は1人なので合成しない。
      // 前処理でスロットと同じ仕様に揃えてあるので、そのまま連結できる
      segmentPaths.push(cellPaths[0] as string);
    }
    ctx.onProgress?.(`page ${page.pageIndex} slot ${slot.slotKey} 合成完了`);
  }

  const listPath = join(pageDir, "concat.txt");
  await writeFile(listPath, buildConcatList(segmentPaths), "utf8");

  const outputPath = join(pageDir, `page_${page.pageIndex + 1}.mp4`);
  await runFfmpeg(ctx.ffmpegPath, buildConcatArgs({ listPath, outputPath }));

  return outputPath;
}

/** ページ番号は1始まりで Storage のファイル名に使う（`{vlogId}_p1.mp4`） */
export function pageNumber(page: PlanPage): number {
  return page.pageIndex + 1;
}
