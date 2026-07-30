import { ErrorCode } from "@worklog/shared";
import { describe, expect, it } from "vitest";

import {
  backoffMs,
  decideRetry,
  isDue,
  MAX_ATTEMPTS,
  selectDue,
  type QueueItem,
} from "../queuePolicy";

const item = (overrides: Partial<QueueItem> = {}): QueueItem => ({
  id: "q1",
  businessDate: "2026-07-26",
  slotKey: "12:00",
  capturedAtIso: "2026-07-26T03:04:33.000Z",
  camera: "back",
  localUri: "file:///tmp/a.mp4",
  attempts: 0,
  state: "pending",
  nextAttemptAt: 0,
  ...overrides,
});

describe("backoffMs", () => {
  const noJitter = () => 0.5; // ゆらぎ 1.0 倍

  it("試行回数に応じて指数的に伸びる", () => {
    expect(backoffMs(1, noJitter)).toBe(2_000);
    expect(backoffMs(2, noJitter)).toBe(4_000);
    expect(backoffMs(3, noJitter)).toBe(8_000);
  });

  it("10分で頭打ちにする（毎正時のスパイクを長引かせない）", () => {
    expect(backoffMs(20, noJitter)).toBe(10 * 60_000);
  });

  it("端末ごとにばらけるようゆらぎが掛かる", () => {
    const low = backoffMs(3, () => 0);
    const high = backoffMs(3, () => 1);
    expect(low).toBeLessThan(high);
    expect(low).toBeGreaterThanOrEqual(Math.round(8_000 * 0.8));
    expect(high).toBeLessThanOrEqual(Math.round(8_000 * 1.2));
  });
});

describe("decideRetry", () => {
  it("ネットワーク不通（コード無し）は再送する", () => {
    expect(decideRetry(item(), undefined)).toMatchObject({ action: "retry" });
  });

  it("サーバー内部エラーは再送する", () => {
    expect(decideRetry(item(), ErrorCode.INTERNAL)).toMatchObject({ action: "retry" });
  });

  it("署名付きURLの失効はすぐ再送する（URLを取り直せば通る）", () => {
    expect(decideRetry(item(), ErrorCode.UPLOAD_EXPIRED)).toEqual({ action: "retry", delayMs: 0 });
  });

  it("二重撮影は諦める（サーバー側に既に存在している）", () => {
    expect(decideRetry(item(), ErrorCode.CAPTURE_DUPLICATE)).toEqual({
      action: "giveUp",
      reason: "terminal",
    });
  });

  it("受付終了・休日・不正スロットは諦める", () => {
    for (const code of [
      ErrorCode.CAPTURE_SLOT_CLOSED,
      ErrorCode.CAPTURE_HOLIDAY,
      ErrorCode.CAPTURE_SLOT_UNKNOWN,
    ]) {
      expect(decideRetry(item(), code)).toMatchObject({ action: "giveUp", reason: "terminal" });
    }
  });

  it("認証系エラーは諦める（再送してもログインし直すまで通らない）", () => {
    expect(decideRetry(item(), ErrorCode.AUTH_TENANT_SUSPENDED)).toMatchObject({
      action: "giveUp",
    });
  });

  it("上限回数に達したら諦める（永久に電池を食わせない）", () => {
    expect(decideRetry(item({ attempts: MAX_ATTEMPTS - 1 }), undefined)).toEqual({
      action: "giveUp",
      reason: "maxAttempts",
    });
  });

  it("上限の1回前はまだ再送する", () => {
    expect(decideRetry(item({ attempts: MAX_ATTEMPTS - 2 }), undefined)).toMatchObject({
      action: "retry",
    });
  });
});

describe("isDue / selectDue", () => {
  it("再送時刻が来ていれば対象", () => {
    expect(isDue(item({ nextAttemptAt: 1000 }), 1000)).toBe(true);
    expect(isDue(item({ nextAttemptAt: 2000 }), 1000)).toBe(false);
  });

  it("諦めた項目は対象にしない", () => {
    expect(isDue(item({ state: "failed", nextAttemptAt: 0 }), 1000)).toBe(false);
  });

  it("撮影が古い順に送る", () => {
    const items = [
      item({ id: "late", capturedAtIso: "2026-07-26T05:00:00.000Z" }),
      item({ id: "early", capturedAtIso: "2026-07-26T03:00:00.000Z" }),
      item({ id: "mid", capturedAtIso: "2026-07-26T04:00:00.000Z" }),
    ];
    expect(selectDue(items, Date.now()).map((i) => i.id)).toEqual(["early", "mid", "late"]);
  });

  it("同時送信数を制限する（回線を占有しない）", () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      item({ id: `q${i}`, capturedAtIso: `2026-07-26T0${i}:00:00.000Z` }),
    );
    expect(selectDue(items, Date.now(), 3)).toHaveLength(3);
  });

  it("まだ時刻が来ていない項目は除外される", () => {
    const now = 10_000;
    const items = [
      item({ id: "ready", nextAttemptAt: 5_000 }),
      item({ id: "waiting", nextAttemptAt: 20_000 }),
    ];
    expect(selectDue(items, now).map((i) => i.id)).toEqual(["ready"]);
  });
});
