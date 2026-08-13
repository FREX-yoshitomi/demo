/**
 * 武雄高校 同窓会 バックエンド v2（Google Apps Script）
 * ------------------------------------------------------------------
 * 【v2の設計】受付は「名簿連動型」
 *   - 名簿（3年1組〜7組）を軸に、受付フォームの回答を自動照合して出欠を更新
 *   - 支払い（PayPay）状況も名簿で一人ごとに管理
 *   - トップページ用に、参加人数の集計を公開APIで返す（個人名は返さない）
 *
 * 【貼り替え後は必ず】デプロイ → デプロイを管理 → 編集（鉛筆）→
 * 「新バージョン」を選んでデプロイ。URLは変わりません。
 */

const TAB = {
  roster: "名簿",
  log: "受付ログ",
  tasks: "タスク",
  checklist: "準備物",
  budget: "予算",
};

/** 管理パスワードの初期値（必ず管理画面から変更してください） */
const DEFAULT_ADMIN_PASSWORD = "takeo-kanji";

// ====================== エントリポイント ======================

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || "";
  if (action === "stats") return stats_();
  return json_({ result: "ok", message: "武雄高校 同窓会 backend v2 is running." });
}

function doPost(e) {
  try {
    const body = e && e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {};
    switch (body.action || "") {
      // --- 一般 ---
      case "rsvp":           return submitRsvp_(body);
      // --- 認証・PW管理 ---
      case "login":          return login_(body);
      case "changePassword": return changePassword_(body);
      // --- 管理データ ---
      case "getAll":         requireAdmin_(body); return getAll_();
      case "addRow":         requireAdmin_(body); return addRow_(body);
      case "updateRow":      requireAdmin_(body); return updateRow_(body);
      case "deleteRow":      requireAdmin_(body); return deleteRow_(body);
      default:
        return json_({ result: "error", message: "unknown action" });
    }
  } catch (err) {
    return json_({ result: "error", message: String(err && err.message ? err.message : err) });
  }
}

// ====================== 公開：参加人数の集計 ======================

function stats_() {
  const rows = readTab_(TAB.roster).rows;
  const byClass = {};
  let total = 0, pending = 0;
  rows.forEach((r) => {
    const c = String(r["組"] || "");
    if (r["出欠"] === "参加") { total++; byClass[c] = (byClass[c] || 0) + 1; }
    else if (r["出欠"] === "未定") pending++;
  });
  return json_({ result: "success", total: total, pending: pending, byClass: byClass, updatedAt: new Date() });
}

// ====================== 一般：受付（名簿と自動照合） ======================

function norm_(s) { return String(s || "").replace(/[\s　]/g, ""); }

function submitRsvp_(b) {
  const sheet = getSheet_(TAB.roster);
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(String);
  const col = (n) => headers.indexOf(n);
  const target = norm_(b.name);
  const now = new Date();

  let rowIndex = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][col("組")]) === String(b.cls) && norm_(data[i][col("名前")]) === target) {
      rowIndex = i; break;
    }
  }

  let matched = true;
  if (rowIndex >= 0) {
    const r = rowIndex + 1;
    sheet.getRange(r, col("出欠") + 1).setValue(b.attendance || "");
    if (b.contact) sheet.getRange(r, col("連絡先") + 1).setValue(b.contact);
    if (b.oldName) sheet.getRange(r, col("旧姓") + 1).setValue(b.oldName);
    sheet.getRange(r, col("更新日時") + 1).setValue(now);
  } else {
    // 名簿に見つからない → 名簿外として追加（幹事があとで照合）
    matched = false;
    sheet.appendRow([nextId_(sheet), b.cls || "", b.name || "", b.oldName || "",
      b.attendance || "", "未", b.contact || "", "フォームから新規（名簿外）", now]);
  }

  getSheet_(TAB.log).appendRow([now, b.cls || "", b.name || "", b.oldName || "",
    b.attendance || "", b.contact || "", b.dates || "", b.message || "",
    matched ? "名簿と一致" : "名簿外→新規追加"]);

  return json_({ result: "success", matched: matched });
}

// ====================== 認証・パスワード管理 ======================

function adminPassword_() {
  const props = PropertiesService.getScriptProperties();
  let p = props.getProperty("ADMIN_PASSWORD");
  if (!p) { p = DEFAULT_ADMIN_PASSWORD; props.setProperty("ADMIN_PASSWORD", p); }
  return p;
}

function requireAdmin_(b) {
  if (String(b.key || "") !== adminPassword_()) throw new Error("認証エラー：管理キーが正しくありません");
}

function login_(b) {
  if (String(b.password || "") !== adminPassword_()) return json_({ result: "error", message: "パスワードが違います" });
  return json_({ result: "success", ok: true });
}

function changePassword_(b) {
  requireAdmin_(b);
  const next = String(b.newPassword || "").trim();
  if (next.length < 4) throw new Error("新しいパスワードは4文字以上にしてください");
  PropertiesService.getScriptProperties().setProperty("ADMIN_PASSWORD", next);
  return json_({ result: "success" });
}

