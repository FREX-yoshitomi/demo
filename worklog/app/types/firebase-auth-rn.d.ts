import type { Persistence } from "firebase/auth";

/**
 * `firebase/auth` の型定義はブラウザ向けが解決されるため、
 * React Native 専用 export（`dist/index.rn.d.ts` にある）の型が見えない。
 * 実行時には RN ビルドが読み込まれるので、型だけ補う。
 */
declare module "firebase/auth" {
  export function getReactNativePersistence(storage: unknown): Persistence;
}
