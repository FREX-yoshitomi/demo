import { configDefaults, defineConfig } from "vitest/config";

/**
 * 既定はエミュレータ不要のユニットテストのみ。
 * `*.emulator.test.ts` は vitest.emulator.config.ts から
 * `firebase emulators:exec` 配下で実行する。
 */
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "**/*.emulator.test.ts"],
    fileParallelism: false,
  },
});
