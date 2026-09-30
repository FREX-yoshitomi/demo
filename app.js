/* ============================================================
 * 武雄高校 同窓会 トップページ
 *  - 参加人数カウンター＋組別バー（公開API ?action=stats）
 *  - アンケート（名簿と自動照合）・入力進捗・送信完了画面
 *  - 〆切カウントダウン / 会費・PayPayリンク表示（config.js）
 * ============================================================ */

const form = document.getElementById("rsvpForm");
const statusEl = document.getElementById("formStatus");
const REQUIRED = ["cls", "name", "attendance", "contact"];
let lastTotal = null;

loadStats();
applyPayConfig();
applySurveyNotice();
bindFormUx();
bindFloatingCta();

// ---------- 参加人数カウンター ----------
async function loadStats() {
  if (!isConnected()) {
    renderCounter(0, 0, {});
    return;
  }
  try {
    const res = await fetch(APP_CONFIG.endpoint + "?action=stats", { redirect: "follow" });
    const d = await res.json();
    if (d.result !== "success") throw new Error(d.message || "stats error");
    renderCounter(d.total, d.pending, d.byClass || {});
  } catch (err) {
    // 集計が取れないときも、事前に参加を伝えてくれた人数は表示する
    console.error(err);
    renderCounter(0, 0, {});
  }
}

function renderCounter(surveyTotal, pending, byClass) {
  const pre = Number(APP_CONFIG.preAttendees) || 0;
  const total = surveyTotal + pre;
  lastTotal = total;
  countUp(document.getElementById("cntTotal"), total);
  document.getElementById("cntSub").textContent =
    [pre ? `事前に参加を伝えてくれた${pre}名を含む` : "", pending > 0 ? `ほか日程次第 ${pending}名` : ""].filter(Boolean).join("／") || "回答するとここに反映されます";

  const classes = ["1", "2", "3", "4", "5", "6", "7"];
  const max = Math.max(1, ...classes.map((c) => byClass[c] || 0));
  const wrap = document.getElementById("cntClasses");
  wrap.hidden = surveyTotal === 0;
  wrap.innerHTML = classes.map((c) => {
    const n = byClass[c] || 0;
    return `<div class="bar">
      <span class="bar__val">${n}</span>
      <span class="bar__col${n ? "" : " is-zero"}" data-h="${n ? Math.round(Math.max(6, (n / max) * 48)) : 4}"></span>
      <span class="bar__name">${c}組</span>
    </div>`;
  }).join("");
  requestAnimationFrame(() => {
    wrap.querySelectorAll(".bar__col").forEach((el) => (el.style.height = el.dataset.h + "px"));
  });
}

function countUp(el, to) {
  const from = Number(el.textContent) || 0;
  const start = performance.now();
  const dur = 900;
  const step = (now) => {
    const t = Math.min(1, (now - start) / dur);
    el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - t, 3)));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------- 〆切バッジ・カウントダウン ----------
function applySurveyNotice() {
  if (!APP_CONFIG.surveyDeadline) return;
  document.getElementById("surveyDeadlineLabel").textContent = APP_CONFIG.surveyDeadline;
  const cd = document.getElementById("surveyCountdown");
  const deadline = APP_CONFIG.surveyDeadlineAt ? new Date(APP_CONFIG.surveyDeadlineAt) : null;
  if (deadline && !isNaN(deadline)) {
    const days = Math.ceil((deadline - new Date()) / 86400000);
    cd.textContent = days < 0 ? "締め切りました" : days === 0 ? "今日まで" : `あと${days}日`;
  } else {
    cd.parentNode.removeChild(cd.previousSibling);
  }
  document.getElementById("surveyNotice").hidden = false;
}

