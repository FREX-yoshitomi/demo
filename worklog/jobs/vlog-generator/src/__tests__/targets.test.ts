import { describe, expect, it } from "vitest";

import { buildLogTargets, decideGeneration, selectShard } from "../targets";

const ts = (ms: number) => ({ toMillis: () => ms, toDate: () => new Date(ms) });

describe("buildLogTargets", () => {
  const departments = [{ id: "sales" }, { id: "dev" }];
  const users = [
    { id: "u1", departmentIds: ["sales"], status: "active" },
    { id: "u2", departmentIds: ["sales", "dev"], status: "active" },
    { id: "u3", departmentIds: ["dev"], status: "disabled" },
  ];

  it("部署ログと個人ログの両方を作る (F-201, F-202)", () => {
    const targets = buildLogTargets({ businessDate: "2026-07-26", departments, users });
    expect(targets.filter((t) => t.scope === "department").map((t) => t.targetId)).toEqual([
      "sales",
      "dev",
    ]);
    expect(targets.filter((t) => t.scope === "personal").map((t) => t.targetId)).toEqual([
      "u1",
      "u2",
    ]);
  });

  it("無効化されたユーザーは含めない (F-606)", () => {
    const targets = buildLogTargets({ businessDate: "2026-07-26", departments, users });
    expect(targets.flatMap((t) => t.memberIds)).not.toContain("u3");
  });

  it("兼任しているユーザーは両方の部署ログに入る (F-204)", () => {
    const targets = buildLogTargets({ businessDate: "2026-07-26", departments, users });
    const sales = targets.find((t) => t.targetId === "sales");
    const dev = targets.find((t) => t.scope === "department" && t.targetId === "dev");
    expect(sales?.memberIds).toEqual(["u1", "u2"]);
    expect(dev?.memberIds).toEqual(["u2"]);
  });

  it("在籍者の居ない部署はログを作らない", () => {
    const targets = buildLogTargets({
      businessDate: "2026-07-26",
      departments: [{ id: "empty" }],
      users: [],
    });
    expect(targets).toEqual([]);
  });

  it("vlogId が決定的（再実行で上書きになる）", () => {
    const a = buildLogTargets({ businessDate: "2026-07-26", departments, users });
    const b = buildLogTargets({ businessDate: "2026-07-26", departments, users });
    expect(a.map((t) => t.vlogId)).toEqual(b.map((t) => t.vlogId));
    expect(a[0]?.vlogId).toBe("department_sales_2026-07-26");
  });
});

describe("decideGeneration", () => {
  const now = new Date("2026-07-26T23:00:00Z");

  it("まだ無ければ作る", () => {
    expect(decideGeneration({ existing: null, now })).toEqual({ generate: true, reason: "new" });
  });

  it("生成済みなら作らない（夜間バッチの二重起動で作り直さない）", () => {
    expect(
      decideGeneration({ existing: { status: "ready", generatedAt: ts(1) }, now }),
    ).toEqual({ generate: false, reason: "alreadyReady" });
  });

  it("削除で再生成要求が立っていれば作り直す (F-905)", () => {
    expect(
      decideGeneration({
        existing: {
          status: "ready",
          generatedAt: ts(1_000),
          regenerateRequestedAt: ts(2_000),
        },
        now,
      }),
    ).toEqual({ generate: true, reason: "regenerate" });
  });

  it("再生成要求より後に生成し直していれば作らない（要求フラグの消し忘れで無限に回さない）", () => {
    expect(
      decideGeneration({
        existing: {
          status: "ready",
          generatedAt: ts(3_000),
          regenerateRequestedAt: ts(2_000),
        },
        now,
      }),
    ).toEqual({ generate: false, reason: "alreadyReady" });
  });

  it("前回失敗していれば作り直す", () => {
    expect(decideGeneration({ existing: { status: "failed", generatedAt: ts(1) }, now })).toEqual({
      generate: true,
      reason: "retryFailed",
    });
  });

  it("生成中は触らない（別タスクと二重に走らせない）", () => {
    expect(
      decideGeneration({
        existing: { status: "generating", generatedAt: ts(now.getTime() - 60_000) },
        now,
      }),
    ).toEqual({ generate: false, reason: "inProgress" });
  });

  it("生成中のまま長時間止まっていれば引き取る", () => {
    expect(
      decideGeneration({
        existing: { status: "generating", generatedAt: ts(now.getTime() - 120 * 60_000) },
        now,
      }),
    ).toEqual({ generate: true, reason: "retryFailed" });
  });

  it("強制指定なら必ず作り直す（手動再実行）", () => {
    expect(
      decideGeneration({ existing: { status: "ready", generatedAt: ts(1) }, now, force: true }),
    ).toEqual({ generate: true, reason: "forced" });
  });
});

describe("selectShard", () => {
  const items = Array.from({ length: 10 }, (_, i) => i);

  it("タスク数で分担する", () => {
    expect(selectShard(items, 0, 3)).toEqual([0, 3, 6, 9]);
    expect(selectShard(items, 1, 3)).toEqual([1, 4, 7]);
    expect(selectShard(items, 2, 3)).toEqual([2, 5, 8]);
  });

  it("全タスクを合わせると漏れも重複も無い", () => {
    const all = [0, 1, 2].flatMap((i) => selectShard(items, i, 3)).sort((a, b) => a - b);
    expect(all).toEqual(items);
  });

  it("単一タスクなら全件", () => {
    expect(selectShard(items, 0, 1)).toEqual(items);
  });

  it("タスク数がログ数より多くても壊れない", () => {
    expect(selectShard([1, 2], 5, 8)).toEqual([]);
  });

  it("不正な指定は例外", () => {
    expect(() => selectShard(items, 0, 0)).toThrow();
    expect(() => selectShard(items, 3, 3)).toThrow();
    expect(() => selectShard(items, -1, 3)).toThrow();
  });
});
