import { defineConfig } from "vitest/config";

/**
 * アプリ側は「端末に依存しない純ロジック」だけをここでテストする
 * （アップロードキューの再送方針・グリッドの組み立て）。
 * 画面と実機依存の確認は Maestro の E2E 側で行う（設計書 第11章）。
 */
export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
    environment: "node",
  },
});
