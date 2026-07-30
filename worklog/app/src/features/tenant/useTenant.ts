import {
  DEFAULT_TIMEZONE,
  fsPath,
  listSlotKeys,
  nextSlotAfter,
  resolveEffectiveSettings,
  resolveBusinessDate,
  type DepartmentDoc,
  type EffectiveSettings,
  type SlotRef,
  type TenantDoc,
  type UserDoc,
} from "@worklog/shared";
import { collection, doc, onSnapshot } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";

import { firestore } from "../../lib/firebase";
import { useAuth } from "../auth/AuthProvider";

/**
 * テナント設定・部署・メンバーの購読。
 * 読み取りは Firestore へ直接（セキュリティルールで守られる：設計書 第1章「原則」）。
 */

export interface TenantData {
  loading: boolean;
  tenant: TenantDoc | null;
  departments: (DepartmentDoc & { id: string })[];
  users: (UserDoc & { id: string })[];
  me: (UserDoc & { id: string }) | null;
  /** 自分の主所属部署の上書きを反映した実効設定 (F-111) */
  settings: EffectiveSettings | null;
  timezone: string;
  slotKeys: string[];
  /** 今日の業務日（テナントのタイムゾーンで解釈）*/
  businessDate: string | null;
  /** 次の撮影スロット。休日はスキップ済み (F-801) */
  nextSlot: SlotRef | null;
}

export function useTenant(): TenantData {
  const { session } = useAuth();
  const tenantId = session?.tenantId;

  const [tenant, setTenant] = useState<TenantDoc | null>(null);
  const [departments, setDepartments] = useState<(DepartmentDoc & { id: string })[]>([]);
  const [users, setUsers] = useState<(UserDoc & { id: string })[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenantId) {
      setTenant(null);
      setDepartments([]);
      setUsers([]);
      setLoading(false);
      return;
    }
    const db = firestore();

    const unsubTenant = onSnapshot(doc(db, fsPath.tenant(tenantId)), (snap) => {
      setTenant(snap.exists() ? (snap.data() as TenantDoc) : null);
      setLoading(false);
    });

    const unsubDepts = onSnapshot(collection(db, fsPath.departments(tenantId)), (snap) => {
      setDepartments(
        snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as DepartmentDoc) }))
          .sort((a, b) => a.order - b.order),
      );
    });

    const unsubUsers = onSnapshot(collection(db, fsPath.users(tenantId)), (snap) => {
      setUsers(snap.docs.map((d) => ({ id: d.id, ...(d.data() as UserDoc) })));
    });

    return () => {
      unsubTenant();
      unsubDepts();
      unsubUsers();
    };
  }, [tenantId]);

  const me = useMemo(
    () => users.find((u) => u.id === session?.uid) ?? null,
    [users, session?.uid],
  );

  const settings = useMemo(() => {
    if (!tenant) return null;
    const deptId = me?.departmentIds[0];
    const dept = deptId ? departments.find((d) => d.id === deptId) : undefined;
    return resolveEffectiveSettings(tenant, dept ?? null);
  }, [tenant, me, departments]);

  const slotKeys = useMemo(
    () => (settings ? listSlotKeys(settings.workingHours, settings.captureIntervalMin) : []),
    [settings],
  );

  const businessDate = useMemo(
    () =>
      settings
        ? resolveBusinessDate(new Date(), settings.timezone, settings.workingHours)
        : null,
    [settings],
  );

  const nextSlot = useMemo(() => {
    if (!settings) return null;
    const holidays = new Set(settings.holidays);
    return nextSlotAfter(
      new Date(),
      settings.timezone,
      settings.workingHours,
      settings.captureIntervalMin,
      { isBusinessDay: (d) => !holidays.has(d) },
    );
  }, [settings]);

  return {
    loading,
    tenant,
    departments,
    users,
    me,
    settings,
    timezone: settings?.timezone ?? DEFAULT_TIMEZONE,
    slotKeys,
    businessDate,
    nextSlot,
  };
}
