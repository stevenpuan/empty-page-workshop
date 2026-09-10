import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Truck, ExternalLink } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { humanizeError } from "@/lib/app-error";
import { fmtDate, fmtDateTime, formatTWD, taipeiToday } from "@/lib/dates";
import { useBoardRealtime } from "@/hooks/useBoardRealtime";
import { RequirePerm } from "@/components/RequirePerm";
import { PageHeader } from "@/components/layout/PageHeader";
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
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export const Route = createFileRoute("/dashboard/orders/$orderId")({
  head: () => ({
    meta: [
      { title: "工單明細" },
      { name: "description", content: "一張訂單的所有工序進度與操作紀錄。" },
      { property: "og:title", content: "工單明細" },
      { property: "og:description", content: "一張訂單的所有工序進度與操作紀錄。" },
    ],
  }),
  component: () => (
    <RequirePerm module="orders">
      <Page />
    </RequirePerm>
  ),
});

interface OrderRow {
  id: string;
  order_no: string;
  item_name: string;
  spec: string | null;
  qty: number;
  unit: string;
  amount_total: number;
  due_date: string | null;
  status: string;
  note: string | null;
  customers: { name: string } | null;
}

interface TaskRow {
  id: string;
  step_no: number;
  status: string;
  started_at: string | null;
  done_at: string | null;
  blocked_reason: string | null;
  is_outsource: boolean;
  outsource_due_at: string | null;
  due_at: string | null;
  work_stations: { name: string; color: string | null } | null;
  employees: { name: string } | null;
  vendors: { name: string } | null;
}

interface LinkRow {
  id: string;
  from_task_id: string;
  status: string;
  agreed_amount: number | null;
  agreed_due_date: string | null;
  to_order_no: string | null;
  vendors: { name: string } | null;
}

interface LogRow {
  id: string;
  created_at: string;
  from_status: string | null;
  to_status: string | null;
  reason: string | null;
  employees: { name: string } | null;
}

const TASK_STATUS_LABEL: Record<string, string> = {
  pending: "待排工",
  assigned: "已指派",
  in_progress: "進行中",
  blocked: "卡關",
  waiting_customer: "等客戶",
  outsourced: "外包中",
  done: "完成",
  skipped: "跳過",
};
const ORDER_STATUS_LABEL: Record<string, string> = {
  draft: "草稿",
  active: "進行中",
  shipped: "已出貨",
  closed: "已結案",
  void: "作廢",
};

