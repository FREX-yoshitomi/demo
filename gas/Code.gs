/**
 * 武雄高校 同窓会 バックエンド（Google Apps Script）
 * ------------------------------------------------------------------
 * 1つのウェブアプリで以下を担当：
 *   - 一般：出欠フォームの受付（rsvp）
 *   - 管理：ログイン認証 / パスワード変更 / 各データの取得・追加・更新・削除
 *
 * データはスプレッドシートの各タブに保存。初回はタスク・準備物・予算の
 * 標準テンプレを自動投入します（「これがあれば実施できる」状態）。
 *
 * セットアップ手順は README.md を参照。
 */

/** タブ名 */
const TAB = {
  rsvp: "出欠回答",
  tasks: "タスク",
  checklist: "準備物",
  budget: "予算",
};

/** 管理パスワードの初期値（必ず管理画面から変更してください） */
const DEFAULT_ADMIN_PASSWORD = "takeo-kanji";

// ====================== エントリポイント ======================

function doGet() {
  return json_({ result: "ok", message: "武雄高校 同窓会 backend is running." });
}

function doPost(e) {
  try {
    const body = e && e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {};
    const action = body.action || "";

    switch (action) {
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
        return json_({ result: "error", message: "unknown action: " + action });
    }
  } catch (err) {
    return json_({ result: "error", message: String(err && err.message ? err.message : err) });
  }
}

// ====================== 一般：出欠 ======================

function submitRsvp_(b) {
  const sheet = getSheet_(TAB.rsvp);
  sheet.appendRow([
    new Date(),
    b.name || "",
    b.oldName || "",
    b.grade || "",
    b.attendance || "",
    b.contact || "",
    b.dates || "",
    b.message || "",
  ]);
  return json_({ result: "success" });
}

// ====================== 認証・パスワード管理 ======================

function adminPassword_() {
  const props = PropertiesService.getScriptProperties();
  let p = props.getProperty("ADMIN_PASSWORD");
  if (!p) {
    p = DEFAULT_ADMIN_PASSWORD;
    props.setProperty("ADMIN_PASSWORD", p);
  }
  return p;
}

function requireAdmin_(b) {
  if (String(b.key || "") !== adminPassword_()) {
    throw new Error("認証エラー：管理キーが正しくありません");
  }
}

function login_(b) {
  if (String(b.password || "") !== adminPassword_()) {
    return json_({ result: "error", message: "パスワードが違います" });
  }
  return json_({ result: "success", ok: true });
}

function changePassword_(b) {
  requireAdmin_(b);
  const next = String(b.newPassword || "").trim();
  if (next.length < 4) throw new Error("新しいパスワードは4文字以上にしてください");
  PropertiesService.getScriptProperties().setProperty("ADMIN_PASSWORD", next);
  return json_({ result: "success" });
}

// ====================== 管理：データ取得 ======================

function getAll_() {
  return json_({
    result: "success",
    data: {
      rsvp: readTab_(TAB.rsvp),
      tasks: readTab_(TAB.tasks),
      checklist: readTab_(TAB.checklist),
      budget: readTab_(TAB.budget),
    },
  });
}

/** タブを {headers, rows} で返す（rows は _row 付きオブジェクト） */
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

// ====================== 管理：追加・更新・削除 ======================

/** クライアントの tab キー → シート名（編集可能なのはこの3つ） */
function editableSheet_(tabKey) {
  const map = { tasks: TAB.tasks, checklist: TAB.checklist, budget: TAB.budget };
  const name = map[tabKey];
  if (!name) throw new Error("編集できないタブです: " + tabKey);
  return getSheet_(name);
}

function addRow_(b) {
  const sheet = editableSheet_(b.tab);
  const headers = sheet.getDataRange().getValues()[0].map(String);
  const values = b.values || {};
  // ID 列があれば自動採番
  if (headers[0] === "ID" && !values.ID) values.ID = nextId_(sheet);
  const row = headers.map((h) => (values[h] !== undefined ? values[h] : ""));
  sheet.appendRow(row);
  return json_({ result: "success", id: values.ID });
}

function updateRow_(b) {
  const sheet = editableSheet_(b.tab);
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(String);
  const idCol = headers.indexOf("ID");
  const target = findRowById_(data, idCol, b.id);
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
  const idCol = data[0].map(String).indexOf("ID");
  const target = findRowById_(data, idCol, b.id);
  if (target < 0) throw new Error("対象が見つかりません: ID=" + b.id);
  sheet.deleteRow(target + 1);
  return json_({ result: "success" });
}

