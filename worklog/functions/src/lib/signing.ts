import { PLAYBACK_URL_TTL_MIN, UPLOAD_URL_TTL_MIN, VIDEO_SPEC } from "@worklog/shared";

import { bucket, defaultBucketName, isEmulator } from "./admin";

/**
 * 署名付きURL（設計書 3.2 / 非機能要件）。
 *
 * アップロードはここで発行した URL で端末から Storage へ直接 PUT する。
 * Functions を経由させると毎正時のスパイクで詰まる（CLAUDE.md「絶対に守ること」）。
 *
 * 署名には署名鍵が必要なため、本番では実行サービスアカウントに
 * `roles/iam.serviceAccountTokenCreator` を付与しておくこと。
 * エミュレータでは署名できないので、Storage エミュレータの直PUTエンドポイントを返す。
 */

export interface SignedUpload {
  uploadUrl: string;
  requiredHeaders: Record<string, string>;
  expiresAt: Date;
}

export async function createUploadUrl(objectPath: string): Promise<SignedUpload> {
  const expiresAt = new Date(Date.now() + UPLOAD_URL_TTL_MIN * 60_000);
  const contentType = VIDEO_SPEC.contentType;

  if (isEmulator()) {
    const host = process.env.STORAGE_EMULATOR_HOST ?? "http://127.0.0.1:9199";
    const base = host.startsWith("http") ? host : `http://${host}`;
    return {
      uploadUrl: `${base}/v0/b/${defaultBucketName()}/o/${encodeURIComponent(objectPath)}`,
      requiredHeaders: { "Content-Type": contentType },
      expiresAt,
    };
  }

  const [url] = await bucket().file(objectPath).getSignedUrl({
    version: "v4",
    action: "write",
    expires: expiresAt,
    contentType,
  });

  return {
    uploadUrl: url,
    // 署名に含めたので、PUT 時に同じ値を送らないと 403 になる
    requiredHeaders: { "Content-Type": contentType },
    expiresAt,
  };
}

export async function createPlaybackUrl(
  objectPath: string,
): Promise<{ url: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + PLAYBACK_URL_TTL_MIN * 60_000);

  if (isEmulator()) {
    const host = process.env.STORAGE_EMULATOR_HOST ?? "http://127.0.0.1:9199";
    const base = host.startsWith("http") ? host : `http://${host}`;
    return {
      url: `${base}/v0/b/${defaultBucketName()}/o/${encodeURIComponent(objectPath)}?alt=media`,
      expiresAt,
    };
  }

  const [url] = await bucket().file(objectPath).getSignedUrl({
    version: "v4",
    action: "read",
    expires: expiresAt,
  });
  return { url, expiresAt };
}
