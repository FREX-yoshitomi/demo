# ワークログアプリ

1時間ごとの通知で2秒動画を撮るだけで、動画付き日報と勤怠記録ができる業務アプリ。

- 要件定義：[`docs/要件定義書_v1.0.md`](docs/要件定義書_v1.0.md)
- システム設計：[`docs/システム設計書_v1.0.md`](docs/システム設計書_v1.0.md)
- 実装ルール：[`CLAUDE.md`](CLAUDE.md) ← **作業前に必ず読む**
- 環境構築（人の作業）：[`docs/セットアップ手順.md`](docs/セットアップ手順.md)

---

## 現在の実装状況

設計書 第13章のマイルストーン基準。

| | 内容 | 状態 |
|---|---|---|
| M0 | モノレポ雛形・共有型・エミュレータ・シード・CI | 完了 |
| M1 | Firestore / Storage ルール + テナント分離テスト | 完了 |
| M2 | auth-ensureTenant + ログイン画面 + Claims 反映 | 完了 |
| M3 | 撮影の縦串（署名付きURL → 直PUT → サムネ生成 → commit） | 完了 |
| M4 | サムネイルグリッド（FlashList・分割数切替・空きコマ） | 完了 |
| M5 | オフラインキュー・再送・遅延フラグ | 完了 |
| M6 | 通知（Scheduler → Tasks → FCM・ばらつき・再送・休日スキップ） | 完了 |
| M8 | capture-delete と Vlog 再生成の伝播（F-9xx） | 完了（再生成の実行は M7 待ち） |
| M7 | vlog-generator（FFmpeg xstack） | 未着手 |
| M9 | report-generator（AI日報）＋日報画面 | 未着手 |
| M10 | 勤怠（明示打刻・CSV・修正申請） | 一部（撮影からの出退勤候補のみ） |
| M11 | 管理Web `/admin` | 未着手 |
| M12 | 提供者Web `/ops` | 未着手 |
| M13 | E2E・負荷・受け入れ基準の消化 | 未着手 |

その他の未着手：ESLint の導入（CI は型チェックとテストのみ）、`admin-*` / `ops-*` / `report-*` /
`attendance-*` の callable（設計書 5.3〜5.6）。

### テスト

| レイヤ | 件数 | 内容 |
|---|---|---|
| 共有ロジック | 69 | 業務日の導出（夜勤跨ぎ・タイムゾーン）、スロット列挙、遅延判定、決定的ID、状態遷移 |
| Functions ユニット | 53 | スロット受理判定、通知計画、ドメイン照合 |
| Functions 統合（エミュレータ） | 46 | 初回ログイン一式、撮影の縦串、削除の伝播、冪等性 |
| セキュリティルール | 85 | テナント越境（全コレクション）、テナント内の閲覧範囲、`/ops` 遮断、Storage 越境 |
| アプリ | 35 | アップロードキューの再送方針、グリッド組み立て |
| **合計** | **288** | |

---

## ディレクトリ

```
worklog/
├─ packages/shared/    型・定数・zodスキーマ・業務日ロジック（全層で共有）
├─ functions/          Cloud Functions（callable / Storageトリガ / スケジューラ）
├─ app/                Expo モバイルアプリ（Development Build 前提）
├─ firebase/           firestore.rules / storage.rules / 分離テスト
├─ scripts/seed.ts     開発用シードデータ（2テナント×3部署×10人）
└─ docs/               要件定義書・システム設計書・セットアップ手順
```

`web/`（管理Web）と `jobs/`（Cloud Run Jobs）は未作成。
`pnpm-workspace.yaml` には登録済みなので、ディレクトリを作れば認識される。

---

## 開発の始め方

前提：Node 22 / pnpm 11 / Java 21（Firestore・Storage エミュレータが JVM 上で動く）

```bash
corepack enable && corepack prepare pnpm@11.18.0 --activate
cd worklog
pnpm install
pnpm build                 # packages/shared をビルド（他が参照する）
```

### エミュレータとシード

```bash
pnpm emulators             # 別ターミナルで起動（UI: http://127.0.0.1:4000）
pnpm seed                  # 2テナント×3部署×10人＋直近3営業日の撮影を投入
```

シードで作られるアカウント（Auth エミュレータ）：

| メール | 権限 |
|---|---|
| `user1@acme.co.jp` | tenantAdmin |
| `user2@acme.co.jp` | deptAdmin（営業部） |
| `user3@acme.co.jp` | member |
| `user1@beta-kogyo.example.com` | 別テナント（分離の確認用） |

シードは **エミュレータ以外では起動時に停止する**（本番プロジェクトを壊さないため）。

### テスト

```bash
pnpm test                             # 全パッケージのユニットテスト
pnpm test:rules                       # テナント分離テスト（エミュレータ起動込み）
pnpm --filter @worklog/functions test:emulator   # Functions 統合テスト
pnpm -r typecheck
```

**セキュリティルールを変更したら必ず `pnpm test:rules` を通すこと。**
CI（`.github/workflows/worklog-ci.yml`）でも実行され、失敗するとマージできない。

### モバイルアプリ

Expo Go では動かない（Development Build 前提）。

```bash
cd app
cp .env.example .env       # Firebase / Google OAuth の値を入れる
pnpm ios                   # または pnpm android（初回はネイティブビルド）
```

エミュレータに繋ぐ場合は `.env` に `EXPO_PUBLIC_USE_EMULATOR=true` を設定する。
実機から繋ぐときは `EXPO_PUBLIC_EMULATOR_HOST` を開発マシンのLAN IPにする。

バンドルだけ確認したいとき（ネイティブビルド不要）：

```bash
cd app && pnpm exec expo export --platform android --output-dir /tmp/worklog-export
```

---

## デプロイ

```bash
pnpm --filter @worklog/functions build
pnpm exec firebase deploy --only firestore:rules,storage:rules --project <env>
pnpm exec firebase deploy --only functions --project <env>
```

| 環境 | Firebase プロジェクト |
|---|---|
| dev | worklog-dev |
| stg | worklog-stg |
| prod | worklog-prod |

初回は [`docs/セットアップ手順.md`](docs/セットアップ手順.md) の作業（GCP プロジェクト作成、
OAuth 同意画面、APNs 鍵、署名付きURL用のIAM権限、Cloud Scheduler / Tasks の作成）が必要。
