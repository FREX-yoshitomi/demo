/**
 * 武雄高校 同窓会 出欠フォーム ― Google Apps Script バックエンド
 *
 * 役割：サイトの出欠フォームから送られてきた回答を、
 *       Google スプレッドシートに1行ずつ追記する。
 *
 * セットアップ手順は README.md の「出欠フォームの保存先を作る」を参照。
 */

// 保存先シートのタブ名（無ければ自動作成）
const SHEET_NAME = "出欠回答";

// 列の定義（順番＝スプレッドシートの列順）
const HEADERS = [
  "受信日時",
  "お名前",
  "旧姓",
  "クラス・部活",
  "出欠",
  "連絡先",
  "希望の曜日・時期",
  "メッセージ",
];

function doPost(e) {
  try {
    const p = (e && e.parameter) || {};
    const sheet = getSheet_();

    sheet.appendRow([
      new Date(),
      p.name || "",
      p.oldName || "",
      p.grade || "",
      p.attendance || "",
      p.contact || "",
      p.dates || "",
      p.message || "",
    ]);

    return json_({ result: "success" });
  } catch (err) {
    return json_({ result: "error", message: String(err) });
  }
}

// ブラウザで URL を直接開いたときの動作確認用
function doGet() {
  return json_({ result: "ok", message: "武雄高校 同窓会 RSVP endpoint is running." });
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  // ヘッダー行が無ければ追加
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
