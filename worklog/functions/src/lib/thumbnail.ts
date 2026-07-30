import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { THUMB_SPEC } from "@worklog/shared";
import ffmpegPath from "ffmpeg-static";

const execFileAsync = promisify(execFile);

/**
 * 2秒動画から1フレーム抜いてサムネイルを作る (F-301, 設計書 3.2)。
 *
 * グリッドは動画ではなく必ずこの静止画を並べる。
 * Cloud Functions のランタイムに ffmpeg は入っていないので、
 * ffmpeg-static の静的バイナリを使う。
 */
export async function extractThumbnail(params: {
  videoBuffer: Buffer;
  /** 何秒目のフレームを使うか。2秒動画なので先頭付近を取る */
  atSeconds?: number;
}): Promise<Buffer> {
  if (!ffmpegPath) throw new Error("ffmpeg binary not found (ffmpeg-static)");

  const dir = await mkdtemp(join(tmpdir(), "worklog-thumb-"));
  const inputPath = join(dir, "in.mp4");
  const outputPath = join(dir, "out.jpg");

  try {
    const { writeFile, readFile } = await import("node:fs/promises");
    await writeFile(inputPath, params.videoBuffer);

    await execFileAsync(
      ffmpegPath,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        String(params.atSeconds ?? 0.2),
        "-i",
        inputPath,
        "-frames:v",
        "1",
        "-vf",
        `scale=${THUMB_SPEC.width}:${THUMB_SPEC.height}:force_original_aspect_ratio=decrease`,
        "-q:v",
        "4",
        "-y",
        outputPath,
      ],
      { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 },
    );

    return await readFile(outputPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
