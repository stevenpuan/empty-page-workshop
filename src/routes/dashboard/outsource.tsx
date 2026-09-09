import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ChevronDown, ExternalLink, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { humanizeError } from "@/lib/app-error";
import { formatTWD, fmtDateTime, taipeiToday } from "@/lib/dates";
import { RequirePerm } from "@/components/RequirePerm";
import { PageHeader } from "@/components/layout/PageHeader";
import { useBoardRealtime } from "@/hooks/useBoardRealtime";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

export const Route = createFileRoute("/dashboard/outsource")({
  head: () => ({
    meta: [
      { title: "外包追蹤" },
      { name: "description", content: "追蹤所有外包出去的工序進度與金額" },
      { property: "og:title", content: "外包追蹤" },
      { property: "og:description", content: "追蹤所有外包出去的工序進度與金額" },
    ],
  }),
  component: () => (
    <RequirePerm module="outsource">
      <Page />
    </RequirePerm>
  ),
});

const PAGE_SIZE = 30;

const STATUSES: ReadonlyArray<readonly [string, string]> = [
  ["dispatched", "已發派"],
  ["in_progress", "進行中"],
  ["completed", "已完成"],
  ["rejected", "已拒絕"],
  ["cancelled", "已取消"],
];

const STATUS_CLASS: Record<string, string> = {
  dispatched: "bg-blue-100 text-blue-800 border-blue-200",
  in_progress: "bg-amber-100 text-amber-800 border-amber-200",
  completed: "bg-green-100 text-green-800 border-green-200",
  rejected: "bg-red-100 text-red-800 border-red-200",
  cancelled: "bg-muted text-muted-foreground border-border",
};

function statusLabel(s: string): string {
  return STATUSES.find(([v]) => v === s)?.[1] ?? s;
}

interface LinkRow {
  id: string;
  status: string;
  dispatched_at: string | null;
  agreed_amount: number | null;
  agreed_due_date: string | null;
  note: string | null;
  from_order_id: string | null;
  to_order_id: string | null;
  vendor_id: string | null;
  from_task_id: string | null;
  from_order: { order_no: string | null; item_name: string | null } | null;
  to_order: { order_no: string | null } | null;
  vendor: { name: string | null } | null;
  from_task: { work_station: { name: string | null } | null } | null;
}

interface EventRow {
  id: string;
  event_type: string;
  created_at: string;
  actor_company_id: string | null;
  payload: unknown;
}

const EMPTY_LINKS: LinkRow[] = [];

interface Stats {
  dispatched_count: number;
  in_progress_count: number;
  completed_count: number;
  overdue_count: number;
  outstanding_amount: number;
}
const ZERO_STATS: Stats = {
  dispatched_count: 0,
  in_progress_count: 0,
  completed_count: 0,
  overdue_count: 0,
  outstanding_amount: 0,
};

