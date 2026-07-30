import { describe, expect, it } from "vitest";

import {
  canAdvanceCaptureStatus,
  captureStatusRank,
  countsAsCaptured,
  isCaptureVisible,
} from "../capture";
import type { CaptureStatus } from "../types";

const ALL: CaptureStatus[] = ["pending", "uploaded", "processing", "ready", "deleted"];

describe("canAdvanceCaptureStatus", () => {
  it("前に進める", () => {
    expect(canAdvanceCaptureStatus("pending", "uploaded")).toBe(true);
    expect(canAdvanceCaptureStatus("pending", "ready")).toBe(true);
    expect(canAdvanceCaptureStatus("processing", "ready")).toBe(true);
  });

  it("後戻りはしない（commit と Storage トリガの順序が逆でも壊れない）", () => {
    expect(canAdvanceCaptureStatus("ready", "processing")).toBe(false);
    expect(canAdvanceCaptureStatus("ready", "uploaded")).toBe(false);
    expect(canAdvanceCaptureStatus("processing", "uploaded")).toBe(false);
  });

  it("同じ状態への更新はしない（無駄な書き込みを避ける）", () => {
    for (const s of ALL) expect(canAdvanceCaptureStatus(s, s)).toBe(false);
  });

  it("削除済みからは何にも進めない（管理者でも復元できない F-904）", () => {
    for (const s of ALL) expect(canAdvanceCaptureStatus("deleted", s)).toBe(false);
  });

  it("どの状態からでも deleted には進める（削除が常に勝つ F-903）", () => {
    for (const s of ALL.filter((s) => s !== "deleted")) {
      expect(canAdvanceCaptureStatus(s, "deleted")).toBe(true);
    }
  });

  it("deleted のランクが最大", () => {
    expect(Math.max(...ALL.map(captureStatusRank))).toBe(captureStatusRank("deleted"));
  });
});

describe("isCaptureVisible", () => {
  it("予約中と削除済みはグリッドに映像を出さない (F-304)", () => {
    expect(isCaptureVisible("pending")).toBe(false);
    expect(isCaptureVisible("deleted")).toBe(false);
  });

  it("アップロード後は表示対象", () => {
    expect(isCaptureVisible("uploaded")).toBe(true);
    expect(isCaptureVisible("processing")).toBe(true);
    expect(isCaptureVisible("ready")).toBe(true);
  });
});

describe("countsAsCaptured", () => {
  it("削除済みも「撮影した」実績として数える (F-706 勤怠の整合性)", () => {
    expect(countsAsCaptured("deleted")).toBe(true);
  });

  it("予約だけの枠は数えない（未撮影として通知の対象に残す）", () => {
    expect(countsAsCaptured("pending")).toBe(false);
  });
});
