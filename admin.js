/* ============================================================
 * 武雄高校 同窓会 幹事ダッシュボード
 * config.js（APP_CONFIG / apiCall / isConnected）を先に読み込むこと
 * ============================================================ */

// ---------- 状態 ----------
const state = {
  key: null,        // 管理パスワード（= APIキー）
  demo: false,      // バックエンド未接続のデモ表示
  data: null,       // { rsvp, tasks, checklist, budget } 各 {headers, rows}
  activeTab: "rsvp",
};

// ---------- 編集可能タブの定義 ----------
const TABLES = {
  tasks: {
    label: "スケジュール / タスク",
    columns: [
      { key: "カテゴリ", type: "text", w: "92px" },
      { key: "タスク", type: "text" },
      { key: "担当", type: "text", w: "120px" },
      { key: "期限目安", type: "text", w: "92px" },
      { key: "状態", type: "status", options: ["未着手", "進行中", "完了"], w: "108px" },
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
      { key: "状態", type: "status", options: ["未手配", "手配中", "完了"], w: "104px" },
      { key: "メモ", type: "text" },
    ],
    statusKey: "状態", done: "完了",
    addDefault: { カテゴリ: "その他", 品目: "", 数量: "", 担当: "", 状態: "未手配", メモ: "" },
  },
  budget: {
    label: "集金・予算",
    columns: [
      { key: "区分", type: "kind", options: ["収入", "支出"], w: "84px" },
      { key: "項目", type: "text" },
      { key: "予定額", type: "num", w: "110px" },
      { key: "実績額", type: "num", w: "110px" },
      { key: "メモ", type: "text" },
    ],
    addDefault: { 区分: "支出", 項目: "", 予定額: 0, 実績額: 0, メモ: "" },
  },
};

