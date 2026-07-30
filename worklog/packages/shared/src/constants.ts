/**
 * 全レイヤ共通の定数。ここ以外にマジックナンバーを置かない。
 * 括弧内は要件定義書 v1.0 の要件ID。
 */

/** GCP リージョン。国外にデータを出さないため固定 (F-510) */
export const REGION = "asia-northeast1" as const;

/** テナント既定タイムゾーン (F-506 / 運用ケース) */
export const DEFAULT_TIMEZONE = "Asia/Tokyo" as const;

// ---------------------------------------------------------------------------
// 撮影
// ---------------------------------------------------------------------------

/** 録画長。アプリ側で maxDuration として強制する (F-102, F-115) */
export const CAPTURE_DURATION_SEC = 2 as const;

/** 動画仕様 (F-115)。設計書 3.3 */
export const VIDEO_SPEC = {
  width: 720,
  height: 1280,
  codec: "h264",
  audioCodec: "aac",
  bitrateKbps: 2000,
  contentType: "video/mp4",
} as const;

export const THUMB_SPEC = {
  width: 360,
  height: 640,
  contentType: "image/jpeg",
} as const;

/** 一言メモの上限文字数 (F-107) */
export const MEMO_MAX_LENGTH = 100 as const;

/** 撮影猶予（通知から何分までを「遅延なし」とみなすか）の既定値 (F-109) */
export const DEFAULT_CAPTURE_GRACE_MIN = 50 as const;

/**
 * 猶予を超えた後追い撮影を受理する上限（スロット開始からの分数）。
 * これを超えると CAPTURE/SLOT_CLOSED。猶予〜この時間までは isLate=true で受理する (F-110)。
 */
export const LATE_CAPTURE_ACCEPT_MIN = 720 as const;

/** スロット開始より少し前の撮影を許容する分数（ホームから先回りして撮る操作を弾かないため） */
export const CAPTURE_EARLY_TOLERANCE_MIN = 5 as const;

/** 選択可能な撮影間隔（分） (F-111) */
export const CAPTURE_INTERVALS_MIN = [30, 60, 120] as const;
export type CaptureIntervalMin = (typeof CAPTURE_INTERVALS_MIN)[number];

/**
 * 業務日の切り替わり時刻（既定）。
 * 日勤シフトでは 04:00 より前の撮影を前日の業務日として扱う。
 * 日跨ぎシフトでは workingHours.start が境界になる（businessDate.ts 参照, 運用ケース「業務日の定義」）。
 */
export const DEFAULT_BUSINESS_DAY_BOUNDARY = "04:00" as const;

// ---------------------------------------------------------------------------
// 署名付きURL (非機能要件)
// ---------------------------------------------------------------------------

/** アップロード用署名付きURLの有効期限（分） */
export const UPLOAD_URL_TTL_MIN = 15 as const;

/** 再生用署名付きURLの有効期限（分） */
export const PLAYBACK_URL_TTL_MIN = 60 as const;

// ---------------------------------------------------------------------------
// 通知 (F-101, F-114, F-116)
// ---------------------------------------------------------------------------

/** 配信時刻のばらつき上限（秒）。毎正時のアップロード集中を平準化する (F-116) */
export const NOTIFICATION_JITTER_MAX_SEC = 180 as const;

/** 未撮影の場合に1回だけ再送するまでの待ち時間（分） (F-114) */
export const NOTIFICATION_RESEND_AFTER_MIN = 15 as const;

/** scheduleNotifications の起動間隔（分）。Cloud Scheduler と一致させる */
export const NOTIFICATION_SCHEDULER_INTERVAL_MIN = 10 as const;

// ---------------------------------------------------------------------------
// 表示 / Vlog
// ---------------------------------------------------------------------------

/** サムネイルグリッドの分割数 (F-302) */
export const GRID_SIZES = [4, 6, 9, 12] as const;
export type GridSize = (typeof GRID_SIZES)[number];

/** 既定の分割数。実機検証で確定させる（要件定義書 第13章 #8） */
export const DEFAULT_GRID_SIZE: GridSize = 6;

// ---------------------------------------------------------------------------
// 保持期間
// ---------------------------------------------------------------------------

/** 撮影動画・Vlog の保持月数の既定値 (F-506 / 非機能要件) */
export const DEFAULT_RETENTION_MONTHS = 13 as const;

/** 操作ログの保持月数 */
export const AUDIT_LOG_RETENTION_MONTHS = 36 as const;
