import { describe, expect, it } from "vitest";

import {
  addDays,
  businessDayBoundaryMin,
  businessDayRange,
  classifySlotTiming,
  crossesMidnight,
  currentSlotAt,
  expectedSlotCount,
  fromMinutes,
  listSlotKeys,
  nextSlotAfter,
  resolveBusinessDate,
  slotStartAt,
  toMinutes,
} from "../businessDay";
import type { WorkingHours } from "../types";

const TZ = "Asia/Tokyo";
const DAY: WorkingHours = { start: "09:00", end: "18:00" };
const NIGHT: WorkingHours = { start: "22:00", end: "06:00" };

/** JST の壁時計をそのまま Date にする（JST は UTC+9 固定なのでオフセット直書きでよい） */
const jst = (s: string) => new Date(`${s}+09:00`);

describe("toMinutes / fromMinutes", () => {
  it("HH:mm を分に変換する", () => {
    expect(toMinutes("00:00")).toBe(0);
    expect(toMinutes("09:30")).toBe(570);
    expect(toMinutes("23:59")).toBe(1439);
  });

  it("不正な入力は例外にする（黙って0にしない）", () => {
    expect(() => toMinutes("24:00")).toThrow();
    expect(() => toMinutes("9:00")).toThrow();
    expect(() => toMinutes("")).toThrow();
  });

  it("分から HH:mm に戻す。24h超は折り返す", () => {
    expect(fromMinutes(570)).toBe("09:30");
    expect(fromMinutes(1440)).toBe("00:00");
    expect(fromMinutes(1500)).toBe("01:00");
  });
});

describe("crossesMidnight / businessDayBoundaryMin", () => {
  it("日勤は日を跨がない", () => {
    expect(crossesMidnight(DAY)).toBe(false);
    expect(businessDayBoundaryMin(DAY)).toBe(toMinutes("04:00"));
  });

  it("夜勤は日を跨ぎ、勤務開始時刻が業務日の境界になる", () => {
    expect(crossesMidnight(NIGHT)).toBe(true);
    expect(businessDayBoundaryMin(NIGHT)).toBe(toMinutes("22:00"));
  });

  it("start と end が同じ場合も日跨ぎ扱い（24時間稼働）", () => {
    expect(crossesMidnight({ start: "08:00", end: "08:00" })).toBe(true);
  });
});

describe("resolveBusinessDate（日勤）", () => {
  it("稼働時間中はその日", () => {
    expect(resolveBusinessDate(jst("2026-07-26T12:04:33"), TZ, DAY)).toBe("2026-07-26");
  });

  it("深夜残業（境界 04:00 より前）は前日の業務日にまとまる", () => {
    expect(resolveBusinessDate(jst("2026-07-27T01:30:00"), TZ, DAY)).toBe("2026-07-26");
    expect(resolveBusinessDate(jst("2026-07-27T03:59:59"), TZ, DAY)).toBe("2026-07-26");
  });

  it("境界の 04:00 ちょうどは当日", () => {
    expect(resolveBusinessDate(jst("2026-07-27T04:00:00"), TZ, DAY)).toBe("2026-07-27");
  });

  it("月末・年末を跨いでも前日に戻る", () => {
    expect(resolveBusinessDate(jst("2027-01-01T02:00:00"), TZ, DAY)).toBe("2026-12-31");
  });
});

describe("resolveBusinessDate（夜勤・日跨ぎ）", () => {
  it("勤務開始直後は開始日の業務日", () => {
    expect(resolveBusinessDate(jst("2026-07-26T22:00:00"), TZ, NIGHT)).toBe("2026-07-26");
    expect(resolveBusinessDate(jst("2026-07-26T23:59:00"), TZ, NIGHT)).toBe("2026-07-26");
  });

  it("日付を跨いだ後も同じ業務日にまとまる（これが夜勤対応の本体）", () => {
    expect(resolveBusinessDate(jst("2026-07-27T00:00:00"), TZ, NIGHT)).toBe("2026-07-26");
    expect(resolveBusinessDate(jst("2026-07-27T05:59:00"), TZ, NIGHT)).toBe("2026-07-26");
  });

  it("次の勤務開始時刻を過ぎると次の業務日になる", () => {
    expect(resolveBusinessDate(jst("2026-07-27T22:00:00"), TZ, NIGHT)).toBe("2026-07-27");
  });
});

