import Constants from "expo-constants";

/**
 * app.config.ts の extra を型付きで読む。
 * ここ以外で Constants を直接触らない。
 */

interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

interface GoogleConfig {
  webClientId: string;
  iosClientId: string;
}

interface AppExtra {
  firebase: FirebaseConfig;
  google: GoogleConfig;
  useEmulator: boolean;
  emulatorHost: string;
}

const extra = (Constants.expoConfig?.extra ?? {}) as Partial<AppExtra>;

function requireValue<T>(value: T | undefined, name: string): T {
  if (value === undefined || value === null || value === "") {
    throw new Error(
      `設定 ${name} が未設定です。app.config.ts と .env（EXPO_PUBLIC_*）を確認してください`,
    );
  }
  return value;
}

export const firebaseConfig: FirebaseConfig = {
  apiKey: requireValue(extra.firebase?.apiKey, "firebase.apiKey"),
  authDomain: requireValue(extra.firebase?.authDomain, "firebase.authDomain"),
  projectId: requireValue(extra.firebase?.projectId, "firebase.projectId"),
  storageBucket: requireValue(extra.firebase?.storageBucket, "firebase.storageBucket"),
  messagingSenderId: extra.firebase?.messagingSenderId ?? "",
  appId: requireValue(extra.firebase?.appId, "firebase.appId"),
};

export const googleConfig: GoogleConfig = {
  webClientId: extra.google?.webClientId ?? "",
  iosClientId: extra.google?.iosClientId ?? "",
};

export const useEmulator = extra.useEmulator === true;
export const emulatorHost = extra.emulatorHost ?? "127.0.0.1";
