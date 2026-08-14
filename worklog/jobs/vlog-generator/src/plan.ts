import type { CaptureStatus, SlotKey } from "@worklog/shared";

import { buildCellLabel } from "./label";
import type { GridDimensions } from "./layout";
import { splitIntoPages } from "./pages";

/**
 * captures から「どのページの・どのスロットの・どの座席に何を置くか」を決める。
 * FFmpeg も GCS も触らないのでユニットテストできる（設計書 第11章）。
 */

export interface PlanMember {
  userId: string;
  name: string;
}

export interface PlanCapture {
  captureId: string;
  userId: string;
  slotKey: SlotKey;
  status: CaptureStatus;
  capturedAt: Date;
  videoPath: string;
}

export type PlanCellKind =
  /** 実際の2秒動画 */
  | "capture"
  /** 未撮影 (F-304) */
  | "empty"
  /** 本人が削除した (F-902, F-905) */
  | "deleted"
  /** メンバーが居ない座席（最終ページの余り） */
  | "vacant";

export interface PlanCell {
  seatIndex: number;
  kind: PlanCellKind;
  memberId?: string;
  memberName?: string;
  captureId?: string;
  videoPath?: string;
  /** 焼き込む「氏名 + HH:mm」(F-309)。capture のときだけ入る */
  label?: string;
}

export interface PlanSlot {
  slotKey: SlotKey;
  cells: PlanCell[];
}

export interface PlanPage {
  pageIndex: number;
  memberIds: string[];
  dimensions: GridDimensions;
  slots: PlanSlot[];
}

export interface BuildPlanParams {
  members: readonly PlanMember[];
  captures: readonly PlanCapture[];
  slotKeys: readonly SlotKey[];
  gridSize: number;
  timezone: string;
}

export function buildVlogPlan(params: BuildPlanParams): PlanPage[] {
  const { members, captures, slotKeys, gridSize, timezone } = params;

  // userId → slotKey → capture
  const index = new Map<string, Map<SlotKey, PlanCapture>>();
  for (const capture of captures) {
    let bySlot = index.get(capture.userId);
    if (!bySlot) {
      bySlot = new Map();
      index.set(capture.userId, bySlot);
    }
    const existing = bySlot.get(capture.slotKey);
    // 削除→撮り直しがあった場合は新しい方を採る
    if (!existing || existing.capturedAt.getTime() < capture.capturedAt.getTime()) {
      bySlot.set(capture.slotKey, capture);
    }
  }

  const pages = splitIntoPages(members, gridSize);

  return pages
    .map((page) => {
      const slots: PlanSlot[] = [];

      for (const slotKey of slotKeys) {
        const cells = page.seats.map<PlanCell>((member, seatIndex) => {
          if (!member) return { seatIndex, kind: "vacant" };

          const capture = index.get(member.userId)?.get(slotKey);
          if (!capture) {
            return {
              seatIndex,
              kind: "empty",
              memberId: member.userId,
              memberName: member.name,
            };
          }
          if (capture.status === "deleted") {
            // 映像は無いが枠は残す (F-902)
            return {
              seatIndex,
              kind: "deleted",
              memberId: member.userId,
              memberName: member.name,
              captureId: capture.captureId,
            };
          }
          if (capture.status !== "ready") {
            // 生成時点でまだ処理中のものは空きコマ扱い（設計書 7.1：status=ready のみ）
            return {
              seatIndex,
              kind: "empty",
              memberId: member.userId,
              memberName: member.name,
            };
          }

          return {
            seatIndex,
            kind: "capture",
            memberId: member.userId,
            memberName: member.name,
            captureId: capture.captureId,
            videoPath: capture.videoPath,
            label: buildCellLabel({
              name: member.name,
              capturedAt: capture.capturedAt,
              timezone,
            }),
          };
        });

        // 誰も撮っていないスロットは Vlog に入れない。
        // 全員プレースホルダの2秒が並ぶだけで、視聴体験にも生成コストにも見合わない。
        if (cells.some((cell) => cell.kind === "capture")) {
          slots.push({ slotKey, cells });
        }
      }

      return {
        pageIndex: page.pageIndex,
        memberIds: page.members.map((m) => m.userId),
        dimensions: page.dimensions,
        slots,
      };
    })
    .filter((page) => page.slots.length > 0);
}

/** 生成対象があるか（1本も撮影が無い日は Vlog を作らない） */
export function hasRenderableContent(pages: readonly PlanPage[]): boolean {
  return pages.length > 0;
}
