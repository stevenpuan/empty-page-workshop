import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Bell, CheckCheck, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { humanizeError } from "@/lib/app-error";
import { fmtDateTime } from "@/lib/dates";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/notifications")({ component: Page });

interface Notif {
  id: string;
  rule_code: string;
  ref_type: string | null;
  ref_id: string | null;
  title: string;
  body: string;
  is_read: boolean;
  line_status: string;
  created_at: string;
}

const LINE_LABEL: Record<string, string> = {
  pending: "LINE 待送",
  sent: "LINE 已送",
  failed: "LINE 失敗",
  skipped: "",
  digest: "LINE 彙整",
};

function Page() {
  const { employee } = useAuth();
  const empId = employee?.id;
  const [items, setItems] = useState<Notif[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "unread">("all");

  const load = useCallback(async () => {
    if (!empId) return;
    const { data, error } = await supabase
      .from("notifications")
      .select("id, rule_code, ref_type, ref_id, title, body, is_read, line_status, created_at")
      .eq("employee_id", empId)
      .order("created_at", { ascending: false })
      .limit(200);
    // 原本不接 error 時，token 過期會顯示「目前沒有通知」，使用者以為真的沒事
    if (error) {
      setLoadError(humanizeError(error, "載入通知"));
      return;
    }
    setLoadError(null);
    setItems((data ?? []) as Notif[]);
  }, [empId]);

  useEffect(() => {
    void load();
    if (!empId) return;
    const channel = supabase.channel(`notif-page-${empId}`);
    channel.on(
      "postgres_changes" as never,
      { event: "*", schema: "public", table: "notifications", filter: `employee_id=eq.${empId}` },
      () => void load(),
    );
    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [empId, load]);

  const markAll = async () => {
    const { error } = await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("employee_id", empId)
      .eq("is_read", false);
    if (error) {
      toast.error(humanizeError(error, "標為已讀"));
      return;
    }
    void load();
  };
  const clearRead = async () => {
    if (!confirm("清除所有已讀通知？")) return;
    const { error } = await supabase
      .from("notifications")
      .delete()
      .eq("employee_id", empId)
      .eq("is_read", true);
    if (error) {
      toast.error(humanizeError(error, "清除已讀"));
      return;
    }
    void load();
  };
  const open = async (n: Notif) => {
    if (!n.is_read) {
      await supabase.from("notifications").update({ is_read: true }).eq("id", n.id);
      setItems((xs) => xs.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)));
    }
    // S3 起依 ref_type 導頁（order/task/payable…）
  };

  const unread = items.filter((n) => !n.is_read).length;
  const shown = filter === "unread" ? items.filter((n) => !n.is_read) : items;

  if (!empId)
    return <p className="text-sm text-muted-foreground py-8">此帳號沒有員工身分，不會收到通知。</p>;

  return (
    <div className="space-y-6">
      <PageHeader
        title="通知中心"
        description={`共 ${items.length} 則・未讀 ${unread} 則`}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={markAll} disabled={!unread}>
              <CheckCheck className="w-4 h-4 mr-1" />
              全部已讀
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={clearRead}
              disabled={items.length === unread}
            >
              <Trash2 className="w-4 h-4 mr-1" />
              清除已讀
            </Button>
          </>
        }
      />
      {loadError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {loadError}（這不代表沒有通知）
        </div>
      )}
      <div className="flex gap-2">
        {(["all", "unread"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "rounded-full border px-3 py-1 text-sm",
              filter === f
                ? "bg-primary text-primary-foreground border-primary"
                : "hover:bg-accent",
            )}
          >
            {f === "all" ? "全部" : `未讀 ${unread}`}
          </button>
        ))}
      </div>
      <div className="space-y-2">
        {shown.length === 0 && !loadError && (
          <p className="text-sm text-muted-foreground py-8 text-center">目前沒有通知</p>
        )}
        {shown.map((n) => (
          <button
            key={n.id}
            onClick={() => open(n)}
            className={cn(
              "w-full text-left rounded-lg border p-3 flex gap-3 transition-colors hover:bg-accent/40",
              n.is_read ? "opacity-75" : "border-primary/30 bg-primary/5",
            )}
          >
            <div className="mt-0.5">
              <Bell
                className={cn("w-4 h-4", n.is_read ? "text-muted-foreground" : "text-primary")}
              />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className={cn("text-sm", !n.is_read && "font-semibold")}>{n.title}</span>
                {LINE_LABEL[n.line_status] && (
                  <Badge variant="outline" className="text-[10px]">
                    {LINE_LABEL[n.line_status]}
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{n.body}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {fmtDateTime(n.created_at)}
                <span className="ml-2 font-mono">{n.rule_code}</span>
              </p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
