import { NOTIFICATION_JITTER_MAX_SEC, type EffectiveSettings } from "@worklog/shared";
import { describe, expect, it } from "vitest";

import { buildNotificationTasks, jitterSeconds, slotsStartingWithin, taskDedupeId } from "../plan";

const jst = (s: string) => new Date(`${s}+09:00`);

type PlanSettings = Pick<
  EffectiveSettings,
  "timezone" | "workingHours" | "captureIntervalMin" | "holidays"
>;

const day: PlanSettings = {
  timezone: "Asia/Tokyo",
  workingHours: { start: "09:00", end: "18:00" },
  captureIntervalMin: 60,
  holidays: [],
};

const night: PlanSettings = { ...day, workingHours: { start: "22:00", end: "06:00" } };

describe("slotsStartingWithin", () => {
  it("10分の窓に入るスロットだけを返す", () => {
    const items = slotsStartingWithin(jst("2026-07-26T11:55:00"), 10, day);
    expect(items.map((i) => i.slotKey)).toEqual(["12:00"]);
    expect(items[0]?.businessDate).toBe("2026-07-26");
  });

  it("窓にスロットが無ければ空", () => {
    expect(slotsStartingWithin(jst("2026-07-26T12:05:00"), 10, day)).toEqual([]);
  });

  it("窓の終端は含まない（次回の起動で拾うので二重にならない）", () => {
    const items = slotsStartingWithin(jst("2026-07-26T11:50:00"), 10, day);
    expect(items).toEqual([]);
  });

  it("窓の開始と一致するスロットは含む", () => {
    const items = slotsStartingWithin(jst("2026-07-26T12:00:00"), 10, day);
    expect(items.map((i) => i.slotKey)).toEqual(["12:00"]);
  });

  it("休日は通知しない（運用ケース「休日・祝日」F-101）", () => {
    const items = slotsStartingWithin(jst("2026-07-26T11:55:00"), 10, {
      ...day,
      holidays: ["2026-07-26"],
    });
    expect(items).toEqual([]);
  });

  it("稼働時間外は返さない（18:00 は end なので対象外）", () => {
    expect(slotsStartingWithin(jst("2026-07-26T17:55:00"), 10, day).map((i) => i.slotKey)).toEqual(
      [],
    );
  });

  it("翌日の初回スロットも窓に入れば拾える（業務日を跨ぐ）", () => {
    const items = slotsStartingWithin(jst("2026-07-26T08:55:00"), 10, day);
    expect(items.map((i) => `${i.businessDate} ${i.slotKey}`)).toEqual(["2026-07-26 09:00"]);
  });

  it("夜勤の日跨ぎスロットは正しい業務日で返る", () => {
    // 実時刻 2026-07-27 01:00 のスロットは、業務日 2026-07-26 に属する
    const items = slotsStartingWithin(jst("2026-07-27T00:55:00"), 10, night);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ businessDate: "2026-07-26", slotKey: "01:00" });
  });

  it("30分間隔の設定では30分刻みのスロットが返る (F-111)", () => {
    const items = slotsStartingWithin(jst("2026-07-26T12:25:00"), 10, {
      ...day,
      captureIntervalMin: 30,
    });
    expect(items.map((i) => i.slotKey)).toEqual(["12:30"]);
  });

  it("時系列で昇順に並ぶ", () => {
    const items = slotsStartingWithin(jst("2026-07-26T08:30:00"), 600, day);
    const times = items.map((i) => i.startsAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});

describe("jitterSeconds (F-116)", () => {
  it("0〜180秒の範囲に収まる", () => {
    for (let i = 0; i < 500; i += 1) {
      const v = jitterSeconds(`user${i}/2026-07-26/12:00`);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(NOTIFICATION_JITTER_MAX_SEC);
    }
  });

  it("同じキーからは常に同じ値（スケジューラの再実行で二重送信にならない）", () => {
    const a = jitterSeconds("t/u/2026-07-26/12:00");
    const b = jitterSeconds("t/u/2026-07-26/12:00");
    expect(a).toBe(b);
  });

  it("ユーザーごとにばらける（100人が同時送信しない）", () => {
    const values = Array.from({ length: 100 }, (_, i) =>
      jitterSeconds(`tenant/user${i}/2026-07-26/12:00`),
    );
    // 100人が10秒以内に固まっていないこと
    expect(new Set(values).size).toBeGreaterThan(50);
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(60);
  });

  it("スロットごとにもばらつく", () => {
    expect(jitterSeconds("t/u/2026-07-26/12:00")).not.toBe(jitterSeconds("t/u/2026-07-26/13:00"));
  });
});

describe("taskDedupeId", () => {
  const base = {
    tenantId: "acme",
    userId: "u1",
    businessDate: "2026-07-26",
    slotKey: "12:00",
    kind: "initial" as const,
  };

  it("Cloud Tasks のID制約（英数字とハイフン・アンダースコア）を満たす", () => {
    expect(taskDedupeId(base)).toMatch(/^[a-f0-9]{48}$/);
  });

  it("同じ通知からは同じID（重複排除が効く）", () => {
    expect(taskDedupeId(base)).toBe(taskDedupeId({ ...base }));
  });

  it("初回と再送でIDが違う（両方積める F-114）", () => {
    expect(taskDedupeId(base)).not.toBe(taskDedupeId({ ...base, kind: "resend" }));
  });

  it("テナント・ユーザー・スロットが違えばIDが違う", () => {
    expect(taskDedupeId(base)).not.toBe(taskDedupeId({ ...base, tenantId: "other" }));
    expect(taskDedupeId(base)).not.toBe(taskDedupeId({ ...base, userId: "u2" }));
    expect(taskDedupeId(base)).not.toBe(taskDedupeId({ ...base, slotKey: "13:00" }));
    expect(taskDedupeId(base)).not.toBe(taskDedupeId({ ...base, businessDate: "2026-07-27" }));
  });
});

describe("buildNotificationTasks", () => {
  const item = {
    businessDate: "2026-07-26",
    slotKey: "12:00",
    startsAt: jst("2026-07-26T12:00:00"),
  };

  it("初回と再送の2件を作る (F-114)", () => {
    const tasks = buildNotificationTasks({
      tenantId: "acme",
      userId: "u1",
      item,
      now: jst("2026-07-26T11:55:00"),
      resendAfterMin: 15,
    });
    expect(tasks.map((t) => t.kind)).toEqual(["initial", "resend"]);
  });

  it("初回の遅延はスロットまでの時間 + ばらつき", () => {
    const now = jst("2026-07-26T11:55:00");
    const [initial] = buildNotificationTasks({
      tenantId: "acme",
      userId: "u1",
      item,
      now,
      resendAfterMin: 15,
    });
    const jitter = jitterSeconds("acme/u1/2026-07-26/12:00");
    expect(initial?.delaySeconds).toBe(300 + jitter);
  });

  it("再送は初回のちょうど15分後", () => {
    const tasks = buildNotificationTasks({
      tenantId: "acme",
      userId: "u1",
      item,
      now: jst("2026-07-26T11:55:00"),
      resendAfterMin: 15,
    });
    expect((tasks[1]?.delaySeconds ?? 0) - (tasks[0]?.delaySeconds ?? 0)).toBe(15 * 60);
  });

  it("スロットが過ぎている場合も負の遅延にはしない", () => {
    const tasks = buildNotificationTasks({
      tenantId: "acme",
      userId: "u1",
      item,
      now: jst("2026-07-26T12:30:00"),
      resendAfterMin: 15,
    });
    expect(tasks[0]?.delaySeconds).toBeGreaterThanOrEqual(0);
  });
});
