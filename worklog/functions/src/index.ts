import {
  ErrorCode,
  NOTIFICATION_SCHEDULER_INTERVAL_MIN,
  REGION,
  commitCaptureInput,
  declareOffInput,
  deleteCaptureInput,
  issueUploadUrlInput,
  registerFcmTokenInput,
  updateProfileInput,
} from "@worklog/shared";
import { onCall, type CallableRequest } from "firebase-functions/https";
import * as logger from "firebase-functions/logger";
import { setGlobalOptions } from "firebase-functions/options";
import { onSchedule } from "firebase-functions/scheduler";
import { onObjectFinalized } from "firebase-functions/storage";
import { onTaskDispatched } from "firebase-functions/tasks";
import { z } from "zod";

import { ensureTenantCore } from "./auth/ensureTenant";
import { commitCapture } from "./capture/commit";
import { declareOff } from "./capture/declareOff";
import { deleteCapture } from "./capture/deleteCapture";
import { issueUploadUrl } from "./capture/issueUploadUrl";
import { handleCaptureUploaded } from "./capture/onCaptureUploaded";
import { issuePlaybackUrl } from "./capture/playbackUrl";
import { loadTenantContext, requireAuth } from "./lib/context";
import { fail } from "./lib/errors";
import { deliverCaptureNotification } from "./notification/deliver";
import { scheduleNotifications, type NotificationTaskPayload } from "./notification/schedule";
import { registerFcmToken, updateProfile } from "./user/profile";

// 全リソースを東京リージョンに固定する (F-510)
setGlobalOptions({
  region: REGION,
  maxInstances: 40,
  memory: "256MiB",
  timeoutSeconds: 60,
});

/**
 * export をオブジェクトにまとめると `グループ名-関数名` でデプロイされる。
 * これで設計書 第5章の `capture-issueUploadUrl` という名前に一致させ、
 * クライアント側は packages/shared の `Callable` 定数をそのまま使える。
 */

/** zod で入力を検証してから本体を呼ぶ。検証エラーは COMMON/INVALID_ARGUMENT に揃える */
function parseInput<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success) {
    logger.warn("invalid callable input", { issues: result.error.issues.slice(0, 5) });
    fail(ErrorCode.INVALID_ARGUMENT, {
      issues: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// auth-*  （認証・テナント確定）
// ---------------------------------------------------------------------------

export const auth = {
  /**
   * 初回ログイン時にテナントを確定して Custom Claims を焼き込む (F-501〜504)。
   * Claims 未付与の状態で呼ばれる前提なので requireAuth は使わない。
   */
  ensureTenant: onCall(async (req: CallableRequest<unknown>) => {
    if (!req.auth) fail(ErrorCode.AUTH_FORBIDDEN);
    const token = req.auth.token;
    const firebase = token.firebase as { sign_in_provider?: string } | undefined;

    return ensureTenantCore({
      uid: req.auth.uid,
      email: typeof token.email === "string" ? token.email : undefined,
      emailVerified: token.email_verified === true,
      signInProvider: firebase?.sign_in_provider ?? "unknown",
      name: typeof token.name === "string" ? token.name : undefined,
      picture: typeof token.picture === "string" ? token.picture : undefined,
      currentClaims: { tenantId: token["tenantId"], role: token["role"] },
    });
  }),
};

// ---------------------------------------------------------------------------
// user-*
// ---------------------------------------------------------------------------

export const user = {
  registerFcmToken: onCall(async (req: CallableRequest<unknown>) => {
    const ctx = requireAuth(req);
    return registerFcmToken(ctx, parseInput(registerFcmTokenInput, req.data));
  }),

  updateProfile: onCall(async (req: CallableRequest<unknown>) => {
    const ctx = requireAuth(req);
    return updateProfile(ctx, parseInput(updateProfileInput, req.data));
  }),
};

// ---------------------------------------------------------------------------
// capture-*  (F-1xx, F-9xx)
// ---------------------------------------------------------------------------

export const capture = {
  /** 毎正時に100人が集中する。ここだけ同時実行数を多めに取る（非機能要件：5分以内に全件） */
  issueUploadUrl: onCall(
    { maxInstances: 100, timeoutSeconds: 30 },
    async (req: CallableRequest<unknown>) => {
      const ctx = await loadTenantContext(requireAuth(req));
      return issueUploadUrl(ctx, parseInput(issueUploadUrlInput, req.data));
    },
  ),

  commit: onCall({ maxInstances: 100 }, async (req: CallableRequest<unknown>) => {
    const ctx = await loadTenantContext(requireAuth(req));
    return commitCapture(ctx, parseInput(commitCaptureInput, req.data));
  }),

  delete: onCall(async (req: CallableRequest<unknown>) => {
    const ctx = await loadTenantContext(requireAuth(req));
    return deleteCapture(ctx, parseInput(deleteCaptureInput, req.data));
  }),

  declareOff: onCall(async (req: CallableRequest<unknown>) => {
    const ctx = await loadTenantContext(requireAuth(req));
    return declareOff(ctx, parseInput(declareOffInput, req.data));
  }),

  playbackUrl: onCall(async (req: CallableRequest<unknown>) => {
    const ctx = await loadTenantContext(requireAuth(req));
    const input = parseInput(z.object({ captureId: z.string().min(1).max(200) }), req.data);
    return issuePlaybackUrl(ctx, input);
  }),
};

// ---------------------------------------------------------------------------
// トリガ・スケジューラ
// ---------------------------------------------------------------------------

/**
 * アップロード完了トリガ。サムネイル生成に ffmpeg を使うのでメモリと時間を多めに取る。
 * captures/ 以外のパスは handleCaptureUploaded 側で無視する（サムネ書き込みでの再入防止）。
 */
export const onCaptureUploaded = onObjectFinalized(
  { memory: "1GiB", timeoutSeconds: 120, maxInstances: 60, concurrency: 1 },
  async (event) => {
    await handleCaptureUploaded(event.data.name);
  },
);

/** 通知スケジューラ (F-101, F-116)。テナントのタイムゾーンはコード側で解釈する */
export const scheduleNotificationsJob = onSchedule(
  {
    schedule: `every ${NOTIFICATION_SCHEDULER_INTERVAL_MIN} minutes`,
    timeZone: "Etc/UTC",
    memory: "512MiB",
    timeoutSeconds: 540,
    retryCount: 1,
  },
  async () => {
    await scheduleNotifications();
  },
);

/** Cloud Tasks のキュー名は関数名と一致する（notification/schedule.ts の NOTIFICATION_QUEUE） */
export const deliverCaptureNotificationQueue = onTaskDispatched<NotificationTaskPayload>(
  {
    retryConfig: { maxAttempts: 3, minBackoffSeconds: 10 },
    rateLimits: { maxConcurrentDispatches: 50 },
    memory: "256MiB",
    timeoutSeconds: 60,
  },
  async (req) => {
    await deliverCaptureNotification(req.data);
  },
);
