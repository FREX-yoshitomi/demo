import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider, useAuth } from "../src/features/auth/AuthProvider";
import { startQueueWatchers } from "../src/features/capture/uploadQueue";
import {
  configureNotificationHandler,
  registerForPushNotifications,
  startNotificationRouting,
} from "../src/features/notifications/push";
import { colors, fontSize, spacing } from "../src/theme";

void SplashScreen.preventAutoHideAsync();
configureNotificationHandler();

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <StatusBar style="light" />
          <Gate />
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

/** ログイン状態に応じて (auth) と (tabs) を出し入れする */
function Gate() {
  const { initializing, session, error } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (initializing) return;
    void SplashScreen.hideAsync();

    const inAuthGroup = segments[0] === "(auth)";
    if (!session && !inAuthGroup) router.replace("/(auth)/login");
    if (session && inAuthGroup) router.replace("/(tabs)/home");
  }, [initializing, session, segments, router]);

  // ログイン後に走らせるもの：オフラインキューの再送 (F-112) と通知登録 (F-101)
  useEffect(() => {
    if (!session) return;
    const stopQueue = startQueueWatchers();
    const stopRouting = startNotificationRouting();
    void registerForPushNotifications().catch(() => undefined);
    return () => {
      stopQueue();
      stopRouting();
    };
  }, [session]);

  if (initializing) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="(auth)/login" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen
        name="capture"
        options={{ presentation: "fullScreenModal", animation: "slide_from_bottom" }}
      />
      <Stack.Screen
        name="capture/[captureId]"
        options={{ presentation: "modal", headerShown: true, title: "撮影" }}
      />
      <Stack.Screen name="settings" options={{ headerShown: true, title: "設定" }} />
    </Stack>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
    gap: spacing.md,
  },
  error: { color: colors.danger, fontSize: fontSize.sm, paddingHorizontal: spacing.xl },
});
