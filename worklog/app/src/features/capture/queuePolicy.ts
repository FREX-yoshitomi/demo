import { ErrorCode } from "@worklog/shared";

/**
 * アップロードキューの再送方針 (F-112)。
 * I/O を含まないのでユニットテストできる。
 *
 * 前提：アップロードは毎正時直後に集中する（CLAUDE.md）。
 * サーバー側の一時的な失敗と、業務的に確定した失敗を区別しないと、
 * 永久に再送し続けて端末のバッテリーを食うか、逆に撮影を失う。
 */

export type QueueItemState = "pending" | "uploading" | "failed";

export interface QueueItem {
  id: string;
  businessDate: string;
  slotKey: string;
  /** 撮影時点の時刻。再送でも変えない (F-112 / 運用ケース「通信不良の現場」) */
  capturedAtIso: string;
  camera: "front" | "back";
  localUri: string;
  memo?: string;
  workTag?: string;
  attempts: number;
  state: QueueItemState;
  /** 次に再送してよい時刻（epoch ms） */
  nextAttemptAt: number;
  lastErrorCode?: string;
}

/** これ以上再送しても意味がない（業務的に確定した）エラー */
const TERMINAL_CODES: readonly string[] = [
  ErrorCode.CAPTURE_DUPLICATE,
  ErrorCode.CAPTURE_SLOT_CLOSED,
  ErrorCode.CAPTURE_SLOT_UNKNOWN,
  ErrorCode.CAPTURE_HOLIDAY,
  ErrorCode.AUTH_FORBIDDEN,
  ErrorCode.AUTH_NOT_WORKSPACE,
  ErrorCode.AUTH_DOMAIN_NOT_ALLOWED,
  ErrorCode.AUTH_TENANT_SUSPENDED,
  ErrorCode.AUTH_USER_DISABLED,
  ErrorCode.INVALID_ARGUMENT,
];

/** 署名付きURLの失効は「取り直してすぐ再送」でよい */
const IMMEDIATE_RETRY_CODES: readonly string[] = [ErrorCode.UPLOAD_EXPIRED];

export const MAX_ATTEMPTS = 8;

export type QueueDecision =
  | { action: "retry"; delayMs: number }
  | { action: "giveUp"; reason: "terminal" | "maxAttempts" };

/**
 * 指数バックオフ。毎正時のスパイクを避けるため、最大10分で頭打ちにする。
 * 端末ごとにばらけるよう ±20% のゆらぎを掛ける。
 */
export function backoffMs(attempts: number, random: () => number = Math.random): number {
  const base = Math.min(2 ** Math.max(0, attempts - 1) * 2_000, 10 * 60_000);
  const jitter = 0.8 + random() * 0.4;
  return Math.round(base * jitter);
}

export function decideRetry(
  item: Pick<QueueItem, "attempts">,
  errorCode: string | undefined,
  random: () => number = Math.random,
): QueueDecision {
  if (errorCode && TERMINAL_CODES.includes(errorCode)) {
    return { action: "giveUp", reason: "terminal" };
  }
  const attempts = item.attempts + 1;
  if (attempts >= MAX_ATTEMPTS) return { action: "giveUp", reason: "maxAttempts" };
  if (errorCode && IMMEDIATE_RETRY_CODES.includes(errorCode)) {
    return { action: "retry", delayMs: 0 };
  }
  return { action: "retry", delayMs: backoffMs(attempts, random) };
}

export function isDue(item: Pick<QueueItem, "state" | "nextAttemptAt">, now: number): boolean {
  if (item.state === "failed") return false;
  return item.nextAttemptAt <= now;
}

/** 送信対象を古い撮影から順に取る（撮影順にサーバーへ届く方が運用上わかりやすい） */
export function selectDue(items: QueueItem[], now: number, limit = 3): QueueItem[] {
  return items
    .filter((i) => isDue(i, now))
    .sort((a, b) => a.capturedAtIso.localeCompare(b.capturedAtIso))
    .slice(0, limit);
}
