import type { CaptureStatus } from "./types";

/**
 * 状態の進行度。
 *
 * `capture-commit`（クライアント起点）と `onCaptureUploaded`（Storageトリガ）は
 * どちらが先に走るか決まらない（設計書 5.2 の注記）。状態を必ず単調増加でしか
 * 更新しないことで、順序に関係なく同じ結果に収束させる。
 */
const STATUS_RANK: Record<CaptureStatus, number> = {
  pending: 0,
  uploaded: 1,
  processing: 2,
  ready: 3,
  // deleted は終端。ランクを最大にして、後から来た ready 等で復活させない (F-904)
  deleted: 99,
};

export function captureStatusRank(status: CaptureStatus): number {
  return STATUS_RANK[status];
}

/** next へ進めてよいか。同じか後退なら false（＝書き込みを省略できる） */
export function canAdvanceCaptureStatus(current: CaptureStatus, next: CaptureStatus): boolean {
  if (current === "deleted") return false;
  return captureStatusRank(next) > captureStatusRank(current);
}

/** グリッド・Vlog・撮影率で「撮影済み」として数える状態か */
export function isCaptureVisible(status: CaptureStatus): boolean {
  return status === "ready" || status === "processing" || status === "uploaded";
}

/** 撮影率の分子に数える状態か。削除済みも「撮影した」実績として数える (F-706) */
export function countsAsCaptured(status: CaptureStatus): boolean {
  return status !== "pending";
}
