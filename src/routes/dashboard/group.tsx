import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, Building2, CheckCircle, Lock } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { humanizeError } from "@/lib/app-error";
import { formatTWD } from "@/lib/dates";
import { RequirePerm } from "@/components/RequirePerm";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/dashboard/group")({
  head: () => ({
    meta: [
      { title: "集團總覽" },
      { name: "description", content: "跨公司往來對帳總覽" },
      { property: "og:title", content: "集團總覽" },
      { property: "og:description", content: "跨公司往來對帳總覽" },
    ],
  }),
  component: () => (
    <RequirePerm module="group_overview">
      <Page />
    </RequirePerm>
  ),
});

type ReconRow = {
  link_id: string;
  from_company_name: string | null;
  to_company_name: string | null;
  from_order_no: string | null;
  to_order_no: string | null;
  from_item_name: string | null;
  agreed_amount: number | null;
  link_status: string;
  payable_amount: number | null;
  payable_status: string | null;
  receivable_amount: number | null;
  receivable_status: string | null;
  amount_mismatch: boolean | null;
  dispatched_at: string | null;
};

const LINK_STATUSES: ReadonlyArray<readonly [string, string]> = [
  ["dispatched", "已發派"],
  ["in_progress", "進行中"],
  ["completed", "已完成"],
  ["rejected", "已拒絕"],
  ["cancelled", "已取消"],
];

const LINK_STATUS_CLASS: Record<string, string> = {
  dispatched: "bg-blue-100 text-blue-800 border-blue-200",
  in_progress: "bg-amber-100 text-amber-800 border-amber-200",
  completed: "bg-green-100 text-green-800 border-green-200",
  rejected: "bg-red-100 text-red-800 border-red-200",
  cancelled: "bg-muted text-muted-foreground border-border",
};

const PAY_STATUSES: ReadonlyArray<readonly [string, string]> = [
  ["unpaid", "未結"],
  ["partial", "部分結清"],
  ["paid", "已結清"],
  ["unreceived", "未結"],
  ["received", "已結清"],
  ["void", "已作廢"],
];

const PAY_STATUS_CLASS: Record<string, string> = {
  unpaid: "bg-red-100 text-red-800 border-red-200",
  partial: "bg-amber-100 text-amber-800 border-amber-200",
  paid: "bg-green-100 text-green-800 border-green-200",
  unreceived: "bg-red-100 text-red-800 border-red-200",
  received: "bg-green-100 text-green-800 border-green-200",
  void: "bg-muted text-muted-foreground border-border",
};

function linkStatusLabel(s: string): string {
  return LINK_STATUSES.find(([v]) => v === s)?.[1] ?? s;
}

function payStatusLabel(s: string | null): string {
  if (!s) return "—";
  return PAY_STATUSES.find(([v]) => v === s)?.[1] ?? s;
}

function PayBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-muted-foreground">—</span>;
  return (
    <Badge variant="outline" className={PAY_STATUS_CLASS[status] ?? ""}>
      {payStatusLabel(status)}
    </Badge>
  );
}

type GroupKpi = {
  company_id: string;
  company_code: string;
  company_name: string;
  today_new_orders: number | null;
  month_orders: number | null;
  month_order_amount: number | string | null;
  wip_orders: number | null;
  overdue_tasks: number | null;
  outsourcing: number | null;
  month_shipped_amount: number | string | null;
  ar_balance: number | string | null;
  ap_balance: number | string | null;
  active_employees: number | null;
  today_clock_in: number | null;
  today_abnormal: number | null;
};

/** group_kpis 只開放老闆；其他角色呼叫會被 DB 擋下（權限錯誤） */
function isOwnerOnlyError(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  const msg = (e?.message ?? "").toLowerCase();
  return (
    e?.code === "42501" ||
    msg.includes("permission") ||
    msg.includes("owner") ||
    msg.includes("not allowed") ||
    msg.includes("forbidden") ||
    (e?.message ?? "").includes("老闆") ||
    (e?.message ?? "").includes("權限")
  );
}

const num = (v: number | null | undefined) => (v == null ? "—" : String(v));

