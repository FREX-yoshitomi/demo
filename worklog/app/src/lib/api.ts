import {
  Callable,
  ErrorCode,
  RETRYABLE_CODES,
  messageForCode,
  type CommitCaptureResult,
  type DeclareOffInput,
  type DeleteCaptureInput,
  type EnsureTenantResult,
  type IssueUploadUrlInput,
  type IssueUploadUrlResult,
  type PlaybackUrlResult,
  type RegisterFcmTokenInput,
  type UpdateProfileInput,
} from "@worklog/shared";
import { FunctionsError, httpsCallable } from "firebase/functions";

import { functions } from "./firebase";

/**
 * callable の呼び出し口。
 * - サーバーが details.code に入れた業務エラーコードを ApiError に変換する（設計書 第10章）
 * - 冪等な API だけ指数バックオフで最大3回リトライする
 */

export class ApiError extends Error {
  readonly code: string;
  readonly detail: Record<string, unknown>;

  constructor(code: string, detail: Record<string, unknown> = {}) {
    super(messageForCode(code));
    this.name = "ApiError";
    this.code = code;
    this.detail = detail;
  }

  get isRetryable(): boolean {
    return RETRYABLE_CODES.includes(this.code);
  }
}

function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;

  if (err instanceof FunctionsError) {
    const details = err.details as { code?: string } | undefined;
    if (details?.code) {
      return new ApiError(details.code, details as Record<string, unknown>);
    }
    if (err.code === "functions/unauthenticated") {
      return new ApiError(ErrorCode.AUTH_FORBIDDEN);
    }
    if (err.code === "functions/unavailable" || err.code === "functions/deadline-exceeded") {
      return new ApiError(ErrorCode.INTERNAL, { cause: err.code });
    }
  }

  return new ApiError(ErrorCode.INTERNAL, {
    cause: err instanceof Error ? err.message : String(err),
  });
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function call<TInput, TOutput>(
  name: string,
  input: TInput,
  options?: { retries?: number },
): Promise<TOutput> {
  const retries = options?.retries ?? 0;
  let lastError: ApiError | undefined;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const fn = httpsCallable<TInput, TOutput>(functions(), name);
      const result = await fn(input);
      return result.data;
    } catch (err) {
      lastError = toApiError(err);
      // 冪等でないもの・業務エラーは再試行しない（二重撮影の誤検知を防ぐ）
      if (attempt === retries || !lastError.isRetryable) throw lastError;
      await sleep(2 ** attempt * 500);
    }
  }

  throw lastError ?? new ApiError(ErrorCode.INTERNAL);
}

export const api = {
  ensureTenant: () => call<Record<string, never>, EnsureTenantResult>(Callable.authEnsureTenant, {}),

  registerFcmToken: (input: RegisterFcmTokenInput) =>
    call<RegisterFcmTokenInput, { ok: true }>(Callable.userRegisterFcmToken, input, { retries: 2 }),

  updateProfile: (input: UpdateProfileInput) =>
    call<UpdateProfileInput, { ok: true }>(Callable.userUpdateProfile, input),

  /** 冪等（決定的な captureId で枠を予約するだけ）なのでリトライしてよい */
  issueUploadUrl: (input: IssueUploadUrlInput) =>
    call<IssueUploadUrlInput, IssueUploadUrlResult>(Callable.captureIssueUploadUrl, input, {
      retries: 2,
    }),

  commitCapture: (input: { captureId: string; memo?: string; workTag?: string }) =>
    call<typeof input, CommitCaptureResult>(Callable.captureCommit, input, { retries: 2 }),

  deleteCapture: (input: DeleteCaptureInput) =>
    call<DeleteCaptureInput, { ok: true }>(Callable.captureDelete, input),

  declareOff: (input: DeclareOffInput) =>
    call<DeclareOffInput, { ok: true }>(Callable.captureDeclareOff, input),

  playbackUrl: (input: { captureId: string }) =>
    call<typeof input, PlaybackUrlResult>(Callable.capturePlaybackUrl, input, { retries: 2 }),
};
