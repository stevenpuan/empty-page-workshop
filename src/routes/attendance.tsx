import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  Loader2,
  MapPin,
  X,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { humanizeError } from "@/lib/app-error";
import { taipeiToday } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export const Route = createFileRoute("/attendance")({
  head: () => ({
    meta: [
      { title: "出勤管理 — 營運系統" },
      { name: "description", content: "每日出勤、補卡審核與月報表。" },
      { property: "og:title", content: "出勤管理 — 營運系統" },
      { property: "og:description", content: "每日出勤、補卡審核與月報表。" },
    ],
  }),
  component: AttendancePage,
});

interface DailyRow {
  attendance_id?: string | null;
  employee_id?: string | null;
  emp_no: string | null;
  name: string | null;
  shift_name: string | null;
  work_date: string;
  clock_in_at: string | null;
  clock_out_at: string | null;
  status: string | null;
  late_minutes: number | null;
  early_leave_minutes: number | null;
  work_minutes: number | null;
  overtime_minutes: number | null;
  is_abnormal_location: boolean | null;
  abnormal_reason?: string | null;
  pending_amendments: number | null;
  clock_in_lat?: number | null;
  clock_in_lng?: number | null;
  clock_in_distance_m?: number | null;
  clock_out_lat?: number | null;
  clock_out_lng?: number | null;
  clock_out_distance_m?: number | null;
}

interface AmendmentRow {
  id: string;
  request_type: string;
  request_time: string | null;
  request_time_out: string | null;
  reason: string | null;
  status: string;
  created_at: string;
  employee: { emp_no: string | null; name: string | null } | null;
}

interface MonthlyRow {
  emp_no: string | null;
  name: string | null;
  work_days: number | null;
  normal_days: number | null;
  late_days: number | null;
  early_leave_days: number | null;
  absent_days: number | null;
  awol_days: number | null;
  total_late_minutes: number | null;
  total_early_leave_minutes: number | null;
  total_work_minutes: number | null;
  overtime_134_minutes: number | null;
  overtime_167_minutes: number | null;
  holiday_overtime_minutes: number | null;
  abnormal_count: number | null;
}

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  normal: { label: "正常", cls: "bg-green-100 text-green-800 border-green-200" },
  late: { label: "遲到", cls: "bg-red-100 text-red-800 border-red-200" },
  early_leave: { label: "早退", cls: "bg-orange-100 text-orange-800 border-orange-200" },
  absent: { label: "缺勤", cls: "bg-gray-100 text-gray-600 border-gray-200" },
  awol: { label: "曠職", cls: "bg-red-100 text-red-800 border-red-200" },
  missing: { label: "缺卡", cls: "bg-gray-100 text-gray-600 border-gray-200" },
};

const AMEND_TYPE: Record<string, string> = {
  clock_in: "補上班卡",
  clock_out: "補下班卡",
  both: "補上下班卡",
};

const EMPTY_DAILY: DailyRow[] = [];
const EMPTY_AMEND: AmendmentRow[] = [];
const EMPTY_MONTHLY: MonthlyRow[] = [];

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function num(v: number | null | undefined): string {
  return v == null || v === 0 ? "—" : String(v);
}

