/**
 * 薪資計算：每月依打卡與核准的請假自動計算（payroll_generate，033）。
 * 老闆只填績效獎金、其他加項、所得稅、其他扣款；鎖定發放後員工在打卡頁看得到薪資條。
 */
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Calculator,
  ChevronDown,
  ChevronRight,
  Download,
  Lock,
  LockOpen,
  Pencil,
  Printer,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { humanizeError } from "@/lib/app-error";
import { formatTWD, fmtDateTime, taipeiToday } from "@/lib/dates";
import {
  PAY_ADD,
  PAY_DED,
  PAY_ER,
  PAY_ITEM_COLUMNS,
  PAY_SUB,
  attLines,
  num,
  periodLabel,
  type PayItem,
} from "@/lib/payroll";
import { RequirePerm } from "@/components/RequirePerm";
import { PageHeader } from "@/components/layout/PageHeader";
import { PayslipView } from "@/components/payroll/PayslipView";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/dashboard/payroll")({
  head: () => ({
    meta: [
      { title: "薪資計算" },
      { name: "description", content: "依打卡與請假自動計算每月薪資、薪資條" },
      { property: "og:title", content: "薪資計算" },
      { property: "og:description", content: "依打卡與請假自動計算每月薪資、薪資條" },
    ],
  }),
  component: () => (
    <RequirePerm module="payroll">
      <Page />
    </RequirePerm>
  ),
});

interface Run {
  id: string;
  period: string;
  status: "draft" | "closed";
  closed_at: string | null;
}
interface Emp {
  id: string;
  emp_no: string;
  name: string;
  hire_date: string | null;
}
interface Profile {
  employee_id: string;
  pay_type: "monthly" | "hourly";
  base_salary: number | string;
  hourly_rate: number | string;
  position_allowance: number | string;
  meal_allowance: number | string;
  attendance_bonus: number | string;
  nhi_enrolled: boolean;
  nhi_dependents: number;
  pension_self_rate: number | string;
  insured_override: number | string | null;
  note: string | null;
}
interface Perf {
  employee_id: string;
  tasks_done: number;
  tasks_on_time: number;
  quick_done: number;
  quick_amount: number | string;
}

const EMPTY_ITEMS: PayItem[] = [];
const EMPTY_EMPS: Emp[] = [];
const EMPTY_PROFILES: Profile[] = [];
const EMPTY_PERF: Perf[] = [];
const SUM_KEYS: (keyof PayItem)[] = [
  "gross_pay",
  "deduct_total",
  "net_pay",
  "er_li",
  "er_nhi",
  "er_pension",
  "total_cost",
];

