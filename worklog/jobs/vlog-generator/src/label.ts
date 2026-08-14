import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * 各コマに焼き込む「氏名 + 撮影時刻」 (F-309)。
 *
 * ## エスケープしない理由
 *
 * drawtext の `text=` はフィルタグラフの中に文字列を埋め込むため、
 * `\` `'` `:` `%` `,` `[` `]` `;` を多重にエスケープする必要があり、
 * 日本語氏名（記号を含みうる）で事故が起きやすい。
 *
 * そこで **`textfile=` を使い、文字列をファイル経由で渡す**。
 * こうするとテキスト側のエスケープが一切不要になる。
 * さらに `expansion=none` を付けて `%{...}` の展開も止める（ffmpeg.ts 側）。
 * 代わりに「ファイルパスにフィルタ構文を壊す文字が入らないこと」だけを保証する。
 */

/** 1コマに収まる氏名の長さ。超える分は省略する */
export const MAX_NAME_LENGTH = 8;

export function truncateName(name: string, max: number = MAX_NAME_LENGTH): string {
  const cleaned = sanitizeText(name);
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1)}…`;
}

/**
 * 制御文字と改行を落とす。
 * textfile 経由なのでエスケープは不要だが、改行が入るとレイアウトが崩れる。
 */
export function sanitizeText(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
}

/** 撮影時刻は分単位で焼き込む。丸めない (F-105) */
export function formatCapturedTime(capturedAt: Date, tz: string): string {
  return dayjs(capturedAt).tz(tz).format("HH:mm");
}

export function buildCellLabel(params: {
  name: string;
  capturedAt: Date;
  timezone: string;
}): string {
  return `${truncateName(params.name)}  ${formatCapturedTime(params.capturedAt, params.timezone)}`;
}

/**
 * フィルタ引数に埋め込めるパスか検証する。
 * `:` はフィルタのオプション区切り、`'` と `\` はクォート文字なので、
 * 含まれていたら組み立てを止める（黙ってエスケープするより気づける）。
 */
export function assertFilterSafePath(path: string): string {
  if (/[:'\\,[\];]/.test(path)) {
    throw new Error(`フィルタに渡せないパスです: ${JSON.stringify(path)}`);
  }
  return path;
}
