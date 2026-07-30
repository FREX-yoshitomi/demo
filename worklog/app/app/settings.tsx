import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";

import { useAuth } from "../src/features/auth/AuthProvider";
import { clearFailed, listQueue } from "../src/features/capture/uploadQueue";
import type { QueueItem } from "../src/features/capture/queuePolicy";
import { useTenant } from "../src/features/tenant/useTenant";
import { ApiError, api } from "../src/lib/api";
import { colors, fontSize, radius, spacing } from "../src/theme";

/**
 * 設定 (F-103, F-113 の入口)。
 *
 * - カメラの既定（インカメ／アウトカメ）
 * - 通知の有効／無効
 * - 未送信キューの状態表示（オフライン時の不安を減らす：F-112）
 *
 * 「撮影しない時間」の申告UIは M6 の続きで撮影スロット一覧と合わせて実装する。
 */
export default function SettingsScreen() {
  const { session, signOutUser } = useAuth();
  const { me, settings, tenant } = useTenant();

  const [camera, setCamera] = useState<"front" | "back">("back");
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (me?.preferences?.camera) setCamera(me.preferences.camera);
    else if (settings) setCamera(settings.defaultCamera);
    setNotificationsEnabled(me?.preferences?.notificationsEnabled !== false);
  }, [me, settings]);

  useEffect(() => {
    void listQueue().then(setQueue);
  }, []);

  const save = async (patch: { camera?: "front" | "back"; notificationsEnabled?: boolean }) => {
    setSaving(true);
    try {
      await api.updateProfile(patch);
    } catch (err) {
      Alert.alert("保存できませんでした", err instanceof ApiError ? err.message : "");
    } finally {
      setSaving(false);
    }
  };

  const failed = queue.filter((q) => q.state === "failed");
  const pending = queue.filter((q) => q.state !== "failed");

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Section title="アカウント">
        <Row label="メールアドレス" value={session?.email ?? "—"} />
        <Row label="会社" value={tenant?.name ?? "—"} />
        <Row label="権限" value={roleLabel(session?.role)} />
      </Section>

      <Section title="撮影">
        <Text style={styles.rowLabel}>既定のカメラ</Text>
        <View style={styles.segment}>
          {(["back", "front"] as const).map((value) => (
            <Pressable
              key={value}
              style={[styles.segmentItem, camera === value && styles.segmentItemActive]}
              onPress={() => {
                setCamera(value);
                void save({ camera: value });
              }}
              disabled={saving}
              accessibilityRole="button"
              accessibilityState={{ selected: camera === value }}
            >
              <Text style={[styles.segmentLabel, camera === value && styles.segmentLabelActive]}>
                {value === "back" ? "アウトカメラ" : "インカメラ"}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.note}>
          アウトカメラを既定にすると、顔を映さずに作業風景だけを記録できます。
        </Text>
      </Section>

      <Section title="通知">
        <View style={styles.switchRow}>
          <Text style={styles.rowLabel}>撮影のお知らせを受け取る</Text>
          <Switch
            value={notificationsEnabled}
            onValueChange={(value) => {
              setNotificationsEnabled(value);
              void save({ notificationsEnabled: value });
            }}
            disabled={saving}
          />
        </View>
      </Section>

      <Section title="未送信の撮影">
        {pending.length === 0 && failed.length === 0 ? (
          <Text style={styles.note}>未送信の撮影はありません。</Text>
        ) : (
          <>
            {pending.map((item) => (
              <Row
                key={item.id}
                label={`${item.businessDate} ${item.slotKey}`}
                value={`送信待ち（${item.attempts}回試行）`}
              />
            ))}
            {failed.map((item) => (
              <Row
                key={item.id}
                label={`${item.businessDate} ${item.slotKey}`}
                value={`送信できませんでした（${item.lastErrorCode ?? "原因不明"}）`}
              />
            ))}
            {failed.length > 0 ? (
              <Pressable
                style={styles.secondaryButton}
                onPress={() => {
                  void clearFailed().then(() => void listQueue().then(setQueue));
                }}
              >
                <Text style={styles.secondaryLabel}>送信できなかった項目を破棄する</Text>
              </Pressable>
            ) : null}
          </>
        )}
      </Section>

      <Section title="プライバシー">
        <Text style={styles.note}>
          撮影した動画はご自身でいつでも削除できます。削除すると映像は完全に消え、
          管理者でも復元できません。勤怠の整合性のため、撮影した時刻の記録だけが残ります。{"\n\n"}
          位置情報は取得していません。端末の写真・動画にはアクセスしません。
        </Text>
      </Section>

      <Pressable style={styles.signOutButton} onPress={() => void signOutUser()}>
        <Text style={styles.signOutLabel}>ログアウト</Text>
      </Pressable>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

function roleLabel(role: string | undefined): string {
  switch (role) {
    case "tenantAdmin":
      return "テナント管理者";
    case "deptAdmin":
      return "部署管理者";
    case "member":
      return "メンバー";
    default:
      return "—";
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing.xxl },
  section: { gap: spacing.sm },
  sectionTitle: { color: colors.textMuted, fontSize: fontSize.sm },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  row: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md },
  rowLabel: { color: colors.textMuted, fontSize: fontSize.sm, flexShrink: 1 },
  rowValue: { color: colors.text, fontSize: fontSize.sm, flexShrink: 1, textAlign: "right" },
  switchRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  segment: { flexDirection: "row", gap: spacing.sm },
  segmentItem: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
  },
  segmentItemActive: { backgroundColor: colors.primary },
  segmentLabel: { color: colors.textMuted, fontSize: fontSize.sm },
  segmentLabelActive: { color: colors.primaryText, fontWeight: "600" },
  note: { color: colors.textMuted, fontSize: fontSize.xs, lineHeight: 18 },
  secondaryButton: {
    backgroundColor: colors.surfaceAlt,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: "center",
  },
  secondaryLabel: { color: colors.text, fontSize: fontSize.sm },
  signOutButton: {
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
    alignItems: "center",
  },
  signOutLabel: { color: colors.danger, fontSize: fontSize.md },
});
