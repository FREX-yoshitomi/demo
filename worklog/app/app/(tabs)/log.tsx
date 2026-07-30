import { DEFAULT_GRID_SIZE, type GridSize } from "@worklog/shared";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { GridView } from "../../src/components/GridView";
import { useAuth } from "../../src/features/auth/AuthProvider";
import type { GridSortOrder } from "../../src/features/log/buildGrid";
import { useGrid } from "../../src/features/log/useGrid";
import { useTenant } from "../../src/features/tenant/useTenant";
import { formatBusinessDate } from "../../src/lib/format";
import { colors, fontSize, radius, spacing } from "../../src/theme";

/**
 * 部署ログ (F-201, F-301〜305, F-802)。
 *
 * 見える部署は「自分の所属」＋「横断閲覧を許可された部署」だけに絞る (F-603, F-604)。
 * ルール側はテナント境界までしか見ないので、ここで絞るのは表示の話。
 * サーバー側でも同じ判定を持つ（functions/src/capture/playbackUrl.ts の canViewCapture）。
 */
export default function LogScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const { departments, me, businessDate, timezone, settings } = useTenant();

  const [deptId, setDeptId] = useState<string | null>(null);
  const [sort, setSort] = useState<GridSortOrder>("name");
  const [gridSize, setGridSize] = useState<GridSize>(DEFAULT_GRID_SIZE);

  const visibleDepartments = departments.filter((d) => {
    if (session?.role === "tenantAdmin") return true;
    if (me?.departmentIds.includes(d.id)) return true;
    return me?.crossViewDeptIds?.includes(d.id) ?? false;
  });

  useEffect(() => {
    if (deptId === null && visibleDepartments.length > 0) {
      setDeptId(visibleDepartments[0]!.id);
    }
  }, [deptId, visibleDepartments]);

  useEffect(() => {
    if (settings) setGridSize(settings.gridSize);
  }, [settings]);

  const grid = useGrid({ businessDate, departmentId: deptId, sort });

  if (visibleDepartments.length === 0) {
    return (
      <SafeAreaView style={styles.container} edges={["bottom"]}>
        <Text style={styles.muted}>
          閲覧できる部署がありません。所属の設定は管理者にお問い合わせください。
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <View style={styles.header}>
        <Text style={styles.date}>{businessDate ? formatBusinessDate(businessDate) : ""}</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.deptRow}>
        {visibleDepartments.map((dept) => (
          <Pressable
            key={dept.id}
            onPress={() => setDeptId(dept.id)}
            style={[styles.deptChip, deptId === dept.id && styles.deptChipActive]}
            accessibilityRole="button"
            accessibilityState={{ selected: deptId === dept.id }}
          >
            <Text style={[styles.deptLabel, deptId === dept.id && styles.deptLabelActive]}>
              {dept.name}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

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
          // タップで単体再生 (F-303)。同時再生はしない
          if (cell.captureId) router.push(`/capture/${cell.captureId}`);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  date: { color: colors.text, fontSize: fontSize.lg, fontWeight: "600" },
  deptRow: { paddingHorizontal: spacing.lg, flexGrow: 0, marginBottom: spacing.md },
  deptChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    marginRight: spacing.sm,
  },
  deptChipActive: { backgroundColor: colors.primary },
  deptLabel: { color: colors.textMuted, fontSize: fontSize.sm },
  deptLabelActive: { color: colors.primaryText, fontWeight: "600" },
  muted: { color: colors.textMuted, fontSize: fontSize.sm, padding: spacing.xl },
});
