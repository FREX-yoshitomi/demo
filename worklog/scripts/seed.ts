/**
 * 開発用シードデータ（設計書 第12章）。
 *
 * 2テナント × 3部署 × 10人。テナント分離の確認に使えるよう、必ず2社作る。
 *
 *   pnpm emulators            # 別ターミナルでエミュレータを起動
 *   pnpm seed                 # 投入
 *
 * 本番プロジェクトに向けて実行しないよう、エミュレータ以外では止める。
 */
import {
  DEFAULT_CAPTURE_GRACE_MIN,
  DEFAULT_GRID_SIZE,
  DEFAULT_RETENTION_MONTHS,
  DEFAULT_TIMEZONE,
  buildAttendanceId,
  buildCaptureId,
  buildOffDeclarationId,
  fsPath,
  listSlotKeys,
  resolveBusinessDate,
  slotStartAt,
  storagePath,
  type Role,
  type WorkingHours,
} from "@worklog/shared";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const PROJECT_ID = process.env.GCLOUD_PROJECT ?? "worklog-dev";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error(
    "FIRESTORE_EMULATOR_HOST が設定されていません。\n" +
      "本番プロジェクトを壊さないため、シードはエミュレータ専用にしています。\n" +
      "  例: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 pnpm seed",
  );
  process.exit(1);
}

initializeApp({ projectId: PROJECT_ID });
const db = getFirestore();
// overrides や memo など、値が無ければフィールド自体を作らない
db.settings({ ignoreUndefinedProperties: true });
const auth = getAuth();

const WORKING_HOURS: WorkingHours = { start: "09:00", end: "18:00" };
const NIGHT_HOURS: WorkingHours = { start: "22:00", end: "06:00" };

interface TenantSeed {
  tenantId: string;
  name: string;
  domain: string;
  departments: { id: string; name: string; parentId: string | null; nightShift?: boolean }[];
}

const TENANTS: TenantSeed[] = [
  {
    tenantId: "acme",
    name: "株式会社アクメ",
    domain: "acme.co.jp",
    departments: [
      { id: "hq", name: "本部", parentId: null },
      { id: "sales", name: "営業部", parentId: "hq" },
      { id: "dev", name: "開発部", parentId: "hq" },
    ],
  },
  {
    tenantId: "beta",
    name: "ベータ工業株式会社",
    domain: "beta-kogyo.example.com",
    departments: [
      { id: "hq", name: "管理本部", parentId: null },
      { id: "factory", name: "製造課", parentId: "hq" },
      { id: "night", name: "夜勤班", parentId: "hq", nightShift: true },
    ],
  },
];

const GIVEN_NAMES = [
  "太郎",
  "花子",
  "一郎",
  "美咲",
  "健太",
  "さくら",
  "大輔",
  "陽菜",
  "翔",
  "結衣",
];
const WORK_TAGS = ["営業", "開発", "会議", "移動", "事務"];

function roleFor(index: number): Role {
  if (index === 0) return "tenantAdmin";
  if (index === 1 || index === 4) return "deptAdmin";
  return "member";
}

