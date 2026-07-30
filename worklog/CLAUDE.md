# CLAUDE.md

このリポジトリで作業する際に、必ず最初に読むこと。

## プロダクト概要

業務向けワークログアプリ。韓国発のVlogアプリ **Setlog** の仕組みを、企業向けに作り直したもの。

1. 稼働時間中、1時間ごとにプッシュ通知が届く
2. 通知をタップして **2秒の動画** を撮る（インカメ／アウトカメ、無音、加工不可）
3. 部署メンバーの撮影が **スクロール可能なサムネイルグリッド** に集まる
4. 1日の終わりに、サーバー生成の **Vlog 1本** と **AIが生成した日報案** ができる
5. 撮影時刻は **分単位**（12:04）で記録され、勤怠の補助エビデンスになる

詳細な要件は `docs/要件定義書_v1.0.md`。要件IDは `F-101` 形式で、コード内のコメントとコミットメッセージで参照する。

## 絶対に守ること

- **テナント分離**：初回ログイン時にサーバー側で `hd` クレームを許可ドメインと照合し、**Custom Claims に `tenantId` を焼き込む**。以降の認可は `request.auth.token.tenantId` のみで判定する。**アプリのコードはテナント判定に一切関与しない**。全データは `/tenants/{tenantId}/` 配下。新しいコレクションやバケットパスを追加したら、必ず分離テストも追加する。他社の従業員の動画が見えることは事業として致命的。
- **アップロードはサーバーを経由しない**：署名付きURL（有効期限15分）を発行し、端末から Cloud Storage へ直接送る。完了は Storage のイベントトリガで検知する。毎正時に100人が一斉送信するため、Functions を経由させると詰まる。
- **撮影のリアルタイム性**：カメラロールからの選択は実装しない。その場で撮影したものだけを受け付ける。これが勤怠エビデンスとしての価値の根拠。
- **時刻を丸めない**：撮影時刻は秒精度で保存し、分単位で表示する。UI側でもDB側でも丸め処理を入れない。
- **アプリ内で複数動画を同時再生しない**：端末の同時デコード数に上限があるため。一覧は**静止画サムネイルのグリッド**、タップで**単体再生**、通しで見るのは**サーバー生成のVlog 1本**。この3本立てを崩さない。
- **本人の削除を必ず通す**：本人はいつでも自分の撮影を削除できる。削除は5分以内に全経路へ反映し、生成済みVlogは該当コマを空きコマにして再生成する。**時刻の記録だけは保持**する（勤怠の整合性のため）。管理者でも映像は復元できない。
- **AI日報を自動確定しない**：必ず本人の確認・編集を経て提出される。撮影やメモが少ない日は、業務内容を推測させず「情報が不足している」と明示させる。
- **AI日報の既定はテキストのみモード**：メモと作業タグだけで生成し、映像を外部APIに送らない。画像ありモードはテナント設定で明示的に有効化されたときだけ。
- **バックグラウンド自動撮影は実装しない**：OS制約で不可能。通知起点の手動撮影が仕様。
- **リージョンは asia-northeast1 に固定**：データを国外に出さない。

## 設計書からの意図的な逸脱

実装して分かった制約により、設計書と違う形にした箇所。**元に戻さないこと。**
理由はコード側のコメントにも書いてある。

| 箇所 | 設計書 | 実装 | 理由 |
|---|---|---|---|
| セキュリティルール | `match /{document=**}` のキャッチオールで read を許可 | キャッチオールを外し、全コレクションを明示列挙 | ルールの `allow` は **OR 評価**。緩いキャッチオールがあると reports の本人限定などの厳しいルールが無効化される。列挙漏れは「読めない」側に倒れる |
| Storage ルール | `/tenants/{t}/{allPaths=**}` で一括許可 | 用途ごとにパスを列挙（captures / thumbs / vlogs / exports） | 同じ OR 評価の問題。実際に exports の管理者限定がワイルドカードに打ち消されるのをテストで検出した |
| `hd` クレーム | IDトークンの `hd` を検証 | 検証済みメールのドメインを照合 | Firebase Auth の IDトークンに Google の `hd` は**入らない**。本物の `hd` は Identity Platform の blocking function からしか読めない。ゲートはサーバー側の `domainIndex` なので強度は同じ。個人Gmailは別途明示的に拒否 |
| `captureId` | `${uid}_${businessDate}_${slotKey}` | slotKey 部分を `1200` 形式に（`paths.ts` の `slotToken`） | `:` は GCS のオブジェクト名・署名付きURLで扱いが面倒。Firestore の `slotKey` フィールドは `12:00` のまま |
| `CaptureStatus` | uploaded / processing / ready / deleted | `pending` を追加 | 「枠を予約したが実ファイルが無い」状態が無いと、二重撮影の防止と空きコマ表示 (F-304) が両立しない |
| グリッドのサムネイル | CDN 経由で配信 | Storage のパスからURLを組み立て、IDトークンを Authorization ヘッダで送る | `getDownloadURL()` は①1件ごとに往復が要る（100人分を2秒以内に出せない）②返るURLがルールを迂回する capability URL。テナント分離を優先した |
| 氏名順 (F-305) | 氏名で並べる | `nameKana`（読み）で並べる。無ければ氏名で代替 | 漢字は `localeCompare('ja')` でも五十音順にならない（「佐藤」<「青木」になる）。読みが無いと五十音順は原理的に作れない |
| iOS 対応下限 | iOS 16 以降 | 実質 iOS 16.4 以降 | Expo 57 / React Native 0.86 の下限。非機能要件の見直しが必要 |
| pnpm の配置 | （記載なし） | `pnpm-workspace.yaml` に `nodeLinker: hoisted` | Metro は仮想ストア配下の推移的依存を解決できず、Expo アプリがバンドルできない |