// ---------- デモ用データ ----------
const DEMO_DATA = {
  rsvp: {
    headers: ["受信日時", "お名前", "旧姓", "クラス・部活", "出欠", "連絡先", "希望の曜日・時期", "メッセージ"],
    rows: [
      { _row: 2, 受信日時: "2026-06-01 21:03", お名前: "武雄 太郎", 旧姓: "", "クラス・部活": "3年2組/野球部", 出欠: "参加", 連絡先: "LINE: takeo_taro", "希望の曜日・時期": "土曜の夜", メッセージ: "楽しみ！" },
      { _row: 3, 受信日時: "2026-06-02 08:15", お名前: "佐賀 花子", 旧姓: "唐津", "クラス・部活": "3年1組/吹奏楽", 出欠: "未定", 連絡先: "hanako@example.com", "希望の曜日・時期": "年末年始", メッセージ: "日程次第で参加したいです" },
      { _row: 4, 受信日時: "2026-06-02 19:40", お名前: "山田 健", 旧姓: "", "クラス・部活": "3年4組/サッカー部", 出欠: "参加", 連絡先: "090-xxxx-xxxx", "希望の曜日・時期": "お盆", メッセージ: "" },
    ],
  },
  tasks: { headers: ["ID", "カテゴリ", "タスク", "担当", "期限目安", "状態", "メモ"], rows: seedRows([
    [1, "立ち上げ", "幹事ミーティング・役割分担を決める", "よしとみ/ひろき", "D-4ヶ月", "完了", ""],
    [2, "立ち上げ", "候補日を2〜3個決める", "よしとみ", "D-4ヶ月", "進行中", "出欠フォームで投票"],
    [3, "集客", "学年LINEグループ作成・告知", "ひろき", "D-4ヶ月", "未着手", ""],
    [4, "集客", "先生方の連絡先を集める", "ひろき", "D-3.5ヶ月", "未着手", ""],
    [5, "日程", "出欠フォームで日程投票→確定", "よしとみ", "D-3ヶ月", "未着手", ""],
    [6, "会場", "候補店をリストアップ（30〜50名）", "よしとみ", "D-3ヶ月", "未着手", "武雄市内"],
    [7, "費用", "会費を決定する", "よしとみ", "D-2ヶ月", "未着手", "先生分の扱いも"],
    [8, "会場", "会場を仮予約", "よしとみ", "D-2ヶ月", "未着手", ""],
    [9, "先生", "先生方へ正式に案内・オファー", "ひろき", "D-2ヶ月", "未着手", ""],
    [10, "出欠", "出欠を締切り、人数を確定", "よしとみ", "D-1ヶ月", "未着手", ""],
    [11, "会場", "会場を本予約・席次を決める", "よしとみ", "D-3週", "未着手", ""],
    [12, "集金", "集金を開始", "よしとみ", "D-3週", "未着手", ""],
    [13, "当日", "進行表・名簿・受付準備", "よしとみ", "D-1週", "未着手", ""],
    [14, "当日", "参加者へリマインド連絡", "ひろき", "D-3日", "未着手", ""],
    [15, "事後", "写真共有・お礼・会計報告", "よしとみ", "D+1週", "未着手", ""],
  ], ["ID", "カテゴリ", "タスク", "担当", "期限目安", "状態", "メモ"]) },
  checklist: { headers: ["ID", "カテゴリ", "品目", "数量", "担当", "状態", "メモ"], rows: seedRows([
    [1, "受付", "名簿・受付チェックリスト", "1部", "よしとみ", "未手配", ""],
    [2, "受付", "釣り銭・集金袋", "1式", "よしとみ", "未手配", ""],
    [3, "受付", "名札・油性ペン", "人数分", "よしとみ", "未手配", ""],
    [4, "受付", "領収書・電卓", "1式", "よしとみ", "未手配", ""],
    [5, "進行", "進行表・台本", "数部", "よしとみ", "未手配", ""],
    [6, "進行", "マイク・音響（会場備品を確認）", "-", "よしとみ", "未手配", ""],
    [7, "演出", "当時の写真・卒業アルバム", "-", "ひろき", "未手配", ""],
    [8, "演出", "スライド/プロジェクター（要確認）", "1式", "よしとみ", "未手配", ""],
    [9, "演出", "BGMプレイリスト", "1式", "ひろき", "未手配", ""],
    [10, "記念", "集合写真用カメラ・三脚", "1式", "ひろき", "未手配", ""],
    [11, "先生", "記念品・花束", "先生数分", "ひろき", "未手配", ""],
    [12, "二次会", "二次会の店の目処", "1件", "ひろき", "未手配", ""],
    [13, "装飾", "横断幕・装飾（任意）", "一式", "-", "未手配", ""],
  ], ["ID", "カテゴリ", "品目", "数量", "担当", "状態", "メモ"]) },
  budget: { headers: ["ID", "区分", "項目", "予定額", "実績額", "メモ"], rows: seedRows([
    [1, "収入", "会費（一般）", 0, 0, "参加人数 × 会費"],
    [2, "収入", "会費（先生）", 0, 0, "招待 or 割引"],
    [3, "支出", "会場・飲食費", 0, 0, "@5,000 × 人数 を想定"],
    [4, "支出", "先生招待分の補助", 0, 0, ""],
    [5, "支出", "記念品・花束", 0, 0, ""],
    [6, "支出", "装飾・備品", 0, 0, ""],
    [7, "支出", "予備費", 0, 0, ""],
  ], ["ID", "区分", "項目", "予定額", "実績額", "メモ"]) },
};
function seedRows(arr, headers) {
  return arr.map((r, i) => {
    const o = { _row: i + 2 };
    headers.forEach((h, j) => (o[h] = r[j]));
    return o;
  });
}

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const loginView = $("loginView"), dashView = $("dashView");

// ---------- 起動 ----------
init();
function init() {
  if (!isConnected()) {
    $("demoNote").hidden = false;
  }
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

  // テーブルのインライン編集・追加・削除（イベント委譲）
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
    status.textContent = err.message === "ENDPOINT_NOT_SET" ? "未接続です。" : "パスワードが違います。";
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

// ---------- ダッシュボード読み込み ----------
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
  if (tab === "rsvp") return renderRsvp();
  if (tab === "budget") return renderBudget();
  return renderEditable(tab);
}

