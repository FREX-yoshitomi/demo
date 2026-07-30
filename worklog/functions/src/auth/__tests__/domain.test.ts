import { describe, expect, it } from "vitest";

import { checkWorkspaceIdentity, extractDomain, isConsumerDomain } from "../domain";

describe("extractDomain", () => {
  it("メールアドレスからドメインを取る", () => {
    expect(extractDomain("taro@acme.co.jp")).toBe("acme.co.jp");
  });

  it("大文字は小文字に正規化する", () => {
    expect(extractDomain("Taro@ACME.co.jp")).toBe("acme.co.jp");
  });

  it("@ を含むローカル部があっても最後の @ で切る", () => {
    expect(extractDomain('"a@b"@acme.co.jp')).toBe("acme.co.jp");
  });

  it("不正な入力は null", () => {
    expect(extractDomain(undefined)).toBeNull();
    expect(extractDomain("noatsign")).toBeNull();
    expect(extractDomain("trailing@")).toBeNull();
  });
});

describe("isConsumerDomain", () => {
  it("個人 Gmail を判定する (F-504)", () => {
    expect(isConsumerDomain("gmail.com")).toBe(true);
    expect(isConsumerDomain("GMAIL.COM")).toBe(true);
    expect(isConsumerDomain("googlemail.com")).toBe(true);
  });

  it("会社ドメインは消費者ドメインではない", () => {
    expect(isConsumerDomain("frex.works")).toBe(false);
    expect(isConsumerDomain("acme.co.jp")).toBe(false);
  });
});

describe("checkWorkspaceIdentity", () => {
  const base = {
    email: "taro@acme.co.jp",
    emailVerified: true,
    signInProvider: "google.com",
  };

  it("Google Workspace アカウントは通る", () => {
    expect(checkWorkspaceIdentity(base)).toEqual({ ok: true, domain: "acme.co.jp" });
  });

  it("Google 以外のプロバイダは弾く (F-501 Googleのみ)", () => {
    expect(checkWorkspaceIdentity({ ...base, signInProvider: "password" })).toEqual({
      ok: false,
      reason: "notGoogle",
    });
  });

  it("個人 Gmail は弾く (F-504)", () => {
    expect(checkWorkspaceIdentity({ ...base, email: "taro@gmail.com" })).toEqual({
      ok: false,
      reason: "consumerDomain",
    });
  });

  it("メール未検証は弾く（ドメインの根拠が無くなる）", () => {
    expect(checkWorkspaceIdentity({ ...base, emailVerified: false })).toEqual({
      ok: false,
      reason: "unverified",
    });
  });

  it("メールが無い場合は弾く", () => {
    expect(checkWorkspaceIdentity({ ...base, email: undefined })).toEqual({
      ok: false,
      reason: "noEmail",
    });
  });

  it("hd が渡された場合はそちらを優先する（blocking function 経由）", () => {
    expect(
      checkWorkspaceIdentity({ ...base, email: "taro@alias.example.com", hd: "acme.co.jp" }),
    ).toEqual({ ok: true, domain: "acme.co.jp" });
  });

  it("hd が gmail.com なら弾く", () => {
    expect(checkWorkspaceIdentity({ ...base, hd: "gmail.com" })).toEqual({
      ok: false,
      reason: "consumerDomain",
    });
  });

  it("hd があればメール未検証でも通る（hd 自体が Google の署名済みクレーム）", () => {
    expect(checkWorkspaceIdentity({ ...base, emailVerified: false, hd: "acme.co.jp" })).toEqual({
      ok: true,
      domain: "acme.co.jp",
    });
  });
});