## 技術スタック

| 領域 | 技術 |
|---|---|
| モバイル | Expo (React Native) / TypeScript ／ **Development Build 前提**（Expo Go では動かない） |
| カメラ | expo-camera（2秒固定録画 / 720p / H.264 / 約2Mbps） |
| 通知 | Cloud Scheduler → FCM / APNs（配信時刻に0〜3分のばらつきを持たせる） |
| 認証 | Firebase Auth（Googleプロバイダのみ）＋ Custom Claims |
| DB | Firestore |
| ストレージ | Cloud Storage + CDN（ライフサイクルで Nearline へ自動移行） |
| サーバー処理 | Cloud Functions |
| 動画合成 | FFmpeg（`xstack` + `concat`）on Cloud Run Jobs |
| AI | Claude API |
| 管理Web | Next.js / TypeScript |

## ディレクトリ構成

```
/app          Expoモバイルアプリ
/web          Next.js 管理Web（テナント管理・提供者管理）
/functions    Cloud Functions
/jobs         Cloud Run Jobs（Vlog生成・AI日報生成）
/packages     共有型定義・定数
/docs         要件定義書ほか
```

## データモデル（基本形）

```
/tenants/{tenantId}
  settings                 timezone, holidays[], captureInterval, workingHours,
                           workTags[], reportTemplate, reportDeadline,
                           gridSize, aiMode(text|image), retentionMonths, theme
  /users/{userId}          uid, email, name, departmentIds[], role, status,
                           joinedAt, leftAt
  /departments/{deptId}    name, parentId, settings（撮影間隔・稼働時間帯の上書き）
  /captures/{captureId}    userId, departmentId, businessDate, slotHour,
                           capturedAt(秒精度), videoPath, thumbPath,
                           memo, workTag, isLate, deletedAt
  /vlogs/{vlogId}          scope(department|personal), targetId, businessDate,
                           videoPath, pages, generatedAt
  /reports/{reportId}      userId, businessDate, aiDraft, body, status, submittedAt
  /attendance/{recordId}   userId, businessDate, workType(normal|shift|night|leave|absent),
                           firstCaptureAt, lastCaptureAt, workedMinutes
  /auditLogs/{logId}       actorId, action, targetPath, at   ※追記専用
```

`role` は `member` / `deptAdmin` / `tenantAdmin` の3種。提供者（FREX）側の運用者は別の仕組みで管理し、テナントの業務データは既定で読めないようにする。

**`businessDate` は「勤務開始時刻が属する日」**。日跨ぎの夜勤も1つの業務日にまとまる。日付で集計する処理はすべてこのフィールドを使い、`capturedAt` から直接日付を作らない。

## 実装の優先順位

1. テナント分離のセキュリティルールとそのテスト（**最初に書く**）
2. Google SSO ログイン → Custom Claims 付与
3. 撮影 → 署名付きURLで直接アップロード → サムネイルグリッド表示（**縦串をまず通す**）
4. 実機で分割数の限界と録画音を検証し、既定値を決める
5. Vlog書き出し（FFmpeg）
6. AI日報（テキストのみモードから）
7. 組織階層・権限・管理Web
8. 勤怠集計・CSV

## 開発上の注意

- コミットメッセージに要件IDを入れる（例：`feat: 2秒録画の実装 (F-102)`）
- セキュリティルールを変更したら、必ずエミュレータで分離テストを実行する
- 休日・有給・欠勤の日は通知を配信せず、撮影率の分母からも除外する（要件定義書 第5章）
- アップロードは毎正時直後に集中する。リトライとバックオフを前提に実装する
- 撮影率などの集計は、Firestoreの単一ドキュメント書き込み制限を避けるため日次バッチか分散カウンタで行う
- 端末の負荷（発熱・バッテリー）に関わる変更は、実機で確認してからマージする
