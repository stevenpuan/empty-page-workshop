import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { toast } from "sonner";
import { supabase } from "./supabase";
import { logActivity } from "./logging";

export type Action = "view" | "create" | "edit" | "delete" | "export";
export type PermFlags = Record<Action, boolean>;
export type PermMap = Record<string, PermFlags>;
export type Tier = "owner" | "manager" | "staff";

export interface Profile {
  id: string;
  display_name: string | null;
  must_change_password: boolean;
  is_platform_admin: boolean;
}
export interface Company {
  id: string;
  code: string;
  name: string;
  short_name: string | null;
  theme_color: string;
  login_domain: string;
}
export interface Employee {
  id: string;
  company_id: string;
  emp_no: string;
  name: string;
  role_id: string;
  can_switch_company: boolean;
  is_active: boolean;
  role: { code: string; name: string; tier: Tier } | null;
}

interface AuthContextValue {
  /** 是否已拿到 session（不代表權限已載入） */
  loading: boolean;
  /**
   * 權限（employee / role / role_module_permissions / company_modules）是否已載入完成。
   * loading 與 permsLoaded 必須分開：頁面若只看 loading，會在 perms 還是 {} 的瞬間判定
   * can() === false 把有權限的人踢走 —— 從側欄點進去不會重現，但重新整理／書籤／LINE 連結一定中。
   */
  permsLoaded: boolean;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  company: Company | null;
  companies: Company[];
  employee: Employee | null;
  tier: Tier | null;
  isPlatformAdmin: boolean;
  isOwner: boolean;
  isManager: boolean;
  modules: Set<string>;
  can: (module: string, action?: Action) => boolean;
  moduleEnabled: (module: string) => boolean;
  switchCompany: (companyId: string) => Promise<void>;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const EMPTY_SET = new Set<string>();

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [permsLoaded, setPermsLoaded] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [perms, setPerms] = useState<PermMap>({});
  const [modules, setModules] = useState<Set<string>>(EMPTY_SET);

  const reset = () => {
    setProfile(null);
    setCompany(null);
    setCompanies([]);
    setEmployee(null);
    setPerms({});
    setModules(EMPTY_SET);
  };

  const loadUserData = async (uid: string) => {
    try {
      await loadUserDataInner(uid);
    } catch (e) {
      console.error("[auth] 權限載入失敗", e);
      toast.error("權限載入失敗，部分選單可能不會出現，請重新整理頁面");
    } finally {
      // 不論成敗都放行，否則整個 app 永遠停在「載入中…」
      setPermsLoaded(true);
    }
  };

  const loadUserDataInner = async (uid: string) => {
    // ① 確保有公司 context（一般員工首次登入自動指到所屬公司）
    const { data: cid, error: ctxErr } = await supabase.rpc("ensure_company_context");
    if (ctxErr) throw ctxErr;

    // ② 平行拉 profile / 可切換公司清單 / 當前員工列
    const [{ data: prof, error: pErr }, { data: cos, error: cErr }, { data: emps, error: eErr }] =
      await Promise.all([
        supabase
          .from("profiles")
          .select("id, display_name, must_change_password, is_platform_admin")
          .eq("id", uid)
          .maybeSingle(),
        supabase
          .from("companies")
          .select("id, code, name, short_name, theme_color, login_domain")
          .order("code"),
        cid
          ? supabase
              .from("employees")
              .select(
                "id, company_id, emp_no, name, role_id, can_switch_company, is_active, roles(code, name, tier)",
              )
              .eq("user_id", uid)
              .eq("company_id", cid)
              .eq("is_active", true)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);
    if (pErr) throw pErr;
    if (cErr) throw cErr;
    if (eErr) throw eErr;

    setProfile((prof as Profile) ?? null);
    const list = (cos ?? []) as Company[];
    setCompanies(list);
    setCompany(list.find((c) => c.id === cid) ?? null);

    const emp = emps
      ? ({
          ...(emps as Record<string, unknown>),
          role: ((emps as Record<string, unknown>)["roles"] as Employee["role"]) ?? null,
        } as unknown as Employee)
      : null;
    setEmployee(emp);

    if (!cid) {
      setPerms({});
      setModules(EMPTY_SET);
      return;
    }

    // ③ 權限矩陣（僅本角色）與公司模組開關
    const [{ data: rmp, error: rmpErr }, { data: cm, error: cmErr }] = await Promise.all([
      emp?.role_id
        ? supabase
            .from("role_module_permissions")
            .select("module_key, can_view, can_create, can_edit, can_delete, can_export")
            .eq("role_id", emp.role_id)
        : Promise.resolve({ data: [], error: null }),
      supabase.from("company_modules").select("module_key, is_enabled").eq("company_id", cid),
    ]);
    if (rmpErr) throw rmpErr;
    if (cmErr) throw cmErr;

    const map: PermMap = {};
    (rmp ?? []).forEach((p: Record<string, unknown>) => {
      map[p["module_key"] as string] = {
        view: !!p["can_view"],
        create: !!p["can_create"],
        edit: !!p["can_edit"],
        delete: !!p["can_delete"],
        export: !!p["can_export"],
      };
    });
    setPerms(map);
    setModules(
      new Set(
        (cm ?? [])
          .filter((m: Record<string, unknown>) => m["is_enabled"])
          .map((m: Record<string, unknown>) => m["module_key"] as string),
      ),
    );
  };

  useEffect(() => {
    let active = true;
    let lastLoadedUid: string | null = null;
    const runLoad = (uid: string) => {
      if (lastLoadedUid === uid) return;
      lastLoadedUid = uid;
      // 丟出回呼堆疊，避免 onAuthStateChange 內直接 await supabase 造成 deadlock（官方建議）
      setTimeout(() => {
        if (active) void loadUserData(uid);
      }, 0);
    };

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      setSession(data.session ?? null);
      if (data.session?.user) runLoad(data.session.user.id);
      else setPermsLoaded(true);
      setLoading(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
      if (sess?.user) runLoad(sess.user.id);
      else {
        lastLoadedUid = null;
        reset();
        setPermsLoaded(false);
      }
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isPlatformAdmin = !!profile?.is_platform_admin;
  const tier: Tier | null = isPlatformAdmin ? "owner" : (employee?.role?.tier ?? null);
  const isOwner = tier === "owner";
  const isManager = tier === "owner" || tier === "manager";

  // 與後端 has_perm() 同源：owner／平台管理員恆真，其餘看矩陣
  const can = (module: string, action: Action = "view") => {
    if (isOwner) return true;
    return !!perms[module]?.[action];
  };
  const moduleEnabled = (module: string) => modules.has(module);

  const switchCompany = async (companyId: string) => {
    const { error } = await supabase.rpc("switch_company", { p_company_id: companyId });
    if (error) throw error;
    await logActivity("switch_company", undefined, companyId);
    if (session?.user) {
      setPermsLoaded(false);
      await loadUserData(session.user.id);
    }
  };
  const refresh = async () => {
    if (session?.user) await loadUserData(session.user.id);
  };
  const signOut = async () => {
    await logActivity("logout", undefined, company?.id ?? null);
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider
      value={{
        loading,
        permsLoaded,
        session,
        user: session?.user ?? null,
        profile,
        company,
        companies,
        employee,
        tier,
        isPlatformAdmin,
        isOwner,
        isManager,
        modules,
        can,
        moduleEnabled,
        switchCompany,
        refresh,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
