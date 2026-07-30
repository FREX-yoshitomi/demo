import { DEFAULT_CAPTURE_GRACE_MIN, type EffectiveSettings } from "@worklog/shared";
import { describe, expect, it } from "vitest";

import { clampCapturedAt, decideSlot } from "../slotPolicy";

const jst = (s: string) => new Date(`${s}+09:00`);

const daySettings: Pick<
  EffectiveSettings,
  "timezone" | "workingHours" | "captureIntervalMin" | "captureGraceMin" | "holidays"
> = {
  timezone: "Asia/Tokyo",
  workingHours: { start: "09:00", end: "18:00" },
  captureIntervalMin: 60,
  captureGraceMin: DEFAULT_CAPTURE_GRACE_MIN,
  holidays: [],
};

const nightSettings = {
  ...daySettings,
  workingHours: { start: "22:00", end: "06:00" },
};

describe("clampCapturedAt", () => {
  it("サーバー時刻より未来の端末時刻は採用しない（枠の先取り防止）", () => {
    const now = jst("2026-07-26T12:05:00");
    const future = jst("2026-07-26T15:00:00");
    expect(clampCapturedAt(future, now)).toEqual(now);
  });

  it("過去の撮影時刻はそのまま保持する（オフラインキューの再送 F-112）", () => {
    const now = jst("2026-07-26T14:00:00");
    const captured = jst("2026-07-26T12:04:33");
    expect(clampCapturedAt(captured, now)).toEqual(captured);
  });

  it("秒を丸めない (F-105)", () => {
    const now = jst("2026-07-26T14:00:00");
    const captured = jst("2026-07-26T12:04:33");
    expect(clampCapturedAt(captured, now).getSeconds()).toBe(33);
  });
});

describe("decideSlot 猶予内", () => {
  it("スロット直後の撮影は遅延なしで受理", () => {
    const result = decideSlot({
      businessDate: "2026-07-26",
      slotKey: "12:00",
      clientCapturedAt: jst("2026-07-26T12:04:00"),
      now: jst("2026-07-26T12:04:05"),
      settings: daySettings,
    });
    expect(result).toMatchObject({ ok: true, isLate: false });
  });

  it("猶予の境界（50分）は遅延なし (F-109)", () => {
    const result = decideSlot({
      businessDate: "2026-07-26",
      slotKey: "12:00",
      clientCapturedAt: jst("2026-07-26T12:50:00"),
      now: jst("2026-07-26T12:50:00"),
      settings: daySettings,
    });
    expect(result).toMatchObject({ ok: true, isLate: false });
  });
});

describe("decideSlot 遅延 (F-110)", () => {
  it("猶予超過でも受理し、遅延フラグを立てる", () => {
    const result = decideSlot({
      businessDate: "2026-07-26",
      slotKey: "12:00",
      clientCapturedAt: jst("2026-07-26T13:30:00"),
      now: jst("2026-07-26T13:30:00"),
      settings: daySettings,
    });
    expect(result).toMatchObject({ ok: true, isLate: true });
  });

  it("テナント設定で猶予を短くすると遅延になる (F-109 設定可)", () => {
    const result = decideSlot({
      businessDate: "2026-07-26",
      slotKey: "12:00",
      clientCapturedAt: jst("2026-07-26T12:20:00"),
      now: jst("2026-07-26T12:20:00"),
      settings: { ...daySettings, captureGraceMin: 10 },
    });
    expect(result).toMatchObject({ ok: true, isLate: true });
  });
});

