import { defineConfig } from "vitest/config";

/** 実際に FFmpeg を起動する統合テスト。drawtext 対応の FFmpeg と CJK フォントが要る */
export default defineConfig({
  test: {
    include: ["**/*.integration.test.ts"],
    testTimeout: 300_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