async function seedTenant(seed: TenantSeed): Promise<void> {
  const now = Timestamp.now();

  await db.doc(fsPath.tenant(seed.tenantId)).set({
    name: seed.name,
    status: "active",
    allowedDomains: [seed.domain],
    timezone: DEFAULT_TIMEZONE,
    // 2026年の祝日を数日だけ（通知が飛ばないことの確認用：受け入れ基準 #9）
    holidays: ["2026-08-10", "2026-09-21", "2026-09-22"],
    captureIntervalMin: 60,
    workingHours: WORKING_HOURS,
    captureGraceMin: DEFAULT_CAPTURE_GRACE_MIN,
    workTags: WORK_TAGS,
    defaultCamera: "back",
    reportTemplate: "本日の業務\n進捗\n課題\n明日の予定",
    reportDeadline: "12:00",
    gridSize: DEFAULT_GRID_SIZE,
    aiMode: "text",
    retentionMonths: DEFAULT_RETENTION_MONTHS,
    autoProvisionUsers: true,
    invites: [],
    createdAt: now,
    updatedAt: now,
  });

  await db.doc(fsPath.domainIndex(seed.domain)).set({
    tenantId: seed.tenantId,
    addedAt: now,
  });

  await db.doc(fsPath.tenantIndex(seed.tenantId)).set({
    name: seed.name,
    status: "active",
    userCount: 10,
    createdAt: now,
  });

  for (const [i, dept] of seed.departments.entries()) {
    await db.doc(fsPath.department(seed.tenantId, dept.id)).set({
      name: dept.name,
      parentId: dept.parentId,
      order: i,
      overrides: dept.nightShift ? { workingHours: NIGHT_HOURS } : undefined,
    });
  }

  const memberDepts = seed.departments.filter((d) => d.parentId !== null);

  for (let i = 0; i < 10; i += 1) {
    const uid = `${seed.tenantId}user${String(i + 1).padStart(2, "0")}`;
    const localPart = `user${i + 1}`;
    const email = `${localPart}@${seed.domain}`;
    const dept = memberDepts[i % memberDepts.length]!;

    try {
      await auth.createUser({ uid, email, emailVerified: true, displayName: GIVEN_NAMES[i] });
    } catch {
      // すでに居る場合は無視
    }
    const role = roleFor(i);
    await auth.setCustomUserClaims(uid, { tenantId: seed.tenantId, role });

    await db.doc(fsPath.user(seed.tenantId, uid)).set({
      email,
      name: `${seed.tenantId === "acme" ? "山田" : "佐藤"} ${GIVEN_NAMES[i]}`,
      departmentIds: role === "tenantAdmin" ? ["hq", dept.id] : [dept.id],
      role,
      status: "active",
      // 役員相当（先頭ユーザー）には横断閲覧権限を持たせる (F-604)
      crossViewDeptIds: role === "tenantAdmin" ? seed.departments.map((d) => d.id) : [],
      fcmTokens: [],
      preferences: { camera: "back", notificationsEnabled: true },
      joinedAt: Timestamp.fromDate(new Date("2026-04-01T00:00:00+09:00")),
      leftAt: null,
    });
  }

  console.log(`  ${seed.tenantId}: テナント・部署3件・ユーザー10人`);
}

/**
 * 直近3営業日分の撮影を作る。
 * グリッド表示の確認用に「未撮影の空きコマ」「遅延」「削除済み」を必ず混ぜる (F-304)。
 */