// ---------- 会費・PayPayリンク ----------
function applyPayConfig() {
  if (APP_CONFIG.fee) {
    document.getElementById("feeValue").textContent = APP_CONFIG.fee;
    document.getElementById("feeNote").textContent = "事前にPayPayでお支払いください";
  }
  if (APP_CONFIG.payPayLink) {
    document.getElementById("payLinkArea").innerHTML =
      `<a class="paylink" href="${encodeURI(APP_CONFIG.payPayLink)}" target="_blank" rel="noopener">PayPayで送金する</a>` +
      (APP_CONFIG.fee ? `（${escapeHtml(APP_CONFIG.fee)}）` : "");
  }
}

// ---------- フォームUX（進捗バー） ----------
function bindFormUx() {
  form.addEventListener("input", updateProgress);
  form.addEventListener("change", updateProgress);
  document.getElementById("againBtn").addEventListener("click", () => {
    document.getElementById("payDone").hidden = true;
    document.getElementById("surveyCard").hidden = false;
    clearStatus();
    document.getElementById("rsvp").scrollIntoView({ behavior: "smooth" });
  });
  updateProgress();
}

function updateProgress() {
  const fd = new FormData(form);
  const filled = REQUIRED.filter((k) => (k === "contact" ? hasContact(fd) : String(fd.get(k) || "").trim())).length;
  document.getElementById("formProgress").style.width = (filled / REQUIRED.length) * 100 + "%";
  document.getElementById("formProgressText").textContent =
    filled === REQUIRED.length ? "必須項目はすべて入力済みです" : `必須 ${filled} / ${REQUIRED.length}`;
}

// ---------- 送信 ----------
form.addEventListener("submit", (e) => {
  e.preventDefault();
  clearStatus();

  if (!form.checkValidity()) {
    const firstInvalid = form.querySelector(":invalid");
    if (firstInvalid) {
      (firstInvalid.closest(".q") || firstInvalid).scrollIntoView({ behavior: "smooth", block: "center" });
      if (firstInvalid.type !== "radio") firstInvalid.focus({ preventScroll: true });
    }
    setStatus(firstInvalid && firstInvalid.type === "email" ? "メールアドレスの形を確認してください。" : "未回答の必須項目があります。", "error");
    return;
  }
  const fd = new FormData(form);
  if (!hasContact(fd)) {
    document.getElementById("cLine").closest(".q").scrollIntoView({ behavior: "smooth", block: "center" });
    document.getElementById("cLine").focus({ preventScroll: true });
    setStatus("連絡先をどれか1つ入れてください。", "error");
    return;
  }

  const data = Object.fromEntries(fd.entries());
  data.dates = fd.getAll("dates").join("・");
  data.contact = [
    data.line && `LINE: ${data.line.trim()}`,
    data.email && `メール: ${data.email.trim()}`,
    data.tel && `電話: ${data.tel.trim()}`,
  ].filter(Boolean).join(" / ");

  send(data);
});

// ---------- 送信 ----------
// 押した瞬間に完了画面を出す。送信は keepalive でページを閉じても続き、
// 保存が確認できるまでは端末にも回答を残しておき、届いていなければ次回開いたときに送り直す。
const PENDING_KEY = "takeo_reunion_pending";

function setPending(data) {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(data)); } catch (e) {}
}
function getPending() {
  try { return JSON.parse(localStorage.getItem(PENDING_KEY) || "null"); } catch (e) { return null; }
}
function clearPending() {
  try { localStorage.removeItem(PENDING_KEY); } catch (e) {}
}

function send(data) {
  if (!isConnected()) { showThanks(data, true); return; }
  setPending(data);
  bumpCounter(data);
  showThanks(data, false);
  deliver(data);
}

