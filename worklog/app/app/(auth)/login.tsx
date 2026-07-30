import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "../../src/features/auth/AuthProvider";
import { colors, fontSize, radius, spacing } from "../../src/theme";

/**
 * ログイン画面 (F-501)。
 * 「Googleでログイン」だけ。独自パスワードは持たない。
 * テナントはサーバー側がドメインから判定する（アプリは関与しない）。
 */
export default function LoginScreen() {
  const { signIn, busy, error } = useAuth();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.hero}>
        <Text style={styles.title}>ワークログ</Text>
        <Text style={styles.lead}>
          1時間ごとに2秒の動画を撮るだけ。{"\n"}日報と勤怠の記録は自動でできます。
        </Text>
      </View>

      <View style={styles.actions}>
        <Pressable
          style={[styles.button, busy && styles.buttonDisabled]}
          onPress={() => void signIn()}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Googleでログイン"
        >
          {busy ? (
            <ActivityIndicator color={colors.primaryText} />
          ) : (
            <Text style={styles.buttonLabel}>Googleでログイン</Text>
          )}
        </Pressable>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Text style={styles.note}>
          会社のGoogleアカウントでログインしてください。{"\n"}
          個人のGmailアカウントではご利用いただけません。
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    justifyContent: "space-between",
    padding: spacing.xl,
  },
  hero: { flex: 1, justifyContent: "center", gap: spacing.md },
  title: { color: colors.text, fontSize: fontSize.xxl, fontWeight: "700" },
  lead: { color: colors.textMuted, fontSize: fontSize.md, lineHeight: 24 },
  actions: { gap: spacing.lg, paddingBottom: spacing.xl },
  button: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
    alignItems: "center",
  },
  buttonDisabled: { opacity: 0.6 },
  buttonLabel: { color: colors.primaryText, fontSize: fontSize.md, fontWeight: "700" },
  error: { color: colors.danger, fontSize: fontSize.sm, textAlign: "center" },
  note: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    textAlign: "center",
    lineHeight: 18,
  },
});
