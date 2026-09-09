import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ShieldAlert, PowerOff } from "lucide-react";
import { useAuth, type Action } from "@/lib/auth";
import { Button } from "@/components/ui/button";

/**
 * 頁面層權限守門（沿用 EIP）：
 * - 不用 <Navigate>：被擋的人可能連預設落點都沒權限，導頁會無限跳轉；停在原地說明即可
 * - 一定要等 permsLoaded
 * - 多一層 company_modules：本公司未啟用的模組（例：沂融的報價單）也擋
 * 前端的擋只是 UX，真正的門鎖在 RLS。
 */
export function RequirePerm({
  module,
  action = "view",
  children,
}: {
  module: string;
  action?: Action;
  children: ReactNode;
}) {
  const { permsLoaded, can, moduleEnabled, isPlatformAdmin } = useAuth();

  if (!permsLoaded) return <div className="text-muted-foreground py-8">載入中…</div>;

  if (!moduleEnabled(module) && !isPlatformAdmin) {
    return (
      <Blocked
        icon={<PowerOff className="h-6 w-6 text-muted-foreground" />}
        title="本公司未啟用此功能"
      >
        此模組已在「公司設定」中關閉。如需使用請聯絡老闆開啟。
      </Blocked>
    );
  }

  if (!can(module, action)) {
    return (
      <Blocked
        icon={<ShieldAlert className="h-6 w-6 text-muted-foreground" />}
        title="沒有權限檢視此頁"
      >
        此頁面需要對應的模組權限，如需使用請聯絡老闆調整「角色與權限」。
      </Blocked>
    );
  }

  return <>{children}</>;
}

function Blocked({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <div className="rounded-full bg-muted p-3">{icon}</div>
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{children}</p>
      </div>
      <Button asChild variant="outline" size="sm">
        <Link to="/dashboard">回首頁</Link>
      </Button>
    </div>
  );
}
