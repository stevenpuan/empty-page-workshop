import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Bell } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";

/** 側欄鈴鐘：未讀數 + Realtime 訂閱（notifications 表已加入 supabase_realtime publication） */
export function NotificationBell() {
  const { employee } = useAuth();
  const [unread, setUnread] = useState(0);
  const empId = employee?.id;

  useEffect(() => {
    if (!empId) return;
    let alive = true;
    const load = async () => {
      const { count, error } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("employee_id", empId)
        .eq("is_read", false);
      if (!alive) return;
      if (error) {
        console.error("[bell]", error);
        return;
      }
      setUnread(count ?? 0);
    };
    void load();
    const channel = supabase.channel(`bell-${empId}-${Math.random().toString(36).slice(2, 8)}`);
    channel.on(
      "postgres_changes" as never,
      { event: "*", schema: "public", table: "notifications", filter: `employee_id=eq.${empId}` },
      () => void load(),
    );
    channel.subscribe();
    return () => {
      alive = false;
      supabase.removeChannel(channel);
    };
  }, [empId]);

  if (!empId) return null;
  return (
    <Link
      to="/dashboard/notifications"
      className="relative p-2 rounded-md hover:bg-accent text-muted-foreground"
      aria-label="通知中心"
    >
      <Bell className="w-4 h-4" />
      {unread > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-destructive text-white text-[10px] leading-4 text-center font-semibold">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}
