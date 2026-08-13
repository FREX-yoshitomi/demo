/* ============================================================
 * 武雄高校 同窓会 幹事ダッシュボード v2（名簿中心）
 * config.js（APP_CONFIG / apiCall / isConnected）を先に読み込むこと
 * ============================================================ */

// ---------- 状態 ----------
const state = {
  key: null,
  demo: false,
  data: null,
  activeTab: "roster",
  rosterFilter: "all",
};

// ---------- 列の色分け ----------
function attClass(v) {
  return v === "参加" ? "st-done" : v === "未定" ? "st-prog" : v === "不参加" ? "st-off" : "st-todo";
}
function payClass(v) { return v === "済" ? "st-done" : v === "当日現金" ? "st-prog" : "st-todo"; }
function threeStep(opts) {
  return (v) => (v === opts[2] ? "st-done" : v === opts[1] ? "st-prog" : "st-todo");
}

// ---------- 編集可能タブ定義 ----------
const TABLES = {
  roster: {
    label: "名簿・参加状況",
    columns: [
      { key: "組", type: "select", options: ["1", "2", "3", "4", "5", "6", "7"], classFor: () => "", w: "64px" },
      { key: "名前", type: "text", w: "130px" },
      { key: "旧姓", type: "text", w: "80px" },
      { key: "出欠", type: "select", options: ["未回答", "参加", "未定", "不参加"], classFor: attClass, w: "104px" },
      { key: "支払い", type: "select", options: ["未", "済", "当日現金"], classFor: payClass, w: "104px" },
      { key: "連絡先", type: "text" },
      { key: "メモ", type: "text" },
    ],
    addDefault: { 組: "1", 名前: "", 旧姓: "", 出欠: "未回答", 支払い: "未", 連絡先: "", メモ: "" },
  },
  tasks: {
    label: "スケジュール / タスク",
    columns: [
      { key: "カテゴリ", type: "text", w: "92px" },
      { key: "タスク", type: "text" },
      { key: "担当", type: "text", w: "120px" },
      { key: "期限目安", type: "text", w: "92px" },
      { key: "状態", type: "select", options: ["未着手", "進行中", "完了"], classFor: threeStep(["未着手", "進行中", "完了"]), w: "108px" },
      { key: "メモ", type: "text" },
    ],
    statusKey: "状態", done: "完了",
    addDefault: { カテゴリ: "その他", タスク: "", 担当: "", 期限目安: "", 状態: "未着手", メモ: "" },
  },
  checklist: {
    label: "準備物チェックリスト",
    columns: [
      { key: "カテゴリ", type: "text", w: "80px" },
      { key: "品目", type: "text" },
      { key: "数量", type: "text", w: "80px" },
      { key: "担当", type: "text", w: "110px" },
      { key: "状態", type: "select", options: ["未手配", "手配中", "完了"], classFor: threeStep(["未手配", "手配中", "完了"]), w: "104px" },
      { key: "メモ", type: "text" },
    ],
    statusKey: "状態", done: "完了",
    addDefault: { カテゴリ: "その他", 品目: "", 数量: "", 担当: "", 状態: "未手配", メモ: "" },
  },
  budget: {
    label: "集金・予算",
    columns: [
      { key: "区分", type: "select", options: ["収入", "支出"], classFor: (v) => (v === "収入" ? "st-done" : "st-off"), w: "84px" },
      { key: "項目", type: "text" },
      { key: "予定額", type: "num", w: "110px" },
      { key: "実績額", type: "num", w: "110px" },
      { key: "メモ", type: "text" },
    ],
    addDefault: { 区分: "支出", 項目: "", 予定額: 0, 実績額: 0, メモ: "" },
  },
};

