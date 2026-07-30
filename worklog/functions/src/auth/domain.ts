/**
 * ログインしてきたアカウントが「クライアント企業の Google Workspace アカウント」か
 * を判定する部分。ここが F-502 / F-504 の本体。
 *
 * ## hd クレームについて
 *
 * 設計書 4.1 は「IDトークンの `hd` クレームを検証する」としているが、
 * Firebase Auth が発行する ID トークンには Google 側の `hd` が **含まれない**
 * （`email` / `email_verified` / `firebase.sign_in_provider` は入る）。
 * 本物の `hd` を読めるのは Identity Platform の blocking function
 * (`beforeSignIn` の `event.credential.claims`) だけ。
 *
 * そこで2段構えにしている：
 *
 * 1. 既定：`sign_in_provider == google.com` かつ `email_verified` を前提に、
 *    **メールアドレスのドメイン**を許可ドメインと照合する。
 *    Google が検証済みのメールなのでドメインは詐称できず、
 *    許可はサーバー側の domainIndex にしか存在しないため、
 *    実質的な安全性は hd 照合と同じ（ゲートは許可リストであって hd ではない）。
 * 2. 任意：Identity Platform を有効化した場合は blocking function から
 *    本物の `hd` を渡せる（auth/blocking.ts）。渡された場合はそちらを優先する。
 *
 * どちらの経路でも「個人 Gmail を弾く」ことは満たす。
 */

/** Workspace ではない一般消費者向けドメイン。ここは許可リストに入っていても拒否する (F-504) */
const CONSUMER_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

export function extractDomain(email: string | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at < 0 || at === email.length - 1) return null;
  return email.slice(at + 1).toLowerCase();
}

export function isConsumerDomain(domain: string): boolean {
  return CONSUMER_DOMAINS.has(domain.toLowerCase());
}

export type DomainCheck =
  | { ok: true; domain: string }
  | { ok: false; reason: "notGoogle" | "unverified" | "noEmail" | "consumerDomain" };

export function checkWorkspaceIdentity(identity: {
  email?: string;
  emailVerified: boolean;
  signInProvider: string;
  /** blocking function から渡された本物の hd（あれば優先する） */
  hd?: string;
}): DomainCheck {
  if (identity.signInProvider !== "google.com") return { ok: false, reason: "notGoogle" };

  if (identity.hd) {
    const hd = identity.hd.toLowerCase();
    if (isConsumerDomain(hd)) return { ok: false, reason: "consumerDomain" };
    return { ok: true, domain: hd };
  }

  if (!identity.email) return { ok: false, reason: "noEmail" };
  if (!identity.emailVerified) return { ok: false, reason: "unverified" };

  const domain = extractDomain(identity.email);
  if (!domain) return { ok: false, reason: "noEmail" };
  // hd が取れない経路では、個人 Gmail を明示的に弾く (F-504)
  if (isConsumerDomain(domain)) return { ok: false, reason: "consumerDomain" };

  return { ok: true, domain };
}
