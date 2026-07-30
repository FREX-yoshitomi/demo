import type { GridCell } from "@worklog/shared";
import { Image } from "expo-image";
import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { formatTime } from "../lib/format";
import { colors, fontSize, radius } from "../theme";

/**
 * グリッドの1コマ (F-301, F-304)。
 *
 * ⚠️ ここに動画コンポーネントを置かない。
 *    端末の同時デコード数の制約があるため、一覧は必ず静止画サムネイル。
 *    通しで見るのはサーバー生成の Vlog 1本（CLAUDE.md）。
 */

interface Props {
  cell: GridCell;
  size: number;
  timezone: string;
  /** サムネイル取得用の Authorization ヘッダ（media.ts 参照） */
  headers: Record<string, string>;
  thumbBaseUrl: (objectPath: string) => string;
  onPress?: (cell: GridCell) => void;
}

function GridCellTileBase({ cell, size, timezone, headers, thumbBaseUrl, onPress }: Props) {
  const tileStyle = [styles.tile, { width: size, height: (size * 16) / 9 }];

  if (cell.state === "captured" || cell.state === "late") {
    return (
      <Pressable
        style={tileStyle}
        onPress={() => onPress?.(cell)}
        accessibilityRole="button"
        accessibilityLabel={`${cell.slotKey} の撮影を再生`}
      >
        {cell.thumbUrl ? (
          <Image
            source={{ uri: thumbBaseUrl(cell.thumbUrl), headers }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            // サムネイルは変わらないのでディスクキャッシュに任せる（受け入れ基準 #4）
            cachePolicy="disk"
            transition={120}
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.processing]}>
            <Text style={styles.processingText}>処理中</Text>
          </View>
        )}
        <View style={styles.footer}>
          {/* 撮影時刻は分単位で出す。丸めない (F-105) */}
          <Text style={styles.time}>
            {cell.capturedAtIso ? formatTime(cell.capturedAtIso, timezone) : ""}
          </Text>
          {cell.state === "late" ? <Text style={styles.lateBadge}>遅延</Text> : null}
        </View>
      </Pressable>
    );
  }

  if (cell.state === "deleted") {
    return (
      <View style={[tileStyle, styles.deleted]}>
        <Text style={styles.placeholderText}>削除済み</Text>
        <Text style={styles.slotLabel}>{cell.slotKey}</Text>
      </View>
    );
  }

  if (cell.state === "declaredOff") {
    return (
      <View style={[tileStyle, styles.off]}>
        <Text style={styles.placeholderText}>対象外</Text>
        <Text style={styles.slotLabel}>{cell.slotKey}</Text>
      </View>
    );
  }

  return (
    <View style={[tileStyle, styles.empty]}>
      <Text style={styles.slotLabel}>{cell.slotKey}</Text>
    </View>
  );
}

export const GridCellTile = memo(GridCellTileBase);

const styles = StyleSheet.create({
  tile: {
    borderRadius: radius.sm,
    overflow: "hidden",
    backgroundColor: colors.empty,
    alignItems: "center",
    justifyContent: "center",
  },
  empty: {
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: "dashed",
  },
  deleted: {
    backgroundColor: colors.deleted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  off: {
    backgroundColor: colors.surfaceAlt,
  },
  processing: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceAlt,
  },
  processingText: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
  },
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 4,
    paddingVertical: 2,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  time: {
    color: "#fff",
    fontSize: fontSize.xs,
    fontVariant: ["tabular-nums"],
  },
  lateBadge: {
    color: colors.warning,
    fontSize: fontSize.xs,
  },
  placeholderText: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
  },
  slotLabel: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    fontVariant: ["tabular-nums"],
    marginTop: 2,
  },
});