function Page() {
  const { company, can } = useAuth();
  const qc = useQueryClient();
  const canEdit = can("payroll", "edit");
  const thisMonth = taipeiToday().slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [tab, setTab] = useState("monthly");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<PayItem | null>(null);
  const [slip, setSlip] = useState<PayItem | null>(null);
  const [confirm, setConfirm] = useState<"close" | "reopen" | null>(null);
  const [busy, setBusy] = useState(false);
  const period = `${month}-01`;
  const validMonth = /^\d{4}-\d{2}$/.test(month);

  const runQ = useQuery({
    queryKey: ["payroll_run", company?.id, period],
    enabled: !!company?.id && validMonth,
    queryFn: async (): Promise<Run | null> => {
      const { data, error } = await supabase
        .from("payroll_runs")
        .select("id, period, status, closed_at")
        .eq("period", period)
        .maybeSingle();
      if (error) throw error;
      return (data as Run | null) ?? null;
    },
  });
  const run = runQ.data ?? null;

  const itemsQ = useQuery({
    queryKey: ["payroll_items", run?.id],
    enabled: !!run?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payroll_items")
        .select(PAY_ITEM_COLUMNS)
        .eq("run_id", run!.id)
        .order("emp_no");
      if (error) throw error;
      return (data ?? []) as unknown as PayItem[];
    },
  });
  const items = run ? (itemsQ.data ?? EMPTY_ITEMS) : EMPTY_ITEMS;

  const empsQ = useQuery({
    queryKey: ["payroll_emps", company?.id],
    enabled: !!company?.id,
    queryFn: async () => {
      const [e, p] = await Promise.all([
        supabase
          .from("employees")
          .select("id, emp_no, name, hire_date")
          .eq("is_active", true)
          .order("emp_no"),
        supabase
          .from("employee_pay_profiles")
          .select(
            "employee_id, pay_type, base_salary, hourly_rate, position_allowance, meal_allowance, attendance_bonus, nhi_enrolled, nhi_dependents, pension_self_rate, insured_override, note",
          ),
      ]);
      if (e.error) throw e.error;
      if (p.error) throw p.error;
      return { emps: (e.data ?? []) as Emp[], profiles: (p.data ?? []) as Profile[] };
    },
  });
  const emps = empsQ.data?.emps ?? EMPTY_EMPS;
  const profiles = empsQ.data?.profiles ?? EMPTY_PROFILES;
  const noProfile = emps.filter((e) => !profiles.some((p) => p.employee_id === e.id));

  const perfQ = useQuery({
    queryKey: ["performance_stats", company?.id, month],
    enabled: !!company?.id && validMonth && !!editing,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("performance_stats", { p_month: period });
      if (error) throw error;
      return (data ?? []) as Perf[];
    },
  });
  const perf = perfQ.data ?? EMPTY_PERF;

  const totals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const k of SUM_KEYS) t[k] = items.reduce((s, i) => s + num(i[k]), 0);
    return t;
  }, [items]);

  const reload = () => {
    void qc.invalidateQueries({ queryKey: ["payroll_run", company?.id, period] });
    void qc.invalidateQueries({ queryKey: ["payroll_items"] });
  };

  const generate = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc("payroll_generate", { p_period: period });
    setBusy(false);
    if (error) {
      toast.error(humanizeError(error, "計算薪資"));
      return;
    }
    const r = data as { count: number; no_profile: string[] };
    toast.success(
      `已計算 ${r.count} 人` +
        (r.no_profile?.length ? `；${r.no_profile.join("、")} 還沒有薪資設定，沒有算到` : ""),
    );
    reload();
  };

  const doClose = async () => {
    if (!run) return;
    setBusy(true);
    const { data, error } = await supabase.rpc(
      confirm === "close" ? "payroll_close" : "payroll_reopen",
      {
        p_run_id: run.id,
      },
    );
    setBusy(false);
    setConfirm(null);
    if (error) {
      toast.error(humanizeError(error, confirm === "close" ? "鎖定發放" : "解除鎖定"));
      return;
    }
    toast.success(
      confirm === "close"
        ? `已鎖定發放，已通知 ${(data as { notified?: number }).notified ?? 0} 位員工`
        : "已解除鎖定，可以重算或修改",
    );
    reload();
  };

  const exportExcel = async () => {
    if (!items.length) {
      toast.info("這個月還沒有薪資資料");
      return;
    }
    try {
      const XLSX = await import("xlsx");
      const cols: [keyof PayItem, string][] = [
        ["pay_days", "計薪天數"],
        ["hourly_base", "時薪基數"],
        ...PAY_ADD,
        ...PAY_SUB,
        ["gross_pay", "應發薪資"],
        ["insured_salary", "投保薪資"],
        ...PAY_DED,
        ["deduct_total", "代扣合計"],
        ["net_pay", "實發金額"],
        ...PAY_ER,
        ["total_cost", "公司總成本"],
      ];
      const aoa: (string | number)[][] = [
        ["員工編號", "姓名", "計薪方式", ...cols.map((c) => c[1]), "備註", "提醒"],
        ...items.map((i) => [
          i.emp_no ?? "",
          i.employee_name ?? "",
          i.pay_type === "hourly" ? "時薪" : "月薪",
          ...cols.map(([k]) => num(i[k])),
          i.note ?? "",
          (i.warnings ?? []).join("；"),
        ]),
        [
          "合計",
          "",
          "",
          ...cols.map(([k]) =>
            k === "pay_days" || k === "hourly_base" || k === "insured_salary"
              ? ""
              : items.reduce((s, i) => s + num(i[k]), 0),
          ),
        ],
      ];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "薪資計算表");
      XLSX.writeFile(wb, `薪資計算表_${company?.short_name ?? company?.name ?? ""}_${month}.xlsx`);
    } catch (e) {
      toast.error(humanizeError(e, "匯出薪資"));
    }
  };

  const closed = run?.status === "closed";

  return (
    <div className="space-y-6">
      <PageHeader
        title="薪資計算"
        description="依打卡（遲到、早退、曠職、加班、國定假日出勤）和核准的請假自動計算；您只要填績效獎金、其他加項、所得稅、其他扣款。鎖定發放後，員工在打卡頁看得到自己的薪資條，LINE 也會通知。"
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="monthly">每月薪資</TabsTrigger>
          <TabsTrigger value="profiles">
            員工薪資設定{noProfile.length ? `（${noProfile.length} 人未設定）` : ""}
          </TabsTrigger>
          <TabsTrigger value="params">計算參數</TabsTrigger>
        </TabsList>

        {/* ---------- 每月薪資 ---------- */}
        <TabsContent value="monthly" className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label>月份</Label>
              <Input
                type="month"
                className="w-44"
                value={month}
                max={thisMonth}
                onChange={(e) => {
                  setMonth(e.target.value);
                  setExpanded(null);
                }}
              />
            </div>
            {run && (
              <Badge variant={closed ? "default" : "secondary"} className="mb-2">
                {closed ? `已鎖定發放（${fmtDateTime(run.closed_at)}）` : "草稿，可重算"}
              </Badge>
            )}
            <div className="flex-1" />
            {canEdit && !closed && (
              <Button onClick={() => void generate()} disabled={busy || !validMonth}>
                <Calculator className="mr-1 h-4 w-4" />
                {run ? "重新計算" : "計算這個月"}
              </Button>
            )}
            {canEdit && run && !closed && items.length > 0 && (
              <Button variant="secondary" onClick={() => setConfirm("close")} disabled={busy}>
                <Lock className="mr-1 h-4 w-4" />
                鎖定發放
              </Button>
            )}
            {canEdit && closed && (
              <Button variant="outline" onClick={() => setConfirm("reopen")} disabled={busy}>
                <LockOpen className="mr-1 h-4 w-4" />
                解除鎖定
              </Button>
            )}
            <Button variant="outline" onClick={() => void exportExcel()} disabled={!items.length}>
              <Download className="mr-1 h-4 w-4" />
              匯出 Excel
            </Button>
          </div>

          {noProfile.length > 0 && (
            <p className="flex items-center gap-1 text-sm text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4" />
              {noProfile.map((e) => e.name).join("、")}{" "}
              還沒有薪資設定，不會算到；請到「員工薪資設定」設定。
            </p>
          )}
          {!!runQ.error && (
            <p className="text-sm text-destructive">{humanizeError(runQ.error, "讀取薪資")}</p>
          )}

          {!run && !runQ.isLoading ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                {periodLabel(period)}
                還沒有計算。月底（或下個月初）確認大家打卡、請假都核准後，按「計算這個月」。
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="overflow-x-auto p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8" />
                      <TableHead>員工</TableHead>
                      <TableHead className="text-right">應發</TableHead>
                      <TableHead className="text-right">代扣</TableHead>
                      <TableHead className="text-right">實發</TableHead>
                      <TableHead className="text-right">公司成本</TableHead>
                      <TableHead>提醒</TableHead>
                      <TableHead className="text-right">動作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((i) => (
                      <Fragment key={i.id}>
                        <TableRow
                          className="cursor-pointer"
                          onClick={() => setExpanded(expanded === i.id ? null : i.id)}
                        >
                          <TableCell>
                            {expanded === i.id ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </TableCell>
                          <TableCell className="font-medium">
                            {i.employee_name}
                            <span className="ml-1 text-xs text-muted-foreground">
                              {i.pay_type === "hourly" ? "時薪" : "月薪"}
                            </span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatTWD(num(i.gross_pay))}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatTWD(num(i.deduct_total))}
                          </TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">
                            {formatTWD(num(i.net_pay))}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatTWD(num(i.total_cost))}
                          </TableCell>
                          <TableCell className="max-w-xs">
                            <div className="flex flex-wrap gap-1">
                              {(i.warnings ?? []).map((w) => (
                                <Badge
                                  key={w}
                                  variant="outline"
                                  className="border-amber-300 text-amber-800 dark:text-amber-300"
                                >
                                  {w}
                                </Badge>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="flex justify-end gap-1">
                              {canEdit && !closed && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  title="填獎金、扣款"
                                  onClick={() => setEditing(i)}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="ghost"
                                title="薪資條"
                                onClick={() => setSlip(i)}
                              >
                                <Printer className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                        {expanded === i.id && (
                          <TableRow>
                            <TableCell colSpan={8} className="bg-muted/40">
                              <div className="max-w-xl py-2">
                                <PayslipView item={i} showEmployer />
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    ))}
                    {items.length > 0 && (
                      <TableRow className="bg-muted/40 font-semibold">
                        <TableCell />
                        <TableCell>合計 {items.length} 人</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatTWD(totals["gross_pay"])}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatTWD(totals["deduct_total"])}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatTWD(totals["net_pay"])}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatTWD(totals["total_cost"])}
                        </TableCell>
                        <TableCell
                          colSpan={2}
                          className="text-xs font-normal text-muted-foreground"
                        >
                          公司另付勞保 {formatTWD(totals["er_li"])}、健保{" "}
                          {formatTWD(totals["er_nhi"])}、勞退 {formatTWD(totals["er_pension"])}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ---------- 員工薪資設定 ---------- */}
        <TabsContent value="profiles">
          <ProfilesTab
            emps={emps}
            profiles={profiles}
            canEdit={canEdit}
            onSaved={() => void qc.invalidateQueries({ queryKey: ["payroll_emps"] })}
          />
        </TabsContent>

        {/* ---------- 參數 ---------- */}
        <TabsContent value="params">
          <ParamsTab canEdit={canEdit} />
        </TabsContent>
      </Tabs>

      {editing && (
        <EditItemDialog
          item={editing}
          perf={perf.find((p) => p.employee_id === editing.employee_id) ?? null}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}

      <Dialog open={!!slip} onOpenChange={(o) => !o && setSlip(null)}>
        <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{slip?.employee_name} 薪資條</DialogTitle>
            <DialogDescription>
              {company?.name} {periodLabel(period)}
            </DialogDescription>
          </DialogHeader>
          {slip && <PayslipView item={slip} />}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => slip && printSlip(slip, company?.name ?? "", periodLabel(period))}
            >
              <Printer className="mr-1 h-4 w-4" />
              列印
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === "close" ? "鎖定發放？" : "解除鎖定？"}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "close"
                ? `鎖定後 ${periodLabel(period)} 的薪資不能再改，員工在打卡頁看得到自己的薪資條，LINE 會通知每個人。這個月的請假也不能再新增或取消。`
                : "解除後可以重算或修改；員工的薪資條會先收起來，等您再次鎖定。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void doClose()}>
              {confirm === "close" ? "確定鎖定發放" : "確定解除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ---------- 列印薪資條（開新視窗） ---------- */
function printSlip(i: PayItem, companyName: string, periodText: string) {
  const esc = (s: string) =>
    s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c);
  const money = (v: unknown) => formatTWD(num(v));
  const rows = (list: [keyof PayItem, string][], neg = false) =>
    list
      .filter(([k]) => num(i[k]) !== 0)
      .map(
        ([k, l]) => `<tr><td>${esc(l)}</td><td class="r">${neg ? "−" : ""}${money(i[k])}</td></tr>`,
      )
      .join("") || `<tr><td colspan="2" class="m">無</td></tr>`;
  const att = attLines(i.att, i.pay_type)
    .map(([k, v]) => `<tr><td>${esc(k)}</td><td class="r">${esc(v)}</td></tr>`)
    .join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>薪資條</title><style>
    body{font-family:"Microsoft JhengHei","PingFang TC",sans-serif;margin:24px;color:#111}
    h1{font-size:20px;margin:0}p{margin:4px 0 12px;color:#555}
    table{width:100%;border-collapse:collapse;margin-bottom:10px}td{padding:4px 6px;border-bottom:1px solid #ddd}
    th{text-align:left;background:#f2f2f2;padding:4px 6px}.r{text-align:right}.m{color:#888}
    .t td{font-weight:bold;font-size:16px;border-top:2px solid #333}
  </style></head><body>
  <h1>${esc(companyName)} 薪資明細</h1><p>${esc(periodText)} ${esc(i.employee_name ?? "")}（${esc(i.emp_no ?? "")}）</p>
  <table><tr><th colspan="2">加項</th></tr>${rows(PAY_ADD)}</table>
  <table><tr><th colspan="2">減項</th></tr>${rows(PAY_SUB, true)}</table>
  <table class="t"><tr><td>應發薪資</td><td class="r">${money(i.gross_pay)}</td></tr></table>
  <table><tr><th colspan="2">代扣</th></tr>${rows(PAY_DED, true)}</table>
  <table class="t"><tr><td>實發金額</td><td class="r">${money(i.net_pay)}</td></tr></table>
  <table><tr><th colspan="2">本月出勤</th></tr>${att}</table>
  <table><tr><th colspan="2">公司另外負擔（不從薪水扣）</th></tr>${rows(PAY_ER)}
  <tr><td>投保薪資</td><td class="r">${money(i.insured_salary)}</td></tr></table>
  ${i.note ? `<p>備註：${esc(i.note)}</p>` : ""}
  </body></html>`;
  const w = window.open("", "_blank", "width=480,height=760");
  if (!w) {
    toast.error("瀏覽器擋住了新視窗，請允許彈出視窗後再試");
    return;
  }
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}

/* ---------- 填獎金、扣款 ---------- */
function EditItemDialog({
  item,
  perf,
  onClose,
  onSaved,
}: {
  item: PayItem;
  perf: Perf | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [v, setV] = useState({
    perf: String(num(item.perf_bonus)),
    add: String(num(item.other_add)),
    tax: String(num(item.income_tax)),
    ded: String(num(item.other_deduct)),
    days: item.pay_days_override === null ? "" : String(num(item.pay_days_override)),
    note: item.note ?? "",
  });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) =>
    setV((p) => ({ ...p, [k]: e.target.value }));

  const save = async () => {
    const n = (s: string) => (s.trim() === "" ? 0 : Number(s));
    const vals = [n(v.perf), n(v.add), n(v.tax), n(v.ded)];
    if (vals.some((x) => !Number.isFinite(x) || x < 0)) {
      toast.error("金額要填 0 以上的數字");
      return;
    }
    const days = v.days.trim() === "" ? null : Number(v.days);
    if (days !== null && (!Number.isFinite(days) || days < 0 || days > 30)) {
      toast.error("計薪天數要在 0～30 之間");
      return;
    }
    setSaving(true);
    const { error } = await supabase.rpc("payroll_update_item", {
      p_item_id: item.id,
      p_perf_bonus: vals[0],
      p_other_add: vals[1],
      p_income_tax: vals[2],
      p_other_deduct: vals[3],
      p_pay_days: days,
      p_note: v.note,
    });
    setSaving(false);
    if (error) {
      toast.error(humanizeError(error, "儲存"));
      return;
    }
    toast.success("已更新，薪資已重算");
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{item.employee_name}：獎金與扣款</DialogTitle>
          <DialogDescription>只有這幾項要手填，其他由打卡和請假自動算。</DialogDescription>
        </DialogHeader>
        {perf && (
          <div className="rounded-md bg-muted px-3 py-2 text-sm">
            本月績效參考：完成工序 {perf.tasks_done} 道（準時 {perf.tasks_on_time}）、完成快單{" "}
            {perf.quick_done} 張、經手快單營收 {formatTWD(num(perf.quick_amount))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>績效獎金</Label>
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              value={v.perf}
              onChange={set("perf")}
            />
          </div>
          <div className="space-y-1">
            <Label>其他加項</Label>
            <Input type="number" inputMode="numeric" min={0} value={v.add} onChange={set("add")} />
          </div>
          <div className="space-y-1">
            <Label>所得稅（代扣）</Label>
            <Input type="number" inputMode="numeric" min={0} value={v.tax} onChange={set("tax")} />
          </div>
          <div className="space-y-1">
            <Label>其他扣款</Label>
            <Input type="number" inputMode="numeric" min={0} value={v.ded} onChange={set("ded")} />
          </div>
          {item.pay_type !== "hourly" && (
            <div className="col-span-2 space-y-1">
              <Label>計薪天數</Label>
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                max={30}
                placeholder={`空白＝自動（${num(item.att?.pay_days ?? 30)} 天）`}
                value={v.days}
                onChange={set("days")}
              />
              <p className="text-xs text-muted-foreground">月中到職或離職才要改；整月是 30 天。</p>
            </div>
          )}
          <div className="col-span-2 space-y-1">
            <Label>備註（員工薪資條上看得到）</Label>
            <Textarea rows={2} value={v.note} onChange={set("note")} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? "儲存中…" : "儲存並重算"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- 員工薪資設定 ---------- */
function ProfilesTab({
  emps,
  profiles,
  canEdit,
  onSaved,
}: {
  emps: Emp[];
  profiles: Profile[];
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState<Emp | null>(null);
  const byEmp = new Map(profiles.map((p) => [p.employee_id, p]));
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        每位員工設定一次，調薪時再改。本薪＋職務加給＋伙食津貼不能低於基本工資；伙食津貼每月 3,000
        元內免稅。 改了之後，到「每月薪資」按「重新計算」才會套用。
      </p>
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>員工</TableHead>
                <TableHead>計薪方式</TableHead>
                <TableHead className="text-right">本薪／時薪</TableHead>
                <TableHead className="text-right">職務加給</TableHead>
                <TableHead className="text-right">伙食津貼</TableHead>
                <TableHead className="text-right">全勤獎金</TableHead>
                <TableHead>健保</TableHead>
                <TableHead className="text-right">投保薪資</TableHead>
                {canEdit && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {emps.map((e) => {
                const p = byEmp.get(e.id);
                return (
                  <TableRow key={e.id}>
                    <TableCell className="font-medium">
                      {e.name}
                      <span className="ml-1 text-xs text-muted-foreground">{e.emp_no}</span>
                    </TableCell>
                    {p ? (
                      <>
                        <TableCell>{p.pay_type === "hourly" ? "時薪" : "月薪"}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {p.pay_type === "hourly"
                            ? `${formatTWD(num(p.hourly_rate))}／時`
                            : formatTWD(num(p.base_salary))}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatTWD(num(p.position_allowance))}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatTWD(num(p.meal_allowance))}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatTWD(num(p.attendance_bonus))}
                        </TableCell>
                        <TableCell className="text-sm">
                          {p.nhi_enrolled
                            ? `加保${p.nhi_dependents ? `＋眷屬 ${p.nhi_dependents}` : ""}`
                            : "不在公司加保"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {p.insured_override ? formatTWD(num(p.insured_override)) : "自動"}
                        </TableCell>
                      </>
                    ) : (
                      <TableCell colSpan={7} className="text-sm text-amber-700 dark:text-amber-400">
                        還沒設定（不會算薪資）
                      </TableCell>
                    )}
                    {canEdit && (
                      <TableCell className="text-right">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(e)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {editing && (
        <ProfileDialog
          emp={editing}
          profile={byEmp.get(editing.id) ?? null}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onSaved();
          }}
        />
      )}
    </div>
  );
}

function ProfileDialog({
  emp,
  profile,
  onClose,
  onSaved,
}: {
  emp: Emp;
  profile: Profile | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { company } = useAuth();
  const s = (x: unknown) => (x === null || x === undefined ? "" : String(num(x)));
  const [v, setV] = useState({
    pay_type: profile?.pay_type ?? "monthly",
    base_salary: profile ? s(profile.base_salary) : "",
    hourly_rate: profile ? s(profile.hourly_rate) : "",
    position_allowance: profile ? s(profile.position_allowance) : "0",
    meal_allowance: profile ? s(profile.meal_allowance) : "2400",
    attendance_bonus: profile ? s(profile.attendance_bonus) : "1000",
    nhi_enrolled: profile?.nhi_enrolled ?? true,
    nhi_dependents: profile ? String(profile.nhi_dependents) : "0",
    pension_self_rate: profile ? String(Math.round(num(profile.pension_self_rate) * 100)) : "0",
    insured_override: profile?.insured_override ? s(profile.insured_override) : "",
    note: profile?.note ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) =>
    setV((p) => ({ ...p, [k]: e.target.value }));
  const hourly = v.pay_type === "hourly";

  const save = async () => {
    if (!company) return;
    const n = (x: string) => (x.trim() === "" ? 0 : Number(x));
    const row = {
      employee_id: emp.id,
      company_id: company.id,
      pay_type: v.pay_type,
      base_salary: hourly ? 0 : n(v.base_salary),
      hourly_rate: hourly ? n(v.hourly_rate) : 0,
      position_allowance: n(v.position_allowance),
      meal_allowance: n(v.meal_allowance),
      attendance_bonus: hourly ? 0 : n(v.attendance_bonus),
      nhi_enrolled: v.nhi_enrolled,
      nhi_dependents: Math.trunc(n(v.nhi_dependents)),
      pension_self_rate: n(v.pension_self_rate) / 100,
      insured_override: v.insured_override.trim() === "" ? null : n(v.insured_override),
      note: v.note.trim() || null,
    };
    const nums = [
      row.base_salary,
      row.hourly_rate,
      row.position_allowance,
      row.meal_allowance,
      row.attendance_bonus,
    ];
    if (nums.some((x) => !Number.isFinite(x) || x < 0)) {
      toast.error("金額要填 0 以上的數字");
      return;
    }
    if (!hourly && row.base_salary <= 0) {
      toast.error("請填本薪");
      return;
    }
    if (hourly && row.hourly_rate <= 0) {
      toast.error("請填時薪");
      return;
    }
    if (hourly && !row.insured_override) {
      toast.error("時薪人員請填投保薪資（依勞保局部分工時級距）");
      return;
    }
    if (!(row.pension_self_rate >= 0 && row.pension_self_rate <= 0.06)) {
      toast.error("勞退自提要在 0～6% 之間");
      return;
    }
    if (!(row.nhi_dependents >= 0 && row.nhi_dependents <= 10)) {
      toast.error("健保眷屬人數不正確");
      return;
    }
    setSaving(true);
    const { data, error } = await supabase
      .from("employee_pay_profiles")
      .upsert(row, { onConflict: "employee_id" })
      .select("employee_id");
    setSaving(false);
    if (error) {
      toast.error(humanizeError(error, "儲存薪資設定"));
      return;
    }
    if (!data?.length) {
      toast.error("沒有寫入任何資料（可能沒有權限）");
      return;
    }
    toast.success(`已儲存 ${emp.name} 的薪資設定`);
    onSaved();
  };

  const remove = async () => {
    setRemoving(true);
    const { data, error } = await supabase
      .from("employee_pay_profiles")
      .delete()
      .eq("employee_id", emp.id)
      .select("employee_id");
    setRemoving(false);
    if (error) {
      toast.error(humanizeError(error, "移除薪資設定"));
      return;
    }
    if (!data?.length) {
      toast.error("沒有移除任何資料（可能沒有權限）");
      return;
    }
    toast.success("已移除，之後計算不會算到這個人");
    onSaved();
  };

  const field = (k: keyof typeof v, label: string, help?: string) => (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Input type="number" inputMode="decimal" min={0} value={String(v[k])} onChange={set(k)} />
      {help && <p className="text-xs text-muted-foreground">{help}</p>}
    </div>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{emp.name} 的薪資設定</DialogTitle>
          <DialogDescription>金額都是每月（時薪除外）。</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1">
            <Label>計薪方式</Label>
            <Select
              value={v.pay_type}
              onValueChange={(x) => setV((p) => ({ ...p, pay_type: x as "monthly" | "hourly" }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="monthly">月薪（正職）</SelectItem>
                <SelectItem value="hourly">時薪（工讀、兼職）</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {hourly ? field("hourly_rate", "時薪", "不可低於 196 元") : field("base_salary", "本薪")}
          {field("position_allowance", "職務加給", "例：設計")}
          {field("meal_allowance", "伙食津貼", "3,000 元內免稅")}
          {!hourly && field("attendance_bonus", "全勤獎金")}
          <div className="col-span-2 flex items-center justify-between rounded-md border px-3 py-2">
            <div>
              <p className="text-sm font-medium">健保在公司加保</p>
              <p className="text-xs text-muted-foreground">工讀生依附父母或在別處加保就關掉</p>
            </div>
            <Switch
              checked={v.nhi_enrolled}
              onCheckedChange={(c) => setV((p) => ({ ...p, nhi_enrolled: c }))}
            />
          </div>
          {v.nhi_enrolled && field("nhi_dependents", "健保眷屬人數", "最多算 3 人")}
          {field("pension_self_rate", "勞退自提（%）", "員工自願，0～6")}
          {field(
            "insured_override",
            "投保薪資（手填）",
            hourly ? "時薪人員必填，依部分工時級距" : "空白＝自動依本薪＋加給＋伙食＋全勤對應級距",
          )}
          <div className="col-span-2 space-y-1">
            <Label>備註</Label>
            <Input value={v.note} onChange={set("note")} />
          </div>
        </div>
        <DialogFooter className="gap-2">
          {profile && (
            <Button
              variant="ghost"
              className="mr-auto text-destructive"
              disabled={removing}
              onClick={() => void remove()}
            >
              移除（不計薪）
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? "儲存中…" : "儲存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- 計算參數 ---------- */
const PARAM_FIELDS: { key: string; label: string; pct?: boolean; help?: string; group: string }[] =
  [
    { group: "基本工資", key: "min_month", label: "基本工資（月）" },
    { group: "基本工資", key: "min_hour", label: "基本工資（時）" },
    { group: "公司規定", key: "late_allow", label: "遲到＋早退可容許次數", help: "超過就不發全勤" },
    { group: "公司規定", key: "div_hour", label: "時薪基數除數", help: "月薪 ÷ 30 ÷ 8＝240" },
    { group: "公司規定", key: "div_day", label: "日薪除數" },
    { group: "加班與請假", key: "ot1", label: "加班前 2 小時倍率" },
    { group: "加班與請假", key: "ot2", label: "加班第 3 小時起倍率" },
    { group: "加班與請假", key: "hol_monthly", label: "國定假日出勤加給（月薪制）" },
    { group: "加班與請假", key: "hol_hourly", label: "國定假日出勤倍率（時薪制）" },
    { group: "加班與請假", key: "sick_ratio", label: "病假給薪比例", pct: true },
    { group: "勞保", key: "li_rate", label: "勞保普通事故費率", pct: true },
    { group: "勞保", key: "ei_rate", label: "就業保險費率", pct: true },
    { group: "勞保", key: "li_emp", label: "勞工負擔", pct: true },
    { group: "勞保", key: "li_er", label: "公司負擔", pct: true },
    { group: "勞保", key: "li_cap", label: "勞保投保上限" },
    {
      group: "勞保",
      key: "occ_rate",
      label: "職災費率（公司全額）",
      pct: true,
      help: "請依勞保局核定通知修改",
    },
    { group: "勞保", key: "occ_cap", label: "職災投保上限" },
    { group: "健保", key: "nhi_rate", label: "健保費率", pct: true },
    { group: "健保", key: "nhi_emp", label: "員工負擔", pct: true },
    { group: "健保", key: "nhi_er", label: "公司負擔", pct: true },
    { group: "健保", key: "nhi_avg", label: "平均眷口數" },
    { group: "健保", key: "nhi_dep_max", label: "眷屬最多計算人數" },
    { group: "勞退與稅", key: "pension_rate", label: "公司勞退提繳率", pct: true },
    { group: "勞退與稅", key: "meal_cap", label: "伙食津貼免稅上限" },
    {
      group: "勞退與稅",
      key: "tax_start",
      label: "所得稅起扣參考（月）",
      help: "超過會提醒填所得稅",
    },
  ];

function ParamsTab({ canEdit }: { canEdit: boolean }) {
  const { company } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["payroll_params", company?.id],
    enabled: !!company?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payroll_params")
        .select(`company_id, brackets, updated_at, ${PARAM_FIELDS.map((f) => f.key).join(", ")}`)
        .maybeSingle();
      if (error) throw error;
      return data as Record<string, unknown> | null;
    },
  });
  const [form, setForm] = useState<Record<string, string> | null>(null);
  const [saving, setSaving] = useState(false);

  const data = q.data;
  const toForm = (d: Record<string, unknown>) => {
    const f: Record<string, string> = {};
    for (const p of PARAM_FIELDS) {
      const n = num(d[p.key]);
      f[p.key] = p.pct ? String(Math.round(n * 1000000) / 10000) : String(n);
    }
    f["brackets"] = ((d["brackets"] as unknown[]) ?? []).map((x) => num(x)).join(", ");
    return f;
  };
  const f = form ?? (data ? toForm(data) : null);

  const save = async () => {
    if (!f || !company) return;
    const row: Record<string, unknown> = {};
    for (const p of PARAM_FIELDS) {
      const n = Number(f[p.key]);
      if (!Number.isFinite(n) || n < 0) {
        toast.error(`「${p.label}」不是正確的數字`);
        return;
      }
      row[p.key] = p.pct ? n / 100 : n;
    }
    const br = (f["brackets"] ?? "")
      .split(/[,，\s]+/)
      .filter(Boolean)
      .map(Number);
    if (!br.length || br.some((x) => !Number.isFinite(x) || x <= 0)) {
      toast.error("投保級距請用逗號分開的數字");
      return;
    }
    row["brackets"] = [...br].sort((a, b) => a - b);
    setSaving(true);
    const { data: res, error } = await supabase
      .from("payroll_params")
      .update(row)
      .eq("company_id", company.id)
      .select("company_id");
    setSaving(false);
    if (error) {
      toast.error(humanizeError(error, "儲存參數"));
      return;
    }
    if (!res?.length) {
      toast.error("沒有寫入任何資料（請先到「每月薪資」計算一次，或確認權限）");
      return;
    }
    toast.success("已儲存。下次「重新計算」時套用");
    setForm(null);
    void qc.invalidateQueries({ queryKey: ["payroll_params", company.id] });
  };

  if (q.isLoading) return <p className="py-6 text-sm text-muted-foreground">載入中…</p>;
  if (q.error)
    return <p className="py-6 text-sm text-destructive">{humanizeError(q.error, "讀取參數")}</p>;
  if (!f)
    return (
      <p className="py-6 text-sm text-muted-foreground">
        還沒有參數，先到「每月薪資」計算一次就會建立。
      </p>
    );

  const groups = [...new Set(PARAM_FIELDS.map((p) => p.group))];
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        已預先填好 2026 年的法定數字。每年 1
        月政府公告調整時，在這裡改；職災費率請依勞保局寄來的核定通知修改。百分比欄位填 %
        數字（例：5.17）。
      </p>
      {groups.map((g) => (
        <Card key={g}>
          <CardContent className="space-y-3 pt-4">
            <p className="font-medium">{g}</p>
            <div className="grid gap-3 sm:grid-cols-3">
              {PARAM_FIELDS.filter((p) => p.group === g).map((p) => (
                <div key={p.key} className="space-y-1">
                  <Label>
                    {p.label}
                    {p.pct ? "（%）" : ""}
                  </Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    disabled={!canEdit}
                    value={f[p.key] ?? ""}
                    onChange={(e) => setForm({ ...f, [p.key]: e.target.value })}
                  />
                  {p.help && <p className="text-xs text-muted-foreground">{p.help}</p>}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
      <Card>
        <CardContent className="space-y-2 pt-4">
          <p className="font-medium">投保級距（月）</p>
          <Textarea
            rows={3}
            disabled={!canEdit}
            value={f["brackets"] ?? ""}
            onChange={(e) => setForm({ ...f, brackets: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            依「本薪＋加給＋伙食＋全勤」自動對應到第一個大於等於它的級距；超過最高級的人請在員工薪資設定手填投保薪資。
          </p>
        </CardContent>
      </Card>
      {canEdit && (
        <div className="flex justify-end gap-2">
          {form && (
            <Button variant="outline" onClick={() => setForm(null)}>
              還原
            </Button>
          )}
          <Button onClick={() => void save()} disabled={saving || !form}>
            {saving ? "儲存中…" : "儲存參數"}
          </Button>
        </div>
      )}
    </div>
  );
}
