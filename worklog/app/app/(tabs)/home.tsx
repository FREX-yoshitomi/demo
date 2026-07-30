import { DEFAULT_GRID_SIZE } from "@worklog/shared";
import { Link, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { GridView } from "../../src/components/GridView";
import { useAuth } from "../../src/features/auth/AuthProvider";
import { pendingCount } from "../../src/features/capture/uploadQueue";
import { useGrid } from "../../src/features/log/useGrid";
import { useTenant } from "../../src/features/tenant/useTenant";
import { formatCountdown, formatRate, formatTime } from "../../src/lib/format";
import { colors, fontSize, radius, spacing } from "../../src/theme";

/**
 * ホーム (F-801)。
 * 次の撮影までのカウントダウン、当日の自分のコマ、未送信の件数を出す。
 */
export default function HomeScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const { tenant, settings, nextSlot, businessDate, timezone, loading } = useTenant();
  const [now, setNow] = useState(() => new Date());
  const [queued, setQueued] = useState(0);
  const [sort, setSort] = useState<"name" | "capturedAt" | "missingFirst">("name");
  const [gridSize, setGridSize] = useState(DEFAULT_GRID_SIZE);

  const grid = useGrid({ businessDate, departmentId: null, sort });

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const check = () => void pendingCount().then(setQueued);
    check();
    const timer = setInterval(check, 5000);
    return () => clearInterval(timer);
  }, []);

  if (loading || !settings) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.muted}>読み込み中…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.scroll} stickyHeaderIndices={[]}>
        <View style={styles.header}>
          <Text style={styles.tenantName}>{tenant?.name ?? ""}</Text>
          <Link href="/settings" style={styles.settingsLink}>
            設定
          </Link>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>次の撮影</Text>
          {nextSlot ? (
            <>
              <Text style={styles.countdown}>{formatCountdown(nextSlot.startsAt, now)}</Text>
              <Text style={styles.cardSub}>
                {formatTime(nextSlot.startsAt, timezone)} の枠
                {nextSlot.businessDate !== businessDate ? "（翌営業日）" : ""}
              </Text>
            </>
          ) : (
            <Text style={styles.cardSub}>予定されている撮影はありません</Text>
          )}

          <Pressable
            style={styles.captureButton}
            onPress={() =>
              router.push({
                pathname: "/capture",
                params: nextSlot
                  ? { businessDate: nextSlot.businessDate, slotKey: nextSlot.slotKey }
                  : {},
              })
            }
            accessibilityRole="button"
          >
            <Text style={styles.captureButtonLabel}>いま撮影する</Text>
          </Pressable>
        </View>

        {queued > 0 ? (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>
              未送信の撮影が {queued} 件あります。通信が回復すると自動で送信されます。
            </Text>
          </View>
        ) : null}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>本日のコマ</Text>
          <Text style={styles.muted}>
            {formatRate(grid.rate.captured, grid.rate.expected)}（{grid.rate.captured}/
            {grid.rate.expected}）
          </Text>
        </View>
      </ScrollView>

      <View style={styles.gridArea}>
        <GridView
          rows={grid.rows}
          slotKeys={grid.slotKeys}
          timezone={timezone}
          gridSize={gridSize}
          rate={grid.rate}
          sort={sort}
          onChangeSort={setSort}
          onChangeGridSize={setGridSize}
          onPressCell={(_, cell) => {
            if (cell.captureId) router.push(`/capture/${cell.captureId}`);
          }}
        />
      </View>

      {session?.role !== "member" ? (
        <Link href="/(tabs)/log" style={styles.footerLink}>
          部署のログを見る
        </Link>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, gap: spacing.lg },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  tenantName: { color: colors.textMuted, fontSize: fontSize.sm },
  settingsLink: { color: colors.primary, fontSize: fontSize.sm },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  cardLabel: { color: colors.textMuted, fontSize: fontSize.sm },
  countdown: {
    color: colors.text,
    fontSize: fontSize.xxl,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  cardSub: { color: colors.textMuted, fontSize: fontSize.sm },
  captureButton: {
    marginTop: spacing.md,
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: "center",
  },
  captureButtonLabel: { color: colors.primaryText, fontWeight: "700", fontSize: fontSize.md },
  notice: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  noticeText: { color: colors.warning, fontSize: fontSize.sm },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sectionTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: "600" },
  gridArea: { flex: 1 },
  muted: { color: colors.textMuted, fontSize: fontSize.sm, padding: spacing.lg },
  footerLink: {
    color: colors.primary,
    fontSize: fontSize.sm,
    textAlign: "center",
    paddingVertical: spacing.md,
  },
});