function KpiItem({
  label,
  value,
  alert,
}: {
  label: string;
  value: ReactNode;
  alert?: boolean;
}) {
  return (
    <div className="rounded-md border px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={`mt-0.5 text-lg font-semibold tabular-nums ${alert ? "text-destructive" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}

function CompanyKpiCard({ k }: { k: GroupKpi }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Building2 className="h-4 w-4 text-muted-foreground" />
          {k.company_name}
          <Badge variant="outline" className="font-mono text-xs">
            {k.company_code}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <KpiItem label="今日新單" value={num(k.today_new_orders)} />
        <KpiItem label="本月接單數" value={`${num(k.month_orders)} 張`} />
        <KpiItem label="本月接單金額" value={formatTWD(k.month_order_amount)} />
        <KpiItem label="進行中工單" value={num(k.wip_orders)} />
        <KpiItem
          label="逾期工序"
          value={num(k.overdue_tasks)}
          alert={(k.overdue_tasks ?? 0) > 0}
        />
        <KpiItem label="外包中" value={num(k.outsourcing)} />
        <KpiItem label="本月出貨金額" value={formatTWD(k.month_shipped_amount)} />
        <KpiItem label="應收未收" value={formatTWD(k.ar_balance)} />
        <KpiItem label="應付未付" value={formatTWD(k.ap_balance)} />
        <KpiItem
          label="今日到勤／在職"
          value={`${num(k.today_clock_in)} / ${num(k.active_employees)}`}
        />
        <KpiItem
          label="今日異常打卡"
          value={num(k.today_abnormal)}
          alert={(k.today_abnormal ?? 0) > 0}
        />
      </CardContent>
    </Card>
  );
}

function GroupKpiSection() {
  const { company } = useAuth();
  const kpiQuery = useQuery({
    queryKey: ["group_kpis", company?.id],
    enabled: !!company?.id,
    retry: false,
    queryFn: async (): Promise<GroupKpi[]> => {
      const { data, error } = await supabase.rpc("group_kpis");
      if (error) throw error;
      return ((data ?? []) as GroupKpi[])
        .slice()
        .sort((a, b) => a.company_code.localeCompare(b.company_code));
    },
  });

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">兩家今日／本月</h2>
      {kpiQuery.isLoading ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">載入中…</CardContent>
        </Card>
      ) : kpiQuery.error ? (
        isOwnerOnlyError(kpiQuery.error) ? (
          <Card>
            <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Lock className="h-4 w-4" />
              兩家公司的營運指標僅限老闆檢視。
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="py-6 text-sm text-destructive">
              {humanizeError(kpiQuery.error, "載入兩家營運指標")}
            </CardContent>
          </Card>
        )
      ) : (kpiQuery.data ?? []).length === 0 ? (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            沒有可檢視的公司資料
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {(kpiQuery.data ?? []).map((k) => (
            <CompanyKpiCard key={k.company_id} k={k} />
          ))}
        </div>
      )}
    </section>
  );
}