function Page() {
  const { company, can } = useAuth();
  const qc = useQueryClient();
  useBoardRealtime();

  const canCancel = can("outsource", "edit");

  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [vendorFilter, setVendorFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<LinkRow | null>(null);

  const companyId = company?.id;
  const today = taipeiToday();

  const statsQ = useQuery({
    queryKey: ["outsource_stats", companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<Stats> => {
      const { data, error } = await supabase
        .from("outsource_stats")
        .select(
          "dispatched_count, in_progress_count, completed_count, overdue_count, outstanding_amount",
        )
        .eq("from_company_id", companyId!)
        .maybeSingle();
      if (error) return ZERO_STATS;
      return { ...ZERO_STATS, ...(data as Partial<Stats> | null) };
    },
  });
  const stats = statsQ.data ?? ZERO_STATS;

  const vendorsQ = useQuery({
    queryKey: ["outsource_vendors", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vendors")
        .select("id, name")
        .eq("company_id", companyId!)
        .eq("is_outsource", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  const linksQ = useQuery({
    queryKey: [
      "cross_company_links",
      companyId,
      statusFilter.join(","),
      vendorFilter,
      dateFrom,
      dateTo,
      page,
    ],
    enabled: !!companyId,
    queryFn: async (): Promise<LinkRow[]> => {
      let q = supabase
        .from("cross_company_links")
        .select(
          `id, status, dispatched_at, agreed_amount, agreed_due_date, note,
           from_order_id, to_order_id, vendor_id, from_task_id,
           from_order:orders!cross_company_links_from_order_id_fkey(order_no, item_name),
           to_order:orders!cross_company_links_to_order_id_fkey(order_no),
           vendor:vendors(name),
           from_task:order_tasks!cross_company_links_from_task_id_fkey(work_station:work_stations(name))`,
        )
        .eq("from_company_id", companyId!)
        .order("dispatched_at", { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

      if (statusFilter.length > 0) q = q.in("status", statusFilter);
      if (vendorFilter !== "all") q = q.eq("vendor_id", vendorFilter);
      if (dateFrom) q = q.gte("dispatched_at", dateFrom);
      if (dateTo) q = q.lte("dispatched_at", `${dateTo}T23:59:59`);

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as LinkRow[];
    },
  });

  const links = linksQ.data ?? EMPTY_LINKS;

  const toggleStatus = (s: string) => {
    setPage(0);
    setStatusFilter((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    );
  };

  const reload = () => {
    void qc.invalidateQueries({ queryKey: ["cross_company_links"] });
    void qc.invalidateQueries({ queryKey: ["outsource_stats"] });
  };

  return (
    <div className="space-y-6">
      <PageHeader title="外包追蹤" description="追蹤所有外包出去的工序進度與金額" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="進行中"
          value={String(stats.dispatched_count + stats.in_progress_count)}
          tone="text-blue-600"
        />
        <StatCard
          label="已完成"
          value={String(stats.completed_count)}
          tone="text-green-600"
        />
        <StatCard
          label="逾期"
          value={String(stats.overdue_count)}
          tone={stats.overdue_count > 0 ? "text-red-600" : "text-muted-foreground"}
          highlight={stats.overdue_count > 0}
        />
        <StatCard
          label="待付金額"
          value={formatTWD(stats.outstanding_amount)}
          tone="text-orange-600"
        />
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 pt-6">
          <div className="space-y-2">
            <Label>狀態</Label>
            <div className="flex flex-wrap gap-2">
              {STATUSES.map(([value, label]) => {
                const active = statusFilter.includes(value);
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => toggleStatus(value)}
                    className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                      active
                        ? STATUS_CLASS[value]
                        : "border-border text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <Label>外包廠</Label>
            <Select
              value={vendorFilter}
              onValueChange={(v) => {
                setVendorFilter(v);
                setPage(0);
              }}
            >
              <SelectTrigger className="w-48">
                <SelectValue placeholder="全部廠商" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部廠商</SelectItem>
                {(vendorsQ.data ?? []).map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>發包日（起）</Label>
            <Input
              type="date"
              className="w-40"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                setPage(0);
              }}
            />
          </div>
          <div className="space-y-2">
            <Label>發包日（迄）</Label>
            <Input
              type="date"
              className="w-40"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                setPage(0);
              }}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>發包日</TableHead>
                <TableHead>發包訂單</TableHead>
                <TableHead>站別</TableHead>
                <TableHead>品名</TableHead>
                <TableHead>外包廠</TableHead>
                <TableHead>對方工單</TableHead>
                <TableHead className="text-right">金額</TableHead>
                <TableHead>約定交期</TableHead>
                <TableHead>狀態</TableHead>
                <TableHead className="text-right">動作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linksQ.isLoading ? (
                <TableRow>
                  <TableCell colSpan={11} className="py-10 text-center text-muted-foreground">
                    載入中…
                  </TableCell>
                </TableRow>
              ) : linksQ.isError ? (
                <TableRow>
                  <TableCell colSpan={11} className="py-10 text-center text-muted-foreground">
                    外包資料尚未啟用
                  </TableCell>
                </TableRow>
              ) : links.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={11} className="py-10 text-center text-muted-foreground">
                    沒有符合條件的外包紀錄
                  </TableCell>
                </TableRow>
              ) : (
                links.map((l) => {
                  const overdue =
                    !!l.agreed_due_date &&
                    l.agreed_due_date < today &&
                    l.status !== "completed" &&
                    l.status !== "cancelled" &&
                    l.status !== "rejected";
                  const open = expanded === l.id;
                  return (
                    <>
                      <TableRow key={l.id}>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => setExpanded(open ? null : l.id)}
                            aria-label="展開詳情"
                          >
                            <ChevronDown
                              className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
                            />
                          </Button>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {l.dispatched_at ? l.dispatched_at.slice(0, 10) : "—"}
                        </TableCell>
                        <TableCell>
                          {l.from_order_id ? (
                            <Link
                              to="/dashboard/orders/$orderId"
                              params={{ orderId: l.from_order_id }}
                              className="inline-flex items-center gap-1 text-primary hover:underline"
                            >
                              {l.from_order?.order_no ?? "—"}
                              <ExternalLink className="h-3 w-3" />
                            </Link>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell>{l.from_task?.work_station?.name ?? "—"}</TableCell>
                        <TableCell className="max-w-48 truncate">
                          {l.from_order?.item_name ?? "—"}
                        </TableCell>
                        <TableCell>{l.vendor?.name ?? "—"}</TableCell>
                        <TableCell>{l.to_order?.order_no ?? "—"}</TableCell>
                        <TableCell className="text-right">
                          {formatTWD(l.agreed_amount)}
                        </TableCell>
                        <TableCell
                          className={`whitespace-nowrap ${overdue ? "font-medium text-red-600" : ""}`}
                        >
                          {l.agreed_due_date ?? "—"}
                          {overdue ? "（逾期）" : ""}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={STATUS_CLASS[l.status] ?? ""}>
                            {statusLabel(l.status)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setExpanded(open ? null : l.id)}
                          >
                            詳情
                          </Button>
                        </TableCell>
                      </TableRow>
                      {open && (
                        <TableRow key={`${l.id}-detail`}>
                          <TableCell colSpan={11} className="bg-muted/40">
                            <LinkDetail
                              link={l}
                              canCancel={
                                canCancel &&
                                (l.status === "dispatched" || l.status === "in_progress")
                              }
                              onCancel={() => setCancelTarget(l)}
                            />
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">第 {page + 1} 頁</span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            上一頁
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={links.length < PAGE_SIZE}
            onClick={() => setPage((p) => p + 1)}
          >
            下一頁
          </Button>
        </div>
      </div>

      <CancelDialog
        link={cancelTarget}
        onClose={() => setCancelTarget(null)}
        onDone={reload}
      />
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
  highlight,
}: {
  label: string;
  value: string;
  tone: string;
  highlight?: boolean;
}) {
  return (
    <Card className={highlight ? "border-red-300" : undefined}>
      <CardContent className="pt-6">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className={`mt-1 text-2xl font-semibold ${tone}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

function LinkDetail({
  link,
  canCancel,
  onCancel,
}: {
  link: LinkRow;
  canCancel: boolean;
  onCancel: () => void;
}) {
  const eventsQ = useQuery({
    queryKey: ["cross_company_events", link.id],
    queryFn: async (): Promise<EventRow[]> => {
      const { data, error } = await supabase
        .from("cross_company_events")
        .select("id, event_type, created_at, actor_company_id, payload")
        .eq("link_id", link.id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as EventRow[];
    },
  });

  return (
    <div className="space-y-3 py-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">事件紀錄</p>
        {canCancel && (
          <Button variant="destructive" size="sm" onClick={onCancel}>
            <X className="mr-1 h-4 w-4" />
            取消外包
          </Button>
        )}
      </div>

      {link.note && (
        <p className="text-sm text-muted-foreground">備註：{link.note}</p>
      )}

      {eventsQ.isLoading ? (
        <p className="text-sm text-muted-foreground">載入中…</p>
      ) : eventsQ.isError ? (
        <p className="text-sm text-muted-foreground">事件紀錄尚未啟用</p>
      ) : (eventsQ.data ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">尚無事件</p>
      ) : (
        <ul className="space-y-2">
          {(eventsQ.data ?? []).map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">{fmtDateTime(e.created_at)}</span>
              <Badge variant="outline">{e.event_type}</Badge>
              <span className="text-muted-foreground">
                操作方 {e.actor_company_id ? e.actor_company_id.slice(0, 8) : "—"}
              </span>
              <span className="truncate text-muted-foreground">
                {e.payload ? JSON.stringify(e.payload).slice(0, 120) : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CancelDialog({
  link,
  onClose,
  onDone,
}: {
  link: LinkRow | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!link) return;
    if (!reason.trim()) {
      toast.error("請填寫取消原因");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.rpc("cancel_outsource", {
        p_link_id: link.id,
        p_reason: reason.trim(),
      });
      if (error) throw error;
      toast.success("外包已取消");
      setReason("");
      onDone();
      onClose();
    } catch (err) {
      toast.error(humanizeError(err, "取消外包"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!link} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>取消外包</DialogTitle>
          <DialogDescription>
            {link?.from_order?.order_no ?? ""}　{link?.vendor?.name ?? ""}
            　取消後對方工單將一併作廢，此動作無法復原。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="cancel-reason">取消原因</Label>
          <Textarea
            id="cancel-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="請說明取消原因"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            返回
          </Button>
          <Button variant="destructive" onClick={submit} disabled={saving}>
            {saving ? "處理中…" : "確認取消"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
