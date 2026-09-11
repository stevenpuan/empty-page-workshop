import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck, Check, X, Clock, BellOff } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { humanizeError } from "@/lib/app-error";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";

interface Notification {
  id: string;
  title: string;
  body: string | null;
  is_read: boolean;
  ref_type: string | null;
  ref_id: string | null;
  line_status: "sent" | "failed" | "pending" | null;
  created_at: string;
}

/** 相對時間：3分鐘前、2小時前、昨天… */
function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "剛剛";
  if (min < 60) return `${min} 分鐘前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小時前`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "昨天";
  if (day < 30) return `${day} 天前`;
  return new Date(iso).toLocaleDateString("zh-TW");
}

/** 依 ref_type 導航到相關頁面；無匹配回傳 false（僅標記已讀） */
const REF_ROUTE: Record<string, string> = {
  attendance: "/attendance",
  payable: "/dashboard/payables",
  receivable: "/dashboard/receivables",
  employee: "/dashboard/settings/employees",
};

/** 側欄鈴鐺＋通知中心下拉面板：未讀數、Realtime 訂閱、標記已讀、導航 */
export function NotificationBell() {
  const { employee } = useAuth();
  const empId = employee?.id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  // 未讀數（my_notification_count view）
  const { data: unread = 0 } = useQuery({
    queryKey: ["notification_unread", empId],
    enabled: !!empId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("my_notification_count")
        .select("unread_count")
        .single();
      if (error) {
        // view 不存在時退回直接 count
        const { count } = await supabase
          .from("notifications")
          .select("id", { count: "exact", head: true })
          .eq("employee_id", empId)
          .eq("is_read", false);
        return count ?? 0;
      }
      return (data?.unread_count as number) ?? 0;
    },
  });

  // 通知列表（展開時才查）
  const { data: notifications = [], isLoading } = useQuery({
    queryKey: ["notifications_panel", empId],
    enabled: !!empId && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as Notification[];
    },
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["notification_unread", empId] });
    qc.invalidateQueries({ queryKey: ["notifications_panel", empId] });
  };

  // Realtime：新通知即時更新 + toast
  useEffect(() => {
    if (!empId) return;
    const channel = supabase.channel(`bell-${empId}-${Math.random().toString(36).slice(2, 8)}`);
    channel.on(
      "postgres_changes" as never,
      {
        event: "INSERT",
        schema: "public",
        table: "notifications",
        filter: `employee_id=eq.${empId}`,
      },
      (payload: { new: { title?: string } }) => {
        refresh();
        if (payload.new?.title) toast.info(payload.new.title);
      },
    );
    channel.on(
      "postgres_changes" as never,
      {
        event: "UPDATE",
        schema: "public",
        table: "notifications",
        filter: `employee_id=eq.${empId}`,
      },
      () => refresh(),
    );
    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empId]);

  const markAllRead = async () => {
    const { error } = await supabase.rpc("mark_all_notifications_read");
    if (error) {
      toast.error(humanizeError(error, "全部標記已讀"));
      return;
    }
    refresh();
  };

  const openNotification = async (n: Notification) => {
    if (!n.is_read) {
      const { error } = await supabase.rpc("mark_notification_read", {
        p_notification_id: n.id,
      });
      if (error) toast.error(humanizeError(error, "標記已讀"));
      else refresh();
    }
    if (n.ref_type === "order_task" && n.ref_id) {
      setOpen(false);
      navigate({ to: "/dashboard/orders/$orderId", params: { orderId: n.ref_id } });
      return;
    }
    const to = n.ref_type ? REF_ROUTE[n.ref_type] : undefined;
    if (to) {
      setOpen(false);
      navigate({ to });
    }
  };

  if (!empId) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="relative p-2 rounded-md hover:bg-accent text-muted-foreground"
          aria-label="通知中心"
        >
          <Bell className="w-4 h-4" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-destructive text-white text-[10px] leading-4 text-center font-semibold">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-[380px] p-0">
        {/* 頂部 */}
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <span className="font-semibold text-sm">通知</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={markAllRead}
            disabled={unread === 0}
          >
            <CheckCheck className="w-3.5 h-3.5" />
            全部標記已讀
          </Button>
        </div>
        {/* 列表 */}
        <div className="max-h-[420px] overflow-y-auto">
          {isLoading ? (
            <div className="space-y-3 p-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="space-y-1.5">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-full" />
                </div>
              ))}
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
              <BellOff className="w-8 h-8" />
              <p className="text-sm">目前沒有通知</p>
            </div>
          ) : (
            notifications.map((n) => (
              <button
                key={n.id}
                onClick={() => openNotification(n)}
                className={`w-full text-left px-4 py-3 border-b last:border-b-0 transition-colors hover:bg-accent/60 ${
                  n.is_read ? "bg-card" : "bg-sky-50 dark:bg-sky-950/30"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span
                    className={`text-sm leading-snug ${n.is_read ? "font-normal" : "font-semibold"}`}
                  >
                    {n.title}
                  </span>
                  {n.line_status && (
                    <span className="shrink-0 mt-0.5" title={`LINE：${n.line_status}`}>
                      {n.line_status === "sent" && (
                        <Check className="w-3.5 h-3.5 text-green-600" />
                      )}
                      {n.line_status === "failed" && (
                        <X className="w-3.5 h-3.5 text-destructive" />
                      )}
                      {n.line_status === "pending" && (
                        <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                      )}
                    </span>
                  )}
                </div>
                {n.body && (
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{n.body}</p>
                )}
                <p className="text-[11px] text-muted-foreground mt-1">
                  {relativeTime(n.created_at)}
                </p>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