function findRowById_(data, idCol, id) {
  if (idCol < 0) return -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idCol]) === String(id)) return i;
  }
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

// ====================== シート生成＋標準テンプレ投入 ======================

function getSheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (sheet) return sheet;

  sheet = ss.insertSheet(name);
  const def = SHEET_DEFS[name];
  sheet.appendRow(def.headers);
  sheet.getRange(1, 1, 1, def.headers.length).setFontWeight("bold");
  sheet.setFrozenRows(1);
  // 標準テンプレを投入
  (def.seed || []).forEach((row) => sheet.appendRow(row));
  return sheet;
}

/** 各タブの定義（ヘッダー＋初期テンプレ） */
const SHEET_DEFS = {
  [TAB.rsvp]: {
    headers: ["受信日時", "お名前", "旧姓", "クラス・部活", "出欠", "連絡先", "希望の曜日・時期", "メッセージ"],
    seed: [],
  },

  [TAB.tasks]: {
    headers: ["ID", "カテゴリ", "タスク", "担当", "期限目安", "状態", "メモ"],
    seed: [
      [1,  "立ち上げ", "幹事ミーティング・役割分担を決める", "よしとみ/ひろき", "D-4ヶ月", "完了", ""],
      [2,  "立ち上げ", "候補日を2〜3個決める",            "よしとみ",       "D-4ヶ月", "進行中", "出欠フォームで投票"],
      [3,  "集客",     "学年LINEグループ作成・告知",        "ひろき",         "D-4ヶ月", "未着手", ""],
      [4,  "集客",     "先生方の連絡先を集める",            "ひろき",         "D-3.5ヶ月", "未着手", ""],
      [5,  "日程",     "出欠フォームで日程投票→確定",       "よしとみ",       "D-3ヶ月", "未着手", ""],
      [6,  "会場",     "候補店をリストアップ（30〜50名）",   "よしとみ",       "D-3ヶ月", "未着手", "武雄市内"],
      [7,  "費用",     "会費を決定する",                    "よしとみ",       "D-2ヶ月", "未着手", "先生分の扱いも"],
      [8,  "会場",     "会場を仮予約",                      "よしとみ",       "D-2ヶ月", "未着手", ""],
      [9,  "先生",     "先生方へ正式に案内・オファー",       "ひろき",         "D-2ヶ月", "未着手", ""],
      [10, "出欠",     "出欠を締切り、人数を確定",           "よしとみ",       "D-1ヶ月", "未着手", ""],
      [11, "会場",     "会場を本予約・席次を決める",         "よしとみ",       "D-3週",  "未着手", ""],
      [12, "集金",     "集金を開始",                        "よしとみ",       "D-3週",  "未着手", ""],
      [13, "当日",     "進行表・名簿・受付準備",            "よしとみ",       "D-1週",  "未着手", ""],
      [14, "当日",     "参加者へリマインド連絡",            "ひろき",         "D-3日",  "未着手", ""],
      [15, "事後",     "写真共有・お礼・会計報告",          "よしとみ",       "D+1週",  "未着手", ""],
    ],
  },

  [TAB.checklist]: {
    headers: ["ID", "カテゴリ", "品目", "数量", "担当", "状態", "メモ"],
    seed: [
      [1,  "受付", "名簿・受付チェックリスト",       "1部",   "よしとみ", "未手配", ""],
      [2,  "受付", "釣り銭・集金袋",                 "1式",   "よしとみ", "未手配", ""],
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
      [13, "装飾", "横断幕・装飾（任意）",            "一式",  "-",        "未手配", ""],
    ],
  },

  [TAB.budget]: {
    headers: ["ID", "区分", "項目", "予定額", "実績額", "メモ"],
    seed: [
      [1, "収入", "会費（一般）",     0, 0, "参加人数 × 会費"],
      [2, "収入", "会費（先生）",     0, 0, "招待 or 割引"],
      [3, "支出", "会場・飲食費",     0, 0, "@5,000 × 人数 を想定"],
      [4, "支出", "先生招待分の補助", 0, 0, ""],
      [5, "支出", "記念品・花束",     0, 0, ""],
      [6, "支出", "装飾・備品",       0, 0, ""],
      [7, "支出", "予備費",           0, 0, ""],
    ],
  },
};

// ====================== ユーティリティ ======================

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