function Page() {
  const { company } = useAuth();
  const companyId = company?.id ?? null;

  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [mismatchOnly, setMismatchOnly] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const reconQuery = useQuery({
    queryKey: ["group_reconciliation", companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<ReconRow[]> => {
      const { data, error } = await supabase
        .from("group_reconciliation")
        .select("*")
        .order("dispatched_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ReconRow[];
    },
  });

  const rows = reconQuery.data ?? [];

  const stats = useMemo(() => {
    let completedAmount = 0;
    let openAmount = 0;
    let unpaidCount = 0;
    let mismatchCount = 0;
    for (const r of rows) {
      const amt = r.agreed_amount ?? 0;
      if (r.link_status === "completed") completedAmount += amt;
      if (!["completed", "rejected", "cancelled"].includes(r.link_status))
        openAmount += amt;
      if (r.payable_status && r.payable_status !== "paid") unpaidCount += 1;
      if (r.amount_mismatch) mismatchCount += 1;
    }
    return { completedAmount, openAmount, unpaidCount, mismatchCount };
  }, [rows]);

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (statusFilter.length > 0 && !statusFilter.includes(r.link_status))
          return false;
        if (mismatchOnly && !r.amount_mismatch) return false;
        if (dateFrom && (r.dispatched_at ?? "") < dateFrom) return false;
        if (dateTo && (r.dispatched_at ?? "") > `${dateTo}T23:59:59`)
          return false;
        return true;
      }),
    [rows, statusFilter, mismatchOnly, dateFrom, dateTo],
  );

  function toggleStatus(s: string) {
    setStatusFilter((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    );
  }

  if (reconQuery.error) {
    return (
      <div className="p-6 space-y-6">
        <PageHeader title="集團總覽" description="跨公司往來對帳" />
        <GroupKpiSection />
        <Card>
          <CardContent className="py-10 text-center text-destructive">
            無法讀取集團對帳資料：
            {humanizeError(reconQuery.error, "載入集團總覽")}
            。若持續發生，可能是檢視表權限尚未開放，請回報系統管理員。
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="集團總覽"
        description="兩家公司今日／本月營運指標，以及跨公司往來對帳"
      />

      <GroupKpiSection />

      <h2 className="text-lg font-semibold">跨公司往來對帳</h2>

      {/* 摘要卡片 */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Building2 className="h-4 w-4" />
              總完成金額
            </div>
            <div className="mt-2 text-2xl font-bold">
              {formatTWD(stats.completedAmount)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Building2 className="h-4 w-4" />
              進行中金額
            </div>
            <div className="mt-2 text-2xl font-bold">
              {formatTWD(stats.openAmount)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">應付未結</div>
            <div className="mt-2">
              <Badge
                variant="outline"
                className={
                  stats.unpaidCount > 0
                    ? "bg-amber-100 text-amber-800 border-amber-200 text-lg px-3 py-1"
                    : "bg-green-100 text-green-800 border-green-200 text-lg px-3 py-1"
                }
              >
                {stats.unpaidCount} 筆
              </Badge>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">金額不一致</div>
            <div className="mt-2">
              {stats.mismatchCount > 0 ? (
                <Badge
                  variant="outline"
                  className="bg-red-100 text-red-800 border-red-200 text-lg px-3 py-1"
                >
                  <AlertTriangle className="h-4 w-4 mr-1" />
                  {stats.mismatchCount} 筆
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="bg-green-100 text-green-800 border-green-200 text-lg px-3 py-1"
                >
                  <CheckCircle className="h-4 w-4 mr-1" />
                  一致
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 篩選列 */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex flex-wrap gap-2">
          {LINK_STATUSES.map(([value, label]) => (
            <Button
              key={value}
              size="sm"
              variant={statusFilter.includes(value) ? "default" : "outline"}
              onClick={() => toggleStatus(value)}
            >
              {label}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id="mismatch-only"
            checked={mismatchOnly}
            onCheckedChange={setMismatchOnly}
          />
          <Label htmlFor="mismatch-only">只看不一致</Label>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="date-from">日期</Label>
          <Input
            id="date-from"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-40"
          />
          <span className="text-muted-foreground">～</span>
          <Input
            id="date-to"
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-40"
          />
        </div>
      </div>

      {/* 對帳表 */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>發包方</TableHead>
                <TableHead>發包訂單</TableHead>
                <TableHead>品名</TableHead>
                <TableHead>接單方</TableHead>
                <TableHead>對方工單</TableHead>
                <TableHead className="text-right">約定金額</TableHead>
                <TableHead>狀態</TableHead>
                <TableHead className="text-right">應付金額</TableHead>
                <TableHead>應付狀態</TableHead>
                <TableHead className="text-right">應收金額</TableHead>
                <TableHead>應收狀態</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {reconQuery.isLoading ? (
                <TableRow>
                  <TableCell
                    colSpan={12}
                    className="text-center py-10 text-muted-foreground"
                  >
                    載入中…
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={12}
                    className="text-center py-10 text-muted-foreground"
                  >
                    目前沒有符合條件的往來紀錄
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((r) => (
                  <TableRow
                    key={r.link_id}
                    className={r.amount_mismatch ? "bg-red-50" : undefined}
                  >
                    <TableCell>{r.from_company_name ?? "—"}</TableCell>
                    <TableCell className="font-mono text-sm">
                      {r.from_order_no ?? "—"}
                    </TableCell>
                    <TableCell>{r.from_item_name ?? "—"}</TableCell>
                    <TableCell>{r.to_company_name ?? "—"}</TableCell>
                    <TableCell className="font-mono text-sm">
                      {r.to_order_no ?? "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {r.agreed_amount != null ? formatTWD(r.agreed_amount) : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={LINK_STATUS_CLASS[r.link_status] ?? ""}
                      >
                        {linkStatusLabel(r.link_status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {r.payable_amount != null ? formatTWD(r.payable_amount) : "—"}
                    </TableCell>
                    <TableCell>
                      <PayBadge status={r.payable_status} />
                    </TableCell>
                    <TableCell className="text-right">
                      {r.receivable_amount != null
                        ? formatTWD(r.receivable_amount)
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <PayBadge status={r.receivable_status} />
                    </TableCell>
                    <TableCell>
                      {r.amount_mismatch && (
                        <AlertTriangle className="h-4 w-4 text-red-600" />
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
