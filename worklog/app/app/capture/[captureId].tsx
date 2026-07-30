import { useQuery } from "@tanstack/react-query";
import { fsPath, parseCaptureId, type CaptureDoc } from "@worklog/shared";
import { useVideoPlayer, VideoView } from "expo-video";
import { useLocalSearchParams, useRouter } from "expo-router";
import { doc, onSnapshot } from "firebase/firestore";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { useAuth } from "../../src/features/auth/AuthProvider";
import { useTenant } from "../../src/features/tenant/useTenant";
import { ApiError, api } from "../../src/lib/api";
import { formatDateTime } from "../../src/lib/format";
import { firestore } from "../../src/lib/firebase";
import { colors, fontSize, radius, spacing } from "../../src/theme";

/**
 * 単体再生 (F-303) と本人による削除 (F-901)。
 *
 * **一覧では動画を再生しない**。ここだけが動画を再生する画面（CLAUDE.md）。
 * 削除は取り消せないことを明示してから実行する (F-904)。
 */
export default function CaptureDetailScreen() {
  const router = useRouter();
  const { captureId } = useLocalSearchParams<{ captureId: string }>();
  const { session } = useAuth();
  const { timezone, users } = useTenant();

  const [capture, setCapture] = useState<CaptureDoc | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!session || !captureId) return;
    return onSnapshot(
      doc(firestore(), fsPath.capture(session.tenantId, captureId)),
      (snap) => {
        if (!snap.exists()) {
          setNotFound(true);
          return;
        }
        setCapture(snap.data() as CaptureDoc);
      },
      () => setNotFound(true),
    );
  }, [session, captureId]);

  // 再生用の署名付きURL（有効期限1時間）。削除済みなら要求しない
  const playback = useQuery({
    queryKey: ["playbackUrl", captureId],
    enabled: Boolean(captureId) && capture?.status === "ready",
    staleTime: 50 * 60_000,
    queryFn: () => api.playbackUrl({ captureId: captureId! }),
  });

  const player = useVideoPlayer(playback.data?.url ?? null, (instance) => {
    instance.loop = true;
    instance.muted = true; // 一覧から来た直後に音が出ないようにする
    instance.play();
  });

  const isOwn = capture?.userId === session?.uid;
  const owner = users.find((u) => u.id === capture?.userId);

  const confirmDelete = () => {
    Alert.alert(
      "この撮影を削除しますか",
      "映像は完全に削除され、管理者でも復元できません。\n撮影した時刻の記録は勤怠のために残ります。",
      [
        { text: "キャンセル", style: "cancel" },
        {
          text: "削除する",
          style: "destructive",
          onPress: () => void performDelete(),
        },
      ],
    );
  };

  const performDelete = async () => {
    if (!captureId) return;
    setDeleting(true);
    try {
      await api.deleteCapture({ captureId });
      router.back();
    } catch (err) {
      Alert.alert("削除できませんでした", err instanceof ApiError ? err.message : "もう一度お試しください");
    } finally {
      setDeleting(false);
    }
  };

  if (notFound) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>この撮影は見つかりませんでした。</Text>
      </View>
    );
  }

  if (!capture) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (capture.status === "deleted") {
    return (
      <View style={styles.container}>
        <View style={styles.deletedBox}>
          <Text style={styles.deletedTitle}>削除済み</Text>
          <Text style={styles.muted}>
            映像は削除されています。撮影時刻の記録のみ残っています。
          </Text>
        </View>
        <Meta capture={capture} timezone={timezone} ownerName={owner?.name} />
      </View>
    );
  }

  const parsed = parseCaptureId(captureId ?? "");

  return (
    <View style={styles.container}>
      <View style={styles.playerBox}>
        {playback.isPending ? (
          <ActivityIndicator color={colors.primary} />
        ) : playback.isError ? (
          <Text style={styles.muted}>再生できませんでした</Text>
        ) : (
          <VideoView
            player={player}
            style={styles.player}
            nativeControls={false}
            contentFit="contain"
          />
        )}
      </View>

      <Meta capture={capture} timezone={timezone} ownerName={owner?.name} />

      {isOwn || parsed?.uid === session?.uid ? (
        <Pressable
          style={[styles.deleteButton, deleting && styles.buttonDisabled]}
          onPress={confirmDelete}
          disabled={deleting}
          accessibilityRole="button"
        >
          {deleting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.deleteLabel}>この撮影を削除する</Text>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

function Meta({
  capture,
  timezone,
  ownerName,
}: {
  capture: CaptureDoc;
  timezone: string;
  ownerName?: string;
}) {
  return (
    <View style={styles.meta}>
      <Text style={styles.metaTime}>
        {formatDateTime(capture.capturedAt.toDate(), timezone)}
        {capture.isLate ? <Text style={styles.late}> ・遅延</Text> : null}
      </Text>
      {ownerName ? <Text style={styles.muted}>{ownerName}</Text> : null}
      {capture.workTag ? <Text style={styles.tag}>{capture.workTag}</Text> : null}
      {capture.memo ? <Text style={styles.memo}>{capture.memo}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg, gap: spacing.lg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
  playerBox: {
    aspectRatio: 9 / 16,
    borderRadius: radius.lg,
    overflow: "hidden",
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
  },
  player: { width: "100%", height: "100%" },
  deletedBox: {
    backgroundColor: colors.deleted,
    borderRadius: radius.lg,
    padding: spacing.xl,
    gap: spacing.sm,
    alignItems: "center",
  },
  deletedTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: "600" },
  meta: { gap: spacing.xs },
  metaTime: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  late: { color: colors.warning, fontSize: fontSize.sm, fontWeight: "400" },
  tag: { color: colors.primary, fontSize: fontSize.sm },
  memo: { color: colors.text, fontSize: fontSize.md, marginTop: spacing.sm },
  muted: { color: colors.textMuted, fontSize: fontSize.sm, textAlign: "center" },
  deleteButton: {
    marginTop: "auto",
    backgroundColor: colors.danger,
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
    alignItems: "center",
  },
  deleteLabel: { color: "#fff", fontWeight: "700", fontSize: fontSize.md },
  buttonDisabled: { opacity: 0.6 },
});
