import { describe, expect, it } from "vitest";

import { splitIntoPages } from "../pages";

const members = (n: number) => Array.from({ length: n }, (_, i) => ({ userId: `u${i}` }));

describe("splitIntoPages (F-307)", () => {
  it("30人・12分割なら3ページ（要件の例）", () => {
    const pages = splitIntoPages(members(30), 12);
    expect(pages).toHaveLength(3);
    expect(pages.map((p) => p.members.length)).toEqual([12, 12, 6]);
  });

  it("ちょうど割り切れる場合", () => {
    expect(splitIntoPages(members(24), 12)).toHaveLength(2);
  });

  it("分割数以下なら1ページ", () => {
    const pages = splitIntoPages(members(5), 12);
    expect(pages).toHaveLength(1);
  });

  it("1ページに収まるときは実人数に合わせて詰める（無駄な空きコマを作らない）", () => {
    const pages = splitIntoPages(members(4), 12);
    expect(pages[0]?.dimensions).toMatchObject({ cols: 2, rows: 2, cellCount: 4 });
    expect(pages[0]?.seats.filter((s) => s === null)).toHaveLength(0);
  });

  it("全ページが同じ行列になる（ページ送りで解像度が変わらない）", () => {
    const pages = splitIntoPages(members(30), 12);
    const dims = pages.map((p) => `${p.dimensions.cols}x${p.dimensions.rows}`);
    expect(new Set(dims).size).toBe(1);
  });

  it("最終ページの足りない座席は空席で埋まる", () => {
    const pages = splitIntoPages(members(30), 12);
    const last = pages[2]!;
    expect(last.seats).toHaveLength(12);
    expect(last.seats.filter((s) => s === null)).toHaveLength(6);
    expect(last.seats.slice(0, 6).every((s) => s !== null)).toBe(true);
  });

  it("座席数は必ず cellCount と一致する（xstack の入力数が固定のため）", () => {
    for (const count of [1, 5, 12, 13, 30, 101]) {
      for (const gridSize of [4, 6, 9, 12]) {
        for (const page of splitIntoPages(members(count), gridSize)) {
          expect(page.seats).toHaveLength(page.dimensions.cellCount);
        }
      }
    }
  });

  it("メンバーの順序と重複しない割り当てが保たれる", () => {
    const pages = splitIntoPages(members(30), 12);
    const assigned = pages.flatMap((p) => p.members.map((m) => m.userId));
    expect(assigned).toEqual(members(30).map((m) => m.userId));
    expect(new Set(assigned).size).toBe(30);
  });

  it("100人でも落とさない（人数上限なし F-203）", () => {
    const pages = splitIntoPages(members(100), 9);
    expect(pages.flatMap((p) => p.members)).toHaveLength(100);
  });

  it("メンバーが居なければページは作らない", () => {
    expect(splitIntoPages([], 12)).toEqual([]);
  });

  it("不正な分割数は例外", () => {
    expect(() => splitIntoPages(members(3), 0)).toThrow();
  });
});