// ---------- デモ用データ ----------
function seedRows(arr, headers) {
  return arr.map((r, i) => {
    const o = { _row: i + 2 };
    headers.forEach((h, j) => (o[h] = r[j]));
    return o;
  });
}
const ROSTER_H = ["ID", "組", "名前", "旧姓", "出欠", "支払い", "連絡先", "メモ", "更新日時"];
const LOG_H = ["受信日時", "組", "名前", "旧姓", "出欠", "連絡先", "希望の曜日・時期", "メッセージ", "照合"];
const DEMO_DATA = {
  roster: { headers: ROSTER_H, rows: seedRows([
    [1, "1", "相原 大輝", "", "参加", "済", "LINE: aihara", "", "6/10"],
    [2, "1", "石井 さくら", "", "未定", "未", "", "サンプル", ""],
    [3, "1", "上田 健太", "", "未回答", "未", "", "サンプル", ""],
    [4, "2", "木村 拓海", "", "参加", "未", "090-xxxx", "", "6/11"],
    [5, "2", "久保 陽菜", "田中", "参加", "済", "kubo@example.com", "", "6/11"],
    [6, "3", "白石 大和", "", "不参加", "未", "", "遠方", "6/12"],
    [7, "4", "寺田 湊", "", "参加", "当日現金", "LINE: terada", "", "6/12"],
    [8, "5", "東 剛志", "", "未回答", "未", "", "サンプル", ""],
    [9, "6", "三浦 洋平", "", "参加", "未", "", "", "6/13"],
    [10, "7", "和田 潤", "", "未定", "未", "", "", "6/13"],
  ], ROSTER_H) },
  log: { headers: LOG_H, rows: seedRows([
    ["6/10 21:03", "1", "相原 大輝", "", "参加", "LINE: aihara", "土曜の夜", "楽しみ！", "名簿と一致"],
    ["6/11 08:15", "2", "久保 陽菜", "田中", "参加", "kubo@example.com", "年末年始", "", "名簿と一致"],
    ["6/12 19:40", "4", "寺山 湊", "", "参加", "LINE: terada", "お盆", "", "名簿外→新規追加"],
  ], LOG_H) },
  tasks: { headers: ["ID", "カテゴリ", "タスク", "担当", "期限目安", "状態", "メモ"], rows: seedRows([
    [1, "立ち上げ", "幹事ミーティング・役割分担を決める", "よしとみ/ひろき", "D-4ヶ月", "完了", ""],
    [2, "立ち上げ", "候補日を2〜3個決める", "よしとみ", "D-4ヶ月", "進行中", ""],
    [3, "集客", "学年LINEグループ作成・告知", "ひろき", "D-4ヶ月", "未着手", ""],
    [4, "名簿", "実名簿（3年1〜7組）をシートに投入", "よしとみ", "D-3.5ヶ月", "未着手", "サンプル行を差し替え"],
    [5, "費用", "会費を決定・PayPayリンクを設定", "よしとみ", "D-2ヶ月", "未着手", ""],
    [6, "集金", "PayPay入金を照合し支払い状況を更新", "よしとみ", "D-3週〜", "未着手", ""],
  ], ["ID", "カテゴリ", "タスク", "担当", "期限目安", "状態", "メモ"]) },
  checklist: { headers: ["ID", "カテゴリ", "品目", "数量", "担当", "状態", "メモ"], rows: seedRows([
    [1, "受付", "名簿・受付チェックリスト", "1部", "よしとみ", "未手配", ""],
    [2, "受付", "釣り銭・集金袋（当日現金者用）", "1式", "よしとみ", "未手配", ""],
    [3, "演出", "当時の写真・卒業アルバム", "-", "ひろき", "未手配", ""],
    [4, "先生", "記念品・花束", "先生数分", "ひろき", "未手配", ""],
  ], ["ID", "カテゴリ", "品目", "数量", "担当", "状態", "メモ"]) },
  budget: { headers: ["ID", "区分", "項目", "予定額", "実績額", "メモ"], rows: seedRows([
    [1, "収入", "会費（PayPay・一般）", 150000, 15000, "参加人数 × 会費"],
    [2, "収入", "会費（当日現金）", 25000, 0, ""],
    [3, "支出", "会場・飲食費", 150000, 0, "@5,000 × 人数"],
    [4, "支出", "記念品・花束", 15000, 0, ""],
    [5, "支出", "予備費", 10000, 0, ""],
  ], ["ID", "区分", "項目", "予定額", "実績額", "メモ"]) },
};

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const loginView = $("loginView"), dashView = $("dashView");

