import { getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import {
  getFirestore,
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
} from "firebase-admin/firestore";
import { getMessaging, type Messaging } from "firebase-admin/messaging";
import { getStorage } from "firebase-admin/storage";
import type { Bucket } from "@google-cloud/storage";

/**
 * Admin SDK の初期化。テストからも同じ経路で使えるように遅延初期化にする。
 * Firestore への書き込みはすべてこの経路（＝セキュリティルールを迂回する Admin SDK）で行う。
 */

let cachedApp: App | undefined;

export function app(): App {
  if (!cachedApp) {
    cachedApp = getApps()[0] ?? initializeApp();
  }
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

export function auth(): Auth {
  return getAuth(app());
}

/**
 * `Firestore.getAll` の戻り値をタプル型にする薄いラッパ。
 * 素の getAll は配列を返すため、要素ごとに undefined チェックが必要になって読みにくい。
 */
export async function getAllDocs<T extends readonly DocumentReference<DocumentData>[]>(
  ...refs: T
): Promise<{ [K in keyof T]: DocumentSnapshot<DocumentData> }> {
  const snaps = await db().getAll(...refs);
  if (snaps.length !== refs.length) {
    throw new Error(`getAll returned ${snaps.length} of ${refs.length} documents`);
  }
  return snaps as { [K in keyof T]: DocumentSnapshot<DocumentData> };
}

export function messaging(): Messaging {
  return getMessaging(app());
}

/** 既定バケット。テナントごとには分けず、パスで分離する（設計書 3.2） */
export function bucket(): Bucket {
  return getStorage(app()).bucket(defaultBucketName());
}

export function defaultBucketName(): string {
  const explicit = process.env.WORKLOG_STORAGE_BUCKET;
  if (explicit) return explicit;
  const projectId =
    process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? "worklog-dev";
  return `${projectId}.firebasestorage.app`;
}

export function isEmulator(): boolean {
  return (
    process.env.FUNCTIONS_EMULATOR === "true" ||
    Boolean(process.env.FIRESTORE_EMULATOR_HOST) ||
    Boolean(process.env.STORAGE_EMULATOR_HOST)
  );
}
