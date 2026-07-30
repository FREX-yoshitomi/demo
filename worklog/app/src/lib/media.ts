import { firebaseAuth } from "./firebase";
import { firebaseConfig } from "./config";

/**
 * サムネイル・動画の取得URL。
 *
 * ## なぜ getDownloadURL を使わないか
 *
 * 1. `getDownloadURL()` は1件ごとにメタデータ取得の往復が要る。
 *    100人分のグリッドを2秒以内に出す（受け入れ基準 #4）と両立しない。
 * 2. `getDownloadURL()` が返すURLは **トークン付きの capability URL** で、
 *    セキュリティルールを迂回する。URLが漏れれば他社からでも従業員の映像が見える。
 *    テナント分離を最優先にするこのプロダクトでは採用しない（CLAUDE.md）。
 *
 * 代わりに、Storage のパスからURLを組み立て（往復ゼロ）、
 * IDトークンを Authorization ヘッダで送る。**評価されるのは storage.rules** なので
 * テナント境界はサーバー側で担保される。expo-image がディスクキャッシュを持つので
 * 2回目以降はネットワークに出ない。
 */

function mediaUrl(objectPath: string): string {
  const bucket = firebaseConfig.storageBucket;
  return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(
    objectPath,
  )}?alt=media`;
}

export interface MediaSource {
  uri: string;
  headers: Record<string, string>;
}

/** expo-image / expo-video にそのまま渡せる形で返す */
export async function mediaSource(objectPath: string): Promise<MediaSource> {
  const user = firebaseAuth().currentUser;
  if (!user) throw new Error("未ログイン状態でメディアを要求した");
  const token = await user.getIdToken();
  return { uri: mediaUrl(objectPath), headers: { Authorization: `Bearer ${token}` } };
}

/**
 * グリッドの全セルで使い回すためのヘッダ。
 * IDトークンは1時間有効なので、画面表示のたびに取り直さない。
 */
export async function authHeaders(): Promise<Record<string, string>> {
  const user = firebaseAuth().currentUser;
  if (!user) return {};
  return { Authorization: `Bearer ${await user.getIdToken()}` };
}

export { mediaUrl };