// ---------- 起動 ----------
init();
function init() {
  if (!isConnected()) $("demoNote").hidden = false;
  const saved = sessionStorage.getItem("adminKey");
  if (saved && isConnected()) {
    state.key = saved;
    enterDashboard(false).catch(() => sessionStorage.removeItem("adminKey"));
  }
  bindEvents();
}

function bindEvents() {
  $("loginForm").addEventListener("submit", onLogin);
  $("demoBtn").addEventListener("click", () => enterDashboard(true));
  $("logoutBtn").addEventListener("click", logout);
  $("reloadBtn").addEventListener("click", () => enterDashboard(state.demo));
  $("settingsBtn").addEventListener("click", () => ($("settingsModal").hidden = false));
  $("settingsClose").addEventListener("click", () => ($("settingsModal").hidden = true));
  $("pwForm").addEventListener("submit", onChangePassword);
  $("tabs").addEventListener("click", (e) => {
    const btn = e.target.closest(".tab");
    if (btn) switchTab(btn.dataset.tab);
  });
  const content = document.querySelector(".content");
  content.addEventListener("change", onFieldChange);
  content.addEventListener("click", onContentClick);
  content.addEventListener("input", onSearchInput);
}

// ---------- ログイン ----------
async function onLogin(e) {
  e.preventDefault();
  const pw = $("loginPassword").value.trim();
  const status = $("loginStatus");
  status.textContent = "";
  if (!pw) { status.textContent = "パスワードを入力してください。"; return; }
  if (!isConnected()) { status.textContent = "未接続です。下の「デモを見る」で確認できます。"; return; }
  $("loginBtn").disabled = true;
  try {
    await apiCall("login", { password: pw });
    state.key = pw;
    sessionStorage.setItem("adminKey", pw);
    await enterDashboard(false);
  } catch (err) {
    status.textContent = "パスワードが違います。";
  } finally {
    $("loginBtn").disabled = false;
  }
}

function logout() {
  sessionStorage.removeItem("adminKey");
  state.key = null; state.data = null;
  dashView.hidden = true; loginView.hidden = false;
  $("loginPassword").value = "";
}

// ---------- 読み込み ----------
async function enterDashboard(demo) {
  state.demo = demo;
  if (demo) {
    state.data = JSON.parse(JSON.stringify(DEMO_DATA));
  } else {
    const res = await apiCall("getAll", { key: state.key });
    state.data = res.data;
  }
  loginView.hidden = true; dashView.hidden = false;
  const badge = $("modeBadge");
  badge.textContent = demo ? "デモ表示（未接続）" : "本番データ";
  badge.className = "badge " + (demo ? "badge--demo" : "badge--live");
  switchTab(state.activeTab);
}

function switchTab(tab) {
  state.activeTab = tab;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("is-active", t.dataset.tab === tab));
  document.querySelectorAll(".panel").forEach((p) => p.classList.remove("is-active"));
  $("panel-" + tab).classList.add("is-active");
  renderPanel(tab);
}

// ---------- レンダリング ----------
function renderPanel(tab) {
  if (tab === "roster") return renderRoster();
  if (tab === "log") return renderLog();
  if (tab === "budget") return renderBudget();
  return renderEditable(tab);
}

