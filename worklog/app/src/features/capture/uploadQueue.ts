import { File, UploadTask, UploadType } from "expo-file-system";
import * as Network from "expo-network";
import * as SQLite from "expo-sqlite";
import { AppState, type AppStateStatus } from "react-native";

import { ApiError, api } from "../../lib/api";
import {
  decideRetry,
  selectDue,
  type QueueItem,
  type QueueItemState,
} from "./queuePolicy";

/**
 * オフライン対応のアップロードキュー (F-112)。
 *
 * 端末で撮った動画をローカルに置き、
 *   issueUploadUrl → 署名付きURLへ直PUT → commit
 * の3段を1件ずつ最後まで通す。途中で落ちても撮影時刻は保持したまま再開する
 * （運用ケース「通信不良の現場」）。
 *
 * 再開の契機は3つ：アプリ起動 / フォアグラウンド復帰 / ネットワーク回復（設計書 8.2）。
 */

const DB_NAME = "worklog-upload-queue.db";

let dbPromise: Promise<SQLite.SQLiteDatabase> | undefined;

async function database(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS upload_queue (
          id TEXT PRIMARY KEY NOT NULL,
          businessDate TEXT NOT NULL,
          slotKey TEXT NOT NULL,
          capturedAtIso TEXT NOT NULL,
          camera TEXT NOT NULL,
          localUri TEXT NOT NULL,
          memo TEXT,
          workTag TEXT,
          attempts INTEGER NOT NULL DEFAULT 0,
          state TEXT NOT NULL DEFAULT 'pending',
          nextAttemptAt INTEGER NOT NULL DEFAULT 0,
          lastErrorCode TEXT
        );
      `);
      return db;
    })();
  }
  return dbPromise;
}

interface QueueRow {
  id: string;
  businessDate: string;
  slotKey: string;
  capturedAtIso: string;
  camera: string;
  localUri: string;
  memo: string | null;
  workTag: string | null;
  attempts: number;
  state: string;
  nextAttemptAt: number;
  lastErrorCode: string | null;
}

function toItem(row: QueueRow): QueueItem {
  return {
    id: row.id,
    businessDate: row.businessDate,
    slotKey: row.slotKey,
    capturedAtIso: row.capturedAtIso,
    camera: row.camera === "front" ? "front" : "back",
    localUri: row.localUri,
    memo: row.memo ?? undefined,
    workTag: row.workTag ?? undefined,
    attempts: row.attempts,
    state: (row.state as QueueItemState) ?? "pending",
    nextAttemptAt: row.nextAttemptAt,
    lastErrorCode: row.lastErrorCode ?? undefined,
  };
}

export async function enqueue(params: {
  businessDate: string;
  slotKey: string;
  capturedAt: Date;
  camera: "front" | "back";
  localUri: string;
  memo?: string;
  workTag?: string;
}): Promise<string> {
  const db = await database();
  // 同一スロットは1件に保つ（撮り直しは上書き）
  const id = `${params.businessDate}_${params.slotKey}`;
  await db.runAsync(
    `INSERT INTO upload_queue
       (id, businessDate, slotKey, capturedAtIso, camera, localUri, memo, workTag, attempts, state, nextAttemptAt, lastErrorCode)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'pending', 0, NULL)
     ON CONFLICT(id) DO UPDATE SET
       capturedAtIso = excluded.capturedAtIso,
       camera = excluded.camera,
       localUri = excluded.localUri,
       memo = excluded.memo,
       workTag = excluded.workTag,
       attempts = 0,
       state = 'pending',
       nextAttemptAt = 0,
       lastErrorCode = NULL`,
    [
      id,
      params.businessDate,
      params.slotKey,
      params.capturedAt.toISOString(),
      params.camera,
      params.localUri,
      params.memo ?? null,
      params.workTag ?? null,
    ],
  );
  return id;
}

export async function listQueue(): Promise<QueueItem[]> {
  const db = await database();
  const rows = await db.getAllAsync<QueueRow>("SELECT * FROM upload_queue");
  return rows.map(toItem);
}

export async function pendingCount(): Promise<number> {
  const db = await database();
  const row = await db.getFirstAsync<{ c: number }>(
    "SELECT COUNT(*) as c FROM upload_queue WHERE state != 'failed'",
  );
  return row?.c ?? 0;
}

export async function removeItem(id: string): Promise<void> {
  const db = await database();
  await db.runAsync("DELETE FROM upload_queue WHERE id = ?", [id]);
}

/** 諦めた項目をユーザー操作で消す（設定画面から） */
export async function clearFailed(): Promise<void> {
  const db = await database();
  await db.runAsync("DELETE FROM upload_queue WHERE state = 'failed'");
}

async function markUploading(id: string): Promise<void> {
  const db = await database();
  await db.runAsync("UPDATE upload_queue SET state = 'uploading' WHERE id = ?", [id]);
}

async function markRetry(id: string, attempts: number, delayMs: number, code?: string): Promise<void> {
  const db = await database();
  await db.runAsync(
    "UPDATE upload_queue SET state = 'pending', attempts = ?, nextAttemptAt = ?, lastErrorCode = ? WHERE id = ?",
    [attempts, Date.now() + delayMs, code ?? null, id],
  );
}

async function markFailed(id: string, code?: string): Promise<void> {
  const db = await database();
  await db.runAsync(
    "UPDATE upload_queue SET state = 'failed', lastErrorCode = ? WHERE id = ?",
    [code ?? null, id],
  );
}

async function deleteLocalFile(localUri: string): Promise<void> {
  try {
    const file = new File(localUri);
    if (file.exists) file.delete();
  } catch {
    // 端末側の後片付けの失敗は無視する（次回起動時に一時領域ごと消える）
  }
}

/** 1件を最後まで通す。成功したらキューから消す */
async function processItem(item: QueueItem): Promise<"done" | "retry" | "failed"> {
  await markUploading(item.id);

  try {
    const issued = await api.issueUploadUrl({
      businessDate: item.businessDate,
      slotKey: item.slotKey,
      capturedAt: item.capturedAtIso,
      camera: item.camera,
    });

    const file = new File(item.localUri);
    if (!file.exists) {
      // ローカルの動画が消えている。これ以上どうにもならない
      await markFailed(item.id, "LOCAL/FILE_MISSING");
      return "failed";
    }

    const task = new UploadTask(file, issued.uploadUrl, {
      httpMethod: "PUT",
      uploadType: UploadType.BINARY_CONTENT,
      headers: issued.requiredHeaders,
      // アプリがバックグラウンドに回っても継続させる（設計書 8.2）
      sessionType: "background",
    });
    const result = await task.uploadAsync();

    if (result.status < 200 || result.status >= 300) {
      const decision = decideRetry(item, result.status === 403 ? "UPLOAD/EXPIRED" : undefined);
      if (decision.action === "giveUp") {
        await markFailed(item.id, `HTTP/${result.status}`);
        return "failed";
      }
      await markRetry(item.id, item.attempts + 1, decision.delayMs, `HTTP/${result.status}`);
      return "retry";
    }

    await api.commitCapture({
      captureId: issued.captureId,
      memo: item.memo,
      workTag: item.workTag,
    });

    await removeItem(item.id);
    await deleteLocalFile(item.localUri);
    return "done";
  } catch (err) {
    const code = err instanceof ApiError ? err.code : undefined;
    const decision = decideRetry(item, code);
    if (decision.action === "giveUp") {
      await markFailed(item.id, code);
      return "failed";
    }
    await markRetry(item.id, item.attempts + 1, decision.delayMs, code);
    return "retry";
  }
}

let running = false;

/**
 * キューを進める。多重起動しないようにガードする
 * （フォアグラウンド復帰とネットワーク回復が同時に来ることがある）。
 */
export async function processQueue(): Promise<{ done: number; retry: number; failed: number }> {
  if (running) return { done: 0, retry: 0, failed: 0 };
  running = true;
  const summary = { done: 0, retry: 0, failed: 0 };

  try {
    const state = await Network.getNetworkStateAsync();
    if (state.isInternetReachable === false) return summary;

    const items = selectDue(await listQueue(), Date.now());
    for (const item of items) {
      const result = await processItem(item);
      summary[result] += 1;
    }
  } finally {
    running = false;
  }

  return summary;
}

/**
 * 再送の契機を張る（設計書 8.2 の 6.）。
 * アプリのルートで1回だけ呼び、返り値で解除する。
 */
export function startQueueWatchers(): () => void {
  void processQueue();

  const appStateSub = AppState.addEventListener("change", (status: AppStateStatus) => {
    if (status === "active") void processQueue();
  });

  const networkSub = Network.addNetworkStateListener((state) => {
    if (state.isInternetReachable) void processQueue();
  });

  // バックオフ待ちの項目を拾うための定期実行。頻度は控えめにする
  const timer = setInterval(() => void processQueue(), 60_000);

  return () => {
    appStateSub.remove();
    networkSub.remove();
    clearInterval(timer);
  };
}
