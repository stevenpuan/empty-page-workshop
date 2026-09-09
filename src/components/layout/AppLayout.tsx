import { Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { AppSidebar } from "./AppSidebar";
import { ForcePasswordChange } from "@/components/ForcePasswordChange";
import { Button } from "@/components/ui/button";
import { themeHex } from "@/lib/theme";

/**
 * 四道關卡（沿用 EIP AppLayout）：
 * ① 未登入 → /login
 * ② profiles.must_change_password → 整頁強制改密碼（唯一出口是登出）
 * ③ 沒有在職員工列（且非平台管理員）→ 「帳號尚未開通」
 * ④ 正常版面：側欄 + 內容；頂端色條依公司主題色（祥興 cyan／沂融 orange）
 */
export function AppLayout() {
  const {
    loading,
    permsLoaded,
    session,
    profile,
    employee,
    isPlatformAdmin,
    company,
    signOut,
    refresh,
  } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !session) navigate({ to: "/login" });
  }, [loading, session, navigate]);

  if (loading || (session && !permsLoaded)) {
    return (
      <div className="min-h-screen grid place-items-center text-muted-foreground">載入中…</div>
    );
  }
  if (!session) return null;

  if (profile?.must_change_password) {
    return (
      <ForcePasswordChange
        email={session.user?.email ?? null}
        onDone={() => void refresh()}
        onSignOut={() => void signOut()}
      />
    );
  }

  if (!employee && !isPlatformAdmin) {
    return (
      <div className="min-h-screen grid place-items-center px-4 text-center">
        <div className="max-w-sm space-y-3">
          <h1 className="text-xl font-semibold">帳號尚未開通</h1>
          <p className="text-sm text-muted-foreground">
            這個登入帳號還沒有對應的在職員工資料，請聯絡老闆在「員工與帳號」中開通。
          </p>
          <Button variant="outline" onClick={signOut}>
            登出
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background" data-company={company?.code ?? ""}>
      <div
        className="fixed inset-x-0 top-0 z-50 h-1"
        style={{ background: themeHex(company?.theme_color) }}
      />
      <AppSidebar />
      <main className="lg:pl-64">
        <div className="p-4 sm:p-6 pb-20 max-w-7xl mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
