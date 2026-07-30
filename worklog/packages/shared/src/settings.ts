import { DEFAULT_CAPTURE_GRACE_MIN, DEFAULT_GRID_SIZE, DEFAULT_TIMEZONE } from "./constants";
import type { CaptureIntervalMin, GridSize } from "./constants";
import type {
  AiMode,
  BusinessDate,
  CameraFacing,
  DepartmentDoc,
  HhMm,
  TenantDoc,
  WorkType,
  WorkingHours,
} from "./types";
import { NON_WORKING_TYPES } from "./types";

/**
 * テナント設定に部署の上書きを重ねた「実効設定」(F-111)。
 * 撮影・通知・集計はすべてこの実効設定を使う。生の TenantDoc を直接見ないこと。
 */
export interface EffectiveSettings {
  timezone: string;
  captureIntervalMin: CaptureIntervalMin;
  workingHours: WorkingHours;
  captureGraceMin: number;
  defaultCamera: CameraFacing;
  gridSize: GridSize;
  workTags: string[];
  reportTemplate: string;
  reportDeadline: HhMm;
  aiMode: AiMode;
  holidays: BusinessDate[];
}

export function resolveEffectiveSettings(
  tenant: Pick<
    TenantDoc,
    | "timezone"
    | "captureIntervalMin"
    | "workingHours"
    | "captureGraceMin"
    | "defaultCamera"
    | "gridSize"
    | "workTags"
    | "reportTemplate"
    | "reportDeadline"
    | "aiMode"
    | "holidays"
  >,
  department?: Pick<DepartmentDoc, "overrides"> | null,
): EffectiveSettings {
  const o = department?.overrides ?? {};
  return {
    timezone: tenant.timezone || DEFAULT_TIMEZONE,
    captureIntervalMin: o.captureIntervalMin ?? tenant.captureIntervalMin,
    workingHours: o.workingHours ?? tenant.workingHours,
    captureGraceMin: o.captureGraceMin ?? tenant.captureGraceMin ?? DEFAULT_CAPTURE_GRACE_MIN,
    defaultCamera: o.defaultCamera ?? tenant.defaultCamera,
    gridSize: tenant.gridSize ?? DEFAULT_GRID_SIZE,
    workTags: tenant.workTags ?? [],
    reportTemplate: o.reportTemplate ?? tenant.reportTemplate,
    reportDeadline: tenant.reportDeadline,
    aiMode: tenant.aiMode,
    holidays: tenant.holidays ?? [],
  };
}

/** 休日カレンダー該当日か (F-506, 運用ケース「休日・祝日」) */
export function isHoliday(holidays: readonly BusinessDate[], businessDate: BusinessDate): boolean {
  return holidays.includes(businessDate);
}

/** 通知を配信し、撮影率の分母に含める日か（運用ケース） */
export function isNotifiableDay(
  holidays: readonly BusinessDate[],
  businessDate: BusinessDate,
  workType: WorkType | undefined,
): boolean {
  if (isHoliday(holidays, businessDate)) return false;
  if (workType && NON_WORKING_TYPES.includes(workType)) return false;
  return true;
}

/**
 * 在籍期間内か（運用ケース「中途入社・退職」）。
 * 撮影率の分母をこの期間に限定する。
 */
export function isEnrolled(
  businessDate: BusinessDate,
  joinedAt: Date,
  leftAt: Date | null | undefined,
  timezone: string,
  toBusinessDate: (instant: Date, tz: string) => BusinessDate,
): boolean {
  const joined = toBusinessDate(joinedAt, timezone);
  if (businessDate < joined) return false;
  if (leftAt) {
    const left = toBusinessDate(leftAt, timezone);
    if (businessDate > left) return false;
  }
  return true;
}
