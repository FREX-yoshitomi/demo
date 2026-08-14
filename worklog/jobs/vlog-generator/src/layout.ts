import { VIDEO_SPEC } from "@worklog/shared";

/**
 * FFmpeg `xstack` のレイアウト文字列を組み立てる（設計書 7.1 / 付録A）。
 *
 * xstack はコマ数ぶんの入力を受け取り、`layout` で各入力の左上座標を指定する。
 * すべてのコマを同じ解像度に前処理してから渡す前提なので、
 * 座標は `w0` / `h0` の累積で表現できる。
 */

export interface GridDimensions {
  cols: number;
  rows: number;
  /** cols * rows。実メンバー数より多い場合、余りは空きコマで埋める */
  cellCount: number;
}

/** 1コマの解像度。縦持ち動画をそのまま縮小する */
export const CELL_WIDTH = VIDEO_SPEC.width / 2; // 360
export const CELL_HEIGHT = VIDEO_SPEC.height / 2; // 640

const CELL_ASPECT = CELL_WIDTH / CELL_HEIGHT;

/**
 * 分割数から行列を決める。
 *
 * 合成後の縦横比が1コマの縦横比（9:16）に最も近くなる組み合わせを選ぶ。
 * スマホで見る前提なので、横に広がりすぎる配置は避けたい。
 * 4→2x2 / 6→2x3 / 9→3x3 / 12→3x4 になる（12分割は設計書 付録A の例と一致）。
 */
export function gridDimensions(memberCount: number): GridDimensions {
  if (!Number.isInteger(memberCount) || memberCount < 1) {
    throw new Error(`invalid memberCount: ${memberCount}`);
  }

  let best: GridDimensions | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  let bestEmpty = Number.POSITIVE_INFINITY;

  for (let cols = 1; cols <= memberCount; cols += 1) {
    const rows = Math.ceil(memberCount / cols);
    const aspect = (cols * CELL_WIDTH) / (rows * CELL_HEIGHT);
    const score = Math.abs(aspect - CELL_ASPECT);
    const empty = cols * rows - memberCount;

    // 縦横比が同点なら空きコマの少ない方を採る
    if (score < bestScore - 1e-9 || (Math.abs(score - bestScore) < 1e-9 && empty < bestEmpty)) {
      best = { cols, rows, cellCount: cols * rows };
      bestScore = score;
      bestEmpty = empty;
    }
  }

  if (!best) throw new Error("failed to compute grid dimensions");
  return best;
}

/**
 * xstack の layout 文字列。
 *
 * 各入力の座標を `x_y` で並べる。列は `w0+w1+...`、行は `h0+h1+...` の累積。
 * 全コマを同じ解像度に揃えてあるので、どのインデックスを参照しても値は同じだが、
 * 設計書 付録A の書き方に合わせて連番で参照する。
 */
export function buildXstackLayout(cols: number, rows: number): string {
  if (cols < 1 || rows < 1) throw new Error(`invalid grid: ${cols}x${rows}`);

  const positions: string[] = [];
  for (let row = 0; row < rows; row += 1) {
    const y = row === 0 ? "0" : range(row).map((i) => `h${i}`).join("+");
    for (let col = 0; col < cols; col += 1) {
      const x = col === 0 ? "0" : range(col).map((i) => `w${i}`).join("+");
      positions.push(`${x}_${y}`);
    }
  }
  return positions.join("|");
}

/** 合成後の解像度 */
export function stackedSize(dims: GridDimensions): { width: number; height: number } {
  return { width: dims.cols * CELL_WIDTH, height: dims.rows * CELL_HEIGHT };
}

function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}