async function seedCaptures(seed: TenantSeed, referenceDate: Date): Promise<void> {
  const businessDate = resolveBusinessDate(referenceDate, DEFAULT_TIMEZONE, WORKING_HOURS);
  const memberDepts = seed.departments.filter((d) => d.parentId !== null);
  let created = 0;

  for (let dayOffset = 0; dayOffset < 3; dayOffset += 1) {
    const date = shiftDate(businessDate, -dayOffset);

    for (let i = 0; i < 10; i += 1) {
      const uid = `${seed.tenantId}user${String(i + 1).padStart(2, "0")}`;
      const dept = memberDepts[i % memberDepts.length]!;
      const hours = dept.nightShift ? NIGHT_HOURS : WORKING_HOURS;
      const slots = listSlotKeys(hours, 60);

      let first: Timestamp | undefined;
      let last: Timestamp | undefined;

      for (const [slotIndex, slotKey] of slots.entries()) {
        // 10%は未撮影（空きコマ）。ユーザーとスロットで決まるので毎回同じ絵になる
        if ((i + slotIndex) % 10 === 3) continue;

        const captureId = buildCaptureId(uid, date, slotKey);
        const slotStart = slotStartAt(date, slotKey, DEFAULT_TIMEZONE, hours);
        // 猶予内のばらつきを付ける（分単位表示の確認用 F-105）
        const offsetSec = ((i * 7 + slotIndex * 13) % 9) * 60 + ((i * 17) % 60);
        const isLate = (i + slotIndex) % 17 === 5;
        const capturedAt = new Date(
          slotStart.getTime() + (isLate ? 61 * 60_000 : offsetSec * 1000),
        );
        const isDeleted = (i + slotIndex) % 23 === 7;

        const stamp = Timestamp.fromDate(capturedAt);
        if (!first || stamp.toMillis() < first.toMillis()) first = stamp;
        if (!last || stamp.toMillis() > last.toMillis()) last = stamp;

        await db.doc(fsPath.capture(seed.tenantId, captureId)).set({
          userId: uid,
          departmentId: dept.id,
          businessDate: date,
          slotKey,
          capturedAt: stamp,
          status: isDeleted ? "deleted" : "ready",
          videoPath: storagePath.captureVideo(seed.tenantId, date, captureId),
          thumbPath: isDeleted ? null : storagePath.captureThumb(seed.tenantId, date, captureId),
          durationSec: 2,
          memo: isDeleted ? undefined : sampleMemo(i, slotIndex),
          workTag: WORK_TAGS[(i + slotIndex) % WORK_TAGS.length],
          isLate,
          camera: slotIndex % 3 === 0 ? "front" : "back",
          deletedAt: isDeleted ? Timestamp.fromDate(new Date(capturedAt.getTime() + 3_600_000)) : null,
          createdAt: stamp,
          updatedAt: stamp,
        });
        created += 1;
      }

      await db.doc(fsPath.attendanceRecord(seed.tenantId, buildAttendanceId(uid, date))).set({
        userId: uid,
        businessDate: date,
        workType: dept.nightShift ? "night" : i === 9 && dayOffset === 1 ? "leave" : "normal",
        firstCaptureAt: first ?? null,
        lastCaptureAt: last ?? null,
        breaks: [],
        corrections: [],
      });
    }

    // 「撮影しない時間」の申告の例 (F-113)
    const offUid = `${seed.tenantId}user03`;
    await db
      .doc(fsPath.offDeclaration(seed.tenantId, buildOffDeclarationId(offUid, date)))
      .set({
        userId: offUid,
        businessDate: date,
        slotKeys: ["12:00"],
        reason: "昼休憩",
        updatedAt: Timestamp.now(),
      });
  }

  console.log(`  ${seed.tenantId}: 撮影 ${created}件（3営業日分・空きコマ/遅延/削除済みを含む）`);
}

function shiftDate(businessDate: string, days: number): string {
  const [y, m, d] = businessDate.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function sampleMemo(userIndex: number, slotIndex: number): string | undefined {
  const memos = [
    "A社訪問",
    "見積書作成",
    "定例MTG",
    "移動中",
    "実装レビュー",
    undefined,
    "問い合わせ対応",
    undefined,
  ];
  return memos[(userIndex + slotIndex) % memos.length];
}

async function seedOperators(): Promise<void> {
  await db.doc(fsPath.operator("opsfrex01")).set({
    email: "ops@frex.works",
    role: "ops",
  });
  try {
    await auth.createUser({
      uid: "opsfrex01",
      email: "ops@frex.works",
      emailVerified: true,
      displayName: "FREX運用",
    });
  } catch {
    // 既存なら無視
  }
  await auth.setCustomUserClaims("opsfrex01", { ops: true, role: "ops" });
  console.log("  ops: 提供者運用アカウント 1件");
}

async function main(): Promise<void> {
  console.log(`シード投入開始 (project=${PROJECT_ID}, emulator)`);
  const referenceDate = new Date();

  for (const tenant of TENANTS) {
    await seedTenant(tenant);
    await seedCaptures(tenant, referenceDate);
  }
  await seedOperators();

  console.log("\n完了。ログインは Auth エミュレータの以下のアカウントで確認できる：");
  console.log("  user1@acme.co.jp                 … tenantAdmin");
  console.log("  user2@acme.co.jp                 … deptAdmin（営業部）");
  console.log("  user3@acme.co.jp                 … member");
  console.log("  user1@beta-kogyo.example.com     … 別テナント（分離の確認用）");
}

void main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
