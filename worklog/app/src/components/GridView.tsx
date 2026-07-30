import { FlashList } from "@shopify/flash-list";
import { GRID_SIZES, type GridCell, type GridRow, type GridSize } from "@worklog/shared";
import { useEffect, useMemo, useState } from "react";
import { Dimensions, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { formatRate } from "../lib/format";
import { authHeaders, mediaUrl } from "../lib/media";
import { colors, fontSize, radius, spacing } from "../theme";
import { GridCellTile } from "./GridCellTile";
import type { GridSortOrder } from "../features/log/buildGrid";

/**
 * スクロール可能なサムネイルグリッド (F-301, F-302, F-305)。
 *
 * FlashList でメンバー行を仮想化する。**人数上限は設けない** (F-203)。
 * 1画面あたりの分割数（4/6/9/12）はタイルサイズの変更として実装する。
 */

const SORT_LABELS: Record<GridSortOrder, string> = {
  name: "氏名順",
  capturedAt: "撮影時刻順",
  missingFirst: "未撮影を先頭",
};

interface Props {
  rows: GridRow[];
  slotKeys: string[];
  timezone: string;
  gridSize: GridSize;
  rate: { captured: number; expected: number };
  sort: GridSortOrder;
  onChangeSort: (sort: GridSortOrder) => void;
  onChangeGridSize: (size: GridSize) => void;
  onPressCell: (row: GridRow, cell: GridCell) => void;
}

export function GridView({
  rows,
  slotKeys,
  timezone,
  gridSize,
  rate,
  sort,
  onChangeSort,
  onChangeGridSize,
  onPressCell,
}: Props) {
  const [headers, setHeaders] = useState<Record<string, string>>({});

  useEffect(() => {
    // IDトークンは1時間有効。グリッド全体で1回だけ取る
    void authHeaders().then(setHeaders);
  }, []);

  const tileSize = useMemo(() => {
    const screenWidth = Dimensions.get("window").width;
    const usable = screenWidth - spacing.lg * 2 - 96; // 96 = 氏名列
    const perRow = Math.max(2, Math.round(Math.sqrt(gridSize) * 1.5));
    return Math.floor(usable / perRow) - spacing.xs;
  }, [gridSize]);

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <Text style={styles.rate}>
          撮影率 {formatRate(rate.captured, rate.expected)}
          <Text style={styles.rateSub}>
            {"  "}
            {rate.captured}/{rate.expected}
          </Text>
        </Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
        {(Object.keys(SORT_LABELS) as GridSortOrder[]).map((key) => (
          <Chip
            key={key}
            label={SORT_LABELS[key]}
            active={sort === key}
            onPress={() => onChangeSort(key)}
          />
        ))}
        <View style={styles.chipDivider} />
        {GRID_SIZES.map((size) => (
          <Chip
            key={size}
            label={`${size}分割`}
            active={gridSize === size}
            onPress={() => onChangeGridSize(size)}
          />
        ))}
      </ScrollView>

      <FlashList
        data={rows}
        keyExtractor={(row) => row.userId}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={styles.nameColumn}>
              <Text style={styles.name} numberOfLines={2}>
                {item.userName}
              </Text>
              <Text style={styles.rowRate}>
                {item.capturedCount}/{item.expectedCount}
              </Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.cells}>
                {item.cells.map((cell) => (
                  <GridCellTile
                    key={cell.slotKey}
                    cell={cell}
                    size={tileSize}
                    timezone={timezone}
                    headers={headers}
                    thumbBaseUrl={mediaUrl}
                    onPress={(c) => onPressCell(item, c)}
                  />
                ))}
              </View>
            </ScrollView>
          </View>
        )}
        ListEmptyComponent={
          <Text style={styles.emptyMessage}>
            {slotKeys.length === 0
              ? "稼働時間帯が未設定です。管理者にお問い合わせください。"
              : "表示できるメンバーがいません。"}
          </Text>
        }
      />
    </View>
  );
}

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  toolbar: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  rate: { color: colors.text, fontSize: fontSize.lg, fontWeight: "600" },
  rateSub: { color: colors.textMuted, fontSize: fontSize.sm, fontWeight: "400" },
  chipRow: { paddingHorizontal: spacing.lg, flexGrow: 0, marginBottom: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    marginRight: spacing.sm,
  },
  chipActive: { backgroundColor: colors.primary },
  chipLabel: { color: colors.textMuted, fontSize: fontSize.sm },
  chipLabelActive: { color: colors.primaryText, fontWeight: "600" },
  chipDivider: { width: 1, backgroundColor: colors.border, marginRight: spacing.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    gap: spacing.sm,
  },
  nameColumn: { width: 88 },
  name: { color: colors.text, fontSize: fontSize.sm },
  rowRate: { color: colors.textMuted, fontSize: fontSize.xs, fontVariant: ["tabular-nums"] },
  cells: { flexDirection: "row", gap: spacing.xs },
  emptyMessage: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    textAlign: "center",
    padding: spacing.xl,
  },
});
