import type { AiMode, BusinessDate, CaptureDoc, Role, SlotKey } from "./types";

/**
 * callable の名前。アプリ/Web はこの定数のみを参照し、文字列リテラルを書かない。
 * 設計書 第5章の一覧と1対1で対応させる。
 */
export const Callable = {
  authEnsureTenant: "auth-ensureTenant",
  userRegisterFcmToken: "user-registerFcmToken",
  userUpdateProfile: "user-updateProfile",

  captureIssueUploadUrl: "capture-issueUploadUrl",
  captureCommit: "capture-commit",
  captureDelete: "capture-delete",
  captureDeclareOff: "capture-declareOff",
  capturePlaybackUrl: "capture-playbackUrl",

  reportGet: "report-get",
  reportSave: "report-save",
  reportSubmit: "report-submit",
  reportComment: "report-comment",
  reportRegenerateDraft: "report-regenerateDraft",

  attendanceClock: "attendance-clock",
  attendanceDeclareWorkType: "attendance-declareWorkType",
  attendanceRequestCorrection: "attendance-requestCorrection",
  attendanceReviewCorrection: "attendance-reviewCorrection",
  attendanceExportCsv: "attendance-exportCsv",

  adminUpsertUser: "admin-upsertUser",
  adminDisableUser: "admin-disableUser",
  adminUpsertDepartment: "admin-upsertDepartment",
  adminUpdateTenantSettings: "admin-updateTenantSettings",

  opsCreateTenant: "ops-createTenant",
  opsSuspendTenant: "ops-suspendTenant",
} as const;

export type CallableName = (typeof Callable)[keyof typeof Callable];

// ---------------------------------------------------------------------------
// レスポンス型
// ---------------------------------------------------------------------------

export interface EnsureTenantResult {
  tenantId: string;
  role: Role;
  /** クライアントは true のとき getIdToken(true) でトークンを更新する必要がある */
  claimsUpdated: boolean;
  tenantName: string;
  timezone: string;
}

export interface IssueUploadUrlResult {
  captureId: string;
  uploadUrl: string;
  /** PUT 時に必須のヘッダ。署名と一致させる必要がある */
  requiredHeaders: Record<string, string>;
  expiresAt: string;
  /** 猶予超過の後追い撮影として受理された (F-110) */
  isLate: boolean;
  videoPath: string;
}

export interface CaptureView {
  captureId: string;
  userId: string;
  userName?: string;
  departmentId: string | null;
  businessDate: BusinessDate;
  slotKey: SlotKey;
  capturedAtIso: string;
  status: CaptureDoc["status"];
  thumbUrl?: string | null;
  memo?: string;
  workTag?: string;
  isLate: boolean;
}

export interface CommitCaptureResult {
  capture: CaptureView;
}

export interface PlaybackUrlResult {
  url: string;
  expiresAt: string;
}

export interface ReportView {
  reportId: string;
  businessDate: BusinessDate;
  aiDraft: string;
  aiMode: AiMode;
  insufficientData: boolean;
  body: string;
  status: "draft" | "submitted";
  submittedAtIso?: string | null;
  comments: { authorId: string; text: string; atIso: string }[];
}

/** グリッド表示の1コマ。未撮影・削除済みも枠として返す (F-304) */
export type GridCellState = "captured" | "empty" | "deleted" | "declaredOff" | "late";

export interface GridCell {
  slotKey: SlotKey;
  state: GridCellState;
  captureId?: string;
  capturedAtIso?: string;
  thumbUrl?: string | null;
}

export interface GridRow {
  userId: string;
  userName: string;
  photoUrl?: string;
  cells: GridCell[];
  capturedCount: number;
  expectedCount: number;
}