describe("decideSlot 受け付けない場合", () => {
  it("休日は受け付けない（運用ケース「休日・祝日」）", () => {
    const result = decideSlot({
      businessDate: "2026-07-26",
      slotKey: "12:00",
      clientCapturedAt: jst("2026-07-26T12:04:00"),
      now: jst("2026-07-26T12:04:00"),
      settings: { ...daySettings, holidays: ["2026-07-26"] },
    });
    expect(result).toEqual({ ok: false, reason: "holiday" });
  });

  it("稼働時間帯に存在しないスロットは受け付けない", () => {
    const result = decideSlot({
      businessDate: "2026-07-26",
      slotKey: "03:00",
      clientCapturedAt: jst("2026-07-26T03:00:00"),
      now: jst("2026-07-26T03:00:00"),
      settings: daySettings,
    });
    expect(result).toEqual({ ok: false, reason: "unknownSlot" });
  });

  it("撮影間隔とずれたスロットは受け付けない（30分刻みは60分設定では無効）", () => {
    const result = decideSlot({
      businessDate: "2026-07-26",
      slotKey: "12:30",
      clientCapturedAt: jst("2026-07-26T12:31:00"),
      now: jst("2026-07-26T12:31:00"),
      settings: daySettings,
    });
    expect(result).toEqual({ ok: false, reason: "unknownSlot" });
  });

  it("「撮影しない時間」に申告済みのスロットは受け付けない (F-113)", () => {
    const result = decideSlot({
      businessDate: "2026-07-26",
      slotKey: "12:00",
      clientCapturedAt: jst("2026-07-26T12:04:00"),
      now: jst("2026-07-26T12:04:00"),
      settings: daySettings,
      declaredOffSlots: ["12:00", "13:00"],
    });
    expect(result).toEqual({ ok: false, reason: "unknownSlot" });
  });

  it("受理上限を超えた後追いは断る", () => {
    const result = decideSlot({
      businessDate: "2026-07-26",
      slotKey: "12:00",
      clientCapturedAt: jst("2026-07-27T09:00:00"),
      now: jst("2026-07-27T09:00:00"),
      settings: daySettings,
    });
    expect(result).toEqual({ ok: false, reason: "closed" });
  });

  it("まだ来ていないスロットは先取りできない", () => {
    const result = decideSlot({
      businessDate: "2026-07-26",
      slotKey: "17:00",
      clientCapturedAt: jst("2026-07-26T12:00:00"),
      now: jst("2026-07-26T12:00:00"),
      settings: daySettings,
    });
    expect(result).toEqual({ ok: false, reason: "closed" });
  });

  it("端末時刻を未来にずらしても先取りできない（クランプが効く）", () => {
    const result = decideSlot({
      businessDate: "2026-07-26",
      slotKey: "17:00",
      clientCapturedAt: jst("2026-07-26T17:00:00"), // 端末は嘘をついている
      now: jst("2026-07-26T12:00:00"),
      settings: daySettings,
    });
    expect(result).toEqual({ ok: false, reason: "closed" });
  });
});

describe("decideSlot 夜勤（日跨ぎ）", () => {
  it("業務日の翌暦日に来る 02:00 スロットを正しく解釈する", () => {
    const result = decideSlot({
      businessDate: "2026-07-26",
      slotKey: "02:00",
      clientCapturedAt: jst("2026-07-27T02:03:00"),
      now: jst("2026-07-27T02:03:10"),
      settings: nightSettings,
    });
    expect(result).toMatchObject({ ok: true, isLate: false });
  });

  it("同じ壁時計でも業務日が違えば受け付けない", () => {
    // 業務日 2026-07-27 の 02:00 は実時刻 2026-07-28 02:00。まだ来ていない
    const result = decideSlot({
      businessDate: "2026-07-27",
      slotKey: "02:00",
      clientCapturedAt: jst("2026-07-27T02:03:00"),
      now: jst("2026-07-27T02:03:00"),
      settings: nightSettings,
    });
    expect(result).toEqual({ ok: false, reason: "closed" });
  });

  it("オフラインキューから翌朝送っても撮影時刻で判定される (F-112)", () => {
    const result = decideSlot({
      businessDate: "2026-07-26",
      slotKey: "23:00",
      clientCapturedAt: jst("2026-07-26T23:05:00"), // 撮影は圏外だった
      now: jst("2026-07-27T07:00:00"), // 送信は翌朝
      settings: nightSettings,
    });
    expect(result).toMatchObject({ ok: true, isLate: false });
  });
});