/** 名簿・参加状況 */
function renderRoster() {
  const rows = state.data.roster.rows;
  const cnt = (v) => rows.filter((r) => r["出欠"] === v).length;
  const attend = cnt("参加");
  const paid = rows.filter((r) => r["出欠"] === "参加" && r["支払い"] === "済").length;
  const byClass = {};
  rows.forEach((r) => { const c = String(r["組"] || "?"); (byClass[c] = byClass[c] || { t: 0, a: 0 }); byClass[c].t++; if (r["出欠"] === "参加") byClass[c].a++; });

  const chips = ["all", "1", "2", "3", "4", "5", "6", "7"].map((c) => {
    const label = c === "all" ? `全体 ${rows.length}` : `${c}組 ${byClass[c] ? byClass[c].a : 0}/${byClass[c] ? byClass[c].t : 0}`;
    return `<button class="chip${state.rosterFilter === c ? " is-active" : ""}" data-filter="${c}">${label}</button>`;
  }).join("");

  const visible = rows.filter((r) => state.rosterFilter === "all" || String(r["組"]) === state.rosterFilter);
  const cfg = TABLES.roster;
  const payPct = attend ? Math.round((paid / attend) * 100) : 0;

  $("panel-roster").innerHTML = `
    <div class="panel__head">
      <h2 class="panel__title">名簿・参加状況</h2>
      <div class="panel__actions">
        <input class="search" data-search="roster" placeholder="名前で検索" />
        <button class="btn btn--ghost" data-csv="roster">CSV書き出し</button>
      </div>
    </div>
    <div class="cards">
      <div class="card card--green"><div class="card__num">${attend}</div><div class="card__label">参加</div></div>
      <div class="card card--amber"><div class="card__num">${cnt("未定")}</div><div class="card__label">未定</div></div>
      <div class="card"><div class="card__num">${cnt("不参加")}</div><div class="card__label">不参加</div></div>
      <div class="card"><div class="card__num">${cnt("未回答")}</div><div class="card__label">未回答</div></div>
      <div class="card ${paid === attend && attend > 0 ? "card--green" : ""}"><div class="card__num">${paid}/${attend}</div><div class="card__label">支払い済み</div></div>
    </div>
    <div class="progress">
      <div class="progress__label"><span>集金の進捗（参加者のうち支払い済み）</span><span>${payPct}%</span></div>
      <div class="progress__track"><div class="progress__fill" style="width:${payPct}%"></div></div>
    </div>
    <div class="chips">${chips}</div>
    <div class="table-wrap">
      <table id="rosterTable">
        <thead><tr>${cfg.columns.map((c) => `<th${c.w ? ` style="width:${c.w}"` : ""}>${c.key}</th>`).join("")}<th></th></tr></thead>
        <tbody>${visible.map((r) => editRow("roster", cfg, r)).join("")}</tbody>
      </table>
      ${visible.length ? "" : '<p class="empty">該当する行がありません。</p>'}
    </div>
    <div class="addbar"><button class="btn btn--ghost" data-add="roster">＋ 名簿に追加</button></div>
    <p class="hint">💡 実名簿への差し替え：スプレッドシートの「名簿」タブでサンプル行を削除し、組・名前を貼り付けてください（IDは連番）。</p>`;
}

/** 受付ログ（読み取り専用） */
function renderLog() {
  const { headers, rows } = state.data.log;
  const list = [...rows].reverse();
  $("panel-log").innerHTML = `
    <div class="panel__head"><h2 class="panel__title">受付ログ（フォーム送信の履歴）</h2></div>
    <div class="table-wrap">
      <table>
        <thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
        <tbody>${list.map((r) => `<tr>${headers.map((h) => `<td>${esc(h === "受信日時" ? fmtDate(r[h]) : r[h])}</td>`).join("")}</tr>`).join("")}</tbody>
      </table>
      ${rows.length ? "" : '<p class="empty">まだ受付がありません。</p>'}
    </div>
    <p class="hint">「名簿外→新規追加」の行は、名簿タブで正しい行と統合（重複削除）してください。</p>`;
}

/** タスク・準備物 共通 */
function renderEditable(tab) {
  const cfg = TABLES[tab];
  const rows = state.data[tab].rows;
  const done = rows.filter((r) => r[cfg.statusKey] === cfg.done).length;
  const pct = rows.length ? Math.round((done / rows.length) * 100) : 0;
  $("panel-" + tab).innerHTML = `
    <div class="panel__head"><h2 class="panel__title">${cfg.label}</h2></div>
    <div class="progress">
      <div class="progress__label"><span>進捗</span><span>${done} / ${rows.length} 完了（${pct}%）</span></div>
      <div class="progress__track"><div class="progress__fill" style="width:${pct}%"></div></div>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr>${cfg.columns.map((c) => `<th${c.w ? ` style="width:${c.w}"` : ""}>${c.key}</th>`).join("")}<th></th></tr></thead>
        <tbody>${rows.map((r) => editRow(tab, cfg, r)).join("")}</tbody>
      </table>
    </div>
    <div class="addbar"><button class="btn btn--ghost" data-add="${tab}">＋ 行を追加</button></div>`;
}

