import { GoogleSignin, statusCodes } from "@react-native-google-signin/google-signin";
import {
  DEFAULT_TIMEZONE,
  ErrorCode,
  messageForCode,
  type EnsureTenantResult,
  type Role,
} from "@worklog/shared";
import {
  GoogleAuthProvider,
  onIdTokenChanged,
  signInWithCredential,
  signOut,
  type User,
} from "firebase/auth";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { ApiError, api } from "../../lib/api";
import { googleConfig } from "../../lib/config";
import { firebaseAuth } from "../../lib/firebase";

/**
 * 認証 (F-501〜504)。
 *
 * **アプリはテナント判定に一切関与しない**（CLAUDE.md）。
 * Google でログインし、サーバーの ensureTenant がドメインを照合して
 * Custom Claims を焼き込む。アプリはトークンを取り直して結果を受け取るだけ。
 */

export interface Session {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoUrl: string | null;
  tenantId: string;
  role: Role;
  tenantName: string;
  timezone: string;
}

interface AuthState {
  /** 初期化中（永続化されたセッションの復元待ち） */
  initializing: boolean;
  session: Session | null;
  /** サインイン処理中 */
  busy: boolean;
  error: string | null;
  signIn: () => Promise<void>;
  signOutUser: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth は AuthProvider の内側で使うこと");
  return ctx;
}

/** Claims からセッションを組み立てる。tenantId が無ければ未確定として null を返す */
async function buildSession(
  user: User,
  ensured?: EnsureTenantResult,
): Promise<Session | null> {
  const token = await user.getIdTokenResult();
  const tenantId = token.claims["tenantId"];
  const role = token.claims["role"];
  if (typeof tenantId !== "string" || tenantId === "") return null;
  if (role !== "member" && role !== "deptAdmin" && role !== "tenantAdmin") return null;

  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    photoUrl: user.photoURL,
    tenantId,
    role,
    tenantName: ensured?.tenantName ?? "",
    timezone: ensured?.timezone ?? DEFAULT_TIMEZONE,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [initializing, setInitializing] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    GoogleSignin.configure({
      webClientId: googleConfig.webClientId,
      iosClientId: googleConfig.iosClientId || undefined,
      offlineAccess: false,
    });
  }, []);

  /** Claims を確定させる。初回ログインでも復帰時でも同じ経路を通る（冪等） */
  const ensure = useCallback(async (user: User): Promise<Session | null> => {
    const result = await api.ensureTenant();
    if (result.claimsUpdated) {
      // Claims が変わったのでトークンを取り直す（設計書 4.1 の 4.）
      await user.getIdToken(true);
    }
    return buildSession(user, result);
  }, []);

  useEffect(() => {
    const unsubscribe = onIdTokenChanged(firebaseAuth(), (user) => {
      void (async () => {
        if (!user) {
          setSession(null);
          setInitializing(false);
          return;
        }
        try {
          // 既に Claims があればサーバーを呼ばずに復元する（起動を速くする）
          const existing = await buildSession(user);
          if (existing) {
            setSession(existing);
            setInitializing(false);
            // 背後で最新化しておく（role 変更・テナント停止の反映 F-507）
            void ensure(user)
              .then((refreshed) => {
                if (refreshed) setSession(refreshed);
              })
              .catch((err: unknown) => {
                if (err instanceof ApiError) {
                  // 停止・無効化されていたらログアウトさせる
                  setError(err.message);
                  void signOut(firebaseAuth());
                }
              });
            return;
          }
          setSession(await ensure(user));
        } catch (err) {
          setError(err instanceof ApiError ? err.message : messageForCode(ErrorCode.INTERNAL));
          await signOut(firebaseAuth());
          setSession(null);
        } finally {
          setInitializing(false);
        }
      })();
    });
    return unsubscribe;
  }, [ensure]);

  const signIn = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await GoogleSignin.hasPlayServices();
      const response = await GoogleSignin.signIn();
      if (response.type === "cancelled") return;

      const idToken = response.data.idToken;
      if (!idToken) throw new ApiError(ErrorCode.AUTH_NOT_WORKSPACE);

      const credential = GoogleAuthProvider.credential(idToken);
      const { user } = await signInWithCredential(firebaseAuth(), credential);
      // onIdTokenChanged 側でも走るが、ここで待つことで画面遷移が確実になる
      setSession(await ensure(user));
    } catch (err) {
      if (isCancellation(err)) return;
      setError(err instanceof ApiError ? err.message : messageForCode(ErrorCode.INTERNAL));
      await signOut(firebaseAuth()).catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }, [ensure]);

  const signOutUser = useCallback(async () => {
    await GoogleSignin.signOut().catch(() => undefined);
    await signOut(firebaseAuth());
    setSession(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ initializing, session, busy, error, signIn, signOutUser }),
    [initializing, session, busy, error, signIn, signOutUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function isCancellation(err: unknown): boolean {
  const code = (err as { code?: string }).code;
  return code === statusCodes.SIGN_IN_CANCELLED;
}