async function deliver(data, note) {
  const state = document.getElementById("saveState");
  const retry = document.getElementById("retryBtn");
  retry.hidden = true;
  try {
    const res = await apiCall("rsvp", data, { keepalive: true });
    clearPending();
    state.className = "save-state is-saved";
    state.textContent = (note || "記録しました。この画面は閉じて大丈夫です。") +
      (res.matched === false ? "（名簿の確認は幹事が行います）" : "");
    loadStats().then(() => { document.getElementById("thanksCount").textContent = lastTotal ?? "–"; });
  } catch (err) {
    console.error(err);
    state.className = "save-state is-error";
    state.textContent = "通信がうまくいきませんでした。下のボタンを押すか、あとでこのページを開き直すと自動で送り直します。";
    retry.hidden = false;
    retry.onclick = () => {
      state.className = "save-state";
      state.textContent = "送り直しています…";
      deliver(data);
    };
  }
}

// 参加の回答なら、保存を待たずにトップの人数を1人増やして見せる
function bumpCounter(data) {
  if (data.attendance !== "参加" || lastTotal == null) return;
  lastTotal += 1;
  document.getElementById("cntTotal").textContent = lastTotal;
}

// 前回届いていなかった回答があれば送り直す
(function resendPending() {
  const pending = getPending();
  if (!pending || !isConnected()) return;
  showThanks(pending, false);
  const state = document.getElementById("saveState");
  state.className = "save-state";
  state.textContent = "前回の回答を送り直しています…";
  deliver(pending, "前回の回答が届いていなかったので、いま送り直して記録しました。");
})();


function hasContact(fd) {
  return ["line", "email", "tel"].some((k) => String(fd.get(k) || "").trim());
}

function showThanks(data, isDemo) {
  const msg = {
    "参加": "会費が決まったら事前入金のご案内をします。入金を確認できた方から、参加者のLINEグループに招待します。",
    "未定": "日程が決まったらすぐにお知らせします。",
    "不参加": "教えてくれてありがとう。また次の機会に。",
  }[data.attendance] || "";
  document.getElementById("thanksMsg").textContent = msg;
  const state = document.getElementById("saveState");
  state.className = "save-state";
  state.textContent = isDemo ? "【テストモード】保存はされていません。" : "記録しています…（この画面は閉じても大丈夫です）";
  document.getElementById("retryBtn").hidden = true;
  document.getElementById("thanksCount").textContent = lastTotal ?? "–";

  const url = location.href.split("#")[0];
  const text = `武雄高校（H27年3月卒）の同窓会の参加アンケートです。1分で答えられます。\n${APP_CONFIG.surveyDeadline ? `〆切：${APP_CONFIG.surveyDeadline}\n` : ""}${url}`;
  document.getElementById("lineShare").href = "https://line.me/R/msg/text/?" + encodeURIComponent(text);

  form.reset();
  updateProgress();
  clearStatus();
  document.getElementById("surveyCard").hidden = true;
  const done = document.getElementById("payDone");
  done.hidden = false;
  done.scrollIntoView({ behavior: "smooth", block: "center" });
}

// ---------- 下部固定CTA ----------
function bindFloatingCta() {
  const cta = document.getElementById("floatingCta");
  const hero = document.querySelector(".hero");
  const survey = document.getElementById("rsvp");
  let heroVisible = true, surveyVisible = false;
  const update = () => cta.classList.toggle("is-visible", !heroVisible && !surveyVisible);
  if (!("IntersectionObserver" in window)) return;
  new IntersectionObserver(([e]) => { heroVisible = e.isIntersecting; update(); }).observe(hero);
  new IntersectionObserver(([e]) => { surveyVisible = e.isIntersecting; update(); }, { threshold: 0.05 }).observe(survey);
}

// ---------- ユーティリティ ----------
function setStatus(message, type) {
  statusEl.textContent = message;
  statusEl.classList.toggle("is-error", type === "error");
  statusEl.classList.toggle("is-success", type === "success");
  statusEl.classList.toggle("is-info", type === "info");
}
function clearStatus() {
  statusEl.textContent = "";
  statusEl.classList.remove("is-error", "is-success", "is-info");
}
function escapeHtml(v) {
  return String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