describe("resolveBusinessDate（タイムゾーン）", () => {
  it("テナントのタイムゾーンで解釈する（UTC で判定してはいけない）", () => {
    // 同じ瞬間が UTC では 2026-07-26 20:00、JST では 2026-07-27 05:00。
    // どちらも境界 04:00 より後なので、業務日が1日ずれる。
    const instant = new Date("2026-07-26T20:00:00Z");
    expect(resolveBusinessDate(instant, TZ, DAY)).toBe("2026-07-27");
    expect(resolveBusinessDate(instant, "UTC", DAY)).toBe("2026-07-26");
  });

  it("JST 05:00 は境界 04:00 を過ぎているのでその日", () => {
    expect(resolveBusinessDate(jst("2026-07-27T05:00:00"), TZ, DAY)).toBe("2026-07-27");
  });
});

describe("listSlotKeys", () => {
  it("日勤 09:00-18:00 / 60分 → 9スロット", () => {
    expect(listSlotKeys(DAY, 60)).toEqual([
      "09:00",
      "10:00",
      "11:00",
      "12:00",
      "13:00",
      "14:00",
      "15:00",
      "16:00",
      "17:00",
    ]);
  });

  it("30分間隔", () => {
    expect(listSlotKeys({ start: "09:00", end: "11:00" }, 30)).toEqual([
      "09:00",
      "09:30",
      "10:00",
      "10:30",
    ]);
  });

  it("2時間間隔（撮影率を緩めたいテナント向け）", () => {
    expect(listSlotKeys(DAY, 120)).toEqual(["09:00", "11:00", "13:00", "15:00", "17:00"]);
  });

  it("夜勤は 24時をまたいで連続する", () => {
    expect(listSlotKeys(NIGHT, 60)).toEqual([
      "22:00",
      "23:00",
      "00:00",
      "01:00",
      "02:00",
      "03:00",
      "04:00",
      "05:00",
    ]);
  });

  it("撮影間隔が不正なら例外", () => {
    expect(() => listSlotKeys(DAY, 0)).toThrow();
    expect(() => listSlotKeys(DAY, -60)).toThrow();
  });
});

describe("slotStartAt", () => {
  it("日勤のスロットは業務日と同じ暦日", () => {
    expect(slotStartAt("2026-07-26", "12:00", TZ, DAY).toISOString()).toBe(
      "2026-07-26T03:00:00.000Z",
    );
  });

  it("夜勤の 22:00 スロットは業務日と同じ暦日", () => {
    expect(slotStartAt("2026-07-26", "22:00", TZ, NIGHT).toISOString()).toBe(
      "2026-07-26T13:00:00.000Z",
    );
  });

  it("夜勤の 02:00 スロットは業務日の翌暦日に置かれる", () => {
    expect(slotStartAt("2026-07-26", "02:00", TZ, NIGHT).toISOString()).toBe(
      "2026-07-26T17:00:00.000Z", // JST 2026-07-27 02:00
    );
  });

  it("listSlotKeys の結果が時系列で単調増加する（夜勤でも順序が壊れない）", () => {
    const times = listSlotKeys(NIGHT, 60).map((s) =>
      slotStartAt("2026-07-26", s, TZ, NIGHT).getTime(),
    );
    const sorted = [...times].sort((a, b) => a - b);
    expect(times).toEqual(sorted);
  });

  it("不正な業務日は例外", () => {
    expect(() => slotStartAt("2026/07/26", "12:00", TZ, DAY)).toThrow();
  });
});

describe("businessDayRange", () => {
  it("日勤は 04:00 から翌 04:00 まで", () => {
    const { start, end } = businessDayRange("2026-07-26", TZ, DAY);
    expect(start.toISOString()).toBe("2026-07-25T19:00:00.000Z"); // JST 07-26 04:00
    expect(end.toISOString()).toBe("2026-07-26T19:00:00.000Z");
  });

  it("業務日の全スロットが範囲に収まる（夜勤）", () => {
    const { start, end } = businessDayRange("2026-07-26", TZ, NIGHT);
    for (const slotKey of listSlotKeys(NIGHT, 60)) {
      const t = slotStartAt("2026-07-26", slotKey, TZ, NIGHT).getTime();
      expect(t).toBeGreaterThanOrEqual(start.getTime());
      expect(t).toBeLessThan(end.getTime());
    }
  });
});

