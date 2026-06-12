/* ============================================================
 * 武雄高校 同窓会 出欠フォーム（一般ページ）
 * 設定・API は config.js を参照（先に読み込むこと）
 * ============================================================ */
const form = document.getElementById("rsvpForm");
const statusEl = document.getElementById("formStatus");
const submitBtn = document.getElementById("submitBtn");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearStatus();

  if (!form.checkValidity()) {
    const firstInvalid = form.querySelector(":invalid");
    if (firstInvalid) firstInvalid.focus();
    setStatus("未入力の必須項目があります。ご確認ください。", "error");
    return;
  }

  const data = Object.fromEntries(new FormData(form).entries());
  setLoading(true);

  // 未接続ならテストモード（送信せず内容を表示）
  if (!isConnected()) {
    console.table(data);
    setLoading(false);
    setStatus("【テストモード】送信先が未設定です。入力内容はコンソールに表示しました。", "error");
    return;
  }

  try {
    await apiCall("rsvp", data);
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
