import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import customParseFormat from "dayjs/plugin/customParseFormat";

import {
  CAPTURE_EARLY_TOLERANCE_MIN,
  DEFAULT_BUSINESS_DAY_BOUNDARY,
  LATE_CAPTURE_ACCEPT_MIN,
} from "./constants";
import type { BusinessDate, HhMm, SlotKey, WorkingHours } from "./types";

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);

const MINUTES_PER_DAY = 24 * 60;
const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** "09:30" → 570。不正な入力は例外にする（黙って 0 にすると集計が静かに壊れる） */
export function toMinutes(hhmm: HhMm): number {
  const m = HHMM_RE.exec(hhmm);
  if (!m) throw new Error(`invalid HH:mm: ${JSON.stringify(hhmm)}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 570 → "09:30"。24時間を超える値は翌日側に折り返す */
export function fromMinutes(minutes: number): HhMm {
  const normalized = ((Math.round(minutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function isValidBusinessDate(value: string): boolean {
  return DATE_RE.test(value) && dayjs(value, "YYYY-MM-DD", true).isValid();
}

/** 稼働時間帯が日を跨ぐか（夜勤シフト） */
export function crossesMidnight(workingHours: WorkingHours): boolean {
  return toMinutes(workingHours.end) <= toMinutes(workingHours.start);
}

/**
 * 業務日の切り替わり時刻（ローカル時刻の分）。
 *
 * 運用ケース「業務日の定義」= 勤務開始時刻が属する日。これを実装に落とすと、
 * 「この時刻より前の撮影は前日の業務日」という境界を1つ決める話になる。
 *
 * - 日勤（09:00-18:00）: 04:00 を境界にする。深夜残業も同じ業務日に入る
 * - 夜勤（22:00-06:00）: 勤務開始の 22:00 が境界。日跨ぎの勤務が1つの業務日にまとまる
 */
export function businessDayBoundaryMin(workingHours: WorkingHours): number {
  return crossesMidnight(workingHours)
    ? toMinutes(workingHours.start)
    : toMinutes(DEFAULT_BUSINESS_DAY_BOUNDARY);
}

/**
 * 実時刻 → 業務日。
 *
 * ⚠️ アプリ・バッチのどこであっても、日付が必要なときは capturedAt から
 * `format("YYYY-MM-DD")` せずに必ずこの関数を通すこと（設計書 3.1 設計判断）。
 */
export function resolveBusinessDate(
  instant: Date,
  timezoneName: string,
  workingHours: WorkingHours,
): BusinessDate {
  const local = dayjs(instant).tz(timezoneName);
  const minutesOfDay = local.hour() * 60 + local.minute();
  const boundary = businessDayBoundaryMin(workingHours);
  const target = minutesOfDay < boundary ? local.subtract(1, "day") : local;
  return target.format("YYYY-MM-DD");
}

/**
 * 稼働時間帯と撮影間隔から通知スロットを列挙する (F-101, F-111)。
 * start を含み end は含まない。日跨ぎシフトは end に 24h 足して計算する。
 */
export function listSlotKeys(workingHours: WorkingHours, intervalMin: number): SlotKey[] {
  if (!Number.isFinite(intervalMin) || intervalMin <= 0) {
    throw new Error(`invalid intervalMin: ${intervalMin}`);
  }
  const start = toMinutes(workingHours.start);
  const end = crossesMidnight(workingHours)
    ? toMinutes(workingHours.end) + MINUTES_PER_DAY
    : toMinutes(workingHours.end);

  const slots: SlotKey[] = [];
  for (let m = start; m < end; m += intervalMin) {
    slots.push(fromMinutes(m));
  }
  return slots;
}

/** 業務日 + スロットキー → 実時刻。境界より前のスロットは業務日の翌暦日に置かれる */
export function slotStartAt(
  businessDate: BusinessDate,
  slotKey: SlotKey,
  timezoneName: string,
  workingHours: WorkingHours,
): Date {
  if (!isValidBusinessDate(businessDate)) {
    throw new Error(`invalid businessDate: ${JSON.stringify(businessDate)}`);
  }
  const slotMin = toMinutes(slotKey);
  const dayOffset = slotMin < businessDayBoundaryMin(workingHours) ? 1 : 0;
  const calendarDate = dayjs
    .tz(`${businessDate}T00:00:00`, timezoneName)
    .add(dayOffset, "day")
    .format("YYYY-MM-DD");
  // 文字列を組み直してから解釈することで、DSTのある地域でもズレない
  return dayjs.tz(`${calendarDate}T${slotKey}:00`, timezoneName).toDate();
}

/** 業務日に属する実時刻の範囲 [start, end)。Firestore の範囲クエリと集計に使う */
export function businessDayRange(
  businessDate: BusinessDate,
  timezoneName: string,
  workingHours: WorkingHours,
): { start: Date; end: Date } {
  const boundary = fromMinutes(businessDayBoundaryMin(workingHours));
  const start = dayjs.tz(`${businessDate}T${boundary}:00`, timezoneName);
  return { start: start.toDate(), end: start.add(1, "day").toDate() };
}

export function addDays(businessDate: BusinessDate, days: number): BusinessDate {
  return dayjs(businessDate, "YYYY-MM-DD", true).add(days, "day").format("YYYY-MM-DD");
}

/** テナントの「今」の業務日 */
export function currentBusinessDate(
  now: Date,
  timezoneName: string,
  workingHours: WorkingHours,
): BusinessDate {
  return resolveBusinessDate(now, timezoneName, workingHours);
}

// ---------------------------------------------------------------------------
// スロットのタイミング判定
// ---------------------------------------------------------------------------

export type SlotTiming =
  /** 猶予内。通常の撮影 */
  | "onTime"
  /** 猶予超過だが受理する。isLate=true を立てる (F-110) */
  | "late"
  /** 受理上限を超えた。CAPTURE/SLOT_CLOSED */
  | "closed"
  /** スロット開始よりも前。時計のズレか不正なリクエスト */
  | "tooEarly";

export function classifySlotTiming(
  capturedAt: Date,
  slotStart: Date,
  graceMin: number,
  options?: { lateAcceptMin?: number; earlyToleranceMin?: number },
): SlotTiming {
  const lateAcceptMin = options?.lateAcceptMin ?? LATE_CAPTURE_ACCEPT_MIN;
  const earlyToleranceMin = options?.earlyToleranceMin ?? CAPTURE_EARLY_TOLERANCE_MIN;
  const diffMin = (capturedAt.getTime() - slotStart.getTime()) / 60_000;

  if (diffMin < -earlyToleranceMin) return "tooEarly";
  if (diffMin <= graceMin) return "onTime";
  if (diffMin <= lateAcceptMin) return "late";
  return "closed";
}

export interface SlotRef {
  businessDate: BusinessDate;
  slotKey: SlotKey;
  startsAt: Date;
}

/**
 * now 以降で最初に来るスロット（ホームのカウントダウン用 F-801、通知スケジューラ用 F-101）。
 * `isBusinessDay` を渡すと休日をスキップする（運用ケース「休日・祝日」）。
 */
export function nextSlotAfter(
  now: Date,
  timezoneName: string,
  workingHours: WorkingHours,
  intervalMin: number,
  options?: { isBusinessDay?: (date: BusinessDate) => boolean; maxLookaheadDays?: number },
): SlotRef | null {
  const isBusinessDay = options?.isBusinessDay ?? (() => true);
  const maxLookaheadDays = options?.maxLookaheadDays ?? 14;
  const slotKeys = listSlotKeys(workingHours, intervalMin);
  if (slotKeys.length === 0) return null;

  let businessDate = resolveBusinessDate(now, timezoneName, workingHours);
  for (let i = 0; i <= maxLookaheadDays; i += 1) {
    if (isBusinessDay(businessDate)) {
      for (const slotKey of slotKeys) {
        const startsAt = slotStartAt(businessDate, slotKey, timezoneName, workingHours);
        if (startsAt.getTime() > now.getTime()) return { businessDate, slotKey, startsAt };
      }
    }
    businessDate = addDays(businessDate, 1);
  }
  return null;
}

/**
 * now の時点で「いま開いているスロット」（直前に始まったもの）を返す。
 * 通知を見落として後から撮る場合の対象枠を決めるのに使う。
 *
 * 端末のローカル時刻ではなく **テナントのタイムゾーン** で判定する（設計書 8.4）。
 */
export function currentSlotAt(
  now: Date,
  timezoneName: string,
  workingHours: WorkingHours,
  intervalMin: number,
): SlotRef | null {
  const businessDate = resolveBusinessDate(now, timezoneName, workingHours);
  let current: SlotRef | null = null;
  for (const slotKey of listSlotKeys(workingHours, intervalMin)) {
    const startsAt = slotStartAt(businessDate, slotKey, timezoneName, workingHours);
    if (startsAt.getTime() <= now.getTime()) current = { businessDate, slotKey, startsAt };
  }
  return current;
}

/** 撮影率の分母。休日・非稼働区分の除外は呼び出し側で判定する (F-802, 運用ケース) */
export function expectedSlotCount(workingHours: WorkingHours, intervalMin: number): number {
  return listSlotKeys(workingHours, intervalMin).length;
}
