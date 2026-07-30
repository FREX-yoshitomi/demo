import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { Platform } from "react-native";

import { api } from "../../lib/api";

/**
 * プッシュ通知 (F-101)。
 *
 * 通知ペイロードの businessDate / slotKey を使って
 * **タップで撮影画面に直行**させる（設計書 第6章）。
 */

export function configureNotificationHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/** 権限を取り、FCMトークンをサーバーへ登録する */
export async function registerForPushNotifications(): Promise<boolean> {
  if (!Device.isDevice) {
    // シミュレータではプッシュを受け取れない
    return false;
  }

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== "granted") {
    status = (await Notifications.requestPermissionsAsync()).status;
  }
  if (status !== "granted") return false;

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("capture", {
      name: "撮影のお知らせ",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
    });
  }

  // FCM のデバイストークンを取る（サーバーは firebase-admin で直接送るため Expo Push は使わない）
  const token = await Notifications.getDevicePushTokenAsync();
  await api.registerFcmToken({ token: String(token.data) });
  return true;
}

interface CapturePayload {
  type?: string;
  businessDate?: string;
  slotKey?: string;
}

function openCaptureFromPayload(data: unknown): void {
  const payload = (data ?? {}) as CapturePayload;
  if (payload.type !== "capture" || !payload.businessDate || !payload.slotKey) return;
  router.push({
    pathname: "/capture",
    params: { businessDate: payload.businessDate, slotKey: payload.slotKey },
  });
}

/**
 * 通知タップの購読。アプリが終了状態から起動された場合も拾う。
 * 戻り値で解除する。
 */
export function startNotificationRouting(): () => void {
  void Notifications.getLastNotificationResponseAsync().then((response) => {
    if (response) openCaptureFromPayload(response.notification.request.content.data);
  });

  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    openCaptureFromPayload(response.notification.request.content.data);
  });

  return () => sub.remove();
}