function renderRsvp() {
  const { rows } = state.data.rsvp;
  const count = (v) => rows.filter((r) => r["出欠"] === v).length;
  const sum = { 参加: count("参加"), 未定: count("未定"), 不参加: count("不参加") };
  const panel = $("panel-rsvp");
  panel.innerHTML = `
    <div class="panel__head">
      <h2 class="panel__title">出欠一覧・集計</h2>
      <div class="panel__actions">
        <input class="search" data-search="rsvp" placeholder="名前・連絡先で検索" />
        <button class="btn btn--ghost" data-csv="1">CSV書き出し</button>
      </div>
    </div>
    <div class="cards">
      <div class="card card--green"><div class="card__num">${sum.参加}</div><div class="card__label">参加</div></div>
      <div class="card card--amber"><div class="card__num">${sum.未定}</div><div class="card__label">日程次第</div></div>
      <div class="card"><div class="card__num">${sum.不参加}</div><div class="card__label">不参加</div></div>
      <div class="card"><div class="card__num">${rows.length}</div><div class="card__label">回答総数</div></div>
    </div>
    <div class="table-wrap">
      <table id="rsvpTable">
        <thead><tr>
          <th>受信</th><th>お名前</th><th>旧姓</th><th>クラス・部活</th><th>出欠</th><th>連絡先</th><th>希望時期</th><th>メッセージ</th>
        </tr></thead>
        <tbody>${rows.length ? rows.map(rsvpRow).join("") : ""}</tbody>
      </table>
      ${rows.length ? "" : '<p class="empty">まだ回答がありません。</p>'}
    </div>`;
}
function rsvpRow(r) {
  const at = r["出欠"];
  const cls = at === "参加" ? "kind-in" : at === "不参加" ? "kind-out" : "";
  return `<tr data-name="${esc(r["お名前"])} ${esc(r["連絡先"])}">
    <td>${esc(fmtDate(r["受信日時"]))}</td><td>${esc(r["お名前"])}</td><td>${esc(r["旧姓"])}</td>
    <td>${esc(r["クラス・部活"])}</td>
    <td><span class="cat-chip ${cls}">${esc(at)}</span></td>
    <td>${esc(r["連絡先"])}</td><td>${esc(r["希望の曜日・時期"])}</td><td>${esc(r["メッセージ"])}</td>
  </tr>`;
}

