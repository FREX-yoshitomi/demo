import { z } from "zod";

import {
  CAPTURE_INTERVALS_MIN,
  GRID_SIZES,
  MEMO_MAX_LENGTH,
} from "./constants";

/**
 * callable の入力スキーマ。Functions 側で必ず parse し、
 * アプリ側でも送信前に parse して往復のズレを早期に見つける。
 */

export const businessDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "businessDate は YYYY-MM-DD 形式");

export const slotKeySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "slotKey は HH:mm 形式");

export const hhmmSchema = slotKeySchema;

export const cameraFacingSchema = z.enum(["front", "back"]);

export const workTypeSchema = z.enum([
  "normal",
  "shift",
  "night",
  "leave",
  "absent",
  "remote",
]);

export const workingHoursSchema = z.object({
  start: hhmmSchema,
  end: hhmmSchema,
});

// --- 認証・ユーザー -------------------------------------------------------

export const ensureTenantInput = z.object({}).optional();

export const registerFcmTokenInput = z.object({
  token: z.string().min(1).max(4096),
  /** 端末を識別して古いトークンを掃除する */
  deviceId: z.string().min(1).max(128).optional(),
});

export const updateProfileInput = z.object({
  name: z.string().min(1).max(64).optional(),
  photoUrl: z.string().url().max(2048).optional(),
  camera: cameraFacingSchema.optional(),
  notificationsEnabled: z.boolean().optional(),
});

// --- 撮影 -----------------------------------------------------------------

export const issueUploadUrlInput = z.object({
  businessDate: businessDateSchema,
  slotKey: slotKeySchema,
  /** 端末の撮影時刻（ISO8601）。オフライン後の再送でも撮影時点を保持する (F-112) */
  capturedAt: z.string().datetime({ offset: true }),
  camera: cameraFacingSchema,
});

export const commitCaptureInput = z.object({
  captureId: z.string().min(1).max(200),
  memo: z.string().max(MEMO_MAX_LENGTH).optional(),
  workTag: z.string().max(32).optional(),
});

export const deleteCaptureInput = z.object({
  captureId: z.string().min(1).max(200),
  reason: z.string().max(200).optional(),
});

export const declareOffInput = z.object({
  businessDate: businessDateSchema,
  slotKeys: z.array(slotKeySchema).max(48),
  reason: z.string().max(200).optional(),
});

// --- 日報 -----------------------------------------------------------------

export const reportGetInput = z.object({ businessDate: businessDateSchema });

export const reportSaveInput = z.object({
  businessDate: businessDateSchema,
  body: z.string().max(8000),
});

export const reportSubmitInput = reportSaveInput;

export const reportCommentInput = z.object({
  reportId: z.string().min(1).max(200),
  text: z.string().min(1).max(2000),
});

// --- 勤怠 -----------------------------------------------------------------

export const attendanceClockInput = z.object({
  type: z.enum(["in", "out", "breakStart", "breakEnd"]),
  /** 端末時刻ではなくサーバー時刻を採用するが、オフライン再送のために受け取る */
  at: z.string().datetime({ offset: true }).optional(),
});

export const declareWorkTypeInput = z.object({
  businessDate: businessDateSchema,
  workType: workTypeSchema,
});

export const requestCorrectionInput = z.object({
  businessDate: businessDateSchema,
  field: z.enum(["clockIn", "clockOut", "breaks"]),
  after: z.string().min(1).max(200),
  reason: z.string().max(500).optional(),
});

// --- 管理 -----------------------------------------------------------------

export const tenantSettingsInput = z.object({
  name: z.string().min(1).max(120).optional(),
  timezone: z.string().min(1).max(64).optional(),
  holidays: z.array(businessDateSchema).max(400).optional(),
  captureIntervalMin: z
    .union([z.literal(30), z.literal(60), z.literal(120)])
    .optional(),
  workingHours: workingHoursSchema.optional(),
  captureGraceMin: z.number().int().min(5).max(240).optional(),
  workTags: z.array(z.string().min(1).max(32)).max(50).optional(),
  defaultCamera: cameraFacingSchema.optional(),
  reportTemplate: z.string().max(4000).optional(),
  reportDeadline: hhmmSchema.optional(),
  gridSize: z
    .union([z.literal(4), z.literal(6), z.literal(9), z.literal(12)])
    .optional(),
  aiMode: z.enum(["text", "image"]).optional(),
  retentionMonths: z.number().int().min(1).max(120).optional(),
  autoProvisionUsers: z.boolean().optional(),
  theme: z
    .object({
      logoUrl: z.string().url().max(2048).optional(),
      primaryColor: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional(),
    })
    .optional(),
});

export const upsertUserInput = z.object({
  uid: z.string().min(1).max(128).optional(),
  email: z.string().email().max(254),
  name: z.string().min(1).max(64),
  departmentIds: z.array(z.string().min(1).max(128)).max(20),
  role: z.enum(["member", "deptAdmin", "tenantAdmin"]),
  crossViewDeptIds: z.array(z.string().min(1).max(128)).max(100).optional(),
});

export const upsertDepartmentInput = z.object({
  deptId: z.string().min(1).max(128).optional(),
  name: z.string().min(1).max(120),
  parentId: z.string().min(1).max(128).nullable(),
  order: z.number().int().min(0).max(9999),
  overrides: z
    .object({
      captureIntervalMin: z
        .union([z.literal(30), z.literal(60), z.literal(120)])
        .optional(),
      workingHours: workingHoursSchema.optional(),
      captureGraceMin: z.number().int().min(5).max(240).optional(),
      defaultCamera: cameraFacingSchema.optional(),
      reportTemplate: z.string().max(4000).optional(),
    })
    .optional(),
});

// --- ops ------------------------------------------------------------------

export const createTenantInput = z.object({
  tenantId: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/, "tenantId は英小文字・数字・ハイフン"),
  name: z.string().min(1).max(120),
  allowedDomains: z.array(z.string().min(3).max(253)).min(1).max(20),
  adminEmail: z.string().email().max(254),
  timezone: z.string().min(1).max(64).optional(),
});

export const suspendTenantInput = z.object({
  tenantId: z.string().min(1).max(64),
  suspend: z.boolean(),
});

// --- 型のエクスポート ------------------------------------------------------

export type IssueUploadUrlInput = z.infer<typeof issueUploadUrlInput>;
export type CommitCaptureInput = z.infer<typeof commitCaptureInput>;
export type DeleteCaptureInput = z.infer<typeof deleteCaptureInput>;
export type DeclareOffInput = z.infer<typeof declareOffInput>;
export type RegisterFcmTokenInput = z.infer<typeof registerFcmTokenInput>;
export type UpdateProfileInput = z.infer<typeof updateProfileInput>;
export type TenantSettingsInput = z.infer<typeof tenantSettingsInput>;
export type UpsertUserInput = z.infer<typeof upsertUserInput>;
export type UpsertDepartmentInput = z.infer<typeof upsertDepartmentInput>;
export type CreateTenantInput = z.infer<typeof createTenantInput>;
export type AttendanceClockInput = z.infer<typeof attendanceClockInput>;
export type DeclareWorkTypeInput = z.infer<typeof declareWorkTypeInput>;
export type RequestCorrectionInput = z.infer<typeof requestCorrectionInput>;

/** 設定の許容値をアプリのUIでも使う */
export const ALLOWED_CAPTURE_INTERVALS = CAPTURE_INTERVALS_MIN;
export const ALLOWED_GRID_SIZES = GRID_SIZES;
