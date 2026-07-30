import {
  fsPath,
  listSlotKeys,
  resolveEffectiveSettings,
  type CaptureDoc,
  type GridRow,
  type OffDeclarationDoc,
} from "@worklog/shared";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";

import { firestore } from "../../lib/firebase";
import { useAuth } from "../auth/AuthProvider";
import { useTenant } from "../tenant/useTenant";
import { aggregateRate, buildGrid, type GridSortOrder } from "./buildGrid";

/**
 * サムネイルグリッドのデータ購読 (F-301〜305, F-802)。
 *
 * 部署ログ（deptId 指定）と個人ログ（自分だけ）の両方を同じ形で返す。
 */

export interface UseGridResult {
  loading: boolean;
  rows: GridRow[];
  slotKeys: string[];
  rate: { captured: number; expected: number };
}

export function useGrid(params: {
  businessDate: string | null;
  /** null なら個人ログ（自分だけ） */
  departmentId: string | null;
  sort?: GridSortOrder;
}): UseGridResult {
  const { session } = useAuth();
  const { tenant, departments, users } = useTenant();
  const [captures, setCaptures] = useState<(CaptureDoc & { id: string })[]>([]);
  const [offDeclarations, setOffDeclarations] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);

  const tenantId = session?.tenantId;
  const { businessDate, departmentId } = params;

  useEffect(() => {
    if (!tenantId || !businessDate) {
      setCaptures([]);
      setLoading(false);
      return;
    }
    const db = firestore();

    // businessDate で絞る。capturedAt から日付を作ってはいけない
    const base = collection(db, fsPath.captures(tenantId));
    const q = departmentId
      ? query(base, where("businessDate", "==", businessDate), where("departmentId", "==", departmentId))
      : query(base, where("businessDate", "==", businessDate), where("userId", "==", session.uid));

    const unsub = onSnapshot(q, (snap) => {
      setCaptures(snap.docs.map((d) => ({ id: d.id, ...(d.data() as CaptureDoc) })));
      setLoading(false);
    });
    return unsub;
  }, [tenantId, businessDate, departmentId, session?.uid]);

  useEffect(() => {
    if (!tenantId || !businessDate) return;
    const db = firestore();
    // 自分以外の申告はルールで読めないので、個人ログのときだけ購読する
    const q = query(
      collection(db, fsPath.offDeclarations(tenantId)),
      where("businessDate", "==", businessDate),
      where("userId", "==", session?.uid ?? "__none__"),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const next: Record<string, string[]> = {};
        for (const d of snap.docs) {
          const data = d.data() as OffDeclarationDoc;
          next[data.userId] = data.slotKeys ?? [];
        }
        setOffDeclarations(next);
      },
      // 権限が無い場合は空のままにする（グリッドは表示できる）
      () => setOffDeclarations({}),
    );
    return unsub;
  }, [tenantId, businessDate, session?.uid]);

  const slotKeys = useMemo(() => {
    if (!tenant) return [];
    const dept = departmentId ? departments.find((d) => d.id === departmentId) : undefined;
    const settings = resolveEffectiveSettings(tenant, dept ?? null);
    return listSlotKeys(settings.workingHours, settings.captureIntervalMin);
  }, [tenant, departments, departmentId]);

  const rows = useMemo(() => {
    const memberIds = new Set(
      departmentId
        ? users.filter((u) => u.departmentIds.includes(departmentId)).map((u) => u.id)
        : session
          ? [session.uid]
          : [],
    );

    return buildGrid({
      users: users
        .filter((u) => memberIds.has(u.id) && u.status === "active")
        .map((u) => ({
          userId: u.id,
          userName: u.name,
          userNameKana: u.nameKana,
          photoUrl: u.photoUrl,
        })),
      captures: captures.map((c) => ({
        captureId: c.id,
        userId: c.userId,
        slotKey: c.slotKey,
        status: c.status,
        capturedAtIso: c.capturedAt.toDate().toISOString(),
        isLate: c.isLate,
        thumbUrl: c.thumbPath,
      })),
      slotKeys,
      declaredOff: offDeclarations,
      sort: params.sort ?? "name",
    });
  }, [users, captures, slotKeys, offDeclarations, departmentId, session, params.sort]);

  return { loading, rows, slotKeys, rate: aggregateRate(rows) };
}
