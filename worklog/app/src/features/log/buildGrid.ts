import type { CaptureStatus, GridCell, GridRow, SlotKey } from "@worklog/shared";
import { countsAsCaptured, isCaptureVisible } from "@worklog/shared";

/**
 * サムネイルグリッドの行列を組み立てる (F-301, F-304, F-305)。
 *
 * 表示は必ず静止画サムネイル。動画コンポーネントはグリッドに置かない（CLAUDE.md）。
 * 未撮影・削除済み・撮影しない時間の申告を、それぞれ別の枠として返す。
 */

export interface GridCaptureInput {
  captureId: string;
  userId: string;
  slotKey: SlotKey;
  status: CaptureStatus;
  capturedAtIso: string;
  isLate: boolean;
  thumbUrl?: string | null;
}

export interface GridUserInput {
  userId: string;
  userName: string;
  /** 氏名の読み（かな）。氏名順の並べ替えに使う (F-305) */
  userNameKana?: string;
  photoUrl?: string;
}

export type GridSortOrder =
  /** 氏名順 */
  | "name"
  /** 撮影時刻順（その日の初回撮影が早い順） */
  | "capturedAt"
  /** 未撮影が多い人を先頭に */
  | "missingFirst";

export interface BuildGridParams {
  users: readonly GridUserInput[];
  captures: readonly GridCaptureInput[];
  slotKeys: readonly SlotKey[];
  /** userId → 撮影しないと申告済みのスロット (F-113) */
  declaredOff?: Readonly<Record<string, readonly SlotKey[]>>;
  sort?: GridSortOrder;
}

export function buildGrid(params: BuildGridParams): GridRow[] {
  const { users, captures, slotKeys, declaredOff = {}, sort = "name" } = params;

  // userId → slotKey → capture
  const index = new Map<string, Map<SlotKey, GridCaptureInput>>();
  for (const capture of captures) {
    let bySlot = index.get(capture.userId);
    if (!bySlot) {
      bySlot = new Map();
      index.set(capture.userId, bySlot);
    }
    const existing = bySlot.get(capture.slotKey);
    // 同一スロットに複数ある場合（削除後の撮り直し等）は新しい方を採る
    if (!existing || existing.capturedAtIso < capture.capturedAtIso) {
      bySlot.set(capture.slotKey, capture);
    }
  }

  const rows: GridRow[] = users.map((user) => {
    const bySlot = index.get(user.userId);
    const off = new Set(declaredOff[user.userId] ?? []);

    let capturedCount = 0;
    let expectedCount = 0;

    const cells: GridCell[] = slotKeys.map((slotKey) => {
      const capture = bySlot?.get(slotKey);
      const isOff = off.has(slotKey);

      // 撮影しないと申告した枠は撮影率の分母から外す（運用ケース）
      if (!isOff) expectedCount += 1;
      if (capture && countsAsCaptured(capture.status)) capturedCount += 1;

      if (capture?.status === "deleted") {
        // 映像は消えるが枠は残る (F-902)
        return { slotKey, state: "deleted", captureId: capture.captureId, capturedAtIso: capture.capturedAtIso };
      }
      if (capture && isCaptureVisible(capture.status)) {
        return {
          slotKey,
          state: capture.isLate ? "late" : "captured",
          captureId: capture.captureId,
          capturedAtIso: capture.capturedAtIso,
          thumbUrl: capture.thumbUrl ?? null,
        };
      }
      if (isOff) return { slotKey, state: "declaredOff" };
      // pending（予約のみ）も未撮影として空きコマにする
      return { slotKey, state: "empty" };
    });

    return {
      userId: user.userId,
      userName: user.userName,
      userNameKana: user.userNameKana,
      photoUrl: user.photoUrl,
      cells,
      capturedCount,
      expectedCount,
    };
  });

  return sortRows(rows, sort);
}

/**
 * 氏名順の比較キー。
 *
 * ⚠️ 漢字の氏名は `localeCompare('ja')` でも五十音順にならない
 *    （「佐藤」<「青木」のようにコードポイント寄りの順になる）。
 *    五十音順にするには読み（かな）が必要なので、あればそちらを使う。
 *    読みが未登録のユーザーは氏名で比較され、五十音順にはならない。
 *    管理Webで読みを登録してもらう運用が前提 (F-605)。
 */
function nameKey(row: GridRow): string {
  return row.userNameKana ?? row.userName;
}

function byName(a: GridRow, b: GridRow): number {
  const diff = nameKey(a).localeCompare(nameKey(b), "ja");
  // 読みが同じ場合も並びが揺れないよう userId で決着させる
  return diff !== 0 ? diff : a.userId.localeCompare(b.userId);
}

function sortRows(rows: GridRow[], sort: GridSortOrder): GridRow[] {
  const sorted = [...rows];
  switch (sort) {
    case "name":
      return sorted.sort(byName);
    case "capturedAt":
      return sorted.sort((a, b) => {
        const at = firstCapturedAt(a);
        const bt = firstCapturedAt(b);
        // 未撮影の人は末尾に置く
        if (at === undefined && bt === undefined) return byName(a, b);
        if (at === undefined) return 1;
        if (bt === undefined) return -1;
        return at.localeCompare(bt);
      });
    case "missingFirst":
      return sorted.sort((a, b) => {
        const diff = missingCount(b) - missingCount(a);
        return diff !== 0 ? diff : byName(a, b);
      });
  }
}

function firstCapturedAt(row: GridRow): string | undefined {
  const times = row.cells
    .map((c) => c.capturedAtIso)
    .filter((t): t is string => typeof t === "string");
  return times.length > 0 ? times.sort()[0] : undefined;
}

function missingCount(row: GridRow): number {
  return row.expectedCount - row.capturedCount;
}

/** ログ全体の撮影率 (F-802)。分母は申告済みの枠を除いた合計 */
export function aggregateRate(rows: readonly GridRow[]): { captured: number; expected: number } {
  return rows.reduce(
    (acc, row) => ({
      captured: acc.captured + row.capturedCount,
      expected: acc.expected + row.expectedCount,
    }),
    { captured: 0, expected: 0 },
  );
}
