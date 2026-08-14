import { describe, expect, it } from "vitest";

import {
  buildCellArgs,
  buildConcatArgs,
  buildConcatList,
  buildPlaceholderArgs,
  buildStackArgs,
  needsStacking,
} from "../ffmpeg";
import { buildCellLabel, truncateName } from "../label";
import { gridDimensions } from "../layout";

const FONT = "/usr/share/fonts/truetype/fonts-japanese-gothic.ttf";

describe("buildCellArgs", () => {
  const args = buildCellArgs({
    inputPath: "/tmp/w/in_0.mp4",
    outputPath: "/tmp/w/cell_0.mp4",
    drawText: { textFile: "/tmp/w/label_0.txt", fontFile: FONT },
  });

  it("入力と出力を渡す", () => {
    expect(args).toContain("/tmp/w/in_0.mp4");
    expect(args[args.length - 1]).toBe("/tmp/w/cell_0.mp4");
  });

  it("縦横比を保って収め、余白を埋める（歪ませない）", () => {
    const filter = args[args.indexOf("-vf") + 1] ?? "";
    expect(filter).toContain("force_original_aspect_ratio=decrease");
    expect(filter).toContain("pad=360:640");
  });

  it("氏名と時刻を textfile 経由で焼き込む（文字列のエスケープを不要にする）", () => {
    const filter = args[args.indexOf("-vf") + 1] ?? "";
    expect(filter).toContain("textfile=/tmp/w/label_0.txt");
    // インラインの text= オプションは使わない（`drawtext=` 自体の末尾と区別するため区切りも見る）
    expect(filter).not.toMatch(/[:=]text=/);
  });

  it("%{...} の展開を止める（氏名に % が入っても壊れない）", () => {
    const filter = args[args.indexOf("-vf") + 1] ?? "";
    expect(filter).toContain("expansion=none");
  });

  it("音声を落とす（Vlog は既定ミュート）", () => {
    expect(args).toContain("-an");
  });

  it("2秒に切り詰める", () => {
    expect(args[args.indexOf("-t") + 1]).toBe("2");
  });

  it("全コマ同じ仕様に揃える（xstack は入力の解像度・SARが揃っている必要がある）", () => {
    const filter = args[args.indexOf("-vf") + 1] ?? "";
    expect(filter).toContain("setsar=1");
    expect(filter).toContain("fps=30");
    expect(filter).toContain("format=yuv420p");
  });

  it("フィルタを壊すパスは組み立てを止める（黙ってエスケープしない）", () => {
    expect(() =>
      buildCellArgs({
        inputPath: "/tmp/w/in.mp4",
        outputPath: "/tmp/w/out.mp4",
        drawText: { textFile: "/tmp/w/la:bel.txt", fontFile: FONT },
      }),
    ).toThrow();
  });
});

describe("buildPlaceholderArgs", () => {
  it("未撮影のコマを実動画と同じ仕様で作る (F-304)", () => {
    const args = buildPlaceholderArgs({
      kind: "empty",
      outputPath: "/tmp/w/cell_1.mp4",
      fontFile: FONT,
      textFile: "/tmp/w/empty.txt",
    });
    const input = args[args.indexOf("-i") + 1] ?? "";
    expect(input).toContain("s=360x640");
    expect(input).toContain("d=2");
    expect(input).toContain("r=30");

    const filter = args[args.indexOf("-vf") + 1] ?? "";
    expect(filter).toContain("setsar=1");
    expect(filter).toContain("format=yuv420p");
  });

  it("削除済みは別の色にする（未撮影と見分けられるように F-902）", () => {
    const empty = buildPlaceholderArgs({ kind: "empty", outputPath: "/o", fontFile: FONT });
    const deleted = buildPlaceholderArgs({ kind: "deleted", outputPath: "/o", fontFile: FONT });
    const colorOf = (args: string[]) => args[args.indexOf("-i") + 1];
    expect(colorOf(empty)).not.toBe(colorOf(deleted));
  });

  it("空席には文字を焼かない（最終ページの余りに「未撮影」と出さない）", () => {
    const args = buildPlaceholderArgs({
      kind: "vacant",
      outputPath: "/o",
      fontFile: FONT,
      textFile: "/tmp/w/x.txt",
    });
    expect(args[args.indexOf("-vf") + 1]).not.toContain("drawtext");
  });

  it("ラベルファイルが無ければ drawtext を付けない", () => {
    const args = buildPlaceholderArgs({ kind: "empty", outputPath: "/o", fontFile: FONT });
    expect(args[args.indexOf("-vf") + 1]).not.toContain("drawtext");
  });
});

