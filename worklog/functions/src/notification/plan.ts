import { createHash } from "node:crypto";

import {
  NOTIFICATION_JITTER_MAX_SEC,
  isHoliday,
  listSlotKeys,
  slotStartAt,
  resolveBusinessDate,
  addDays,
  type BusinessDate,
  type EffectiveSettings,
  type SlotKey,
} from "@worklog/shared";

/**
 * 通知の計画（設計書 第6章）。I/O を含まないのでユニットテストできる。
 *
 * 方針
 *  - Cloud Scheduler が10分おきに起動し、「次の10分の間に始まるスロット」を拾う
 *  - 配信時刻に 0〜3分のばらつきを付けてアップロードの集中を平準化する (F-116)
 *  - ばらつきは **ユーザーとスロットから決まる決定的な値** にする。
 *    Math.random だとスケジューラのリトライで別時刻の二重送信になりうる
 */

export interface SlotWindowItem {
  businessDate: BusinessDate;
  slotKey: SlotKey;
  startsAt: Date;
}

/**
 * [now, now + windowMin) の間に開始するスロットを列挙する。
 * 業務日の境界を跨ぐので、当日と翌日の両方を見る。
 */
export function slotsStartingWithin(
  now: Date,
  windowMin: number,
  settings: Pick<
    EffectiveSettings,
    "timezone" | "workingHours" | "captureIntervalMin" | "holidays"
  >,
): SlotWindowItem[] {
  const windowEnd = now.getTime() + windowMin * 60_000;
  const slotKeys = listSlotKeys(settings.workingHours, settings.captureIntervalMin);
  const today = resolveBusinessDate(now, settings.timezone, settings.workingHours);

  const items: SlotWindowItem[] = [];
  for (const businessDate of [today, addDays(today, 1)]) {
    // 休日は通知を配信しない（運用ケース「休日・祝日」F-101）
    if (isHoliday(settings.holidays, businessDate)) continue;
    for (const slotKey of slotKeys) {
      const startsAt = slotStartAt(businessDate, slotKey, settings.timezone, settings.workingHours);
      const t = startsAt.getTime();
      if (t >= now.getTime() && t < windowEnd) {
        items.push({ businessDate, slotKey, startsAt });
      }
    }
  }
  return items.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

/**
 * 0〜max 秒の決定的なばらつき (F-116)。
 * 同じ (uid, businessDate, slotKey) からは常に同じ値になるので、
 * スケジューラが二重起動しても配信時刻がぶれない。
 */
export function jitterSeconds(
  key: string,
  maxSec: number = NOTIFICATION_JITTER_MAX_SEC,
): number {
  const digest = createHash("sha256").update(key).digest();
  // 先頭4バイトを整数にして剰余を取る
  const value = digest.readUInt32BE(0);
  return value % (maxSec + 1);
}

/**
 * Cloud Tasks の重複排除キー。
 * ドキュメントの推奨どおりハッシュ化して均一に分散させる
 * （連番・タイムスタンプ由来のIDはキューのレイテンシを悪化させる）。
 */
export function taskDedupeId(params: {
  tenantId: string;
  userId: string;
  businessDate: BusinessDate;
  slotKey: SlotKey;
  kind: NotificationKind;
}): string {
  const raw = `${params.tenantId}/${params.userId}/${params.businessDate}/${params.slotKey}/${params.kind}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 48);
}

export type NotificationKind = "initial" | "resend";

export interface NotificationTask {
  tenantId: string;
  userId: string;
  businessDate: BusinessDate;
  slotKey: SlotKey;
  kind: NotificationKind;
  /** now からの遅延秒数 */
  delaySeconds: number;
  dedupeId: string;
}

/**
 * 1人・1スロット分の通知タスク（初回＋15分後の再送）を作る (F-114)。
 * 再送タスクは「まだ撮っていなければ送る」判定を配信側で行う。
 */
export function buildNotificationTasks(params: {
  tenantId: string;
  userId: string;
  item: SlotWindowItem;
  now: Date;
  resendAfterMin: number;
}): NotificationTask[] {
  const { tenantId, userId, item, now } = params;
  const baseDelay = Math.max(0, Math.round((item.startsAt.getTime() - now.getTime()) / 1000));
  const jitter = jitterSeconds(`${tenantId}/${userId}/${item.businessDate}/${item.slotKey}`);

  const make = (kind: NotificationKind, extraSec: number): NotificationTask => ({
    tenantId,
    userId,
    businessDate: item.businessDate,
    slotKey: item.slotKey,
    kind,
    delaySeconds: baseDelay + jitter + extraSec,
    dedupeId: taskDedupeId({
      tenantId,
      userId,
      businessDate: item.businessDate,
      slotKey: item.slotKey,
      kind,
    }),
  });

  return [make("initial", 0), make("resend", params.resendAfterMin * 60)];
}
