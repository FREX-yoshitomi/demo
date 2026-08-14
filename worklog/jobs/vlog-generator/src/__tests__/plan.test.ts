import { describe, expect, it } from "vitest";

import { buildVlogPlan, hasRenderableContent, type PlanCapture, type PlanMember } from "../plan";

const TZ = "Asia/Tokyo";
const SLOTS = ["09:00", "10:00", "11:00"];
const jst = (s: string) => new Date(`${s}+09:00`);

const members: PlanMember[] = [
  { userId: "u1", name: "山田 太郎" },
  { userId: "u2", name: "佐藤 花子" },
];

const capture = (overrides: Partial<PlanCapture> = {}): PlanCapture => ({
  captureId: "c1",
  userId: "u1",
  slotKey: "09:00",
  status: "ready",
  capturedAt: jst("2026-07-26T09:04:33"),
  videoPath: "tenants/acme/captures/2026-07-26/c1.mp4",
  ...overrides,
});

const build = (captures: PlanCapture[], gridSize = 4) =>
  buildVlogPlan({ members, captures, slotKeys: SLOTS, gridSize, timezone: TZ });

describe("buildVlogPlan コマの割り当て", () => {
  it("撮影済みは動画コマになり、氏名と時刻が焼き込まれる (F-309)", () => {
    const pages = build([capture()]);
    const cell = pages[0]?.slots[0]?.cells[0];
    expect(cell).toMatchObject({
      kind: "capture",
      memberId: "u1",
      captureId: "c1",
      videoPath: "tenants/acme/captures/2026-07-26/c1.mp4",
    });
    expect(cell?.label).toBe("山田 太郎  09:04");
  });

  it("撮影時刻は分単位で丸めずに焼き込む (F-105)", () => {
    const pages = build([capture({ capturedAt: jst("2026-07-26T09:59:59") })]);
    expect(pages[0]?.slots[0]?.cells[0]?.label).toContain("09:59");
  });

  it("未撮影は空きコマ (F-304)", () => {
    const pages = build([capture()]);
    // u2 は撮っていない
    expect(pages[0]?.slots[0]?.cells[1]).toMatchObject({ kind: "empty", memberId: "u2" });
  });

  it("削除済みは削除済みコマとして残る (F-902, F-905)", () => {
    const pages = build([capture(), capture({ captureId: "c2", userId: "u2", status: "deleted" })]);
    expect(pages[0]?.slots[0]?.cells[1]).toMatchObject({
      kind: "deleted",
      memberId: "u2",
      captureId: "c2",
    });
    // 映像は無いので動画パスを持たない
    expect(pages[0]?.slots[0]?.cells[1]?.videoPath).toBeUndefined();
  });

  it("まだ処理中のものは空きコマにする（設計書 7.1：status=ready のみ）", () => {
    for (const status of ["pending", "uploaded", "processing"] as const) {
      const pages = build([capture(), capture({ captureId: "c2", userId: "u2", status })]);
      expect(pages[0]?.slots[0]?.cells[1]?.kind).toBe("empty");
    }
  });

  it("削除後に撮り直された場合は新しい撮影を採る", () => {
    const pages = build([
      capture({ captureId: "old", status: "deleted", capturedAt: jst("2026-07-26T09:04:00") }),
      capture({ captureId: "new", capturedAt: jst("2026-07-26T09:40:00") }),
    ]);
    expect(pages[0]?.slots[0]?.cells[0]).toMatchObject({ kind: "capture", captureId: "new" });
  });

  it("最終ページの余った座席は空席になる", () => {
    // 5人・4分割 → 2ページ目は u4 のみ。残り3席が空席になる
    const many = Array.from({ length: 5 }, (_, i) => ({ userId: `u${i}`, name: `社員${i}` }));
    const pages = buildVlogPlan({
      members: many,
      captures: [capture({ userId: "u0" }), capture({ captureId: "c5", userId: "u4" })],
      slotKeys: SLOTS,
      gridSize: 4,
      timezone: TZ,
    });
    const lastPage = pages[pages.length - 1]!;
    expect(lastPage.memberIds).toEqual(["u4"]);
    expect(lastPage.slots[0]?.cells.filter((c) => c.kind === "vacant")).toHaveLength(3);
  });
});

describe("buildVlogPlan スロットの取捨", () => {
  it("誰も撮っていないスロットは Vlog に入れない", () => {
    const pages = build([capture({ slotKey: "10:00" })]);
    expect(pages[0]?.slots.map((s) => s.slotKey)).toEqual(["10:00"]);
  });

  it("スロットは時系列順に並ぶ", () => {
    const pages = build([
      capture({ captureId: "c3", slotKey: "11:00" }),
      capture({ captureId: "c1", slotKey: "09:00" }),
      capture({ captureId: "c2", slotKey: "10:00" }),
    ]);
    expect(pages[0]?.slots.map((s) => s.slotKey)).toEqual(["09:00", "10:00", "11:00"]);
  });

  it("削除済みしか無いスロットは入れない（全員プレースホルダの2秒を作らない）", () => {
    const pages = build([capture({ status: "deleted" })]);
    expect(pages).toEqual([]);
  });

  it("1本も撮影が無い日は Vlog を作らない", () => {
    expect(build([])).toEqual([]);
    expect(hasRenderableContent(build([]))).toBe(false);
  });

  it("撮影があれば生成対象になる", () => {
    expect(hasRenderableContent(build([capture()]))).toBe(true);
  });
});

describe("buildVlogPlan ページ分割 (F-307)", () => {
  it("30人・12分割で3ページに分かれる", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ userId: `u${i}`, name: `社員${i}` }));
    const captures = many.map((m, i) =>
      capture({ captureId: `c${i}`, userId: m.userId, slotKey: "09:00" }),
    );
    const pages = buildVlogPlan({
      members: many,
      captures,
      slotKeys: SLOTS,
      gridSize: 12,
      timezone: TZ,
    });
    expect(pages).toHaveLength(3);
    expect(pages.map((p) => p.memberIds.length)).toEqual([12, 12, 6]);
  });

  it("撮影が無いページは落とすが、ページ番号は元の並びを保つ", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ userId: `u${i}`, name: `社員${i}` }));
    // 2ページ目（u4〜u7）だけが撮影している
    const captures = [capture({ userId: "u5", captureId: "c5" })];
    const pages = buildVlogPlan({
      members: many,
      captures,
      slotKeys: SLOTS,
      gridSize: 4,
      timezone: TZ,
    });
    expect(pages).toHaveLength(1);
    expect(pages[0]?.pageIndex).toBe(1);
  });

  it("各スロットのコマ数が座席数と一致する（xstack の入力数が合う）", () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ userId: `u${i}`, name: `社員${i}` }));
    const captures = many.map((m, i) => capture({ captureId: `c${i}`, userId: m.userId }));
    const pages = buildVlogPlan({
      members: many,
      captures,
      slotKeys: SLOTS,
      gridSize: 4,
      timezone: TZ,
    });
    for (const page of pages) {
      for (const slot of page.slots) {
        expect(slot.cells).toHaveLength(page.dimensions.cellCount);
      }
    }
  });
});
