import type { CaptureIntervalMin, GridSize } from "./constants";

/**
 * Firestore の Timestamp。Admin SDK と Client SDK の Timestamp が
 * 構造的にどちらも満たす最小形。片方に依存させないためにこの形で持つ。
 */
export interface Timestampish {
  toDate(): Date;
  toMillis(): number;
}

/** "2026-07-26" 形式の業務日。capturedAt から導出してはいけない（運用ケース「業務日の定義」） */
export type BusinessDate = string;

/** "12:00" 形式の通知スロット */
export type SlotKey = string;

/** "09:00" 形式の時刻 */
export type HhMm = string;

export interface WorkingHours {
  /** 稼働開始 "09:00" */
  start: HhMm;
  /** 稼働終了 "18:00"。start 以下なら日跨ぎシフトとして扱う */
  end: HhMm;
}

export type Role = "member" | "deptAdmin" | "tenantAdmin";
export type TenantStatus = "active" | "suspended";
export type UserStatus = "active" | "disabled";
export type AiMode = "text" | "image";
export type CameraFacing = "front" | "back";

/** 勤務区分 (F-701〜, 運用ケース) */
export type WorkType = "normal" | "shift" | "night" | "leave" | "absent" | "remote";

/** 通知・撮影率の分母から除外される勤務区分（運用ケース「有給・欠勤」） */
export const NON_WORKING_TYPES: readonly WorkType[] = ["leave", "absent"];

export type CaptureStatus = "uploaded" | "processing" | "ready" | "deleted";
export type VlogStatus = "pending" | "generating" | "ready" | "failed";
export type ReportStatus = "draft" | "submitted";
export type CorrectionStatus = "pending" | "approved" | "rejected";

// ---------------------------------------------------------------------------
// /tenants/{tenantId}
// ---------------------------------------------------------------------------

export interface TenantTheme {
  logoUrl?: string;
  primaryColor?: string;
}

/** テナント設定 (F-506)。設計書 3.1 */
export interface TenantDoc {
  name: string;
  status: TenantStatus;
  /** hd クレーム照合用の許可ドメイン (F-502) */
  allowedDomains: string[];
  timezone: string;
  /** "2026-01-01" 形式の休日 (F-506, 運用ケース) */
  holidays: BusinessDate[];
  captureIntervalMin: CaptureIntervalMin;
  workingHours: WorkingHours;
  /** 撮影猶予（分）。既定 DEFAULT_CAPTURE_GRACE_MIN (F-109) */
  captureGraceMin: number;
  workTags: string[];
  defaultCamera: CameraFacing;
  reportTemplate: string;
  /** 翌日のこの時刻が日報の締め (F-406) */
  reportDeadline: HhMm;
  gridSize: GridSize;
  aiMode: AiMode;
  retentionMonths: number;
  theme?: TenantTheme;
  /**
   * 未登録ユーザーの初回ログインを自動で受け入れるか。
   * false のときは管理Webでの事前登録が必須（設計書 4.1 d）。
   */
  autoProvisionUsers: boolean;
  createdAt: Timestampish;
  updatedAt: Timestampish;
}

export interface UserDoc {
  email: string;
  name: string;
  photoUrl?: string;
  departmentIds: string[];
  role: Role;
  status: UserStatus;
  /** 横断閲覧を許可する部署ID (F-604) */
  crossViewDeptIds: string[];
  fcmTokens: string[];
  /** 端末側の既定カメラ・通知設定 */
  preferences?: {
    camera?: CameraFacing;
    notificationsEnabled?: boolean;
  };
  joinedAt: Timestampish;
  leftAt?: Timestampish | null;
}

export interface DepartmentDoc {
  name: string;
  parentId: string | null;
  order: number;
  /** テナント設定の部分上書き (F-111) */
  overrides?: {
    captureIntervalMin?: CaptureIntervalMin;
    workingHours?: WorkingHours;
    captureGraceMin?: number;
    defaultCamera?: CameraFacing;
    reportTemplate?: string;
  };
}

