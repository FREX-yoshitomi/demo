import {
  classifySlotTiming,
  isHoliday,
  listSlotKeys,
  slotStartAt,
  type BusinessDate,
  type EffectiveSettings,
  type SlotKey,
  type SlotTiming,
} from "@worklog/shared";

/**
 * 「この撮影を受け付けるか、遅延を付けるか、断るか」の判定。
 *
 * Functions のハンドラから I/O を切り離してここに置いてあるので、
 * エミュレータ無しでユニットテストできる（設計書 第11章）。
 */

export type SlotDecision =
  | { ok: true; isLate: boolean; slotStart: Date; capturedAt: Date }
  | { ok: false; reason: "holiday" | "unknownSlot" | "closed" };

export interface SlotDecisionInput {
  businessDate: BusinessDate;
  slotKey: SlotKey;
  /** 端末が申告した撮影時刻。オフラインキューからの再送でも撮影時点を保持する (F-112) */
  clientCapturedAt: Date;
  /** サーバー時刻 */
  now: Date;
  settings: Pick<
    EffectiveSettings,
    "timezone" | "workingHours" | "captureIntervalMin" | "captureGraceMin" | "holidays"
  >;
  /** 申告済みの「撮影しない時間」(F-113) */
  declaredOffSlots?: readonly SlotKey[];
}

/**
 * 端末時刻は信用しきれないので、次の範囲に丸める（＝クランプする）。
 *
 * - 未来方向：サーバー時刻を超える撮影時刻は認めない（時計を進めて先の枠を埋められないように）
 * - 過去方向：スロット開始より earlyTolerance 以上前は認めない（classifySlotTiming が tooEarly を返す）
 *
 * 丸めるのは「端末時計のズレ」の補正だけ。**分・秒の丸めはしない** (F-105)。
 */
export function clampCapturedAt(clientCapturedAt: Date, now: Date): Date {
  return clientCapturedAt.getTime() > now.getTime() ? now : clientCapturedAt;
}

export function decideSlot(input: SlotDecisionInput): SlotDecision {
  const { settings } = input;

  // 休日は撮影スロットが存在しない（運用ケース「休日・祝日」）
  if (isHoliday(settings.holidays, input.businessDate)) return { ok: false, reason: "holiday" };

  const validSlots = listSlotKeys(settings.workingHours, settings.captureIntervalMin);
  if (!validSlots.includes(input.slotKey)) return { ok: false, reason: "unknownSlot" };

  // 本人が「撮影しない」と申告した枠は通知も来ないので、撮影も受けない (F-113)
  if (input.declaredOffSlots?.includes(input.slotKey)) {
    return { ok: false, reason: "unknownSlot" };
  }

  const slotStart = slotStartAt(
    input.businessDate,
    input.slotKey,
    settings.timezone,
    settings.workingHours,
  );
  const capturedAt = clampCapturedAt(input.clientCapturedAt, input.now);
  const timing: SlotTiming = classifySlotTiming(capturedAt, slotStart, settings.captureGraceMin);

  switch (timing) {
    case "onTime":
      return { ok: true, isLate: false, slotStart, capturedAt };
    case "late":
      // 猶予超過でも受理する。遅延フラグを立てるだけ (F-110)
      return { ok: true, isLate: true, slotStart, capturedAt };
    case "closed":
      return { ok: false, reason: "closed" };
    case "tooEarly":
      // まだ来ていないスロット。枠の先取りは許さない
      return { ok: false, reason: "closed" };
  }
}