function renderEditable(tab) {
  const cfg = TABLES[tab];
  const { rows } = state.data[tab];
  const panel = $("panel-" + tab);
  const done = rows.filter((r) => r[cfg.statusKey] === cfg.done).length;
  const pct = rows.length ? Math.round((done / rows.length) * 100) : 0;
  panel.innerHTML = `
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

function editRow(tab, cfg, r) {
  const cells = cfg.columns.map((c) => {
    const v = r[c.key] ?? "";
    return `<td${c.type === "num" ? ' class="num"' : ""}>${field(tab, c, r.ID, v)}</td>`;
  }).join("");
  return `<tr>${cells}<td><button class="del-btn" data-del="${tab}" data-id="${r.ID}" title="削除">×</button></td></tr>`;
}

function field(tab, c, id, v) {
  const attrs = `data-id="${id}" data-tab="${tab}" data-key="${esc(c.key)}"`;
  if (c.type === "status") {
    return `<select ${attrs} class="${statusClass(c.options, v)}">${optionList(c.options, v)}</select>`;
  }
  if (c.type === "kind") {
    return `<select ${attrs} class="${v === "収入" ? "kind-in" : "kind-out"}">${optionList(c.options, v)}</select>`;
  }
  if (c.type === "num") {
    return `<input ${attrs} type="number" value="${esc(v)}" />`;
  }
  return `<input ${attrs} type="text" value="${esc(v)}" />`;
}

function renderBudget() {
  renderEditable("budget");
  const rows = state.data.budget.rows;
  const n = (v) => Number(v) || 0;
  const income = rows.filter((r) => r["区分"] === "収入");
  const expense = rows.filter((r) => r["区分"] === "支出");
  const sumP = (a) => a.reduce((s, r) => s + n(r["予定額"]), 0);
  const sumA = (a) => a.reduce((s, r) => s + n(r["実績額"]), 0);
  const cards = `
    <div class="cards">
      <div class="card card--green"><div class="card__num">¥${fmtYen(sumP(income))}</div><div class="card__label">収入（予定）</div></div>
      <div class="card"><div class="card__num">¥${fmtYen(sumP(expense))}</div><div class="card__label">支出（予定）</div></div>
      <div class="card ${sumP(income) - sumP(expense) >= 0 ? "card--green" : "card--amber"}"><div class="card__num">¥${fmtYen(sumP(income) - sumP(expense))}</div><div class="card__label">収支（予定）</div></div>
      <div class="card"><div class="card__num">¥${fmtYen(sumA(income) - sumA(expense))}</div><div class="card__label">収支（実績）</div></div>
    </div>`;
  const head = $("panel-budget").querySelector(".panel__head");
  head.insertAdjacentHTML("afterend", cards);
}

// ---------- 編集イベント ----------
async function onFieldChange(e) {
  const el = e.target;
  if (!el.dataset || el.dataset.id === undefined || !el.dataset.key) return;
  const { tab, id, key } = el.dataset;
  const value = el.value;
  const row = state.data[tab].rows.find((r) => String(r.ID) === String(id));
  if (row) row[key] = value;

  // 見た目の即時反映
  if (el.tagName === "SELECT") {
    const cfg = TABLES[tab];
    if (key === "区分") el.className = value === "収入" ? "kind-in" : "kind-out";
    else if (cfg) el.className = statusClass(cfg.columns.find((c) => c.key === key).options, value);
  }
  if (tab === "budget") refreshBudgetSummary();
  if (tab !== "budget" && TABLES[tab].statusKey === key) refreshProgress(tab);

  await persist("updateRow", { tab, id: Number(id), values: { [key]: value } });
}

async function onContentClick(e) {
  const add = e.target.closest("[data-add]");
  if (add) return addRow(add.dataset.add);
  const del = e.target.closest("[data-del]");
  if (del) return deleteRow(del.dataset.del, del.dataset.id);
  const csv = e.target.closest("[data-csv]");
  if (csv) return exportCsv();
}

function onSearchInput(e) {
  const s = e.target.closest("[data-search]");
  if (!s) return;
  const q = s.value.trim().toLowerCase();
  document.querySelectorAll("#rsvpTable tbody tr").forEach((tr) => {
    tr.style.display = (tr.dataset.name || "").toLowerCase().includes(q) ? "" : "none";
  });
}

async function addRow(tab) {
  const cfg = TABLES[tab];
  const id = nextLocalId(tab);
  const row = { _row: 0, ID: id, ...JSON.parse(JSON.stringify(cfg.addDefault)) };
  state.data[tab].rows.push(row);
  renderPanel(tab);
  await persist("addRow", { tab, values: { ID: id, ...cfg.addDefault } });
}

async function deleteRow(tab, id) {
  if (!confirm("この行を削除しますか？")) return;
  state.data[tab].rows = state.data[tab].rows.filter((r) => String(r.ID) !== String(id));
  renderPanel(tab);
  await persist("deleteRow", { tab, id: Number(id) });
}

/** バックエンドへ反映（デモ時は何もしない） */
async function persist(action, payload) {
  if (state.demo) return;
  try {
    await apiCall(action, { key: state.key, ...payload });
  } catch (err) {
    alert("保存に失敗しました：" + err.message + "\n再読込してやり直してください。");
  }
}

function nextLocalId(tab) {
  return state.data[tab].rows.reduce((m, r) => Math.max(m, Number(r.ID) || 0), 0) + 1;
}

// ---------- 軽量更新（テーブルを作り直さず一部だけ） ----------
function refreshProgress(tab) {
  const cfg = TABLES[tab];
  const rows = state.data[tab].rows;
  const done = rows.filter((r) => r[cfg.statusKey] === cfg.done).length;
  const pct = rows.length ? Math.round((done / rows.length) * 100) : 0;
  const panel = $("panel-" + tab);
  panel.querySelector(".progress__label span:last-child").textContent = `${done} / ${rows.length} 完了（${pct}%）`;
  panel.querySelector(".progress__fill").style.width = pct + "%";
}
function refreshBudgetSummary() {
  const panel = $("panel-budget");
  const cards = panel.querySelector(".cards");
  if (cards) cards.remove();
  renderBudget(); // 再描画で更新（フォーカスは数値確定後なので許容）
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

// ---------- CSV ----------
function exportCsv() {
  const { headers, rows } = state.data.rsvp;
  const cols = headers;
  const lines = [cols.join(",")];
  rows.forEach((r) => lines.push(cols.map((h) => csvCell(r[h])).join(",")));
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "同窓会_出欠.csv";
  a.click();
  URL.revokeObjectURL(url);
}
function csvCell(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ---------- ユーティリティ ----------
function optionList(options, v) {
  return options.map((o) => `<option ${o === v ? "selected" : ""}>${o}</option>`).join("");
}
function statusClass(options, v) {
  if (v === options[options.length - 1]) return "st-done";
  if (v === options[0]) return "st-todo";
  return "st-prog";
}
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
