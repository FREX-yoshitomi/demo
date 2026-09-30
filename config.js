/* ============================================================
 * 武雄高校 同窓会サイト 共通設定
 *
 * ▼ endpoint : Google Apps Script のウェブアプリ URL（README.md 参照）
 *   空のままだと「デモ/テストモード」で動きます（保存はされません）。
 *
 * ▼ payPayLink : 幹事の PayPay 受け取りリンク（例 https://qr.paypay.ne.jp/xxxx）
 *   会費が決まったら設定。空の間はサイト上で「準備中」と表示されます。
 *
 * ▼ fee : 会費の表示（例 "5,000円"）。空の間は「調整中」表示。
 * ============================================================ */
const APP_CONFIG = {
  endpoint: "https://script.google.com/macros/s/AKfycbyTrKTX-vjqEJwzLRgiKSB0lTdOhVHxllIJcMU0byjcG0AE_vR96m8_KzCWdDGYEon2/exec",
  payPayLink: "",
  fee: "",
  // 参加アンケートの〆切（空にするとバナー非表示）。表示用ラベルと、カウントダウン用の日時
  surveyDeadline: "10/18（日）23:59",
  surveyDeadlineAt: "2026-10-18T23:59:00+09:00",
  // アンケート以外ですでに参加を伝えてくれている人数（トップの人数に足して表示）
  preAttendees: 10,
};

/** バックエンド（Apps Script）が接続済みかどうか */
function isConnected() {
  return Boolean(APP_CONFIG.endpoint);
}

/**
 * Apps Script への共通API呼び出し。
 * text/plain で送ることで CORS プリフライトを避け、レスポンス(JSON)も読める。
 */
async function apiCall(action, payload = {}, options = {}) {
  if (!isConnected()) throw new Error("ENDPOINT_NOT_SET");
  const res = await fetch(APP_CONFIG.endpoint, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, ...payload }),
    redirect: "follow",
    // keepalive: ページを閉じても送信を最後まで続ける（回答の送信で使う）
    keepalive: Boolean(options.keepalive),
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const data = await res.json();
  if (data.result === "error") throw new Error(data.message || "サーバーエラー");
  return data;
}
