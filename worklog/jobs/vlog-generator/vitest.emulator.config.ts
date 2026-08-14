import { defineConfig } from "vitest/config";

/** Firestore / Storage エミュレータ + 実 FFmpeg を使うジョブ全体の統合テスト */
export default defineConfig({
  test: {
    include: ["**/*.emulator.test.ts"],
    testTimeout: 420_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
