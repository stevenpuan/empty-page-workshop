import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { humanizeError } from "@/lib/app-error";
import { useBoardRealtime } from "@/hooks/useBoardRealtime";
import { JobCard, type BoardTask } from "@/components/JobCard";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/dashboard/board/tv")({
  head: () => ({
    meta: [
      { title: "派工看板（電視模式）" },
      { name: "description", content: "印刷廠牆面電視用的全螢幕派工看板，深色大字即時顯示。" },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "派工看板（電視模式）" },
      { property: "og:description", content: "全螢幕深色派工看板，即時顯示進行中的工序。" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): { company?: string } => ({
    company: typeof search.company === "string" && search.company ? search.company : undefined,
  }),
  component: TvPage,
});

/** 電視模式只顯示活躍欄位（隱藏 done / skipped） */
const COLUMNS: ReadonlyArray<readonly [string, string]> = [
  ["pending", "待排工"],
  ["assigned", "已指派"],
  ["in_progress", "進行中"],
  ["blocked", "卡關"],
  ["waiting_customer", "等客戶"],
  ["outsourced", "外包中"],
];

function TvPage() {
  const { company, companies, permsLoaded, switchCompany } = useAuth();
  const { company: companyParam } = Route.useSearch();
  useBoardRealtime();

  // ?company=XX 固定公司（避免誤切）：id 或 code 都可
  const switched = useRef(false);
  useEffect(() => {
    if (!companyParam || switched.current || !permsLoaded || companies.length === 0) return;
    const target = companies.find((c) => c.id === companyParam || c.code === companyParam);
    if (target && target.id !== company?.id) {
      switched.current = true;
      void switchCompany(target.id).catch(() => {});
    }
  }, [companyParam, permsLoaded, companies, company?.id, switchCompany]);

  // 電視一律深色：掛載期間把整個文件切到 dark theme
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("dark");
    return () => root.classList.remove("dark");
  }, []);

  // Realtime 的保險：每 60 秒強制重整一次
  useEffect(() => {
    const t = window.setInterval(() => window.location.reload(), 60_000);
    return () => window.clearInterval(t);
  }, []);

  const {
    data: tasks = [],
    error: loadErr,
  } = useQuery({
    queryKey: ["order_tasks_board", "tv", company?.id],
    enabled: !!company?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("order_tasks")
        .select(
          "id, status, blocked_reason, assignee_id, station_id, order_id, orders:order_id(order_no, item_name, due_date, customer_id), work_stations:station_id(name, color), employees:assignee_id(name), vendors:outsource_vendor_id(name)",
        )
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as unknown as BoardTask[];
    },
  });

  // 右下角「最後更新 HH:mm:ss」
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  useEffect(() => {
    setLastUpdated(new Date());
  }, [tasks]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-zinc-950 text-zinc-100">
      <header className="flex shrink-0 items-center gap-3 border-b border-zinc-800 px-5 py-3">
        <span className="text-2xl font-bold tracking-wide">派工看板</span>
        <span className="text-lg text-zinc-400">
          {company?.short_name ?? company?.name ?? ""}
        </span>
        {loadErr && (
          <span className="ml-auto text-base text-red-400">
            {humanizeError(loadErr, "載入看板")}
          </span>
        )}
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-6 gap-3 p-4">
        {COLUMNS.map(([status, label]) => {
          const items = tasks.filter((t) => t.status === status);
          return (
            <div
              key={status}
              className="flex min-h-0 flex-col rounded-lg border border-zinc-800 bg-zinc-900/60 p-2"
            >
              <div className="flex shrink-0 items-center gap-2 px-1 py-1">
                <span className="text-xl font-semibold">{label}</span>
                <Badge variant="secondary" className="text-base">
                  {items.length}
                </Badge>
              </div>
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pt-1">
                {items.map((t) => (
                  <JobCard key={t.id} task={t} compact={false} />
                ))}
                {items.length === 0 && (
                  <p className="py-6 text-center text-base text-zinc-600">沒有卡片</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="fixed bottom-1.5 right-3 text-xs text-zinc-600">
        最後更新{" "}
        {lastUpdated
          ? lastUpdated.toLocaleTimeString("zh-TW", { hour12: false })
          : "—"}
      </p>
    </div>
  );
}