function AttendancePage() {
  const navigate = useNavigate();
  const { session, loading, permsLoaded, isManager, company } = useAuth();
  const [tab, setTab] = useState("daily");

  useEffect(() => {
    if (!loading && !session) navigate({ to: "/login" });
  }, [loading, session, navigate]);

  useEffect(() => {
    if (!loading && permsLoaded && session && !isManager) {
      toast.error("此頁面僅限主管與負責人檢視");
      navigate({ to: "/clock" });
    }
  }, [loading, permsLoaded, session, isManager, navigate]);

  if (loading || !permsLoaded) {
    return <div className="min-h-screen grid place-items-center text-muted-foreground">載入中…</div>;
  }
  if (!session || !isManager) return null;

  return (
    <div className="min-h-screen bg-background px-4 py-6">
      <div className="mx-auto w-full max-w-7xl space-y-4">
        <div>
          <h1 className="text-2xl font-bold">出勤管理</h1>
          <p className="text-sm text-muted-foreground">{company?.name ?? ""}</p>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="daily">每日出勤</TabsTrigger>
            <TabsTrigger value="amend">補卡審核</TabsTrigger>
            <TabsTrigger value="monthly">月報表</TabsTrigger>
          </TabsList>

          <TabsContent value="daily" className="mt-4">
            <DailyTab onGoAmend={() => setTab("amend")} />
          </TabsContent>
          <TabsContent value="amend" className="mt-4">
            <AmendTab />
          </TabsContent>
          <TabsContent value="monthly" className="mt-4">
            <MonthlyTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

/* ---------------- Tab 1：每日出勤 ---------------- */

function DailyTab({ onGoAmend }: { onGoAmend: () => void }) {
  const today = taipeiToday();
  const [rangeMode, setRangeMode] = useState(false);
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["attendance_daily_report", rangeMode, dateFrom, dateTo],
    queryFn: async () => {
      let q = supabase.from("attendance_daily_report").select("*");
      q = rangeMode ? q.gte("work_date", dateFrom).lte("work_date", dateTo) : q.eq("work_date", dateFrom);
      const { data: rows, error: err } = await q.order("work_date").order("emp_no");
      if (err) throw err;
      return (rows ?? []) as unknown as DailyRow[];
    },
  });

  const rows = data ?? EMPTY_DAILY;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">每日出勤</CardTitle>
        <div className="flex flex-wrap items-end gap-3 pt-2">
          <div className="space-y-1">
            <Label className="text-xs">{rangeMode ? "起始日" : "日期"}</Label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-40"
            />
          </div>
          {rangeMode && (
            <div className="space-y-1">
              <Label className="text-xs">結束日</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-40"
              />
            </div>
          )}
          <div className="flex items-center gap-2 pb-2">
            <Switch id="range-mode" checked={rangeMode} onCheckedChange={setRangeMode} />
            <Label htmlFor="range-mode" className="text-xs">
              日期範圍
            </Label>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            出勤報表尚未啟用（{humanizeError(error, "讀取出勤")}）
          </p>
        ) : isLoading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">載入中…</p>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">此期間沒有出勤資料</p>
        ) : (
          <TooltipProvider>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>工號</TableHead>
                    <TableHead>姓名</TableHead>
                    <TableHead>班別</TableHead>
                    <TableHead>上班打卡</TableHead>
                    <TableHead>下班打卡</TableHead>
                    <TableHead>狀態</TableHead>
                    <TableHead className="text-right">遲到(分)</TableHead>
                    <TableHead className="text-right">早退(分)</TableHead>
                    <TableHead className="text-right">工時(分)</TableHead>
                    <TableHead className="text-right">加班</TableHead>
                    <TableHead>異常</TableHead>
                    <TableHead>補卡</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r, i) => {
                    const key = `${r.employee_id ?? r.emp_no ?? i}-${r.work_date}`;
                    const st = r.status ? STATUS_LABEL[r.status] : null;
                    const open = expanded === key;
                    return (
                      <Fragment key={key}>
                        <TableRow
                          className="cursor-pointer"
                          onClick={() => setExpanded(open ? null : key)}
                        >
                          <TableCell>
                            {open ? (
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            )}
                          </TableCell>
                          <TableCell className="tabular-nums">{r.emp_no ?? "—"}</TableCell>
                          <TableCell className="font-medium">{r.name ?? "—"}</TableCell>
                          <TableCell>{r.shift_name ?? "—"}</TableCell>
                          <TableCell className="tabular-nums">{fmtTime(r.clock_in_at)}</TableCell>
                          <TableCell className="tabular-nums">{fmtTime(r.clock_out_at)}</TableCell>
                          <TableCell>
                            {st ? (
                              <Badge variant="outline" className={st.cls}>
                                {st.label}
                              </Badge>
                            ) : (
                              "—"
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{num(r.late_minutes)}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {num(r.early_leave_minutes)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{num(r.work_minutes)}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {num(r.overtime_minutes)}
                          </TableCell>
                          <TableCell>
                            {r.is_abnormal_location ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="inline-flex">
                                    <AlertTriangle className="h-4 w-4 text-orange-500" />
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {r.abnormal_reason ?? "打卡位置異常（超出允許範圍）"}
                                </TooltipContent>
                              </Tooltip>
                            ) : (
                              "—"
                            )}
                          </TableCell>
                          <TableCell>
                            {(r.pending_amendments ?? 0) > 0 ? (
                              <Badge
                                className="cursor-pointer bg-yellow-100 text-yellow-800 border-yellow-200"
                                variant="outline"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onGoAmend();
                                }}
                              >
                                {r.pending_amendments}
                              </Badge>
                            ) : (
                              "—"
                            )}
                          </TableCell>
                        </TableRow>
                        {open && (
                          <TableRow className="bg-muted/40 hover:bg-muted/40">
                            <TableCell colSpan={13}>
                              <div className="grid gap-3 py-2 text-sm sm:grid-cols-2">
                                <DetailBlock
                                  title="上班打卡"
                                  at={r.clock_in_at}
                                  lat={r.clock_in_lat ?? null}
                                  lng={r.clock_in_lng ?? null}
                                  distance={r.clock_in_distance_m ?? null}
                                />
                                <DetailBlock
                                  title="下班打卡"
                                  at={r.clock_out_at}
                                  lat={r.clock_out_lat ?? null}
                                  lng={r.clock_out_lng ?? null}
                                  distance={r.clock_out_distance_m ?? null}
                                />
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </TooltipProvider>
        )}
      </CardContent>
    </Card>
  );
}

