import { DEFAULT_TIMEZONE } from "@worklog/shared";
import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * 表示用の時刻整形。
 * すべて **テナントのタイムゾーン** で表示する（端末のタイムゾーンではない：設計書 8.4）。
 * 撮影時刻は分単位で出す。**丸め処理は入れない**（切り捨て表示のみ：F-105）。
 */

export function formatTime(instant: Date | string, tz: string = DEFAULT_TIMEZONE): string {
  return dayjs(instant).tz(tz).format("HH:mm");
}

export function formatDateTime(instant: Date | string, tz: string = DEFAULT_TIMEZONE): string {
  return dayjs(instant).tz(tz).format("M月D日 HH:mm");
}

export function formatBusinessDate(businessDate: string): string {
  return dayjs(businessDate, "YYYY-MM-DD").format("M月D日(ddd)");
}

/** 次の撮影までのカウントダウン (F-801) */
export function formatCountdown(target: Date, now: Date = new Date()): string {
  const diffSec = Math.max(0, Math.floor((target.getTime() - now.getTime()) / 1000));
  const h = Math.floor(diffSec / 3600);
  const m = Math.floor((diffSec % 3600) / 60);
  const s = diffSec % 60;
  if (h > 0) return `${h}時間${String(m).padStart(2, "0")}分`;
  if (m > 0) return `${m}分${String(s).padStart(2, "0")}秒`;
  return `${s}秒`;
}

export function formatRate(captured: number, expected: number): string {
  if (expected === 0) return "—";
  return `${Math.round((captured / expected) * 100)}%`;
}
