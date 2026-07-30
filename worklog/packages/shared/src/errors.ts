/** 設計書 第10章のエラーコード。クライアントは code で分岐する */
export const ErrorCode = {
  AUTH_NOT_WORKSPACE: "AUTH/NOT_WORKSPACE",
  AUTH_DOMAIN_NOT_ALLOWED: "AUTH/DOMAIN_NOT_ALLOWED",
  AUTH_TENANT_SUSPENDED: "AUTH/TENANT_SUSPENDED",
  AUTH_USER_DISABLED: "AUTH/USER_DISABLED",
  AUTH_NOT_REGISTERED: "AUTH/NOT_REGISTERED",
  AUTH_FORBIDDEN: "AUTH/FORBIDDEN",
  CAPTURE_SLOT_CLOSED: "CAPTURE/SLOT_CLOSED",
  CAPTURE_SLOT_UNKNOWN: "CAPTURE/SLOT_UNKNOWN",
  CAPTURE_DUPLICATE: "CAPTURE/DUPLICATE",
  CAPTURE_NOT_FOUND: "CAPTURE/NOT_FOUND",
  CAPTURE_NOT_UPLOADED: "CAPTURE/NOT_UPLOADED",
  CAPTURE_HOLIDAY: "CAPTURE/HOLIDAY",
  UPLOAD_EXPIRED: "UPLOAD/EXPIRED",
  REPORT_DEADLINE_PASSED: "REPORT/DEADLINE_PASSED",
  TENANT_NOT_FOUND: "TENANT/NOT_FOUND",
  INVALID_ARGUMENT: "COMMON/INVALID_ARGUMENT",
  INTERNAL: "COMMON/INTERNAL",
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

/** ユーザー向けの日本語メッセージ。アプリはこれをそのまま出せる */
export const ERROR_MESSAGES_JA: Record<ErrorCodeValue, string> = {
  [ErrorCode.AUTH_NOT_WORKSPACE]:
    "会社のGoogleアカウントでログインしてください（個人のGmailは利用できません）。",
  [ErrorCode.AUTH_DOMAIN_NOT_ALLOWED]:
    "このドメインは登録されていません。管理者にお問い合わせください。",
  [ErrorCode.AUTH_TENANT_SUSPENDED]: "現在ご利用を停止しています。管理者にお問い合わせください。",
  [ErrorCode.AUTH_USER_DISABLED]: "このアカウントは無効化されています。",
  [ErrorCode.AUTH_NOT_REGISTERED]:
    "利用登録がされていません。管理者に登録を依頼してください。",
  [ErrorCode.AUTH_FORBIDDEN]: "この操作の権限がありません。",
  [ErrorCode.CAPTURE_SLOT_CLOSED]: "この時間の撮影は受付を終了しました。",
  [ErrorCode.CAPTURE_SLOT_UNKNOWN]: "撮影時間の指定が正しくありません。",
  [ErrorCode.CAPTURE_DUPLICATE]: "この時間はすでに撮影済みです。",
  [ErrorCode.CAPTURE_NOT_FOUND]: "撮影が見つかりません。",
  [ErrorCode.CAPTURE_NOT_UPLOADED]: "動画のアップロードが完了していません。",
  [ErrorCode.CAPTURE_HOLIDAY]: "本日は休日として設定されています。",
  [ErrorCode.UPLOAD_EXPIRED]: "アップロードの有効期限が切れました。もう一度お試しください。",
  [ErrorCode.REPORT_DEADLINE_PASSED]: "締め時刻を過ぎています（遅延として受け付けます）。",
  [ErrorCode.TENANT_NOT_FOUND]: "テナントが見つかりません。",
  [ErrorCode.INVALID_ARGUMENT]: "入力内容が正しくありません。",
  [ErrorCode.INTERNAL]: "処理に失敗しました。時間をおいてお試しください。",
};

export function messageForCode(code: string): string {
  return (ERROR_MESSAGES_JA as Record<string, string>)[code] ?? ERROR_MESSAGES_JA[ErrorCode.INTERNAL];
}

/** クライアントが指数バックオフで再試行してよい（冪等な）エラー（設計書 第10章） */
export const RETRYABLE_CODES: readonly string[] = [ErrorCode.UPLOAD_EXPIRED, ErrorCode.INTERNAL];