/** captureId = `${uid}_${businessDate}_${slotToken}`（決定的IDにして二重撮影を防ぐ） */
export interface CaptureDoc {
  userId: string;
  departmentId: string | null;
  businessDate: BusinessDate;
  slotKey: SlotKey;
  /** 秒精度。丸めない (F-105) */
  capturedAt: Timestampish;
  status: CaptureStatus;
  videoPath: string;
  thumbPath: string | null;
  durationSec: number;
  memo?: string;
  workTag?: string;
  /** 猶予超過の後追い撮影 (F-110) */
  isLate: boolean;
  camera: CameraFacing;
  /** 映像削除の時刻。ドキュメント自体は消さない (F-902, F-706) */
  deletedAt?: Timestampish | null;
  deleteReason?: string;
  createdAt: Timestampish;
  updatedAt: Timestampish;
}

/** 「撮影しない時間」の申告 (F-113) */
export interface OffDeclarationDoc {
  userId: string;
  businessDate: BusinessDate;
  slotKeys: SlotKey[];
  reason?: string;
  updatedAt: Timestampish;
}

export interface VlogPage {
  videoPath: string;
  memberIds: string[];
}

export interface VlogDoc {
  scope: "department" | "personal";
  targetId: string;
  businessDate: BusinessDate;
  status: VlogStatus;
  pages: VlogPage[];
  generatedAt?: Timestampish | null;
  /** 削除発生で再生成が必要になった印 (F-905) */
  regenerateRequestedAt?: Timestampish | null;
}

export interface ReportComment {
  authorId: string;
  text: string;
  at: Timestampish;
}

export interface ReportDoc {
  userId: string;
  businessDate: BusinessDate;
  aiDraft: string;
  aiDraftMeta: {
    mode: AiMode;
    /** コマ数・メモが少ない日は推測させず情報不足を明示する (F-408) */
    insufficientData: boolean;
    generatedAt?: Timestampish;
    regenerateCount: number;
  };
  body: string;
  status: ReportStatus;
  submittedAt?: Timestampish | null;
  /** 締め時刻を過ぎた提出 (F-406) */
  isLateSubmission?: boolean;
  comments: ReportComment[];
}

export interface AttendanceBreak {
  start: Timestampish;
  end?: Timestampish | null;
}

export interface AttendanceCorrection {
  requestedBy: string;
  field: string;
  before: string | null;
  after: string;
  status: CorrectionStatus;
  reviewedBy?: string;
  requestedAt: Timestampish;
  reviewedAt?: Timestampish | null;
}

export interface AttendanceDoc {
  userId: string;
  businessDate: BusinessDate;
  workType: WorkType;
  /** 初回撮影＝出勤時刻候補 / 最終撮影＝退勤時刻候補 (F-701)。映像削除後も保持 (F-706) */
  firstCaptureAt?: Timestampish | null;
  lastCaptureAt?: Timestampish | null;
  /** 明示打刻 (F-702) */
  clockIn?: Timestampish | null;
  clockOut?: Timestampish | null;
  breaks: AttendanceBreak[];
  workedMinutes?: number;
  corrections: AttendanceCorrection[];
}

export interface DailyStatsDoc {
  businessDate: BusinessDate;
  byDept: Record<string, { expected: number; captured: number; rate: number }>;
  generatedAt: Timestampish;
}

/** 追記専用 (F-805) */
export interface AuditLogDoc {
  actorId: string;
  action: string;
  targetPath: string;
  detail?: Record<string, unknown>;
  at: Timestampish;
}

// ---------------------------------------------------------------------------
// /ops/**（提供者側。テナント外）
// ---------------------------------------------------------------------------

export interface TenantIndexDoc {
  name: string;
  status: TenantStatus;
  userCount: number;
  createdAt: Timestampish;
}

/** hd → tenantId の逆引き (F-502) */
export interface DomainIndexDoc {
  tenantId: string;
  addedAt: Timestampish;
}

export interface OperatorDoc {
  email: string;
  role: "ops";
}

// ---------------------------------------------------------------------------
// Custom Claims (F-503)
// ---------------------------------------------------------------------------

export interface WorklogClaims {
  tenantId: string;
  role: Role;
  /** ops 運用者のみ true。テナント業務データには使わない (F-509) */
  ops?: boolean;
}