describe("buildStackArgs", () => {
  const dims = gridDimensions(4);
  const inputs = ["/tmp/w/c0.mp4", "/tmp/w/c1.mp4", "/tmp/w/c2.mp4", "/tmp/w/c3.mp4"];

  it("入力をコマ数ぶん渡す", () => {
    const args = buildStackArgs({ inputPaths: inputs, dimensions: dims, outputPath: "/tmp/w/s.mp4" });
    expect(args.filter((a) => a === "-i")).toHaveLength(4);
  });

  it("レイアウト文字列を filter_complex に埋め込む", () => {
    const args = buildStackArgs({ inputPaths: inputs, dimensions: dims, outputPath: "/tmp/w/s.mp4" });
    const filter = args[args.indexOf("-filter_complex") + 1] ?? "";
    expect(filter).toBe("xstack=inputs=4:layout=0_0|w0_0|0_h0|w0_h0:fill=black");
  });

  it("入力数と座席数が食い違ったら組み立てを止める", () => {
    expect(() =>
      buildStackArgs({ inputPaths: inputs.slice(0, 3), dimensions: dims, outputPath: "/o" }),
    ).toThrow(/入力数/);
  });

  it("1人（個人ログ F-202）では合成しない。xstack は入力2本以上が必須", () => {
    const single = gridDimensions(1);
    expect(needsStacking(single)).toBe(false);
    expect(() =>
      buildStackArgs({ inputPaths: ["/tmp/w/c0.mp4"], dimensions: single, outputPath: "/o" }),
    ).toThrow(/2本以上/);
  });

  it("2人以上なら合成する", () => {
    expect(needsStacking(gridDimensions(2))).toBe(true);
    expect(needsStacking(gridDimensions(12))).toBe(true);
  });

  it("12分割でも入力数とレイアウトが一致する", () => {
    const d12 = gridDimensions(12);
    const paths = Array.from({ length: 12 }, (_, i) => `/tmp/w/c${i}.mp4`);
    const args = buildStackArgs({ inputPaths: paths, dimensions: d12, outputPath: "/o" });
    const filter = args[args.indexOf("-filter_complex") + 1] ?? "";
    const layout = filter.split("layout=")[1]?.split(":")[0] ?? "";
    expect(layout.split("|")).toHaveLength(12);
  });
});

describe("buildConcatArgs / buildConcatList", () => {
  it("再エンコードせずに繋ぐ（全セグメントを同じ仕様で作っているため）", () => {
    const args = buildConcatArgs({ listPath: "/tmp/w/list.txt", outputPath: "/tmp/w/p1.mp4" });
    expect(args).toContain("-c");
    expect(args[args.indexOf("-c") + 1]).toBe("copy");
    expect(args).toContain("concat");
  });

  it("ストリーミング再生のために faststart を付ける", () => {
    const args = buildConcatArgs({ listPath: "/l", outputPath: "/o" });
    expect(args[args.indexOf("-movflags") + 1]).toBe("+faststart");
  });

  it("リストファイルは1行1ファイル", () => {
    expect(buildConcatList(["/tmp/a.mp4", "/tmp/b.mp4"])).toBe(
      "file '/tmp/a.mp4'\nfile '/tmp/b.mp4'\n",
    );
  });

  it("シングルクォートを含むパスをエスケープする", () => {
    expect(buildConcatList(["/tmp/it's.mp4"])).toBe("file '/tmp/it'\\''s.mp4'\n");
  });
});

describe("ラベルの整形", () => {
  it("長い氏名は省略する（コマからはみ出さない）", () => {
    expect(truncateName("非常に長い氏名の従業員さん")).toHaveLength(8);
    expect(truncateName("非常に長い氏名の従業員さん").endsWith("…")).toBe(true);
  });

  it("短い氏名はそのまま", () => {
    expect(truncateName("山田 太郎")).toBe("山田 太郎");
  });

  it("改行や制御文字を落とす（レイアウトが崩れないように）", () => {
    expect(truncateName("山田\n太郎")).toBe("山田 太郎");
  });

  it("氏名と時刻を並べる (F-309)", () => {
    expect(
      buildCellLabel({
        name: "山田 太郎",
        capturedAt: new Date("2026-07-26T03:04:33Z"),
        timezone: "Asia/Tokyo",
      }),
    ).toBe("山田 太郎  12:04");
  });

  it("記号を含む氏名でもそのまま扱える（textfile 経由なので壊れない）", () => {
    const label = buildCellLabel({
      name: "O'Brien:100%",
      capturedAt: new Date("2026-07-26T03:04:00Z"),
      timezone: "Asia/Tokyo",
    });
    expect(label).toContain("O'Brien");
    expect(label).toContain("12:04");
  });
});
