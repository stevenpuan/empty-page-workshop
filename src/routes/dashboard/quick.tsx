/**
 * 快單看板：老闆／員工用 LINE（或這裡）開單 → 老闆派工 → 製作 → 待取件 → 取件收款結案（列入營收）。
 * 所有寫入走 quick_job_* RPC（029_quick_jobs）。
 */
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Camera,
  Clock,
  Maximize2,
  MessageCircle,
  Minimize2,
  MoreHorizontal,
  Plus,
  Printer,
  User,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { humanizeError } from "@/lib/app-error";
import { fmtDateTime, formatTWD, taipeiToday } from "@/lib/dates";
import { RequirePerm } from "@/components/RequirePerm";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/dashboard/quick")({
  head: () => ({
    meta: [
      { title: "快單看板" },
      { name: "description", content: "臨時快單：LINE 開單、派工、完成、取件收款" },
      { property: "og:title", content: "快單看板" },
      { property: "og:description", content: "臨時快單：LINE 開單、派工、完成、取件收款" },
    ],
  }),
  component: () => (
    <RequirePerm module="quick_jobs">
      <Page />
    </RequirePerm>
  ),
});

/* ======================= 型別與常數 ======================= */

interface QuickJob {
  id: string;
  job_no: string;
  title: string;
  customer_name: string | null;
  customer_phone: string | null;
  pickup_at: string | null;
  note: string | null;
  status: string;
  assignee_id: string | null;
  created_by_employee_id: string | null;
  source: string;
  created_at: string;
  assigned_at: string | null;
  started_at: string | null;
  done_at: string | null;
  closed_at: string | null;
  amount_total: number | null;
  pay_method: string | null;
  tax_id: string | null;
  cancel_reason: string | null;
  assignee: { name: string } | null;
  creator: { name: string } | null;
  closer: { name: string } | null;
  files: { id: string; storage_path: string }[];
}

interface Emp {
  id: string;
  name: string;
}

const JOB_COLS =
  "id, job_no, title, customer_name, customer_phone, pickup_at, note, status, assignee_id, created_by_employee_id, source, created_at, assigned_at, started_at, done_at, closed_at, amount_total, pay_method, tax_id, cancel_reason, assignee:assignee_id(name), creator:created_by_employee_id(name), closer:closed_by_employee_id(name), files:quick_job_files(id, storage_path)";

const COLUMNS: ReadonlyArray<{ key: string; label: string; tone: string }> = [
  { key: "new", label: "待派工", tone: "border-t-red-500" },
  { key: "assigned", label: "已派工", tone: "border-t-blue-500" },
  { key: "in_progress", label: "製作中", tone: "border-t-amber-500" },
  { key: "ready", label: "待取件", tone: "border-t-green-500" },
  { key: "closed", label: "今日結案", tone: "border-t-muted-foreground" },
];

const STATUS_LABEL: Record<string, string> = {
  new: "待派工",
  assigned: "已派工",
  in_progress: "製作中",
  ready: "待取件",
  closed: "已結案",
  cancelled: "已取消",
};

const PAY_LABEL: Record<string, string> = {
  cash: "現金",
  transfer: "轉帳",
  other: "其他",
  unpaid: "未收",
};

const EMPTY_JOBS: QuickJob[] = [];
const EMPTY_EMPS: Emp[] = [];

/** 台北時間今天 00:00 的 ISO */
const dayStartIso = (d: string) => `${d}T00:00:00+08:00`;
const nextDay = (d: string) => {
  const [y = 0, m = 1, dd = 1] = d.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, dd + 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
};

/** datetime-local（台北時間）↔ ISO */
const localToIso = (v: string) => (v ? `${v}:00+08:00` : null);
const isoToLocal = (iso: string | null) => {
  if (!iso) return "";
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour") === "24" ? "00" : g("hour")}:${g("minute")}`;
};

