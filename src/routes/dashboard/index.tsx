import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Users, Bell, KeyRound, Building2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/dashboard/")({ component: Home });

/**
 * S1 版首頁：只放底座相關的狀態卡。S3 會換成營運總覽（逾期數、等校稿數、今日出貨）。
 */
function Home() {
  const { employee, profile, company, isOwner, can, isPlatformAdmin } = useAuth();

  const { data: stats } = useQuery({
    queryKey: ["home-stats", company?.id, employee?.id],
    enabled: !!company?.id,
    queryFn: async () => {
      const [emp, noAcct, unread] = await Promise.all([
        supabase
          .from("employees")
          .select("id", { count: "exact", head: true })
          .eq("company_id", company!.id)
          .eq("is_active", true),
        supabase
          .from("employees")
          .select("id", { count: "exact", head: true })
          .eq("company_id", company!.id)
          .eq("is_active", true)
          .is("user_id", null),
        employee?.id
          ? supabase
              .from("notifications")
              .select("id", { count: "exact", head: true })
              .eq("employee_id", employee.id)
              .eq("is_read", false)
          : Promise.resolve({ count: 0, error: null }),
      ]);
      // 兩個 error 都 throw：原本被丟掉時卡片顯示 0，看起來像「今天沒事」
      if (emp.error) throw emp.error;
      if (noAcct.error) throw noAcct.error;
      if (unread.error) throw unread.error;
      return { employees: emp.count ?? 0, noAccount: noAcct.count ?? 0, unread: unread.count ?? 0 };
    },
  });

  const name = employee?.name ?? profile?.display_name ?? "";
  return (
    <div className="space-y-6">
      <PageHeader
        title={`歡迎回來，${name}`}
        description={`${company?.name ?? ""} · 角色：${isPlatformAdmin && !employee ? "系統維護" : (employee?.role?.name ?? "—")}`}
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {can("employees", "view") && (
          <StatCard
            icon={<Users className="w-5 h-5" />}
            label="在職員工"
            value={stats?.employees ?? "—"}
            to="/dashboard/settings/employees"
          />
        )}
        {can("employees", "edit") && (
          <StatCard
            icon={<KeyRound className="w-5 h-5" />}
            label="尚未開通帳號"
            value={stats?.noAccount ?? "—"}
            to="/dashboard/settings/employees"
            hint="員工列存在但還沒有登入帳號"
          />
        )}
        {employee && (
          <StatCard
            icon={<Bell className="w-5 h-5" />}
            label="未讀通知"
            value={stats?.unread ?? "—"}
            to="/dashboard/notifications"
          />
        )}
        {isOwner && (
          <StatCard
            icon={<Building2 className="w-5 h-5" />}
            label="公司設定"
            value={company?.code ?? "—"}
            to="/dashboard/settings/company"
            hint="統編、打卡座標、LINE、模組開關"
          />
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        S1 底座已就位：帳號、角色權限、選單、系統參數、代碼字典、日誌、通知規則。訂單與派工看板將於
        S2／S3 上線。
      </p>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  to,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  to: string;
  hint?: string;
}) {
  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <Link to={to as any} className="block transition-transform hover:-translate-y-0.5">
      <Card>
        <CardContent className="p-5 flex items-start gap-4">
          <div className="rounded-lg bg-primary/10 text-primary p-2.5">{icon}</div>
          <div className="min-w-0">
            <div className="text-sm text-muted-foreground">{label}</div>
            <div className="text-2xl font-bold tracking-tight">{value}</div>
            {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
