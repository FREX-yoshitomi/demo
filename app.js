/* ============================================================
 * 武雄高校 同窓会 トップページ
 *  - 参加人数カウンター（公開API ?action=stats）
 *  - 受付フォーム（名簿と自動照合）
 *  - 会費・PayPayリンクの表示（config.js の設定を反映）
 * ============================================================ */

const form = document.getElementById("rsvpForm");
const statusEl = document.getElementById("formStatus");
const submitBtn = document.getElementById("submitBtn");

// ---------- 参加人数カウンター ----------
loadStats();
applyPayConfig();

async function loadStats() {
  const total = document.getElementById("cntTotal");
  const sub = document.getElementById("cntSub");
  const classes = document.getElementById("cntClasses");

  // 未接続時はデモ表示
  if (!isConnected()) {
    renderCounter(27, 6, { 1: 4, 2: 5, 3: 3, 4: 4, 5: 4, 6: 3, 7: 4 });
    sub.textContent = "（デモ表示）ほか 未定 6名";
    return;
  }
  try {
    const res = await fetch(APP_CONFIG.endpoint + "?action=stats", { redirect: "follow" });
    const d = await res.json();
    if (d.result !== "success") throw new Error(d.message || "stats error");
    renderCounter(d.total, d.pending, d.byClass || {});
  } catch (err) {
    console.error(err);
    total.textContent = "–";
    sub.textContent = "集計は準備中です";
    classes.innerHTML = "";
  }

  function renderCounter(t, pending, byClass) {
    total.textContent = t;
    sub.textContent = pending > 0 ? `ほか 日程次第で検討中 ${pending}名` : "受付するとここに反映されます";
    classes.innerHTML = ["1", "2", "3", "4", "5", "6", "7"]
      .map((c) => `<span class="counter__chip">${c}組 <b>${byClass[c] || 0}</b></span>`)
      .join("");
  }
}

// ---------- 会費・PayPayリンク表示 ----------
function applyPayConfig() {
  if (APP_CONFIG.fee) {
    document.getElementById("feeCell").innerHTML =
      `<strong>${escapeHtml(APP_CONFIG.fee)}</strong><br /><small>お支払いは下の「お支払い」参照（PayPay / 当日現金）</small>`;
  }
  if (APP_CONFIG.payPayLink) {
    document.getElementById("payLinkArea").innerHTML =
      `<a class="paylink" href="${encodeURI(APP_CONFIG.payPayLink)}" target="_blank" rel="noopener">PayPayで送金する</a>` +
      (APP_CONFIG.fee ? `<br /><small>金額：${escapeHtml(APP_CONFIG.fee)}</small>` : "");
  }
}

// ---------- 受付フォーム ----------
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

  if (!isConnected()) {
    console.table(data);
    setLoading(false);
    setStatus("【テストモード】送信先が未設定です。入力内容はコンソールに表示しました。", "error");
    return;
  }

  try {
    const res = await apiCall("rsvp", data);
    const attending = data.attendance === "参加";
    form.reset();
    setStatus(
      res.matched
        ? "受付しました！名簿と照合済みです 🎉"
        : "受付しました！（名簿と自動照合できなかったため、幹事が確認します）",
      "success"
    );
    const done = document.getElementById("payDone");
    done.hidden = false;
    if (attending) {
      done.querySelector("p").textContent = "参加予定の方は、続けて下の「お支払い」までお願いします。";
      document.getElementById("pay").scrollIntoView({ behavior: "smooth" });
    } else {
      done.querySelector("p").textContent = "ご回答ありがとうございます。変更はいつでもこのフォームからどうぞ。";
    }
    loadStats(); // カウンターを更新
  } catch (err) {
    console.error(err);
    setStatus("送信に失敗しました。通信環境をご確認のうえ、もう一度お試しください。", "error");
  } finally {
    setLoading(false);
  }
});

function setLoading(isLoading) {
  submitBtn.disabled = isLoading;
  submitBtn.textContent = isLoading ? "送信中…" : "受付を完了する";
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
function escapeHtml(v) {
  return String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
