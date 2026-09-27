/* ============================================================
 * 武雄高校 同窓会 トップページ
 *  - 参加人数カウンター＋組別バー（公開API ?action=stats）
 *  - アンケート（名簿と自動照合）・入力進捗・送信完了画面
 *  - 〆切カウントダウン / 会費・PayPayリンク表示（config.js）
 * ============================================================ */

const form = document.getElementById("rsvpForm");
const statusEl = document.getElementById("formStatus");
const submitBtn = document.getElementById("submitBtn");
const REQUIRED = ["cls", "name", "attendance", "contact"];
let lastTotal = null;

loadStats();
applyPayConfig();
applySurveyNotice();
applySchoolPhoto();
bindFormUx();
bindFloatingCta();

// ---------- 参加人数カウンター ----------
async function loadStats() {
  const sub = document.getElementById("cntSub");

  if (!isConnected()) {
    renderCounter(27, 6, { 1: 4, 2: 5, 3: 3, 4: 4, 5: 4, 6: 3, 7: 4 });
    sub.textContent = "（デモ表示）ほか 日程次第 6名";
    return;
  }
  try {
    const res = await fetch(APP_CONFIG.endpoint + "?action=stats", { redirect: "follow" });
    const d = await res.json();
    if (d.result !== "success") throw new Error(d.message || "stats error");
    renderCounter(d.total, d.pending, d.byClass || {});
  } catch (err) {
    console.error(err);
    document.getElementById("cntTotal").textContent = "–";
    sub.textContent = "集計は準備中です";
    document.getElementById("cntClasses").innerHTML = "";
  }
}

function renderCounter(total, pending, byClass) {
  lastTotal = total;
  countUp(document.getElementById("cntTotal"), total);
  document.getElementById("cntSub").textContent =
    pending > 0 ? `ほか 日程次第で検討中 ${pending}名` : "回答するとここに反映されます";

  const classes = ["1", "2", "3", "4", "5", "6", "7"];
  const max = Math.max(1, ...classes.map((c) => byClass[c] || 0));
  const wrap = document.getElementById("cntClasses");
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

// assets/school.jpg があれば線画の上に写真を表示
function applySchoolPhoto() {
  const img = new Image();
  img.onload = () => {
    const el = document.querySelector(".school__photo");
    el.style.height = "220px";
    document.querySelector(".school__art").style.display = "none";
  };
  img.src = "assets/school.jpg";
}

// ---------- 会費・PayPayリンク ----------
function applyPayConfig() {
  if (APP_CONFIG.fee) {
    document.getElementById("feeValue").textContent = APP_CONFIG.fee;
    document.getElementById("feeNote").textContent = "PayPay または当日現金でお支払いください";
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
  const filled = REQUIRED.filter((k) => String(fd.get(k) || "").trim()).length;
  document.getElementById("formProgress").style.width = (filled / REQUIRED.length) * 100 + "%";
  document.getElementById("formProgressText").textContent =
    filled === REQUIRED.length ? "必須項目はすべて入力済みです" : `必須 ${filled} / ${REQUIRED.length}`;
}

// ---------- 送信 ----------
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearStatus();

  if (!form.checkValidity()) {
    const firstInvalid = form.querySelector(":invalid");
    if (firstInvalid) {
      (firstInvalid.closest(".q") || firstInvalid).scrollIntoView({ behavior: "smooth", block: "center" });
      if (firstInvalid.type !== "radio") firstInvalid.focus({ preventScroll: true });
    }
    setStatus("未回答の必須項目があります。", "error");
    return;
  }

  const fd = new FormData(form);
  const data = Object.fromEntries(fd.entries());
  data.dates = fd.getAll("dates").join("・");
  setLoading(true);

  if (!isConnected()) {
    console.table(data);
    setLoading(false);
    showThanks(data, { matched: true }, true);
    return;
  }

  try {
    const res = await apiCall("rsvp", data);
    showThanks(data, res, false);
    loadStats();
  } catch (err) {
    console.error(err);
    setStatus("送信に失敗しました。通信環境をご確認のうえ、もう一度お試しください。", "error");
  } finally {
    setLoading(false);
  }
});

function showThanks(data, res, isDemo) {
  const msg = {
    "参加": "当日会えるのを楽しみにしています。",
    "未定": "日程が決まったらすぐにお知らせします。",
    "不参加": "教えてくれてありがとう。また次の機会に。",
  }[data.attendance] || "";
  document.getElementById("thanksMsg").textContent =
    (isDemo ? "【テストモード】保存はされていません。" : "") +
    msg + (res.matched ? "" : "（名簿の確認は幹事が行います）");
  document.getElementById("thanksCount").textContent = lastTotal ?? "–";

  const url = location.href.split("#")[0];
  const text = `武雄高校（H27年3月卒）の同窓会の参加アンケートです。1分で答えられます。\n${APP_CONFIG.surveyDeadline ? `〆切：${APP_CONFIG.surveyDeadline}\n` : ""}${url}`;
  document.getElementById("lineShare").href = "https://line.me/R/msg/text/?" + encodeURIComponent(text);

  form.reset();
  updateProgress();
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
function setLoading(isLoading) {
  submitBtn.disabled = isLoading;
  submitBtn.textContent = isLoading ? "送信中…" : "回答を送信する";
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
