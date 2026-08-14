import { CAPTURE_DURATION_SEC, VIDEO_SPEC } from "@worklog/shared";

import { assertFilterSafePath } from "./label";
import { CELL_HEIGHT, CELL_WIDTH, buildXstackLayout, type GridDimensions } from "./layout";
import type { PlanCellKind } from "./plan";

/**
 * FFmpeg のコマンド（引数配列）を組み立てる。実行はしない。
 * 引数の組み立てだけを純関数にしてスナップショットテストの対象にする（設計書 第11章）。
 *
 * シェルを経由せず `execFile` で渡すので、引数のクォートは不要。
 * ただし **フィルタ文字列の中**はフィルタ独自の構文なので、パスは検証してから埋め込む。
 */

/** 合成時の共通仕様。全コマをこれに揃えないと xstack が失敗する */
export const RENDER_SPEC = {
  fps: 30,
  pixelFormat: "yuv420p",
  videoCodec: "libx264",
  preset: "veryfast",
  crf: 23,
} as const;

/** プレースホルダの背景色。アプリのグリッドの空きコマと揃える */
const PLACEHOLDER_COLORS: Record<Exclude<PlanCellKind, "capture">, string> = {
  empty: "0x232833",
  deleted: "0x2a2230",
  vacant: "0x181c23",
};

const PLACEHOLDER_LABELS: Record<Exclude<PlanCellKind, "capture">, string | null> = {
  empty: "未撮影",
  deleted: "削除済み",
  // 最終ページの余った座席には何も書かない
  vacant: null,
};

export interface DrawTextOptions {
  /** 焼き込む文字列を書いたファイル。text= を使わないので文字列側のエスケープが不要 */
  textFile: string;
  fontFile: string;
  fontSize?: number;
  fontColor?: string;
}

function drawTextFilter(options: DrawTextOptions): string {
  const textFile = assertFilterSafePath(options.textFile);
  const fontFile = assertFilterSafePath(options.fontFile);
  return [
    "drawtext=",
    `fontfile=${fontFile}`,
    `:textfile=${textFile}`,
    // %{...} を展開させない。氏名に % が入っても壊れない
    ":expansion=none",
    `:fontsize=${options.fontSize ?? 22}`,
    `:fontcolor=${options.fontColor ?? "white"}`,
    ":box=1:boxcolor=black@0.5:boxborderw=6",
    ":x=10:y=h-th-10",
  ].join("");
}

/**
 * 実際の2秒動画を1コマぶんに前処理する。
 * 縦横比を保って収め、余白を黒で埋めてから氏名と時刻を焼き込む (F-309)。
 */
export function buildCellArgs(params: {
  inputPath: string;
  outputPath: string;
  drawText: DrawTextOptions;
}): string[] {
  const filter = [
    `scale=${CELL_WIDTH}:${CELL_HEIGHT}:force_original_aspect_ratio=decrease`,
    `pad=${CELL_WIDTH}:${CELL_HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black`,
    "setsar=1",
    `fps=${RENDER_SPEC.fps}`,
    drawTextFilter(params.drawText),
    `format=${RENDER_SPEC.pixelFormat}`,
  ].join(",");

  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    params.inputPath,
    "-vf",
    filter,
    // 音声はVlog合成時に既定ミュート（設計書 3.3）
    "-an",
    "-t",
    String(CAPTURE_DURATION_SEC),
    "-c:v",
    RENDER_SPEC.videoCodec,
    "-preset",
    RENDER_SPEC.preset,
    "-crf",
    String(RENDER_SPEC.crf),
    "-y",
    params.outputPath,
  ];
}

/** 未撮影・削除済み・空席のコマ。実動画と同じ仕様の2秒クリップを作る */
export function buildPlaceholderArgs(params: {
  kind: Exclude<PlanCellKind, "capture">;
  outputPath: string;
  fontFile: string;
  /** 「未撮影」等のラベルを書いたファイル。vacant のときは不要 */
  textFile?: string;
}): string[] {
  const color = PLACEHOLDER_COLORS[params.kind];
  const hasLabel = PLACEHOLDER_LABELS[params.kind] !== null && params.textFile;

  const filters = [`setsar=1`, `fps=${RENDER_SPEC.fps}`];
  if (hasLabel && params.textFile) {
    filters.push(
      drawTextFilter({
        textFile: params.textFile,
        fontFile: params.fontFile,
        fontSize: 20,
        fontColor: "0x9aa4b2",
      }),
    );
  }
  filters.push(`format=${RENDER_SPEC.pixelFormat}`);

  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    `color=c=${color}:s=${CELL_WIDTH}x${CELL_HEIGHT}:d=${CAPTURE_DURATION_SEC}:r=${RENDER_SPEC.fps}`,
    "-vf",
    filters.join(","),
    "-an",
    "-c:v",
    RENDER_SPEC.videoCodec,
    "-preset",
    RENDER_SPEC.preset,
    "-crf",
    String(RENDER_SPEC.crf),
    "-y",
    params.outputPath,
  ];
}

/**
 * xstack が使えるか。
 *
 * **xstack は入力が2本以上でないと受け付けない**（`inputs` の下限が2）。
 * 個人ログ (F-202) は必ず1人なので、ここを分けないと全ユーザーの個人Vlogが失敗する。
 * 1コマのときは合成せず、前処理済みのコマをそのままスロットの映像として使う。
 */
export function needsStacking(dimensions: GridDimensions): boolean {
  return dimensions.cellCount >= 2;
}

/** 1スロットぶんのコマを xstack で1枚に合成する */
export function buildStackArgs(params: {
  inputPaths: readonly string[];
  dimensions: GridDimensions;
  outputPath: string;
}): string[] {
  if (!needsStacking(params.dimensions)) {
    throw new Error(
      `xstack は入力2本以上が必要です（cellCount=${params.dimensions.cellCount}）。` +
        "1コマのときは合成せずコマをそのまま使うこと",
    );
  }
  if (params.inputPaths.length !== params.dimensions.cellCount) {
    throw new Error(
      `xstack の入力数が合いません: ${params.inputPaths.length} != ${params.dimensions.cellCount}`,
    );
  }

  const layout = buildXstackLayout(params.dimensions.cols, params.dimensions.rows);
  const inputs = params.inputPaths.flatMap((path) => ["-i", path]);

  return [
    "-hide_banner",
    "-loglevel",
    "error",
    ...inputs,
    "-filter_complex",
    `xstack=inputs=${params.dimensions.cellCount}:layout=${layout}:fill=black`,
    "-an",
    "-c:v",
    RENDER_SPEC.videoCodec,
    "-preset",
    RENDER_SPEC.preset,
    "-crf",
    String(RENDER_SPEC.crf),
    "-pix_fmt",
    RENDER_SPEC.pixelFormat,
    "-y",
    params.outputPath,
  ];
}

/**
 * スロット順に連結して1ページぶんの動画にする。
 * 全セグメントを同じ仕様で作っているので再エンコードなしで繋げる。
 */
export function buildConcatArgs(params: { listPath: string; outputPath: string }): string[] {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    params.listPath,
    "-c",
    "copy",
    "-movflags",
    "+faststart",
    "-y",
    params.outputPath,
  ];
}

/** concat デマルチプレクサ用のリストファイルの中身 */
export function buildConcatList(segmentPaths: readonly string[]): string {
  return segmentPaths.map((path) => `file '${path.replace(/'/g, "'\\''")}'`).join("\n") + "\n";
}

export { VIDEO_SPEC };
