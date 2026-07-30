import { describe, expect, it } from "vitest";

import { aggregateRate, buildGrid, type GridCaptureInput } from "../buildGrid";

const SLOTS = ["09:00", "10:00", "11:00", "12:00"];

const users = [
  { userId: "u2", userName: "佐藤 花子", userNameKana: "さとう はなこ" },
  { userId: "u1", userName: "青木 太郎", userNameKana: "あおき たろう" },
];

const capture = (overrides: Partial<GridCaptureInput> = {}): GridCaptureInput => ({
  captureId: "c1",
  userId: "u1",
  slotKey: "09:00",
  status: "ready",
  capturedAtIso: "2026-07-26T00:04:00.000Z",
  isLate: false,
  thumbUrl: "https://example.com/t.jpg",
  ...overrides,
});

describe("buildGrid セルの状態 (F-304)", () => {
  it("撮影済みはサムネイル付きの captured", () => {
    const [row] = buildGrid({ users: [users[1]!], captures: [capture()], slotKeys: SLOTS });
    expect(row?.cells[0]).toMatchObject({
      state: "captured",
      captureId: "c1",
      thumbUrl: "https://example.com/t.jpg",
    });
  });

  it("未撮影は空きコマ", () => {
    const [row] = buildGrid({ users: [users[1]!], captures: [], slotKeys: SLOTS });
    expect(row?.cells.map((c) => c.state)).toEqual(["empty", "empty", "empty", "empty"]);
  });

  it("削除済みは枠だけ残り、サムネイルを持たない (F-902)", () => {
    const [row] = buildGrid({
      users: [users[1]!],
      captures: [capture({ status: "deleted" })],
      slotKeys: SLOTS,
    });
    expect(row?.cells[0]).toMatchObject({ state: "deleted", captureId: "c1" });
    expect(row?.cells[0]?.thumbUrl).toBeUndefined();
  });

  it("削除済みでも撮影時刻は残る (F-706)", () => {
    const [row] = buildGrid({
      users: [users[1]!],
      captures: [capture({ status: "deleted" })],
      slotKeys: SLOTS,
    });
    expect(row?.cells[0]?.capturedAtIso).toBe("2026-07-26T00:04:00.000Z");
  });

  it("遅延は late として区別する (F-110)", () => {
    const [row] = buildGrid({
      users: [users[1]!],
      captures: [capture({ isLate: true })],
      slotKeys: SLOTS,
    });
    expect(row?.cells[0]?.state).toBe("late");
  });

  it("撮影しないと申告した枠は declaredOff (F-113)", () => {
    const [row] = buildGrid({
      users: [users[1]!],
      captures: [],
      slotKeys: SLOTS,
      declaredOff: { u1: ["12:00"] },
    });
    expect(row?.cells[3]?.state).toBe("declaredOff");
  });

  it("予約だけ（pending）は空きコマとして扱う", () => {
    const [row] = buildGrid({
      users: [users[1]!],
      captures: [capture({ status: "pending" })],
      slotKeys: SLOTS,
    });
    expect(row?.cells[0]?.state).toBe("empty");
  });

  it("列数は必ずスロット数と一致する（分割数を変えても崩れない F-302）", () => {
    const slots = ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30"];
    const [row] = buildGrid({ users: [users[1]!], captures: [capture()], slotKeys: slots });
    expect(row?.cells).toHaveLength(6);
    expect(row?.cells.map((c) => c.slotKey)).toEqual(slots);
  });

  it("同一スロットに複数あれば新しい撮影を採る（削除後の撮り直し）", () => {
    const [row] = buildGrid({
      users: [users[1]!],
      captures: [
        capture({ captureId: "old", capturedAtIso: "2026-07-26T00:04:00.000Z", status: "deleted" }),
        capture({ captureId: "new", capturedAtIso: "2026-07-26T00:40:00.000Z" }),
      ],
      slotKeys: SLOTS,
    });
    expect(row?.cells[0]).toMatchObject({ state: "captured", captureId: "new" });
  });
});

