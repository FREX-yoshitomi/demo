import { configDefaults, defineConfig } from "vitest/config";

/**
 * 既定は純ロジックのテストのみ。
 * `*.integration.test.ts` は実際に ffmpeg を起動して mp4 を作るので、
 * ffmpeg が使える環境でのみ `pnpm test:ffmpeg` から実行する。
 */
export default defineConfig({
  test: {
    exclude: [
      ...configDefaults.exclude,
      "**/*.integration.test.ts",
      "**/*.emulator.test.ts",
    ],
  },
});