describe("classifySlotTiming", () => {
  const slotStart = jst("2026-07-26T12:00:00");

  it("スロット直後は onTime", () => {
    expect(classifySlotTiming(jst("2026-07-26T12:04:00"), slotStart, 50)).toBe("onTime");
  });

  it("猶予ちょうどは onTime", () => {
    expect(classifySlotTiming(jst("2026-07-26T12:50:00"), slotStart, 50)).toBe("onTime");
  });

  it("猶予を1分でも超えたら late（受理はする F-110）", () => {
    expect(classifySlotTiming(jst("2026-07-26T12:51:00"), slotStart, 50)).toBe("late");
  });

  it("受理上限（既定12時間）を超えたら closed", () => {
    expect(classifySlotTiming(jst("2026-07-27T00:01:00"), slotStart, 50)).toBe("closed");
  });

  it("わずかに早い撮影は許容する（ホームから先回りして撮る操作）", () => {
    expect(classifySlotTiming(jst("2026-07-26T11:58:00"), slotStart, 50)).toBe("onTime");
  });

  it("許容を超えて早い撮影は tooEarly", () => {
    expect(classifySlotTiming(jst("2026-07-26T11:00:00"), slotStart, 50)).toBe("tooEarly");
  });
});

describe("nextSlotAfter", () => {
  it("稼働時間中は次の正時を返す", () => {
    const next = nextSlotAfter(jst("2026-07-26T12:10:00"), TZ, DAY, 60);
    expect(next?.businessDate).toBe("2026-07-26");
    expect(next?.slotKey).toBe("13:00");
  });

  it("稼働終了後は翌業務日の初回スロットを返す", () => {
    const next = nextSlotAfter(jst("2026-07-26T19:00:00"), TZ, DAY, 60);
    expect(next?.businessDate).toBe("2026-07-27");
    expect(next?.slotKey).toBe("09:00");
  });

  it("休日はスキップする（運用ケース「休日・祝日」F-101）", () => {
    const holidays = new Set(["2026-07-27", "2026-07-28"]);
    const next = nextSlotAfter(jst("2026-07-26T19:00:00"), TZ, DAY, 60, {
      isBusinessDay: (d) => !holidays.has(d),
    });
    expect(next?.businessDate).toBe("2026-07-29");
    expect(next?.slotKey).toBe("09:00");
  });

  it("休日が続いて見つからなければ null", () => {
    const next = nextSlotAfter(jst("2026-07-26T19:00:00"), TZ, DAY, 60, {
      isBusinessDay: () => false,
    });
    expect(next).toBeNull();
  });

  it("夜勤でも次のスロットが時系列で正しい", () => {
    const next = nextSlotAfter(jst("2026-07-27T00:30:00"), TZ, NIGHT, 60);
    expect(next?.businessDate).toBe("2026-07-26");
    expect(next?.slotKey).toBe("01:00");
  });
});

describe("currentSlotAt", () => {
  it("直前に始まったスロットを返す", () => {
    const current = currentSlotAt(jst("2026-07-26T12:40:00"), TZ, DAY, 60);
    expect(current).toMatchObject({ businessDate: "2026-07-26", slotKey: "12:00" });
  });

  it("スロット開始ちょうどはそのスロット", () => {
    expect(currentSlotAt(jst("2026-07-26T13:00:00"), TZ, DAY, 60)?.slotKey).toBe("13:00");
  });

  it("稼働開始前は null", () => {
    expect(currentSlotAt(jst("2026-07-26T08:00:00"), TZ, DAY, 60)).toBeNull();
  });

  it("稼働終了後は最後のスロットを返す（後追い撮影のため）", () => {
    expect(currentSlotAt(jst("2026-07-26T20:00:00"), TZ, DAY, 60)?.slotKey).toBe("17:00");
  });

  it("夜勤の日跨ぎでも業務日が正しい", () => {
    const current = currentSlotAt(jst("2026-07-27T02:30:00"), TZ, NIGHT, 60);
    expect(current).toMatchObject({ businessDate: "2026-07-26", slotKey: "02:00" });
  });

  it("端末のローカル時刻ではなくテナントのタイムゾーンで判定する", () => {
    // 同じ瞬間が UTC では 2026-07-26 03:40、JST では 2026-07-26 12:40
    const instant = new Date("2026-07-26T03:40:00Z");
    expect(currentSlotAt(instant, TZ, DAY, 60)).toMatchObject({
      businessDate: "2026-07-26",
      slotKey: "12:00",
    });
    // UTC で解釈すると業務日も枠も別物になる（＝タイムゾーンを取り違えると壊れる）
    expect(currentSlotAt(instant, "UTC", DAY, 60)).toMatchObject({
      businessDate: "2026-07-25",
      slotKey: "17:00",
    });
  });
});

describe("expectedSlotCount / addDays", () => {
  it("撮影率の分母を返す", () => {
    expect(expectedSlotCount(DAY, 60)).toBe(9);
    expect(expectedSlotCount(NIGHT, 60)).toBe(8);
  });

  it("業務日の加減算", () => {
    expect(addDays("2026-07-31", 1)).toBe("2026-08-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});
