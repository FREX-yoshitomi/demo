import type { ExpoConfig } from "expo/config";

/**
 * Expo Development Build 前提（Expo Go では動かない：非機能要件）。
 *
 * カメラロールへのアクセス権限は **要求しない**。
 * その場で撮影したものだけを受け付ける仕様を、権限レベルで構造的に保証する (F-106)。
 */

const projectId = process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? "worklog-dev";
const variant = process.env.APP_VARIANT ?? "development";
const isProduction = variant === "production";

const config: ExpoConfig = {
  name: isProduction ? "ワークログ" : `ワークログ (${variant})`,
  slug: "worklog",
  scheme: "worklog",
  version: "0.1.0",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  // 新アーキテクチャと edge-to-edge は Expo 57 では既定で有効なので明示しない

  ios: {
    bundleIdentifier: isProduction ? "works.frex.worklog" : `works.frex.worklog.${variant}`,
    supportsTablet: false,
    infoPlist: {
      // 撮影は通知起点の手動操作のみ。バックグラウンド自動撮影は実装しない
      NSCameraUsageDescription:
        "稼働時間中の2秒動画を撮影するためにカメラを使用します。撮影した動画はご自身でいつでも削除できます。",
      NSMicrophoneUsageDescription:
        "動画の録画にマイクを使用します。音声はVlogの合成時に既定でミュートされます。",
      // 位置情報は取得しない（非機能要件・プライバシー）
      ITSAppUsesNonExemptEncryption: false,
    },
  },

  android: {
    package: isProduction ? "works.frex.worklog" : `works.frex.worklog.${variant}`,
    permissions: [
      "android.permission.CAMERA",
      "android.permission.RECORD_AUDIO",
      "android.permission.POST_NOTIFICATIONS",
    ],
    // READ_MEDIA_VIDEO は要求しない (F-106)
    blockedPermissions: [
      "android.permission.READ_MEDIA_IMAGES",
      "android.permission.READ_MEDIA_VIDEO",
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.ACCESS_FINE_LOCATION",
      "android.permission.ACCESS_COARSE_LOCATION",
    ],
  },

  plugins: [
    "expo-router",
    "expo-video",
    [
      "expo-camera",
      {
        cameraPermission:
          "稼働時間中の2秒動画を撮影するためにカメラを使用します。",
        microphonePermission: "動画の録画にマイクを使用します。",
        recordAudioAndroid: true,
      },
    ],
    [
      "expo-notifications",
      {
        // 撮影通知のチャンネル。deliver.ts の channelId と一致させる
        defaultChannel: "capture",
      },
    ],
    [
      "expo-build-properties",
      {
        // 要件は「iOS 16以降」だが、Expo 57 / React Native 0.86 の下限が 16.4 なので
        // 実質の対応下限は iOS 16.4 になる（非機能要件の見直しが必要）
        ios: { deploymentTarget: "16.4" },
        // Android 12 = API 31（非機能要件どおり）
        android: { minSdkVersion: 31 },
      },
    ],
  ],

  extra: {
    firebase: {
      apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? "",
      authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? `${projectId}.firebaseapp.com`,
      projectId,
      storageBucket:
        process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ?? `${projectId}.firebasestorage.app`,
      messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "",
      appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? "",
    },
    google: {
      webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? "",
      iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? "",
    },
    /** ローカル開発でエミュレータに接続するか */
    useEmulator: process.env.EXPO_PUBLIC_USE_EMULATOR === "true",
    emulatorHost: process.env.EXPO_PUBLIC_EMULATOR_HOST ?? "127.0.0.1",
  },
};

export default config;