// ====================== 管理：データ取得・編集 ======================

function getAll_() {
  return json_({
    result: "success",
    data: {
      roster: readTab_(TAB.roster),
      log: readTab_(TAB.log),
      tasks: readTab_(TAB.tasks),
      checklist: readTab_(TAB.checklist),
      budget: readTab_(TAB.budget),
    },
  });
}

function readTab_(name) {
  const sheet = getSheet_(name);
  const values = sheet.getDataRange().getValues();
  if (values.length === 0) return { headers: [], rows: [] };
  const headers = values[0].map(String);
  const rows = values.slice(1).map((r, i) => {
    const o = { _row: i + 2 };
    headers.forEach((h, j) => (o[h] = r[j]));
    return o;
  });
  return { headers, rows };
}

function editableSheet_(tabKey) {
  const map = { roster: TAB.roster, tasks: TAB.tasks, checklist: TAB.checklist, budget: TAB.budget };
  const name = map[tabKey];
  if (!name) throw new Error("編集できないタブです: " + tabKey);
  return getSheet_(name);
}

function addRow_(b) {
  const sheet = editableSheet_(b.tab);
  const headers = sheet.getDataRange().getValues()[0].map(String);
  const values = b.values || {};
  if (headers[0] === "ID" && !values.ID) values.ID = nextId_(sheet);
  sheet.appendRow(headers.map((h) => (values[h] !== undefined ? values[h] : "")));
  return json_({ result: "success", id: values.ID });
}

function updateRow_(b) {
  const sheet = editableSheet_(b.tab);
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(String);
  const target = findRowById_(data, headers.indexOf("ID"), b.id);
  if (target < 0) throw new Error("対象が見つかりません: ID=" + b.id);
  const values = b.values || {};
  headers.forEach((h, j) => {
    if (values[h] !== undefined) sheet.getRange(target + 1, j + 1).setValue(values[h]);
  });
  return json_({ result: "success" });
}

function deleteRow_(b) {
  const sheet = editableSheet_(b.tab);
  const data = sheet.getDataRange().getValues();
  const target = findRowById_(data, data[0].map(String).indexOf("ID"), b.id);
  if (target < 0) throw new Error("対象が見つかりません: ID=" + b.id);
  sheet.deleteRow(target + 1);
  return json_({ result: "success" });
}

function findRowById_(data, idCol, id) {
  if (idCol < 0) return -1;
  for (let i = 1; i < data.length; i++) if (String(data[i][idCol]) === String(id)) return i;
  return -1;
}