function DetailBlock({
  title,
  at,
  lat,
  lng,
  distance,
}: {
  title: string;
  at: string | null;
  lat: number | null;
  lng: number | null;
  distance: number | null;
}) {
  return (
    <div className="space-y-1">
      <div className="font-medium">{title}</div>
      <div className="text-muted-foreground">時間：{fmtDateTime(at)}</div>
      <div className="text-muted-foreground flex items-center gap-1">
        <MapPin className="h-3 w-3" />
        座標：{lat != null && lng != null ? `${lat.toFixed(6)}, ${lng.toFixed(6)}` : "—"}
      </div>
      <div className="text-muted-foreground">
        距離：{distance != null ? `${Math.round(distance)} 公尺` : "—"}
      </div>
    </div>
  );
}

/* ---------------- Tab 2：補卡審核 ---------------- */

function AmendTab() {
  const qc = useQueryClient();
  const [rejectTarget, setRejectTarget] = useState<AmendmentRow | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["attendance_amendments_pending"],
    queryFn: async () => {
      const { data: rows, error: err } = await supabase
        .from("attendance_amendments")
        .select("id, request_type, request_time, request_time_out, reason, status, created_at, employee:employees(emp_no, name)")
        .eq("status", "pending")
        .order("created_at");
      if (err) throw err;
      return (rows ?? []) as unknown as AmendmentRow[];
    },
  });

  const rows = data ?? EMPTY_AMEND;

  const decide = async (row: AmendmentRow, approved: boolean, noteText: string) => {
    setBusy(row.id);
    const { error: err } = await supabase.rpc("approve_amendment", {
      p_amendment_id: row.id,
      p_approved: approved,
      p_note: noteText || null,
    });
    setBusy(null);
    if (err) {
      toast.error(humanizeError(err, approved ? "核准補卡" : "駁回補卡"));
      return;
    }
    toast.success(approved ? "已核准補卡申請" : "已駁回補卡申請");
    setRejectTarget(null);
    setNote("");
    qc.invalidateQueries({ queryKey: ["attendance_amendments_pending"] });
    qc.invalidateQueries({ queryKey: ["attendance_daily_report"] });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">待審核補卡申請</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            補卡功能尚未啟用（{humanizeError(error, "讀取補卡申請")}）
          </p>
        ) : isLoading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">載入中…</p>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">目前沒有待審核的補卡申請</p>
        ) : (
          rows.map((r) => (
            <div
              key={r.id}
              className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3"
            >
              <div className="space-y-1 text-sm">
                <div className="font-medium">
                  {r.employee?.name ?? "—"}
                  <span className="ml-2 text-xs text-muted-foreground tabular-nums">
                    {r.employee?.emp_no ?? ""}
                  </span>
                  <Badge variant="outline" className="ml-2">
                    {AMEND_TYPE[r.request_type] ?? r.request_type}
                  </Badge>
                </div>
                <div className="text-muted-foreground">
                  補打時間：{fmtDateTime(r.request_time)}
                  {r.request_time_out ? `　下班：${fmtDateTime(r.request_time_out)}` : ""}
                </div>
                <div className="text-muted-foreground">原因：{r.reason ?? "—"}</div>
                <div className="text-xs text-muted-foreground">
                  申請於 {fmtDateTime(r.created_at)}
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={busy === r.id}
                  onClick={() => void decide(r, true, "")}
                >
                  {busy === r.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                  核准
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy === r.id}
                  onClick={() => {
                    setRejectTarget(r);
                    setNote("");
                  }}
                >
                  <X className="h-4 w-4" />
                  駁回
                </Button>
              </div>
            </div>
          ))
        )}
      </CardContent>

      <Dialog open={!!rejectTarget} onOpenChange={(o) => !o && setRejectTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>駁回補卡申請</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reject-note">駁回備註</Label>
            <Textarea
              id="reject-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="請說明駁回原因"
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={!note.trim() || busy !== null}
              onClick={() => rejectTarget && void decide(rejectTarget, false, note.trim())}
            >
              確認駁回
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/* ---------------- Tab 3：月報表 ---------------- */

function MonthlyTab() {
  const [month, setMonth] = useState(() => taipeiToday().slice(0, 7));
  const [exporting, setExporting] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["attendance_monthly_summary", month],
    queryFn: async () => {
      const { data: rows, error: err } = await supabase
        .from("attendance_monthly_summary")
        .select("*")
        .eq("month", month)
        .order("emp_no");
      if (err) throw err;
      return (rows ?? []) as unknown as MonthlyRow[];
    },
  });

  const rows = data ?? EMPTY_MONTHLY;

  const headers = useMemo(
    () => [
      "工號",
      "姓名",
      "出勤天數",
      "正常",
      "遲到",
      "早退",
      "缺勤",
      "曠職",
      "遲到總分鐘",
      "早退總分鐘",
      "總工時",
      "加班134",
      "加班167",
      "假日加班",
      "異常次數",
    ],
    [],
  );

  const exportExcel = async () => {
    if (rows.length === 0) {
      toast.warning("沒有可匯出的資料");
      return;
    }
    setExporting(true);
    try {
      const XLSX = await import("xlsx");
      const aoa = [
        headers,
        ...rows.map((r) => [
          r.emp_no ?? "",
          r.name ?? "",
          r.work_days ?? 0,
          r.normal_days ?? 0,
          r.late_days ?? 0,
          r.early_leave_days ?? 0,
          r.absent_days ?? 0,
          r.awol_days ?? 0,
          r.total_late_minutes ?? 0,
          r.total_early_leave_minutes ?? 0,
          r.total_work_minutes ?? 0,
          r.overtime_134_minutes ?? 0,
          r.overtime_167_minutes ?? 0,
          r.holiday_overtime_minutes ?? 0,
          r.abnormal_count ?? 0,
        ]),
      ];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, month);
      XLSX.writeFile(wb, `出勤月報表_${month}.xlsx`);
      toast.success("已匯出 Excel");
    } catch (err) {
      toast.error(humanizeError(err, "匯出 Excel"));
    } finally {
      setExporting(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-1">
            <Label className="text-xs">月份</Label>
            <Input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="w-44"
            />
          </div>
          <Button variant="outline" onClick={() => void exportExcel()} disabled={exporting}>
            {exporting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            匯出 Excel
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            月報表尚未啟用（{humanizeError(error, "讀取月報表")}）
          </p>
        ) : isLoading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">載入中…</p>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">此月份沒有出勤資料</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {headers.map((h, i) => (
                    <TableHead key={h} className={i > 1 ? "text-right" : ""}>
                      {h}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow key={`${r.emp_no ?? i}`}>
                    <TableCell className="tabular-nums">{r.emp_no ?? "—"}</TableCell>
                    <TableCell className="font-medium">{r.name ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.work_days ?? 0}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.normal_days ?? 0}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.late_days ?? 0}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.early_leave_days ?? 0}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.absent_days ?? 0}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.awol_days ?? 0}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.total_late_minutes ?? 0}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.total_early_leave_minutes ?? 0}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.total_work_minutes ?? 0}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.overtime_134_minutes ?? 0}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.overtime_167_minutes ?? 0}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.holiday_overtime_minutes ?? 0}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.abnormal_count ?? 0}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
