import {
  CAPTURE_DURATION_SEC,
  MEMO_MAX_LENGTH,
  currentSlotAt,
  type CameraFacing,
} from "@worklog/shared";
import { CameraView, useCameraPermissions, useMicrophonePermissions } from "expo-camera";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { enqueue, processQueue } from "../src/features/capture/uploadQueue";
import { useTenant } from "../src/features/tenant/useTenant";
import { colors, fontSize, radius, spacing } from "../src/theme";

/**
 * 撮影画面 (F-102〜F-108)。
 *
 * - 2秒で自動停止（maxDuration で強制）
 * - インカメ／アウトカメの切替（既定はテナント設定 F-103）
 * - **カメラロールからの選択は用意しない** (F-106)
 * - 撮影 → メモ／作業タグ → 送信。送信はキュー経由なので圏外でも失敗しない (F-112)
 */

type Phase = "camera" | "review" | "sending";

export default function CaptureScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ businessDate?: string; slotKey?: string }>();
  const { settings, nextSlot, timezone } = useTenant();

  const cameraRef = useRef<CameraView>(null);
  const [cameraPermission, requestCamera] = useCameraPermissions();
  const [micPermission, requestMic] = useMicrophonePermissions();

  const [phase, setPhase] = useState<Phase>("camera");
  const [facing, setFacing] = useState<CameraFacing>("back");
  const [recording, setRecording] = useState(false);
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [capturedAt, setCapturedAt] = useState<Date | null>(null);
  const [memo, setMemo] = useState("");
  const [workTag, setWorkTag] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (settings) setFacing(settings.defaultCamera);
  }, [settings]);

  useEffect(() => {
    if (!cameraPermission?.granted) void requestCamera();
    if (!micPermission?.granted) void requestMic();
  }, [cameraPermission?.granted, micPermission?.granted, requestCamera, requestMic]);

  /**
   * 撮影対象のスロット。
   * 通知から来た場合はそのスロット、ホームから来た場合は直近のスロット。
   * businessDate は端末で日付文字列を作らず、必ず shared の導出関数を通す。
   */
  const target = useMemo(() => {
    if (params.businessDate && params.slotKey) {
      return { businessDate: params.businessDate, slotKey: params.slotKey };
    }
    if (!settings) return null;
    // 直前に始まったスロットを対象にする（通知を見落として後から撮る場合）
    const current = currentSlotAt(
      new Date(),
      timezone,
      settings.workingHours,
      settings.captureIntervalMin,
    );
    if (current) return { businessDate: current.businessDate, slotKey: current.slotKey };
    // 稼働開始前は次のスロットを案内する（サーバー側では tooEarly で断られる）
    if (nextSlot) return { businessDate: nextSlot.businessDate, slotKey: nextSlot.slotKey };
    return null;
  }, [params.businessDate, params.slotKey, settings, nextSlot, timezone]);

  const startRecording = useCallback(async () => {
    if (!cameraRef.current || recording) return;
    setError(null);
    setRecording(true);
    // 撮影時刻はここで確定させる。以降のアップロード再送でも変えない (F-105, F-112)
    const startedAt = new Date();
    setCapturedAt(startedAt);

    try {
      const result = await cameraRef.current.recordAsync({
        maxDuration: CAPTURE_DURATION_SEC,
      });
      if (!result?.uri) throw new Error("録画に失敗しました");
      setVideoUri(result.uri);
      setPhase("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "録画に失敗しました");
      setCapturedAt(null);
    } finally {
      setRecording(false);
    }
  }, [recording]);

  const send = useCallback(async () => {
    if (!videoUri || !capturedAt || !target) return;
    setPhase("sending");
    try {
      await enqueue({
        businessDate: target.businessDate,
        slotKey: target.slotKey,
        capturedAt,
        camera: facing,
        localUri: videoUri,
        memo: memo.trim() || undefined,
        workTag,
      });
      // すぐ送る。失敗してもキューに残るので画面は閉じてよい
      void processQueue();
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : "送信の準備に失敗しました");
      setPhase("review");
    }
  }, [videoUri, capturedAt, target, facing, memo, workTag, router]);

  if (!cameraPermission?.granted) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <Text style={styles.message}>
            撮影するにはカメラの使用を許可してください。{"\n"}
            端末の設定から変更できます。
          </Text>
          <Pressable style={styles.secondaryButton} onPress={() => router.back()}>
            <Text style={styles.secondaryLabel}>閉じる</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (phase === "camera") {
    return (
      <View style={styles.container}>
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing={facing === "front" ? "front" : "back"}
          mode="video"
          videoQuality="720p"
        />
        <SafeAreaView style={styles.overlay}>
          <View style={styles.topBar}>
            <Pressable onPress={() => router.back()} accessibilityRole="button">
              <Text style={styles.overlayText}>閉じる</Text>
            </Pressable>
            <Text style={styles.overlayText}>
              {target ? `${target.slotKey} の枠` : "撮影枠が特定できません"}
            </Text>
            <Pressable
              onPress={() => setFacing(facing === "front" ? "back" : "front")}
              accessibilityRole="button"
              accessibilityLabel="カメラを切り替える"
            >
              <Text style={styles.overlayText}>切替</Text>
            </Pressable>
          </View>

          <View style={styles.bottomBar}>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Text style={styles.hint}>タップで{CAPTURE_DURATION_SEC}秒だけ録画します</Text>
            <Pressable
              style={[styles.shutter, recording && styles.shutterRecording]}
              onPress={() => void startRecording()}
              disabled={recording || !target}
              accessibilityRole="button"
              accessibilityLabel="録画する"
            >
              {recording ? <ActivityIndicator color="#fff" /> : null}
            </Pressable>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <SafeAreaView style={styles.reviewContainer}>
        <ScrollView contentContainerStyle={styles.reviewContent}>
          <Text style={styles.reviewTitle}>撮影しました</Text>
          <Text style={styles.reviewSub}>
            {target?.slotKey} の枠 ／{" "}
            {capturedAt
              ? `${String(capturedAt.getHours()).padStart(2, "0")}:${String(
                  capturedAt.getMinutes(),
                ).padStart(2, "0")}`
              : ""}
          </Text>

          <Text style={styles.label}>一言メモ（任意）</Text>
          <TextInput
            style={styles.input}
            value={memo}
            onChangeText={(text) => setMemo(text.slice(0, MEMO_MAX_LENGTH))}
            placeholder="例：A社訪問"
            placeholderTextColor={colors.textMuted}
            maxLength={MEMO_MAX_LENGTH}
            multiline
          />
          <Text style={styles.counter}>
            {memo.length}/{MEMO_MAX_LENGTH}
          </Text>

          <Text style={styles.label}>作業タグ（任意）</Text>
          <View style={styles.tagRow}>
            {(settings?.workTags ?? []).map((tag) => (
              <Pressable
                key={tag}
                onPress={() => setWorkTag(workTag === tag ? undefined : tag)}
                style={[styles.tag, workTag === tag && styles.tagActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: workTag === tag }}
              >
                <Text style={[styles.tagLabel, workTag === tag && styles.tagLabelActive]}>
                  {tag}
                </Text>
              </Pressable>
            ))}
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>

        <View style={styles.reviewActions}>
          <Pressable
            style={styles.secondaryButton}
            onPress={() => {
              // 撮り直しはアップロード前のみ。コミット後は削除 → 猶予内なら再撮影
              setVideoUri(null);
              setCapturedAt(null);
              setPhase("camera");
            }}
            disabled={phase === "sending"}
          >
            <Text style={styles.secondaryLabel}>撮り直す</Text>
          </Pressable>
          <Pressable
            style={[styles.primaryButton, phase === "sending" && styles.buttonDisabled]}
            onPress={() => void send()}
            disabled={phase === "sending"}
          >
            {phase === "sending" ? (
              <ActivityIndicator color={colors.primaryText} />
            ) : (
              <Text style={styles.primaryLabel}>送信する</Text>
            )}
          </Pressable>
        </View>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  overlay: { flex: 1, justifyContent: "space-between" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.lg },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: spacing.lg,
  },
  bottomBar: { alignItems: "center", gap: spacing.md, paddingBottom: spacing.xl },
  overlayText: { color: "#fff", fontSize: fontSize.sm },
  hint: { color: "rgba(255,255,255,0.8)", fontSize: fontSize.xs },
  shutter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.danger,
    borderWidth: 4,
    borderColor: "rgba(255,255,255,0.9)",
    alignItems: "center",
    justifyContent: "center",
  },
  shutterRecording: { backgroundColor: colors.warning },
  reviewContainer: { flex: 1, backgroundColor: colors.bg },
  reviewContent: { padding: spacing.lg, gap: spacing.sm },
  reviewTitle: { color: colors.text, fontSize: fontSize.xl, fontWeight: "700" },
  reviewSub: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    marginBottom: spacing.lg,
    fontVariant: ["tabular-nums"],
  },
  label: { color: colors.textMuted, fontSize: fontSize.sm, marginTop: spacing.md },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    color: colors.text,
    padding: spacing.md,
    minHeight: 72,
    fontSize: fontSize.md,
    textAlignVertical: "top",
  },
  counter: { color: colors.textMuted, fontSize: fontSize.xs, textAlign: "right" },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  tag: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
  },
  tagActive: { backgroundColor: colors.primary },
  tagLabel: { color: colors.textMuted, fontSize: fontSize.sm },
  tagLabelActive: { color: colors.primaryText, fontWeight: "600" },
  reviewActions: { flexDirection: "row", gap: spacing.md, padding: spacing.lg },
  primaryButton: {
    flex: 2,
    backgroundColor: colors.primary,
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
    alignItems: "center",
  },
  primaryLabel: { color: colors.primaryText, fontWeight: "700", fontSize: fontSize.md },
  secondaryButton: {
    flex: 1,
    backgroundColor: colors.surfaceAlt,
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
    alignItems: "center",
  },
  secondaryLabel: { color: colors.text, fontSize: fontSize.md },
  buttonDisabled: { opacity: 0.6 },
  message: {
    color: colors.text,
    fontSize: fontSize.md,
    textAlign: "center",
    paddingHorizontal: spacing.xl,
    lineHeight: 24,
  },
  error: { color: colors.danger, fontSize: fontSize.sm },
});
