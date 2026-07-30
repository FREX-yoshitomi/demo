import type { BusinessDate, SlotKey } from "./types";

/**
 * ID / パスの組み立ては必ずここを通す。
 * 文字列連結を各所に散らすと、テナント越境や二重撮影の穴になる。
 *
 * 設計書 3.1 では captureId を `${uid}_${businessDate}_${slotKey}` と定義しているが、
 * slotKey の ":" は GCS のオブジェクト名や署名付きURLで扱いが面倒なため、
 * ID の中だけ "1200" 形式（slotToken）にする。Firestore の slotKey フィールドは "12:00" のまま。
 */

const SLOT_TOKEN_RE = /^([01]\d|2[0-3])([0-5]\d)$/;

export function slotToken(slotKey: SlotKey): string {
  const token = slotKey.replace(":", "");
  if (!SLOT_TOKEN_RE.test(token)) throw new Error(`invalid slotKey: ${JSON.stringify(slotKey)}`);
  return token;
}

export function slotKeyFromToken(token: string): SlotKey {
  const m = SLOT_TOKEN_RE.exec(token);
  if (!m) throw new Error(`invalid slotToken: ${JSON.stringify(token)}`);
  return `${m[1]}:${m[2]}`;
}

/** 決定的ID。同一スロットへの二重撮影を構造的に防ぐ（設計書 3.1 設計判断） */
export function buildCaptureId(uid: string, businessDate: BusinessDate, slotKey: SlotKey): string {
  if (uid.includes("_") || uid.includes("/")) throw new Error(`unsupported uid: ${uid}`);
  return `${uid}_${businessDate}_${slotToken(slotKey)}`;
}

export function parseCaptureId(
  captureId: string,
): { uid: string; businessDate: BusinessDate; slotKey: SlotKey } | null {
  const parts = captureId.split("_");
  if (parts.length !== 3) return null;
  const [uid, businessDate, token] = parts as [string, string, string];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate) || !SLOT_TOKEN_RE.test(token)) return null;
  return { uid, businessDate, slotKey: slotKeyFromToken(token) };
}

export function buildAttendanceId(uid: string, businessDate: BusinessDate): string {
  return `${uid}_${businessDate}`;
}

export function buildReportId(uid: string, businessDate: BusinessDate): string {
  return `${uid}_${businessDate}`;
}

export function buildOffDeclarationId(uid: string, businessDate: BusinessDate): string {
  return `${uid}_${businessDate}`;
}

export function buildVlogId(
  scope: "department" | "personal",
  targetId: string,
  businessDate: BusinessDate,
): string {
  return `${scope}_${targetId}_${businessDate}`;
}

// ---------------------------------------------------------------------------
// Firestore パス
// ---------------------------------------------------------------------------

export const fsPath = {
  tenant: (tenantId: string) => `tenants/${tenantId}`,
  users: (tenantId: string) => `tenants/${tenantId}/users`,
  user: (tenantId: string, uid: string) => `tenants/${tenantId}/users/${uid}`,
  departments: (tenantId: string) => `tenants/${tenantId}/departments`,
  department: (tenantId: string, deptId: string) => `tenants/${tenantId}/departments/${deptId}`,
  captures: (tenantId: string) => `tenants/${tenantId}/captures`,
  capture: (tenantId: string, captureId: string) => `tenants/${tenantId}/captures/${captureId}`,
  offDeclarations: (tenantId: string) => `tenants/${tenantId}/offDeclarations`,
  offDeclaration: (tenantId: string, id: string) => `tenants/${tenantId}/offDeclarations/${id}`,
  vlogs: (tenantId: string) => `tenants/${tenantId}/vlogs`,
  vlog: (tenantId: string, vlogId: string) => `tenants/${tenantId}/vlogs/${vlogId}`,
  reports: (tenantId: string) => `tenants/${tenantId}/reports`,
  report: (tenantId: string, reportId: string) => `tenants/${tenantId}/reports/${reportId}`,
  attendance: (tenantId: string) => `tenants/${tenantId}/attendance`,
  attendanceRecord: (tenantId: string, id: string) => `tenants/${tenantId}/attendance/${id}`,
  dailyStats: (tenantId: string) => `tenants/${tenantId}/dailyStats`,
  auditLogs: (tenantId: string) => `tenants/${tenantId}/auditLogs`,
  // ops（クライアントからは一切読めない）
  tenantsIndex: () => `ops/registry/tenantsIndex`,
  tenantIndex: (tenantId: string) => `ops/registry/tenantsIndex/${tenantId}`,
  domainIndex: (domain: string) => `ops/registry/domainIndex/${domain}`,
  domainIndexCollection: () => `ops/registry/domainIndex`,
  operator: (uid: string) => `ops/registry/operators/${uid}`,
} as const;

// ---------------------------------------------------------------------------
// Cloud Storage パス（設計書 3.2）
// ---------------------------------------------------------------------------

export const storagePath = {
  captureVideo: (tenantId: string, businessDate: BusinessDate, captureId: string) =>
    `tenants/${tenantId}/captures/${businessDate}/${captureId}.mp4`,
  captureThumb: (tenantId: string, businessDate: BusinessDate, captureId: string) =>
    `tenants/${tenantId}/thumbs/${businessDate}/${captureId}.jpg`,
  vlogPage: (tenantId: string, businessDate: BusinessDate, vlogId: string, page: number) =>
    `tenants/${tenantId}/vlogs/${businessDate}/${vlogId}_p${page}.mp4`,
  exports: (tenantId: string, fileName: string) => `tenants/${tenantId}/exports/${fileName}`,
} as const;

/** Storage のオブジェクト名から撮影を特定する（onCaptureUploaded 用） */
export function parseCaptureVideoPath(
  objectName: string,
): { tenantId: string; businessDate: BusinessDate; captureId: string } | null {
  const m = /^tenants\/([^/]+)\/captures\/(\d{4}-\d{2}-\d{2})\/([^/]+)\.mp4$/.exec(objectName);
  if (!m) return null;
  return { tenantId: m[1] as string, businessDate: m[2] as string, captureId: m[3] as string };
}
