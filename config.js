/* ============================================================
 * 武雄高校 同窓会サイト 共通設定
 *
 * ▼ ここに Google Apps Script のウェブアプリ URL を貼る
 *   （取得手順は README.md を参照）
 *   空のままだと「デモ/テストモード」で動きます（保存はされません）。
 * ============================================================ */
const APP_CONFIG = {
  endpoint: "https://script.google.com/macros/s/AKfycbyTrKTX-vjqEJwzLRgiKSB0lTdOhVHxllIJcMU0byjcG0AE_vR96m8_KzCWdDGYEon2/exec",
};

/** バックエンド（Apps Script）が接続済みかどうか */
function isConnected() {
  return Boolean(APP_CONFIG.endpoint);
}

/**
 * Apps Script への共通API呼び出し。
 * text/plain で送ることで CORS プリフライトを避け、レスポンス(JSON)も読める。
 * @param {string} action  サーバー側のアクション名
 * @param {object} payload 送信データ（管理操作では key を含める）
 */
async function apiCall(action, payload = {}) {
  if (!isConnected()) throw new Error("ENDPOINT_NOT_SET");

  const res = await fetch(APP_CONFIG.endpoint, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, ...payload }),
    redirect: "follow",
  });
  if (!res.ok) throw new Error("HTTP " + res.status);

  const data = await res.json();
  if (data.result === "error") throw new Error(data.message || "サーバーエラー");
  return data;
}
