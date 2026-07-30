import { defineConfig } from "vitest/config";

/** Firestore / Auth / Storage エミュレータを使う統合テスト */
export default defineConfig({
  test: {
    include: ["**/*.emulator.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
