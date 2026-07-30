import { ErrorCode, type ErrorCodeValue, messageForCode } from "@worklog/shared";
import { HttpsError, type FunctionsErrorCode } from "firebase-functions/https";

/**
 * 業務エラーは必ず `code/DETAIL` 形式（設計書 第10章）でクライアントへ返す。
 * HttpsError の code は gRPC 系の粗い分類しか無いので、
 * 詳細コードは details.code に入れてクライアントはそちらで分岐する。
 */

const HTTP_CODE_BY_ERROR: Partial<Record<ErrorCodeValue, FunctionsErrorCode>> = {
  [ErrorCode.AUTH_NOT_WORKSPACE]: "permission-denied",
  [ErrorCode.AUTH_DOMAIN_NOT_ALLOWED]: "permission-denied",
  [ErrorCode.AUTH_TENANT_SUSPENDED]: "permission-denied",
  [ErrorCode.AUTH_USER_DISABLED]: "permission-denied",
  [ErrorCode.AUTH_NOT_REGISTERED]: "permission-denied",
  [ErrorCode.AUTH_FORBIDDEN]: "permission-denied",
  [ErrorCode.CAPTURE_SLOT_CLOSED]: "failed-precondition",
  [ErrorCode.CAPTURE_SLOT_UNKNOWN]: "invalid-argument",
  [ErrorCode.CAPTURE_DUPLICATE]: "already-exists",
  [ErrorCode.CAPTURE_NOT_FOUND]: "not-found",
  [ErrorCode.CAPTURE_NOT_UPLOADED]: "failed-precondition",
  [ErrorCode.CAPTURE_HOLIDAY]: "failed-precondition",
  [ErrorCode.UPLOAD_EXPIRED]: "deadline-exceeded",
  [ErrorCode.REPORT_DEADLINE_PASSED]: "failed-precondition",
  [ErrorCode.TENANT_NOT_FOUND]: "not-found",
  [ErrorCode.INVALID_ARGUMENT]: "invalid-argument",
  [ErrorCode.INTERNAL]: "internal",
};

export function fail(code: ErrorCodeValue, detail?: Record<string, unknown>): never {
  throw new HttpsError(HTTP_CODE_BY_ERROR[code] ?? "internal", messageForCode(code), {
    code,
    ...detail,
  });
}

export { ErrorCode };
