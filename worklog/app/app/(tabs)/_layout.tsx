import { Tabs } from "expo-router";

import { colors } from "../../src/theme";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="home" options={{ title: "ホーム" }} />
      <Tabs.Screen name="log" options={{ title: "ログ" }} />
      <Tabs.Screen name="attendance" options={{ title: "勤怠" }} />
    </Tabs>
  );
}
