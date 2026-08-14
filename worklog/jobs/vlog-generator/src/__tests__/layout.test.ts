import { GRID_SIZES } from "@worklog/shared";
import { describe, expect, it } from "vitest";

import {
  buildXstackLayout,
  CELL_HEIGHT,
  CELL_WIDTH,
  gridDimensions,
  stackedSize,
} from "../layout";

describe("gridDimensions", () => {
  it("設定可能な分割数それぞれで行列を決める (F-302)", () => {
    expect(gridDimensions(4)).toMatchObject({ cols: 2, rows: 2 });
    expect(gridDimensions(6)).toMatchObject({ cols: 2, rows: 3 });
    expect(gridDimensions(9)).toMatchObject({ cols: 3, rows: 3 });
    expect(gridDimensions(12)).toMatchObject({ cols: 3, rows: 4 });
  });

  it("12分割は設計書 付録A の 3x4 と一致する", () => {
    const dims = gridDimensions(12);
    expect(`${dims.cols}x${dims.rows}`).toBe("3x4");
  });

  it("どの分割数でも全コマが収まる", () => {
    for (const size of GRID_SIZES) {
      const dims = gridDimensions(size);
      expect(dims.cellCount).toBeGreaterThanOrEqual(size);
    }
  });

  it("1人なら1x1", () => {
    expect(gridDimensions(1)).toMatchObject({ cols: 1, rows: 1, cellCount: 1 });
  });

  it("端数のある人数でも空きコマが最小になる", () => {
    // 5人：2x3 なら空き1、3x2 なら空き1。縦横比の近い 2x3 を選ぶ
    expect(gridDimensions(5)).toMatchObject({ cols: 2, rows: 3, cellCount: 6 });
  });

  it("合成後の縦横比が縦持ちに近い（横に広がらない）", () => {
    for (const size of GRID_SIZES) {
      const dims = gridDimensions(size);
      const { width, height } = stackedSize(dims);
      expect(width).toBeLessThan(height);
    }
  });

  it("不正な人数は例外", () => {
    expect(() => gridDimensions(0)).toThrow();
    expect(() => gridDimensions(-1)).toThrow();
    expect(() => gridDimensions(1.5)).toThrow();
  });
});

describe("buildXstackLayout", () => {
  it("2x2", () => {
    expect(buildXstackLayout(2, 2)).toBe("0_0|w0_0|0_h0|w0_h0");
  });

  it("3x4 は設計書 付録A の例と完全に一致する", () => {
    expect(buildXstackLayout(3, 4)).toBe(
      "0_0|w0_0|w0+w1_0|" +
        "0_h0|w0_h0|w0+w1_h0|" +
        "0_h0+h1|w0_h0+h1|w0+w1_h0+h1|" +
        "0_h0+h1+h2|w0_h0+h1+h2|w0+w1_h0+h1+h2",
    );
  });

  it("座標の個数が cols*rows と一致する", () => {
    for (const [cols, rows] of [
      [2, 2],
      [2, 3],
      [3, 3],
      [3, 4],
      [4, 3],
    ] as const) {
      expect(buildXstackLayout(cols, rows).split("|")).toHaveLength(cols * rows);
    }
  });

  it("左上は必ず原点", () => {
    expect(buildXstackLayout(3, 3).split("|")[0]).toBe("0_0");
  });

  it("同じ座標が重複しない（コマが重なって消えない）", () => {
    const positions = buildXstackLayout(3, 4).split("|");
    expect(new Set(positions).size).toBe(positions.length);
  });

  it("行優先で並ぶ（座席番号とコマの位置が対応する）", () => {
    const positions = buildXstackLayout(2, 3).split("|");
    // 0,1 が1行目 / 2,3 が2行目 / 4,5 が3行目
    expect(positions[0]).toBe("0_0");
    expect(positions[1]).toBe("w0_0");
    expect(positions[2]).toBe("0_h0");
    expect(positions[4]).toBe("0_h0+h1");
  });

  it("不正な行列は例外", () => {
    expect(() => buildXstackLayout(0, 3)).toThrow();
    expect(() => buildXstackLayout(3, 0)).toThrow();
  });
});

describe("stackedSize", () => {
  it("コマ数ぶんの解像度になる", () => {
    expect(stackedSize({ cols: 3, rows: 4, cellCount: 12 })).toEqual({
      width: CELL_WIDTH * 3,
      height: CELL_HEIGHT * 4,
    });
  });

  it("エンコーダが扱えるよう幅と高さが偶数になる", () => {
    for (const size of GRID_SIZES) {
      const { width, height } = stackedSize(gridDimensions(size));
      expect(width % 2).toBe(0);
      expect(height % 2).toBe(0);
    }
  });
});