/** 集金・予算 */
function renderBudget() {
  const cfg = TABLES.budget;
  const rows = state.data.budget.rows;
  const n = (v) => Number(v) || 0;
  const sum = (kind, key) => rows.filter((r) => r["区分"] === kind).reduce((s, r) => s + n(r[key]), 0);
  const planNet = sum("収入", "予定額") - sum("支出", "予定額");
  const actNet = sum("収入", "実績額") - sum("支出", "実績額");
  $("panel-budget").innerHTML = `
    <div class="panel__head"><h2 class="panel__title">${cfg.label}</h2></div>
    <div class="cards">
      <div class="card card--green"><div class="card__num">¥${fmtYen(sum("収入", "予定額"))}</div><div class="card__label">収入（予定）</div></div>
      <div class="card"><div class="card__num">¥${fmtYen(sum("支出", "予定額"))}</div><div class="card__label">支出（予定）</div></div>
      <div class="card ${planNet >= 0 ? "card--green" : "card--amber"}"><div class="card__num">¥${fmtYen(planNet)}</div><div class="card__label">収支（予定）</div></div>
      <div class="card"><div class="card__num">¥${fmtYen(actNet)}</div><div class="card__label">収支（実績）</div></div>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr>${cfg.columns.map((c) => `<th${c.w ? ` style="width:${c.w}"` : ""}>${c.key}</th>`).join("")}<th></th></tr></thead>
        <tbody>${rows.map((r) => editRow("budget", cfg, r)).join("")}</tbody>
      </table>
    </div>
    <div class="addbar"><button class="btn btn--ghost" data-add="budget">＋ 行を追加</button></div>
    <p class="hint">💡 集金の実績は名簿タブの「支払い済み」人数 × 会費 が目安になります。</p>`;
}

// ---------- 行・セル生成 ----------
function editRow(tab, cfg, r) {
  const cells = cfg.columns.map((c) => {
    const v = r[c.key] ?? "";
    return `<td${c.type === "num" ? ' class="num"' : ""}>${field(tab, c, r.ID, v)}</td>`;
  }).join("");
  const nameAttr = tab === "roster" ? ` data-name="${esc(String(r["名前"] || "") + String(r["旧姓"] || ""))}"` : "";
  return `<tr${nameAttr}>${cells}<td><button class="del-btn" data-del="${tab}" data-id="${r.ID}" title="削除">×</button></td></tr>`;
}

function field(tab, c, id, v) {
  const attrs = `data-id="${id}" data-tab="${tab}" data-key="${esc(c.key)}"`;
  if (c.type === "select") {
    const cls = c.classFor ? c.classFor(String(v)) : "";
    const opts = c.options.map((o) => `<option ${String(o) === String(v) ? "selected" : ""}>${o}</option>`).join("");
    return `<select ${attrs} class="${cls}">${opts}</select>`;
  }
  if (c.type === "num") return `<input ${attrs} type="number" value="${esc(v)}" />`;
  return `<input ${attrs} type="text" value="${esc(v)}" />`;
}

// ---------- 編集イベント ----------
async function onFieldChange(e) {
  const el = e.target;
  if (!el.dataset || el.dataset.id === undefined || !el.dataset.key) return;
  const { tab, id, key } = el.dataset;
  const value = el.value;
  const row = state.data[tab].rows.find((r) => String(r.ID) === String(id));
  if (row) row[key] = value;

  if (el.tagName === "SELECT") {
    const col = TABLES[tab].columns.find((c) => c.key === key);
    if (col && col.classFor) el.className = col.classFor(value);
  }
  if (tab === "roster" && (key === "出欠" || key === "支払い" || key === "組")) renderRoster();
  if (tab === "budget" && (key === "予定額" || key === "実績額" || key === "区分")) renderBudget();
  if (TABLES[tab] && TABLES[tab].statusKey === key) refreshProgress(tab);

  await persist("updateRow", { tab, id: Number(id), values: { [key]: value } });
}

