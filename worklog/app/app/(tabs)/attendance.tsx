import { buildAttendanceId, fsPath, type AttendanceDoc } from "@worklog/shared";
import { doc, onSnapshot } from "firebase/firestore";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "../../src/features/auth/AuthProvider";
import { useTenant } from "../../src/features/tenant/useTenant";
import { formatTime } from "../../src/lib/format";
import { firestore } from "../../src/lib/firebase";
import { colors, fontSize, radius, spacing } from "../../src/theme";

/**
 * 勤怠 (F-701, F-703)。
 *
 * 現時点では「撮影から自動で付いた出退勤候補」の確認のみ。
 * 明示打刻 (F-702)・修正申請 (F-705)・月次CSV (F-704) は M10 で実装する。
 *
 * ⚠️ 労務上の位置づけ：MVPでは既存勤怠への**補助エビデンス**に留める
 *    （要件定義書 4.7 の留意点）。ここを正式な打刻として案内しない。
 */
export default function AttendanceScreen() {
  const { session } = useAuth();
  const { businessDate, timezone } = useTenant();
  const [record, setRecord] = useState<AttendanceDoc | null>(null);

  useEffect(() => {
    if (!session || !businessDate) return;
    const id = buildAttendanceId(session.uid, businessDate);
    return onSnapshot(
      doc(firestore(), fsPath.attendanceRecord(session.tenantId, id)),
      (snap) => setRecord(snap.exists() ? (snap.data() as AttendanceDoc) : null),
      () => setRecord(null),
    );
  }, [session, businessDate]);

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>本日の記録</Text>
        <Row
          label="初回撮影（出勤時刻候補）"
          value={record?.firstCaptureAt ? formatTime(record.firstCaptureAt.toDate(), timezone) : "—"}
        />
        <Row
          label="最終撮影（退勤時刻候補）"
          value={record?.lastCaptureAt ? formatTime(record.lastCaptureAt.toDate(), timezone) : "—"}
        />
        <Row label="勤務区分" value={workTypeLabel(record?.workType)} />
      </View>

      <Text style={styles.note}>
        撮影記録は既存の勤怠システムへの補助エビデンスです。{"\n"}
        打刻の修正申請と月次CSVの出力は次のリリースで対応します。
      </Text>
    </SafeAreaView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function workTypeLabel(workType: AttendanceDoc["workType"] | undefined): string {
  switch (workType) {
    case "normal":
      return "通常";
    case "shift":
      return "シフト";
    case "night":
      return "夜勤";
    case "leave":
      return "有給";
    case "absent":
      return "欠勤";
    case "remote":
      return "在宅";
    default:
      return "—";
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg, gap: spacing.lg },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  cardTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: "600" },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  rowLabel: { color: colors.textMuted, fontSize: fontSize.sm, flex: 1 },
  rowValue: {
    color: colors.text,
    fontSize: fontSize.md,
    fontVariant: ["tabular-nums"],
  },
  note: { color: colors.textMuted, fontSize: fontSize.xs, lineHeight: 18 },
});