describe("撮影率 (F-802)", () => {
  it("削除済みも撮影済みとして数える (F-706)", () => {
    const [row] = buildGrid({
      users: [users[1]!],
      captures: [capture({ status: "deleted" })],
      slotKeys: SLOTS,
    });
    expect(row?.capturedCount).toBe(1);
    expect(row?.expectedCount).toBe(4);
  });

  it("申告済みの枠は分母から外す（運用ケース）", () => {
    const [row] = buildGrid({
      users: [users[1]!],
      captures: [capture()],
      slotKeys: SLOTS,
      declaredOff: { u1: ["12:00"] },
    });
    expect(row?.expectedCount).toBe(3);
    expect(row?.capturedCount).toBe(1);
  });

  it("ログ全体の撮影率を合算できる", () => {
    const rows = buildGrid({
      users,
      captures: [capture({ userId: "u1" }), capture({ userId: "u2", captureId: "c2" })],
      slotKeys: SLOTS,
    });
    expect(aggregateRate(rows)).toEqual({ captured: 2, expected: 8 });
  });
});

describe("並び順 (F-305)", () => {
  it("氏名順（既定）は読みの五十音順になる", () => {
    const rows = buildGrid({ users, captures: [], slotKeys: SLOTS });
    expect(rows.map((r) => r.userName)).toEqual(["青木 太郎", "佐藤 花子"]);
  });

  it("読みが無いと五十音順にはならない（漢字は localeCompare でも部首寄りの順になる）", () => {
    // この挙動は仕様。読みの登録が必要であることをテストで固定しておく
    const rows = buildGrid({
      users: [
        { userId: "u2", userName: "佐藤 花子" },
        { userId: "u1", userName: "青木 太郎" },
      ],
      captures: [],
      slotKeys: SLOTS,
    });
    expect(rows.map((r) => r.userName)).toEqual(["佐藤 花子", "青木 太郎"]);
  });

  it("読みが同じでも並びが揺れない", () => {
    const rows = buildGrid({
      users: [
        { userId: "b", userName: "斎藤", userNameKana: "さいとう" },
        { userId: "a", userName: "齋藤", userNameKana: "さいとう" },
      ],
      captures: [],
      slotKeys: SLOTS,
    });
    expect(rows.map((r) => r.userId)).toEqual(["a", "b"]);
  });

  it("撮影時刻順", () => {
    const rows = buildGrid({
      users,
      captures: [
        capture({ userId: "u1", capturedAtIso: "2026-07-26T02:00:00.000Z" }),
        capture({ userId: "u2", captureId: "c2", capturedAtIso: "2026-07-26T00:10:00.000Z" }),
      ],
      slotKeys: SLOTS,
      sort: "capturedAt",
    });
    expect(rows.map((r) => r.userId)).toEqual(["u2", "u1"]);
  });

  it("撮影時刻順では未撮影の人が末尾に来る", () => {
    const rows = buildGrid({
      users,
      captures: [capture({ userId: "u2", captureId: "c2" })],
      slotKeys: SLOTS,
      sort: "capturedAt",
    });
    expect(rows.map((r) => r.userId)).toEqual(["u2", "u1"]);
  });

  it("未撮影が多い順", () => {
    const rows = buildGrid({
      users,
      captures: [
        capture({ userId: "u2", captureId: "a", slotKey: "09:00" }),
        capture({ userId: "u2", captureId: "b", slotKey: "10:00" }),
        capture({ userId: "u2", captureId: "c", slotKey: "11:00" }),
        capture({ userId: "u1", captureId: "d", slotKey: "09:00" }),
      ],
      slotKeys: SLOTS,
      sort: "missingFirst",
    });
    expect(rows.map((r) => r.userId)).toEqual(["u1", "u2"]);
  });

  it("人数が増えても行は落とさない（人数上限なし F-203, F-301）", () => {
    const many = Array.from({ length: 120 }, (_, i) => ({
      userId: `u${i}`,
      userName: `社員${String(i).padStart(3, "0")}`,
      userNameKana: `しゃいん${String(i).padStart(3, "0")}`,
    }));
    const rows = buildGrid({ users: many, captures: [], slotKeys: SLOTS });
    expect(rows).toHaveLength(120);
  });
});
