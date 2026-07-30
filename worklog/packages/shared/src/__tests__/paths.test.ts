import { describe, expect, it } from "vitest";

import {
  buildCaptureId,
  parseCaptureId,
  parseCaptureVideoPath,
  slotKeyFromToken,
  slotToken,
  storagePath,
} from "../paths";

describe("slotToken", () => {
  it("コロンを落とす", () => {
    expect(slotToken("12:00")).toBe("1200");
    expect(slotToken("09:30")).toBe("0930");
  });

  it("不正な slotKey は例外", () => {
    expect(() => slotToken("24:00")).toThrow();
    expect(() => slotToken("1200")).not.toThrow(); // すでにトークン形式なら許容
    expect(() => slotToken("abc")).toThrow();
  });

  it("トークンから戻せる", () => {
    expect(slotKeyFromToken("1200")).toBe("12:00");
  });
});

describe("buildCaptureId / parseCaptureId", () => {
  it("決定的IDを組み立てる（同一スロットの二重撮影を防ぐ）", () => {
    expect(buildCaptureId("uid123", "2026-07-26", "12:00")).toBe("uid123_2026-07-26_1200");
  });

  it("同じ入力からは必ず同じIDになる", () => {
    expect(buildCaptureId("u", "2026-07-26", "12:00")).toBe(
      buildCaptureId("u", "2026-07-26", "12:00"),
    );
  });

  it("往復できる", () => {
    const id = buildCaptureId("uid123", "2026-07-26", "09:30");
    expect(parseCaptureId(id)).toEqual({
      uid: "uid123",
      businessDate: "2026-07-26",
      slotKey: "09:30",
    });
  });

  it("アンダースコアを含む uid は拒否する（IDのパースが壊れるため）", () => {
    expect(() => buildCaptureId("uid_123", "2026-07-26", "12:00")).toThrow();
  });

  it("パス区切りの混入を拒否する", () => {
    expect(() => buildCaptureId("../evil", "2026-07-26", "12:00")).toThrow();
  });

  it("形式が違えば null", () => {
    expect(parseCaptureId("garbage")).toBeNull();
    expect(parseCaptureId("uid_2026-7-26_1200")).toBeNull();
    expect(parseCaptureId("uid_2026-07-26_9999")).toBeNull();
  });
});

describe("storagePath / parseCaptureVideoPath", () => {
  it("動画パスは tenants/{t}/captures/{date}/{id}.mp4", () => {
    expect(storagePath.captureVideo("acme", "2026-07-26", "uid_2026-07-26_1200")).toBe(
      "tenants/acme/captures/2026-07-26/uid_2026-07-26_1200.mp4",
    );
  });

  it("サムネイルは thumbs 配下の jpg", () => {
    expect(storagePath.captureThumb("acme", "2026-07-26", "c1")).toBe(
      "tenants/acme/thumbs/2026-07-26/c1.jpg",
    );
  });

  it("Storage のオブジェクト名から撮影を特定できる（onCaptureUploaded 用）", () => {
    const objectName = storagePath.captureVideo("acme", "2026-07-26", "uid1_2026-07-26_1200");
    expect(parseCaptureVideoPath(objectName)).toEqual({
      tenantId: "acme",
      businessDate: "2026-07-26",
      captureId: "uid1_2026-07-26_1200",
    });
  });

  it("thumbs や vlogs のパスは撮影として解釈しない（無限ループ防止）", () => {
    expect(parseCaptureVideoPath(storagePath.captureThumb("acme", "2026-07-26", "c1"))).toBeNull();
    expect(parseCaptureVideoPath(storagePath.vlogPage("acme", "2026-07-26", "v1", 1))).toBeNull();
  });
});
