import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // エミュレータへの接続を共有するため、ファイル間で直列実行する
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    globalSetup: [],
  },
});