const fmtPickup = (iso: string | null) => {
  if (!iso) return "取件時間未定";
  const today = taipeiToday();
  const local = isoToLocal(iso);
  const [d, t] = local.split("T");
  if (d === today) return `今天 ${t}`;
  if (d === nextDay(today)) return `明天 ${t}`;
  return `${d?.slice(5).replace("-", "/")} ${t}`;
};

/* ======================= 頁面 ======================= */

function Page() {
  const { company, employee, isManager } = useAuth();
  const qc = useQueryClient();
  const companyId = company?.id;
  const today = taipeiToday();
  const key = ["quick_jobs", companyId, today];

  const {
    data: jobs = EMPTY_JOBS,
    isLoading,
    error,
  } = useQuery({
    queryKey: key,
    enabled: !!companyId,
    queryFn: async (): Promise<QuickJob[]> => {
      const { data, error } = await supabase
        .from("quick_jobs")
        .select(JOB_COLS)
        .eq("company_id", companyId!)
        .or(`status.in.(new,assigned,in_progress,ready),closed_at.gte.${dayStartIso(today)}`)
        .order("pickup_at", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as QuickJob[];
    },
  });

  const { data: emps = EMPTY_EMPS } = useQuery({
    queryKey: ["quick_emps", companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<Emp[]> => {
      const { data, error } = await supabase
        .from("employees")
        .select("id, name")
        .eq("company_id", companyId!)
        .eq("is_active", true)
        .order("emp_no");
      if (error) throw error;
      return (data ?? []) as Emp[];
    },
  });

  // 即時更新：LINE 開單、別人派工或完成，畫面跟著變
  useEffect(() => {
    if (!companyId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const ch = supabase
      .channel(`quick-${companyId}-${Math.random().toString(36).slice(2, 8)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "quick_jobs", filter: `company_id=eq.${companyId}` },
        () => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => {
            void qc.invalidateQueries({ queryKey: ["quick_jobs", companyId] });
          }, 300);
        },
      )
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(ch);
    };
  }, [companyId, qc]);

  const reload = () => {
    void qc.invalidateQueries({ queryKey: ["quick_jobs", companyId] });
    void qc.invalidateQueries({ queryKey: ["quick_daily"] });
    void qc.invalidateQueries({ queryKey: ["ledger_docs"] });
    void qc.invalidateQueries({ queryKey: ["ledger_txs"] });
  };

  const [tab, setTab] = useState("board");
  const [tv, setTv] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [detail, setDetail] = useState<QuickJob | null>(null);
  const [assignTarget, setAssignTarget] = useState<QuickJob | null>(null);
  const [pickupTarget, setPickupTarget] = useState<QuickJob | null>(null);
  const [editTarget, setEditTarget] = useState<QuickJob | null>(null);
  const [cancelTarget, setCancelTarget] = useState<QuickJob | null>(null);

  const byStatus = useMemo(() => {
    const m: Record<string, QuickJob[]> = {};
    for (const c of COLUMNS) m[c.key] = [];
    for (const j of jobs) m[j.status]?.push(j);
    return m;
  }, [jobs]);

  const todayAmount = (byStatus["closed"] ?? []).reduce(
    (s, j) => s + Number(j.amount_total ?? 0),
    0,
  );

  const run = async (fn: string, args: Record<string, unknown>, ok: string, ctx: string) => {
    const { error } = await supabase.rpc(fn, args);
    if (error) {
      toast.error(humanizeError(error, ctx));
      return false;
    }
    toast.success(ok);
    reload();
    return true;
  };

  const actions: CardActions = {
    meId: employee?.id ?? null,
    isManager,
    onOpen: setDetail,
    onAssign: setAssignTarget,
    onStart: (j) => void run("quick_job_start", { p_job_id: j.id }, "已開始製作", "開始製作"),
    onDone: (j) => void run("quick_job_done", { p_job_id: j.id }, "已完成，等客人取件", "標記完成"),
    onPickup: setPickupTarget,
    onEdit: setEditTarget,
    onCancel: setCancelTarget,
  };

  const board = (
    <div className={`grid gap-3 ${tv ? "h-full grid-cols-5" : "md:grid-cols-3 xl:grid-cols-5"}`}>
      {COLUMNS.map((c) => {
        const list = byStatus[c.key] ?? [];
        return (
          <div
            key={c.key}
            className={`flex min-h-[8rem] flex-col rounded-lg border border-t-4 bg-muted/30 p-2 ${c.tone} ${
              tv ? "min-h-0 overflow-hidden" : ""
            }`}
          >
            <div className="flex items-center justify-between px-1 pb-2">
              <span className={`font-semibold ${tv ? "text-2xl" : ""}`}>{c.label}</span>
              <Badge variant="secondary" className={tv ? "text-lg" : ""}>
                {list.length}
              </Badge>
            </div>
            <div className={`space-y-2 ${tv ? "min-h-0 flex-1 overflow-y-auto" : ""}`}>
              {list.map((j) => (
                <JobCard key={j.id} job={j} tv={tv} actions={actions} />
              ))}
              {list.length === 0 && (
                <p className="py-6 text-center text-xs text-muted-foreground">沒有快單</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );

  if (tv) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-background p-4">
        <div className="mb-3 flex items-center gap-4">
          <span className="text-3xl font-bold">快單看板</span>
          <span className="text-xl text-muted-foreground">
            {company?.short_name ?? company?.name}
          </span>
          <span className="ml-auto text-xl">
            今日結案 {byStatus["closed"]?.length ?? 0} 張・{formatTWD(todayAmount)}
          </span>
          <Button variant="outline" onClick={() => setTv(false)}>
            <Minimize2 className="mr-1 h-4 w-4" />
            離開全螢幕
          </Button>
        </div>
        <div className="min-h-0 flex-1">{board}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="快單看板"
        description="臨時、散客的快單：LINE 傳「快單 …」就會出現在這裡。老闆派工、做好按完成、取件收款後列入營收。"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setTv(true)}>
              <Maximize2 className="mr-1 h-4 w-4" />
              全螢幕
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1 h-4 w-4" />
              開快單
            </Button>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="待派工"
          value={String(byStatus["new"]?.length ?? 0)}
          alert={(byStatus["new"]?.length ?? 0) > 0}
        />
        <Stat
          label="製作中"
          value={String(
            (byStatus["assigned"]?.length ?? 0) + (byStatus["in_progress"]?.length ?? 0),
          )}
        />
        <Stat label="待取件" value={String(byStatus["ready"]?.length ?? 0)} />
        <Stat
          label={`今日結案 ${byStatus["closed"]?.length ?? 0} 張`}
          value={formatTWD(todayAmount)}
        />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="board">看板</TabsTrigger>
          <TabsTrigger value="daily">日結（收款對帳）</TabsTrigger>
          <TabsTrigger value="howto">LINE 用法</TabsTrigger>
        </TabsList>
        <TabsContent value="board" className="mt-4 space-y-3">
          {!!error && (
            <p className="text-sm text-destructive">{humanizeError(error, "載入快單")}</p>
          )}
          {isLoading ? <p className="py-8 text-muted-foreground">載入中…</p> : board}
        </TabsContent>
        <TabsContent value="daily" className="mt-4">
          <DailyClose companyId={companyId} />
        </TabsContent>
        <TabsContent value="howto" className="mt-4">
          <HowTo />
        </TabsContent>
      </Tabs>

      {createOpen && (
        <JobFormDialog
          mode="create"
          emps={emps}
          canAssign={isManager}
          onClose={() => setCreateOpen(false)}
          onSaved={reload}
        />
      )}
      {editTarget && (
        <JobFormDialog
          mode="edit"
          job={editTarget}
          emps={emps}
          canAssign={false}
          onClose={() => setEditTarget(null)}
          onSaved={reload}
        />
      )}
      {assignTarget && (
        <AssignDialog
          job={assignTarget}
          emps={emps}
          onClose={() => setAssignTarget(null)}
          onSaved={reload}
        />
      )}
      {pickupTarget && (
        <PickupDialog job={pickupTarget} onClose={() => setPickupTarget(null)} onSaved={reload} />
      )}
      {cancelTarget && (
        <CancelDialog job={cancelTarget} onClose={() => setCancelTarget(null)} onSaved={reload} />
      )}
      {detail && <DetailDialog job={detail} actions={actions} onClose={() => setDetail(null)} />}
    </div>
  );
}

function Stat({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <Card className={alert ? "border-red-300" : undefined}>
      <CardContent className="p-4">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className={`mt-1 text-2xl font-semibold tabular-nums ${alert ? "text-red-600" : ""}`}>
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

/* ======================= 卡片 ======================= */

interface CardActions {
  meId: string | null;
  isManager: boolean;
  onOpen: (j: QuickJob) => void;
  onAssign: (j: QuickJob) => void;
  onStart: (j: QuickJob) => void;
  onDone: (j: QuickJob) => void;
  onPickup: (j: QuickJob) => void;
  onEdit: (j: QuickJob) => void;
  onCancel: (j: QuickJob) => void;
}

function JobCard({ job: j, tv, actions: a }: { job: QuickJob; tv: boolean; actions: CardActions }) {
  const mine = !!a.meId && j.assignee_id === a.meId;
  const canWork = mine || a.isManager;
  const canModify = a.isManager || (!!a.meId && j.created_by_employee_id === a.meId);
  const overdue =
    !!j.pickup_at &&
    j.status !== "closed" &&
    j.status !== "ready" &&
    new Date(j.pickup_at).getTime() < Date.now();

  return (
    <div
      className={`cursor-pointer rounded-md border bg-card p-2.5 shadow-sm transition-colors hover:border-primary/50 ${
        overdue ? "border-red-400 bg-red-50 dark:bg-red-950/30" : ""
      } ${mine && j.status !== "closed" ? "ring-2 ring-primary/40" : ""}`}
      onClick={() => a.onOpen(j)}
    >
      <div className="flex items-start justify-between gap-2">
        <span className={`font-mono text-muted-foreground ${tv ? "text-sm" : "text-xs"}`}>
          {j.job_no.slice(-7)}
        </span>
        <div className="flex items-center gap-1">
          {j.source === "line" && <MessageCircle className="h-3.5 w-3.5 text-green-600" />}
          {j.files.length > 0 && (
            <span className="inline-flex items-center text-xs text-muted-foreground">
              <Camera className="mr-0.5 h-3.5 w-3.5" />
              {j.files.length}
            </span>
          )}
        </div>
      </div>
      <div className={`mt-0.5 font-medium leading-snug ${tv ? "text-xl" : ""}`}>{j.title}</div>
      {(j.customer_name || j.customer_phone) && (
        <div className={`text-muted-foreground ${tv ? "text-base" : "text-sm"}`}>
          {[j.customer_name, j.customer_phone].filter(Boolean).join(" ")}
        </div>
      )}
      <div
        className={`mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 ${tv ? "text-base" : "text-xs"}`}
      >
        {j.status === "closed" ? (
          <span className="font-medium">
            {formatTWD(j.amount_total)}・{PAY_LABEL[j.pay_method ?? ""] ?? "免收費"}
          </span>
        ) : (
          <span
            className={`inline-flex items-center ${overdue ? "font-semibold text-red-600" : ""}`}
          >
            <Clock className="mr-0.5 h-3.5 w-3.5" />
            {fmtPickup(j.pickup_at)}
            {overdue && "（逾時）"}
          </span>
        )}
        {j.assignee && (
          <span className="inline-flex items-center">
            <User className="mr-0.5 h-3.5 w-3.5" />
            {j.assignee.name}
          </span>
        )}
      </div>

      {!tv && j.status !== "closed" && (
        <div className="mt-2 flex flex-wrap gap-1" onClick={(e) => e.stopPropagation()}>
          {a.isManager && ["new", "assigned", "in_progress"].includes(j.status) && (
            <Button
              size="sm"
              variant={j.status === "new" ? "default" : "outline"}
              className="h-7 px-2"
              onClick={() => a.onAssign(j)}
            >
              {j.status === "new" ? "派工" : "改派"}
            </Button>
          )}
          {canWork && j.status === "assigned" && (
            <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => a.onStart(j)}>
              開始
            </Button>
          )}
          {canWork && ["assigned", "in_progress"].includes(j.status) && (
            <Button size="sm" className="h-7 px-2" onClick={() => a.onDone(j)}>
              完成
            </Button>
          )}
          {j.status === "ready" && (
            <Button size="sm" className="h-7 px-2" onClick={() => a.onPickup(j)}>
              取件收款
            </Button>
          )}
          {canModify && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost" className="ml-auto h-7 px-1.5" aria-label="更多">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => a.onEdit(j)}>修改內容</DropdownMenuItem>
                {j.status !== "ready" && (
                  <DropdownMenuItem onSelect={() => a.onPickup(j)}>直接取件收款</DropdownMenuItem>
                )}
                <DropdownMenuItem className="text-destructive" onSelect={() => a.onCancel(j)}>
                  取消快單
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}
    </div>
  );
}

/* ======================= 詳情（含照片） ======================= */

function DetailDialog({
  job: j,
  actions: a,
  onClose,
}: {
  job: QuickJob;
  actions: CardActions;
  onClose: () => void;
}) {
  const { data: urls = [] } = useQuery({
    queryKey: ["quick_files", j.id, j.files.length],
    enabled: j.files.length > 0,
    queryFn: async () => {
      const out: string[] = [];
      for (const f of j.files) {
        const { data, error } = await supabase.storage
          .from("quick-job-files")
          .createSignedUrl(f.storage_path, 3600);
        if (!error && data?.signedUrl) out.push(data.signedUrl);
      }
      return out;
    },
  });

  const rows: [string, string | null][] = [
    ["狀態", STATUS_LABEL[j.status] ?? j.status],
    ["客人", [j.customer_name, j.customer_phone].filter(Boolean).join(" ") || null],
    ["取件時間", j.pickup_at ? fmtDateTime(j.pickup_at) : null],
    ["負責人", j.assignee?.name ?? null],
    [
      "開單",
      `${j.creator?.name ?? "—"}・${fmtDateTime(j.created_at)}${j.source === "line" ? "（LINE）" : ""}`,
    ],
    ["開始製作", j.started_at ? fmtDateTime(j.started_at) : null],
    ["完成", j.done_at ? fmtDateTime(j.done_at) : null],
    [
      "結案",
      j.closed_at
        ? `${fmtDateTime(j.closed_at)}・${j.closer?.name ?? ""}・${formatTWD(j.amount_total)} ${
            PAY_LABEL[j.pay_method ?? ""] ?? ""
          }`
        : null,
    ],
    ["統編", j.tax_id],
    ["備註", j.note],
    ["取消原因", j.cancel_reason],
  ];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{j.title}</DialogTitle>
          <DialogDescription className="font-mono">{j.job_no}</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-1.5 text-sm">
          {rows
            .filter(([, v]) => !!v)
            .map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="whitespace-pre-wrap">{v}</dd>
              </div>
            ))}
        </dl>
        {j.files.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            {urls.map((u) => (
              <a key={u} href={u} target="_blank" rel="noreferrer">
                <img
                  src={u}
                  alt="快單照片"
                  className="aspect-square w-full rounded-md border object-cover"
                />
              </a>
            ))}
            {urls.length === 0 && <p className="text-sm text-muted-foreground">照片載入中…</p>}
          </div>
        )}
        <DialogFooter className="gap-2 sm:justify-start">
          {j.status === "ready" && (
            <Button
              onClick={() => {
                onClose();
                a.onPickup(j);
              }}
            >
              取件收款
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            關閉
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ======================= 開單／修改 ======================= */

function JobFormDialog({
  mode,
  job,
  emps,
  canAssign,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  job?: QuickJob;
  emps: Emp[];
  canAssign: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(job?.title ?? "");
  const [customerName, setCustomerName] = useState(job?.customer_name ?? "");
  const [phone, setPhone] = useState(job?.customer_phone ?? "");
  const [pickup, setPickup] = useState(isoToLocal(job?.pickup_at ?? null));
  const [note, setNote] = useState(job?.note ?? "");
  const [assignee, setAssignee] = useState("none");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!title.trim()) {
      toast.error("請填寫要做什麼");
      return;
    }
    setSaving(true);
    const { data, error } =
      mode === "create"
        ? await supabase.rpc("quick_job_create", {
            p_title: title.trim(),
            p_customer_name: customerName.trim() || null,
            p_customer_phone: phone.trim() || null,
            p_pickup_at: localToIso(pickup),
            p_note: note.trim() || null,
            p_assignee_id: assignee === "none" ? null : assignee,
          })
        : await supabase.rpc("quick_job_update", {
            p_job_id: job!.id,
            p_title: title.trim(),
            p_customer_name: customerName.trim() || null,
            p_customer_phone: phone.trim() || null,
            p_pickup_at: localToIso(pickup),
            p_note: note.trim() || null,
          });
    setSaving(false);
    if (error) {
      toast.error(humanizeError(error, mode === "create" ? "開快單" : "修改快單"));
      return;
    }
    const res = (data ?? {}) as { job_no?: string };
    toast.success(mode === "create" ? `已開快單 ${res.job_no ?? ""}` : "已修改");
    onSaved();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "開快單" : `修改 ${job?.job_no}`}</DialogTitle>
          <DialogDescription>金額在客人取件時才填。</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>要做什麼 *</Label>
            <Input
              placeholder="例：名片 2 盒、A1 海報輸出 1 張"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>客人</Label>
              <Input
                placeholder="王先生"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>電話</Label>
              <Input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>取件時間</Label>
              <Input
                type="datetime-local"
                value={pickup}
                onChange={(e) => setPickup(e.target.value)}
              />
            </div>
            {mode === "create" && canAssign && (
              <div className="space-y-1">
                <Label>直接派給</Label>
                <Select value={assignee} onValueChange={setAssignee}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">先不派工</SelectItem>
                    {emps.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <div className="space-y-1">
            <Label>備註</Label>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? "儲存中…" : mode === "create" ? "開單" : "儲存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ======================= 派工 ======================= */

function AssignDialog({
  job,
  emps,
  onClose,
  onSaved,
}: {
  job: QuickJob;
  emps: Emp[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const assign = async (empId: string, name: string) => {
    setSaving(true);
    const { error } = await supabase.rpc("quick_job_assign", {
      p_job_id: job.id,
      p_assignee_id: empId,
    });
    setSaving(false);
    if (error) {
      toast.error(humanizeError(error, "派工"));
      return;
    }
    toast.success(`已派給 ${name}，LINE 會通知他`);
    onSaved();
    onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>派工：{job.title}</DialogTitle>
          <DialogDescription>{job.job_no}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {emps.map((e) => (
            <Button
              key={e.id}
              variant={job.assignee_id === e.id ? "default" : "outline"}
              disabled={saving}
              onClick={() => void assign(e.id, e.name)}
            >
              {e.name}
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ======================= 取件收款 ======================= */

function PickupDialog({
  job,
  onClose,
  onSaved,
}: {
  job: QuickJob;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [taxId, setTaxId] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const n = Number(amount);
    if (amount.trim() === "" || !Number.isFinite(n) || n < 0) {
      toast.error("請填寫金額（免費請填 0）");
      return;
    }
    if (taxId.trim() && !/^\d{8}$/.test(taxId.trim())) {
      toast.error("統編是 8 位數字");
      return;
    }
    setSaving(true);
    const { error } = await supabase.rpc("quick_job_pickup", {
      p_job_id: job.id,
      p_amount: Math.round(n * 100) / 100,
      p_method: method,
      p_tax_id: taxId.trim() || null,
      p_note: note.trim() || null,
    });
    setSaving(false);
    if (error) {
      toast.error(humanizeError(error, "取件收款"));
      return;
    }
    toast.success(
      n === 0
        ? "已結案（免收費）"
        : method === "unpaid"
          ? "已結案，金額記到應收，之後再收款"
          : `已收款 ${formatTWD(n)}，列入營收`,
    );
    onSaved();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>取件收款</DialogTitle>
          <DialogDescription>
            {job.job_no}・{job.title}
            {job.customer_name ? `・${job.customer_name}` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {job.note && <p className="rounded-md bg-muted p-2 text-sm">備註：{job.note}</p>}
          <div className="space-y-1">
            <Label>金額（含稅）*</Label>
            <Input
              autoFocus
              type="number"
              inputMode="decimal"
              min={0}
              className="text-right text-lg"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>收款方式</Label>
            <div className="grid grid-cols-4 gap-2">
              {(["cash", "transfer", "other", "unpaid"] as const).map((m) => (
                <Button
                  key={m}
                  type="button"
                  variant={method === m ? "default" : "outline"}
                  onClick={() => setMethod(m)}
                >
                  {PAY_LABEL[m]}
                </Button>
              ))}
            </div>
            {method === "unpaid" && (
              <p className="text-xs text-muted-foreground">
                會記一筆應收，之後在「應收與收款」收款沖帳。
              </p>
            )}
          </div>
          <div className="space-y-1">
            <Label>統編（要開三聯發票才填）</Label>
            <Input
              inputMode="numeric"
              maxLength={8}
              value={taxId}
              onChange={(e) => setTaxId(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>備註</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? "處理中…" : "確認結案"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ======================= 取消 ======================= */

function CancelDialog({
  job,
  onClose,
  onSaved,
}: {
  job: QuickJob;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!reason.trim()) {
      toast.error("請填寫取消原因");
      return;
    }
    setSaving(true);
    const { error } = await supabase.rpc("quick_job_cancel", {
      p_job_id: job.id,
      p_reason: reason.trim(),
    });
    setSaving(false);
    if (error) {
      toast.error(humanizeError(error, "取消快單"));
      return;
    }
    toast.success("已取消快單");
    onSaved();
    onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>取消 {job.job_no}</DialogTitle>
          <DialogDescription>{job.title}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label>原因 *</Label>
          <Textarea
            rows={2}
            placeholder="例：客人不要了"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            返回
          </Button>
          <Button variant="destructive" onClick={submit} disabled={saving}>
            確認取消
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ======================= 日結 ======================= */

function DailyClose({ companyId }: { companyId: string | undefined }) {
  const [date, setDate] = useState(taipeiToday());
  const {
    data = EMPTY_JOBS,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["quick_daily", companyId, date],
    enabled: !!companyId && !!date,
    queryFn: async (): Promise<QuickJob[]> => {
      const { data, error } = await supabase
        .from("quick_jobs")
        .select(JOB_COLS)
        .eq("company_id", companyId!)
        .eq("status", "closed")
        .gte("closed_at", dayStartIso(date))
        .lt("closed_at", dayStartIso(nextDay(date)))
        .order("closed_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as QuickJob[];
    },
  });

  const summary = useMemo(() => {
    const byPerson = new Map<string, Record<string, number>>();
    const total: Record<string, number> = { cash: 0, transfer: 0, other: 0, unpaid: 0 };
    for (const j of data) {
      const who = j.closer?.name ?? "—";
      const m = j.pay_method ?? "cash";
      const amt = Number(j.amount_total ?? 0);
      const row = byPerson.get(who) ?? { cash: 0, transfer: 0, other: 0, unpaid: 0 };
      row[m] = (row[m] ?? 0) + amt;
      byPerson.set(who, row);
      total[m] = (total[m] ?? 0) + amt;
    }
    return { byPerson: [...byPerson.entries()], total };
  }, [data]);

  const sum = (r: Record<string, number>) =>
    (r["cash"] ?? 0) + (r["transfer"] ?? 0) + (r["other"] ?? 0) + (r["unpaid"] ?? 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <div className="space-y-1">
          <Label>日期</Label>
          <Input
            type="date"
            className="w-44"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <Button variant="outline" onClick={() => window.print()}>
          <Printer className="mr-1 h-4 w-4" />
          列印
        </Button>
      </div>
      {!!error && <p className="text-sm text-destructive">{humanizeError(error, "載入日結")}</p>}

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>收款人</TableHead>
                <TableHead className="text-right">現金（要對抽屜）</TableHead>
                <TableHead className="text-right">轉帳</TableHead>
                <TableHead className="text-right">其他</TableHead>
                <TableHead className="text-right">未收</TableHead>
                <TableHead className="text-right">合計</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.byPerson.map(([who, r]) => (
                <TableRow key={who}>
                  <TableCell className="font-medium">{who}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {formatTWD(r["cash"])}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatTWD(r["transfer"])}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatTWD(r["other"])}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatTWD(r["unpaid"])}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatTWD(sum(r))}</TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-muted/40 font-semibold">
                <TableCell>合計（{data.length} 張）</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatTWD(summary.total["cash"])}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatTWD(summary.total["transfer"])}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatTWD(summary.total["other"])}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatTWD(summary.total["unpaid"])}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatTWD(sum(summary.total))}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>時間</TableHead>
                <TableHead>單號</TableHead>
                <TableHead>內容</TableHead>
                <TableHead>客人</TableHead>
                <TableHead>製作</TableHead>
                <TableHead>收款人</TableHead>
                <TableHead>方式</TableHead>
                <TableHead className="text-right">金額</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                    載入中…
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && data.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                    這天沒有結案的快單
                  </TableCell>
                </TableRow>
              )}
              {data.map((j) => (
                <TableRow key={j.id}>
                  <TableCell className="whitespace-nowrap text-sm">
                    {isoToLocal(j.closed_at).slice(11)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{j.job_no}</TableCell>
                  <TableCell>{j.title}</TableCell>
                  <TableCell className="text-sm">{j.customer_name ?? "—"}</TableCell>
                  <TableCell className="text-sm">{j.assignee?.name ?? "—"}</TableCell>
                  <TableCell className="text-sm">{j.closer?.name ?? "—"}</TableCell>
                  <TableCell className="text-sm">
                    {PAY_LABEL[j.pay_method ?? ""] ?? "免收費"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatTWD(j.amount_total)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

/* ======================= LINE 用法 ======================= */

function HowTo() {
  const rows: [string, string][] = [
    ["開單", "快單 名片2盒 王先生 0912345678 今天5點"],
    ["開單並直接派工（老闆）", "快單 海報1張 李小姐 明天10點 給阿明"],
    ["開沂融的單", "快單 沂融 燙金卡片 50張 後天3點"],
    ["附照片", "先傳照片，10 分鐘內再傳「快單 …」，照片會自動附上"],
    ["看未結案清單", "快單"],
    ["開始／完成", "開始 2610001　／　完成 2610001（或按通知下方的按鈕）"],
    ["取件收款", "收款 2610001 600　（轉帳：收款 2610001 600 轉帳；之後再收：… 未收）"],
    ["取消", "取消 2610001 客人不要了"],
  ];
  return (
    <Card>
      <CardContent className="space-y-3 p-4 text-sm">
        <p>
          在公司的 LINE 官方帳號對話視窗輸入下面的文字（需要先完成員工綁定）。單號可以只打後 7 碼。
          老闆收到新快單時，通知下方會出現員工名字，點一下就派工；員工收到派工後按「開始做」「做好了」。
        </p>
        <Table>
          <TableBody>
            {rows.map(([k, v]) => (
              <TableRow key={k}>
                <TableCell className="w-44 font-medium">{k}</TableCell>
                <TableCell className="font-mono text-sm">{v}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="text-muted-foreground">
          時間可以寫「今天5點」「明天上午10點」「10/20 3點半」；沒寫上午下午時，1～7 點當作下午。
          金額在取件收款時才填。
        </p>
      </CardContent>
    </Card>
  );
}
