import { getApps, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getMessaging, type Messaging } from "firebase-admin/messaging";
import { getStorage } from "firebase-admin/storage";
import type { Bucket } from "@google-cloud/storage";

/** Admin SDK の初期化。Cloud Run Jobs の既定サービスアカウントで動く */

let cachedApp: App | undefined;

export function app(): App {
  if (!cachedApp) cachedApp = getApps()[0] ?? initializeApp();
  return cachedApp;
}

let cachedDb: Firestore | undefined;

export function db(): Firestore {
  if (!cachedDb) {
    cachedDb = getFirestore(app());
    cachedDb.settings({ ignoreUndefinedProperties: true });
  }
  return cachedDb;
}

export function messaging(): Messaging {
  return getMessaging(app());
}

export function bucketName(): string {
  const explicit = process.env.WORKLOG_STORAGE_BUCKET;
  if (explicit) return explicit;
  const projectId =
    process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? "worklog-dev";
  return `${projectId}.firebasestorage.app`;
}

export function bucket(): Bucket {
  return getStorage(app()).bucket(bucketName());
}

/** 撮影動画をローカルへ落とす */
export async function downloadObject(objectPath: string, destination: string): Promise<void> {
  await bucket().file(objectPath).download({ destination });
}

/** 生成した Vlog を Storage へ置く */
export async function uploadObject(params: {
  localPath: string;
  objectPath: string;
  contentType: string;
}): Promise<void> {
  await bucket().upload(params.localPath, {
    destination: params.objectPath,
    contentType: params.contentType,
    resumable: false,
    metadata: {
      // 生成物は差し替わりうるので短めにする
      cacheControl: "private, max-age=300",
    },
  });
}