async function onContentClick(e) {
  const add = e.target.closest("[data-add]");
  if (add) return addRow(add.dataset.add);
  const del = e.target.closest("[data-del]");
  if (del) return deleteRow(del.dataset.del, del.dataset.id);
  const csv = e.target.closest("[data-csv]");
  if (csv) return exportCsv();
  const chip = e.target.closest("[data-filter]");
  if (chip) { state.rosterFilter = chip.dataset.filter; renderRoster(); }
}

function onSearchInput(e) {
  const s = e.target.closest("[data-search]");
  if (!s) return;
  const q = s.value.trim().toLowerCase().replace(/[\s　]/g, "");
  document.querySelectorAll("#rosterTable tbody tr").forEach((tr) => {
    tr.style.display = (tr.dataset.name || "").toLowerCase().replace(/[\s　]/g, "").includes(q) ? "" : "none";
  });
}

async function addRow(tab) {
  const cfg = TABLES[tab];
  const id = state.data[tab].rows.reduce((m, r) => Math.max(m, Number(r.ID) || 0), 0) + 1;
  state.data[tab].rows.push({ _row: 0, ID: id, ...JSON.parse(JSON.stringify(cfg.addDefault)) });
  renderPanel(tab);
  await persist("addRow", { tab, values: { ID: id, ...cfg.addDefault } });
}

async function deleteRow(tab, id) {
  if (!confirm("この行を削除しますか？")) return;
  state.data[tab].rows = state.data[tab].rows.filter((r) => String(r.ID) !== String(id));
  renderPanel(tab);
  await persist("deleteRow", { tab, id: Number(id) });
}

async function persist(action, payload) {
  if (state.demo) return;
  try {
    await apiCall(action, { key: state.key, ...payload });
  } catch (err) {
    alert("保存に失敗しました：" + err.message + "\n再読込してやり直してください。");
  }
}

// ---------- 部分更新 ----------
function refreshProgress(tab) {
  const cfg = TABLES[tab];
  const rows = state.data[tab].rows;
  const done = rows.filter((r) => r[cfg.statusKey] === cfg.done).length;
  const pct = rows.length ? Math.round((done / rows.length) * 100) : 0;
  const panel = $("panel-" + tab);
  const label = panel.querySelector(".progress__label span:last-child");
  if (label) label.textContent = `${done} / ${rows.length} 完了（${pct}%）`;
  const fill = panel.querySelector(".progress__fill");
  if (fill) fill.style.width = pct + "%";
}

// ---------- パスワード変更 ----------
async function onChangePassword(e) {
  e.preventDefault();
  const a = $("newPassword").value.trim(), b = $("newPassword2").value.trim();
  const status = $("pwStatus");
  status.className = "modal__status";
  if (a.length < 4) { status.textContent = "4文字以上にしてください。"; status.classList.add("is-error"); return; }
  if (a !== b) { status.textContent = "確認用と一致しません。"; status.classList.add("is-error"); return; }
  if (state.demo) { status.textContent = "デモ表示では変更できません（接続後に可能）。"; status.classList.add("is-error"); return; }
  try {
    await apiCall("changePassword", { key: state.key, newPassword: a });
    state.key = a;
    sessionStorage.setItem("adminKey", a);
    status.textContent = "変更しました。"; status.classList.add("is-success");
    $("newPassword").value = ""; $("newPassword2").value = "";
  } catch (err) {
    status.textContent = "失敗：" + err.message; status.classList.add("is-error");
  }
}

// ---------- CSV（名簿） ----------
function exportCsv() {
  const { headers, rows } = state.data.roster;
  const lines = [headers.join(",")];
  rows.forEach((r) => lines.push(headers.map((h) => csvCell(r[h])).join(",")));
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "同窓会_名簿.csv";
  a.click();
  URL.revokeObjectURL(url);
}
function csvCell(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ---------- ユーティリティ ----------
function esc(v) {
  return String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function fmtYen(n) { return (Number(n) || 0).toLocaleString("ja-JP"); }
function fmtDate(v) {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d)) return String(v);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
