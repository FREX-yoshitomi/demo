import { gridDimensions, type GridDimensions } from "./layout";

/**
 * メンバーのページ分割 (F-307)。
 * 「30人・12分割なら3ページを順に再生」。
 */

export interface MemberPage<T> {
  pageIndex: number;
  /** 実在するメンバー */
  members: T[];
  /**
   * グリッドを埋めるための座席。実メンバーが足りない分は null。
   * 長さは必ず `dimensions.cellCount` と一致する（xstack は入力数が固定のため）。
   */
  seats: (T | null)[];
  dimensions: GridDimensions;
}

/**
 * 分割数ごとにページを作る。
 *
 * 最終ページのメンバーが分割数に満たない場合、**空席で埋めて全ページを同じ解像度に揃える**。
 * ページごとに行列を変えると、ページ送り再生で解像度が変わって見づらくなるため。
 */
export function splitIntoPages<T>(members: readonly T[], gridSize: number): MemberPage<T>[] {
  if (!Number.isInteger(gridSize) || gridSize < 1) {
    throw new Error(`invalid gridSize: ${gridSize}`);
  }
  if (members.length === 0) return [];

  // 全ページ共通の行列。1ページに収まる場合は実人数に合わせて詰める
  const dimensions = gridDimensions(Math.min(members.length, gridSize));

  const pages: MemberPage<T>[] = [];
  for (let start = 0; start < members.length; start += gridSize) {
    const slice = members.slice(start, start + gridSize);
    const seats: (T | null)[] = Array.from(
      { length: dimensions.cellCount },
      (_, i) => slice[i] ?? null,
    );
    pages.push({ pageIndex: pages.length, members: slice, seats, dimensions });
  }
  return pages;
}
