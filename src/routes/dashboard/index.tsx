import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Users, Bell, KeyRound, Building2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { useBoardRealtime } from "@/hooks/useBoardRealtime";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/dashboard/")({ component: Home });

interface BoardStats {
  in_progress_count: number;
  pending_count: number;
  assigned_count: number;
  blocked_count: number;
  waiting_customer_count: number;
  overdue_count: number;
  due_today_count: number;
  active_order_count: number | null;
  done_task_count: number | null;
}

const ZERO_STATS: BoardStats = {
  in_progress_count: 0,
  pending_count: 0,
  assigned_count: 0,
  blocked_count: 0,
  waiting_customer_count: 0,
  overdue_count: 0,
  due_today_count: 0,
  active_order_count: 0,
  done_task_count: 0,
};


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

  useBoardRealtime();
  // board_stats view：還沒有訂單（或 view 尚未建立）時顯示全零，不擋畫面
  const { data: board = ZERO_STATS } = useQuery({
    queryKey: ["board_stats", company?.id],
    enabled: !!company?.id,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("board_stats")
        .select("*")
        .eq("company_id", company!.id)
        .maybeSingle();
      if (error) return ZERO_STATS;
      return { ...ZERO_STATS, ...(data ?? {}) } as BoardStats;
    },
  });

  const name = employee?.name ?? profile?.display_name ?? "";
  return (
    <div className="space-y-6">
      <PageHeader
        title={`歡迎回來，${name}`}
        description={`${company?.name ?? ""} · 角色：${isPlatformAdmin && !employee ? "系統維護" : (employee?.role?.name ?? "—")}`}
      />

      {can("board", "view") && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <BoardCard label="進行中" value={board.in_progress_count} tone="text-blue-600 dark:text-blue-400" />
            <BoardCard
              label="待排工"
              value={(board.pending_count ?? 0) + (board.assigned_count ?? 0)}
              tone="text-muted-foreground"
            />
            <BoardCard
              label="卡關"
              value={board.blocked_count}
              tone="text-orange-600 dark:text-orange-400"
              alert={board.blocked_count > 0}
            />
            <BoardCard label="等客戶" value={board.waiting_customer_count} tone="text-yellow-600 dark:text-yellow-400" />
            <BoardCard
              label="逾期"
              value={board.overdue_count}
              tone="text-destructive"
              alert={board.overdue_count > 0}
            />
            <BoardCard label="今日到期" value={board.due_today_count} tone="text-purple-600 dark:text-purple-400" />
          </div>
          <p className="text-xs text-muted-foreground">
            活躍訂單 {board.active_order_count ?? 0} 張 / 已完成工序 {board.done_task_count ?? 0} 道
          </p>
        </div>
      )}

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

function BoardCard({
  label,
  value,
  tone,
  alert,
}: {
  label: string;
  value: number;
  tone: string;
  alert?: boolean;
}) {
  return (
    <Link
      to="/dashboard/board"
      className="block transition-transform hover:-translate-y-0.5"
    >
      <Card className={alert ? "border-2 border-current/40" : ""}>
        <CardContent className="p-4">
          <div className={`text-2xl font-bold tracking-tight ${tone}`}>{value ?? 0}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
        </CardContent>
      </Card>
    </Link>
  );
}