function taskTone(status: string) {
  switch (status) {
    case "in_progress":
      return "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/40";
    case "blocked":
      return "bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/40";
    case "waiting_customer":
      return "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/40";
    case "outsourced":
      return "bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/40";
    case "done":
      return "bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/40";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

function Page() {
  const { orderId } = Route.useParams();
  const { company, isManager } = useAuth();
  const qc = useQueryClient();
  useBoardRealtime();

  const [assignTarget, setAssignTarget] = useState<TaskRow | null>(null);
  const [assignee, setAssignee] = useState("");
  const [showLogs, setShowLogs] = useState(false);
  const [dispatchTarget, setDispatchTarget] = useState<TaskRow | null>(null);

  const tasksKey = ["order_detail_tasks", orderId];

  const { data: order, error: orderErr } = useQuery({
    queryKey: ["order_detail", orderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select(
          "id, order_no, item_name, spec, qty, unit, amount_total, due_date, status, note, customers:customer_id(name)",
        )
        .eq("id", orderId)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as OrderRow | null;
    },
  });

  const { data: tasks = [], error: taskErr } = useQuery({
    queryKey: tasksKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("order_tasks")
        .select(
          "id, step_no, status, started_at, done_at, blocked_reason, is_outsource, outsource_due_at, due_at, work_stations:station_id(name, color), employees:assignee_id(name), vendors:vendor_id(name)",
        )
        .eq("order_id", orderId)
        .order("step_no");
      if (error) throw error;
      return data as unknown as TaskRow[];
    },
  });

  const { data: employees = [] } = useQuery({
    queryKey: ["order_detail_employees", company?.id],
    enabled: !!company?.id && isManager,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employees")
        .select("id, name")
        .eq("is_active", true)
        .order("emp_no");
      if (error) throw error;
      return data as { id: string; name: string }[];
    },
  });

  // 工序日誌（S3 才會建表；查不到時靜默略過，不影響本頁其他區塊）
  const { data: logs = [], error: logErr } = useQuery({
    queryKey: ["order_task_logs", orderId],
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("order_task_logs")
        .select("id, created_at, from_status, to_status, reason, employees:actor_employee_id(name)")
        .eq("order_id", orderId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as unknown as LogRow[];
    },
  });

  // 跨公司外包單（S4 才會建表；查不到時靜默略過）
  const { data: links = [] } = useQuery({
    queryKey: ["order_outsource_links", orderId],
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cross_company_links")
        .select(
          "id, from_task_id, status, agreed_amount, agreed_due_date, to_order_no, vendors:vendor_id(name)",
        )
        .eq("from_order_id", orderId)
        .not("status", "in", "(rejected,cancelled)");
      if (error) throw error;
      return data as unknown as LinkRow[];
    },
  });
  const linkByTask = new Map(links.map((l) => [l.from_task_id, l]));

  const total = tasks.length;
  const doneCount = tasks.filter((t) => t.status === "done" || t.status === "skipped").length;
  const pct = total ? Math.round((doneCount / total) * 100) : 0;

  const runRpc = async (fn: string, args: Record<string, unknown>, ctx: string) => {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) {
      toast.error(humanizeError(error, ctx));
      return null;
    }
    void qc.invalidateQueries({ queryKey: tasksKey });
    return data;
  };

  const skip = async (t: TaskRow) => {
    const res = await runRpc("task_skip", { p_task_id: t.id }, "跳過工序");
    if (res !== null) toast.success("已跳過此工序");
  };

  const confirmAssign = async () => {
    if (!assignTarget) return;
    if (!assignee) {
      toast.error("請選擇負責人");
      return;
    }
    const res = await runRpc(
      "task_assign",
      { p_task_id: assignTarget.id, p_assignee_id: assignee },
      "指派工序",
    );
    if (res !== null) {
      toast.success("已指派");
      setAssignTarget(null);
    }
  };

  const overdue = !!order?.due_date && order.due_date < taipeiToday();

  return (
    <div className="space-y-6">
      <PageHeader
        title="工單明細"
        description={order ? `${order.order_no}｜${order.customers?.name ?? "—"}` : ""}
      />

      {orderErr && <p className="text-sm text-destructive">{humanizeError(orderErr, "載入訂單")}</p>}
      {taskErr && <p className="text-sm text-destructive">{humanizeError(taskErr, "載入工序")}</p>}

      {order && (
        <Card>
          <CardContent className="p-5 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-mono text-lg">{order.order_no}</span>
              <Badge variant="outline">{ORDER_STATUS_LABEL[order.status] ?? order.status}</Badge>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
              <Field label="客戶" value={order.customers?.name ?? "—"} />
              <Field label="品名" value={order.item_name} />
              <Field label="數量" value={`${order.qty} ${order.unit}`} />
              <Field
                label="交期"
                value={
                  <span className={overdue ? "text-destructive font-medium" : ""}>
                    {fmtDate(order.due_date) || "—"}
                  </span>
                }
              />
              <Field
                label="含稅金額"
                value={new Intl.NumberFormat("zh-TW").format(Number(order.amount_total ?? 0))}
              />
              <Field label="規格" value={order.spec ?? "—"} />
              {order.note && <Field label="備註" value={order.note} />}
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">工序進度</span>
                <span>
                  {doneCount} / {total}（{pct}%）
                </span>
              </div>
              <Progress value={pct} />
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="tasks" className="space-y-4">
        <TabsList>
          <TabsTrigger value="tasks">工序</TabsTrigger>
          <TabsTrigger value="costs">成本</TabsTrigger>
        </TabsList>

        <TabsContent value="tasks" className="space-y-6">
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-14">序號</TableHead>
                <TableHead>站別</TableHead>
                <TableHead>負責人</TableHead>
                <TableHead>狀態</TableHead>
                <TableHead>開始時間</TableHead>
                <TableHead>完成時間</TableHead>
                <TableHead>備註</TableHead>
                {isManager && <TableHead className="text-right">操作</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>{t.step_no}</TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ backgroundColor: t.work_stations?.color ?? "#94a3b8" }}
                      />
                      {t.work_stations?.name ?? "—"}
                    </span>
                  </TableCell>
                  <TableCell>{t.employees?.name ?? "未指派"}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={taskTone(t.status)}>
                      {TASK_STATUS_LABEL[t.status] ?? t.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {fmtDateTime(t.started_at) || "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {fmtDateTime(t.done_at) || "—"}
                  </TableCell>
                  <TableCell className="max-w-[16rem]">
                    {t.status === "blocked" && t.blocked_reason && (
                      <span className="text-orange-600 dark:text-orange-400 break-words">
                        {t.blocked_reason}
                      </span>
                    )}
                    {t.is_outsource && (
                      <span className="inline-flex items-center gap-1 text-purple-600 dark:text-purple-400">
                        <Truck className="h-3 w-3" />
                        {t.vendors?.name ?? "外包"}
                        {t.outsource_due_at ? `（${fmtDate(t.outsource_due_at)}到期）` : ""}
                      </span>
                    )}
                    <OutsourceInfo link={linkByTask.get(t.id)} />
                  </TableCell>
                  {isManager && (
                    <TableCell className="text-right whitespace-nowrap">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setAssignee("");
                          setAssignTarget(t);
                        }}
                      >
                        指派
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void skip(t)}>
                        跳過
                      </Button>
                      {["pending", "assigned", "in_progress"].includes(t.status) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setDispatchTarget(t)}
                          className="text-purple-600 dark:text-purple-400"
                        >
                          <ExternalLink className="h-3.5 w-3.5 mr-1" />
                          派外包
                        </Button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {tasks.length === 0 && (
                <TableRow>
                  <TableCell colSpan={isManager ? 8 : 7} className="text-center text-muted-foreground py-8">
                    這張訂單還沒有展開工序
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* 工序日誌 */}
      <div className="space-y-3">
        <button
          type="button"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground"
          onClick={() => setShowLogs((v) => !v)}
        >
          {showLogs ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          工序日誌{logErr ? "" : `（${logs.length}）`}
        </button>
        {showLogs &&
          (logErr ? (
            <p className="text-sm text-muted-foreground">工序日誌尚未啟用。</p>
          ) : logs.length === 0 ? (
            <p className="text-sm text-muted-foreground">目前沒有紀錄。</p>
          ) : (
            <Card>
              <CardContent className="p-0 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>時間</TableHead>
                      <TableHead>操作人</TableHead>
                      <TableHead>狀態變更</TableHead>
                      <TableHead>原因</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.map((l) => (
                      <TableRow key={l.id}>
                        <TableCell className="whitespace-nowrap">{fmtDateTime(l.created_at)}</TableCell>
                        <TableCell>{l.employees?.name ?? "—"}</TableCell>
                        <TableCell>
                          {(TASK_STATUS_LABEL[l.from_status ?? ""] ?? l.from_status ?? "—")} →{" "}
                          {(TASK_STATUS_LABEL[l.to_status ?? ""] ?? l.to_status ?? "—")}
                        </TableCell>
                        <TableCell>{l.reason ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))}
      </div>

      <Dialog open={!!assignTarget} onOpenChange={(o) => !o && setAssignTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>指派負責人</DialogTitle>
            <DialogDescription>
              步驟 {assignTarget?.step_no}｜{assignTarget?.work_stations?.name ?? ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label>負責人 *</Label>
            <Select value={assignee} onValueChange={setAssignee}>
              <SelectTrigger>
                <SelectValue placeholder="請選擇" />
              </SelectTrigger>
              <SelectContent>
                {employees.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignTarget(null)}>
              取消
            </Button>
            <Button onClick={confirmAssign}>確認指派</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DispatchOutsourceDialog
        task={dispatchTarget}
        orderNo={order?.order_no ?? ""}
        itemName={order?.item_name ?? ""}
        companyId={company?.id ?? null}
        onClose={() => setDispatchTarget(null)}
        onDone={() => {
          void qc.invalidateQueries({ queryKey: tasksKey });
          void qc.invalidateQueries({ queryKey: ["order_outsource_links", orderId] });
        }}
      />
    </div>
  );
}

const LINK_STATUS_LABEL: Record<string, string> = {
  pending: "待對方接單",
  accepted: "對方已接單",
  in_progress: "對方生產中",
  completed: "已完成",
  shipped: "已出貨",
};

function OutsourceInfo({ link }: { link: LinkRow | undefined }) {
  if (!link) return null;
  const done = link.status === "completed";
  const late =
    !done && !!link.agreed_due_date && link.agreed_due_date < taipeiToday();
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <span>已派 → {link.vendors?.name ?? "外包夥伴"}</span>
      {link.agreed_amount != null && (
        <span>｜金額 {new Intl.NumberFormat("zh-TW").format(Number(link.agreed_amount))}</span>
      )}
      <Badge
        variant="outline"
        className={
          done
            ? "bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/40"
            : "bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/40"
        }
      >
        {LINK_STATUS_LABEL[link.status] ?? link.status}
      </Badge>
      {late && (
        <span className="text-destructive font-medium">
          已逾期（{fmtDate(link.agreed_due_date)}）
        </span>
      )}
    </div>
  );
}

function DispatchOutsourceDialog({
  task,
  orderNo,
  itemName,
  companyId,
  onClose,
  onDone,
}: {
  task: TaskRow | null;
  orderNo: string;
  itemName: string;
  companyId: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [vendorId, setVendorId] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (task) {
      setVendorId("");
      setAmount("");
      setDueDate(task.due_at ?? "");
      setNote("");
    }
  }, [task]);

  const { data: vendors = [], error: vendorErr } = useQuery({
    queryKey: ["outsource_vendors", companyId],
    enabled: !!companyId && !!task,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vendors")
        .select("id, name")
        .eq("company_id", companyId)
        .eq("is_outsource", true)
        .eq("auto_dispatch", true)
        .not("linked_company_id", "is", null)
        .order("name");
      if (error) throw error;
      return data as { id: string; name: string }[];
    },
  });

  const submit = async () => {
    if (!task) return;
    if (!vendorId) {
      toast.error("請選擇外包廠商");
      return;
    }
    const amt = Number(amount);
    if (!amount || !Number.isFinite(amt) || amt <= 0) {
      toast.error("請填寫正確的外包金額");
      return;
    }
    setSaving(true);
    const { data, error } = await supabase.rpc("dispatch_outsource", {
      p_task_id: task.id,
      p_vendor_id: vendorId,
      p_amount: amt,
      p_due_date: dueDate || null,
      p_note: note.trim() || null,
    });
    setSaving(false);
    if (error) {
      toast.error(humanizeError(error, "外包發派"));
      return;
    }
    const toOrderNo =
      (data as { to_order_no?: string } | null)?.to_order_no ??
      (Array.isArray(data) ? (data[0] as { to_order_no?: string } | undefined)?.to_order_no : undefined) ??
      "";
    toast.success(`外包發派成功！對方已自動建立工單 ${toOrderNo}`);
    onDone();
    onClose();
  };

  return (
    <Dialog open={!!task} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>派外包</DialogTitle>
          <DialogDescription>
            {orderNo}｜{itemName}｜步驟 {task?.step_no}　{task?.work_stations?.name ?? ""}（
            {TASK_STATUS_LABEL[task?.status ?? ""] ?? task?.status}）
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>外包廠商 *</Label>
            <Select value={vendorId} onValueChange={setVendorId}>
              <SelectTrigger>
                <SelectValue placeholder="請選擇" />
              </SelectTrigger>
              <SelectContent>
                {vendors.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {vendorErr && (
              <p className="text-xs text-destructive">{humanizeError(vendorErr, "載入廠商")}</p>
            )}
            {!vendorErr && vendors.length === 0 && (
              <p className="text-xs text-muted-foreground">
                目前沒有已綁定夥伴公司且開啟自動派工的外包廠商。
              </p>
            )}
          </div>
          <div className="space-y-1">
            <Label>外包金額 *</Label>
            <Input
              type="number"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
            />
          </div>
          <div className="space-y-1">
            <Label>約定交期</Label>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>備註</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={() => void submit()} disabled={saving}>
            {saving ? "發派中…" : "確認發派"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="break-words">{value}</div>
    </div>
  );
}