function nextId_(sheet) {
  const data = sheet.getDataRange().getValues();
  let max = 0;
  for (let i = 1; i < data.length; i++) {
    const n = parseInt(data[i][0], 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return max + 1;
}

// ====================== シート生成＋テンプレ投入 ======================

function getSheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (sheet) return sheet;
  sheet = ss.insertSheet(name);
  const def = SHEET_DEFS[name];
  sheet.appendRow(def.headers);
  sheet.getRange(1, 1, 1, def.headers.length).setFontWeight("bold");
  sheet.setFrozenRows(1);
  (def.seed || []).forEach((row) => sheet.appendRow(row));
  return sheet;
}

/** 名簿のサンプル（実名簿に差し替えるまでの仮データ。メモ=サンプル） */
const SAMPLE_ROSTER = (function () {
  const names = {
    "1": ["相原 大輝", "石井 さくら", "上田 健太", "江口 美月", "大野 翔", "岡本 結衣", "梶原 亮", "川口 真央"],
    "2": ["木村 拓海", "久保 陽菜", "小島 悠斗", "近藤 芽依", "斎藤 蓮", "坂本 心春", "佐々木 颯", "島田 莉子"],
    "3": ["白石 大和", "杉本 花音", "瀬戸 隼人", "高橋 美桜", "田口 陽向", "田村 柚希", "辻 悠真", "堤 千夏"],
    "4": ["寺田 湊", "中井 咲良", "中村 樹", "西田 琴音", "野口 陸斗", "橋本 楓", "浜田 光", "原田 澪"],
    "5": ["東 剛志", "平田 菜々", "福田 岳", "藤井 綾乃", "古川 渉", "堀 美羽", "前田 空", "松尾 里奈"],
    "6": ["三浦 洋平", "宮崎 杏", "村上 昴", "森 千尋", "安田 慶", "山内 遥", "山本 大地", "吉田 詩織"],
    "7": ["和田 潤", "渡辺 澄香", "井上 楽", "内田 このみ", "遠藤 迅", "小川 真帆", "金子 到", "岸本 凛"],
  };
  const rows = [];
  let id = 1;
  Object.keys(names).forEach((cls) => {
    names[cls].forEach((n) => rows.push([id++, cls, n, "", "未回答", "未", "", "サンプル", ""]));
  });
  return rows;
})();

const SHEET_DEFS = {
  [TAB.roster]: {
    headers: ["ID", "組", "名前", "旧姓", "出欠", "支払い", "連絡先", "メモ", "更新日時"],
    seed: SAMPLE_ROSTER,
  },
  [TAB.log]: {
    headers: ["受信日時", "組", "名前", "旧姓", "出欠", "連絡先", "希望の曜日・時期", "メッセージ", "照合"],
    seed: [],
  },
  [TAB.tasks]: {
    headers: ["ID", "カテゴリ", "タスク", "担当", "期限目安", "状態", "メモ"],
    seed: [
      [1,  "立ち上げ", "幹事ミーティング・役割分担を決める", "よしとみ/ひろき", "D-4ヶ月", "完了", ""],
      [2,  "立ち上げ", "候補日を2〜3個決める",            "よしとみ",       "D-4ヶ月", "進行中", "受付フォームで希望を集約"],
      [3,  "集客",     "学年LINEグループ作成・告知",        "ひろき",         "D-4ヶ月", "未着手", ""],
      [4,  "集客",     "先生方の連絡先を集める",            "ひろき",         "D-3.5ヶ月", "未着手", ""],
      [5,  "名簿",     "実名簿（3年1〜7組）をシートに投入",  "よしとみ",       "D-3.5ヶ月", "未着手", "サンプル行を差し替え"],
      [6,  "日程",     "希望を集計して日程を確定",           "よしとみ",       "D-3ヶ月", "未着手", ""],
      [7,  "会場",     "候補店をリストアップ（30〜50名）",   "よしとみ",       "D-3ヶ月", "未着手", "武雄市内"],
      [8,  "費用",     "会費を決定・PayPayリンクを設定",     "よしとみ",       "D-2ヶ月", "未着手", "config.js に設定"],
      [9,  "会場",     "会場を仮予約",                      "よしとみ",       "D-2ヶ月", "未着手", ""],
      [10, "先生",     "先生方へ正式に案内・オファー",       "ひろき",         "D-2ヶ月", "未着手", ""],
      [11, "出欠",     "受付を締切り、人数を確定",           "よしとみ",       "D-1ヶ月", "未着手", ""],
      [12, "会場",     "会場を本予約・席次を決める",         "よしとみ",       "D-3週",  "未着手", ""],
      [13, "集金",     "PayPay入金を照合し支払い状況を更新",  "よしとみ",       "D-3週〜", "未着手", "名簿タブでチェック"],
      [14, "当日",     "進行表・名簿・受付準備",            "よしとみ",       "D-1週",  "未着手", ""],
      [15, "当日",     "参加者へリマインド連絡",            "ひろき",         "D-3日",  "未着手", ""],
      [16, "事後",     "写真共有・お礼・会計報告",          "よしとみ",       "D+1週",  "未着手", ""],
    ],
  },
  [TAB.checklist]: {
    headers: ["ID", "カテゴリ", "品目", "数量", "担当", "状態", "メモ"],
    seed: [
      [1,  "受付", "名簿・受付チェックリスト",        "1部",   "よしとみ", "未手配", "名簿タブをCSV出力して印刷"],
      [2,  "受付", "釣り銭・集金袋（当日現金者用）",   "1式",   "よしとみ", "未手配", ""],
      [3,  "受付", "名札・油性ペン",                 "人数分", "よしとみ", "未手配", ""],
      [4,  "受付", "領収書・電卓",                   "1式",   "よしとみ", "未手配", ""],
      [5,  "進行", "進行表・台本",                   "数部",  "よしとみ", "未手配", ""],
      [6,  "進行", "マイク・音響（会場備品を確認）",  "-",     "よしとみ", "未手配", ""],
      [7,  "演出", "当時の写真・卒業アルバム",        "-",     "ひろき",   "未手配", ""],
      [8,  "演出", "スライド/プロジェクター（要確認）","1式",   "よしとみ", "未手配", ""],
      [9,  "演出", "BGMプレイリスト",                "1式",   "ひろき",   "未手配", ""],
      [10, "記念", "集合写真用カメラ・三脚",          "1式",   "ひろき",   "未手配", ""],
      [11, "先生", "記念品・花束",                   "先生数分", "ひろき", "未手配", ""],
      [12, "二次会", "二次会の店の目処",              "1件",   "ひろき",   "未手配", ""],
    ],
  },
  [TAB.budget]: {
    headers: ["ID", "区分", "項目", "予定額", "実績額", "メモ"],
    seed: [
      [1, "収入", "会費（PayPay・一般）", 0, 0, "参加人数 × 会費"],
      [2, "収入", "会費（当日現金）",     0, 0, ""],
      [3, "収入", "会費（先生）",         0, 0, "招待 or 割引"],
      [4, "支出", "会場・飲食費",         0, 0, "@5,000 × 人数 を想定"],
      [5, "支出", "先生招待分の補助",     0, 0, ""],
      [6, "支出", "記念品・花束",         0, 0, ""],
      [7, "支出", "装飾・備品",           0, 0, ""],
      [8, "支出", "予備費",               0, 0, ""],
    ],
  },
};

// ====================== ユーティリティ ======================

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
