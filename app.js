/* ============================================================
 * 武雄高校 同窓会 出欠フォーム
 *
 * ▼ 設定：ここに Google Apps Script のウェブアプリ URL を貼る
 *   （セットアップ手順は README.md を参照）
 *   未設定（空文字）の場合は、送信内容を確認用に表示するだけのテストモードになります。
 * ============================================================ */
const RSVP_ENDPOINT = "";

const form = document.getElementById("rsvpForm");
const statusEl = document.getElementById("formStatus");
const submitBtn = document.getElementById("submitBtn");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearStatus();

  // --- 入力チェック ---
  if (!form.checkValidity()) {
    const firstInvalid = form.querySelector(":invalid");
    if (firstInvalid) firstInvalid.focus();
    setStatus("未入力の必須項目があります。ご確認ください。", "error");
    return;
  }

  const data = new FormData(form);

  // --- 送信 ---
  setLoading(true);

  // テストモード：エンドポイント未設定なら送信せず内容を表示
  if (!RSVP_ENDPOINT) {
    console.table(Object.fromEntries(data.entries()));
    setLoading(false);
    setStatus("【テストモード】送信先が未設定です。入力内容はコンソールに表示しました。", "error");
    return;
  }

  try {
    // Google Apps Script へは x-www-form-urlencoded で送ると CORS プリフライトを回避できる。
    // レスポンスは読めない（no-cors）ため、成功は楽観的に扱う。
    await fetch(RSVP_ENDPOINT, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(data),
    });

    form.reset();
    setStatus("送信しました！ご回答ありがとうございます 🎉 詳細が決まり次第ご連絡します。", "success");
  } catch (err) {
    console.error(err);
    setStatus("送信に失敗しました。通信環境をご確認のうえ、もう一度お試しください。", "error");
  } finally {
    setLoading(false);
  }
});

function setLoading(isLoading) {
  submitBtn.disabled = isLoading;
  submitBtn.textContent = isLoading ? "送信中…" : "この内容で送信する";
}

function setStatus(message, type) {
  statusEl.textContent = message;
  statusEl.classList.toggle("is-error", type === "error");
  statusEl.classList.toggle("is-success", type === "success");
}

function clearStatus() {
  statusEl.textContent = "";
  statusEl.classList.remove("is-error", "is-success");
}
