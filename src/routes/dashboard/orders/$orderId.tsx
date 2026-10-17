import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Truck, ExternalLink, FileText, Printer } from "lucide-react";
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
  customers: { name: string; contact: string | null; address: string | null } | null;
}

interface DeliveryRow {
  id: string;
  delivery_no: string;
  delivery_date: string;
  amount_total: number | string | null;
  status: string;
  receivables: { doc_no: string | null } | null;
}

const DELIVERY_STATUS_LABEL: Record<string, string> = {
  issued: "已開立",
  void: "作廢",
};

/** 已結束的工序（完成／跳過／外包中）不再提供指派、跳過 */
const TERMINAL_TASK_STATUSES = ["done", "skipped", "outsourced"];

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
  work_stations: { name: string; color: string | null; is_outsource_capable: boolean | null } | null;
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
  old_status: string | null;
  new_status: string | null;
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
  const { company, isManager, can } = useAuth();
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
          "id, order_no, item_name, spec, qty, unit, amount_total, due_date, status, note, customers:customer_id(name, contact, address)",
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
          "id, step_no, status, started_at, done_at, blocked_reason, is_outsource, outsource_due_at, due_at, work_stations:station_id(name, color, is_outsource_capable), employees:assignee_id(name), vendors:vendor_id(name)",
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
        .select("id, created_at, old_status, new_status, reason, employees:changed_by(name)")
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

  const { data: deliveries = [], error: deliveryErr } = useQuery({
    queryKey: ["order_delivery_notes", orderId],
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("delivery_notes")
        .select("id, delivery_no, delivery_date, amount_total, status, receivables:receivable_id(doc_no)")
        .eq("order_id", orderId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as unknown as DeliveryRow[];
    },
  });
  const [showDelivery, setShowDelivery] = useState(false);

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

      {order && (
        <Card>
          <CardContent className="p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-medium inline-flex items-center gap-1.5">
                <FileText className="h-4 w-4" />
                出貨單
              </h3>
              {order.status === "active" && can("orders", "edit") && (
                <Button size="sm" onClick={() => setShowDelivery(true)}>
                  開立出貨單
                </Button>
              )}
            </div>
            {deliveryErr ? (
              <p className="text-sm text-destructive">{humanizeError(deliveryErr, "載入出貨單")}</p>
            ) : deliveries.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {order.status === "active"
                  ? "尚未開立出貨單。除最後出貨站外，其餘工序完成（或跳過）後即可開立。"
                  : "目前沒有出貨單。"}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>出貨單號</TableHead>
                      <TableHead>出貨日期</TableHead>
                      <TableHead className="text-right">含稅金額</TableHead>
                      <TableHead>狀態</TableHead>
                      <TableHead>應收單號</TableHead>
                      <TableHead className="text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {deliveries.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell className="font-mono text-sm">{d.delivery_no}</TableCell>
                        <TableCell className="whitespace-nowrap">{fmtDate(d.delivery_date)}</TableCell>
                        <TableCell className="text-right font-mono">{formatTWD(d.amount_total)}</TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={
                              d.status === "void"
                                ? "bg-destructive text-destructive-foreground border-transparent"
                                : "bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/40"
                            }
                          >
                            {DELIVERY_STATUS_LABEL[d.status] ?? d.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-sm">{d.receivables?.doc_no ?? "—"}</TableCell>
                        <TableCell className="text-right">
                          <Button asChild size="sm" variant="ghost">
                            <Link to="/dashboard/deliveries" search={{ print: d.id }} target="_blank">
                              <Printer className="h-3.5 w-3.5 mr-1" />
                              列印
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
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
                      {!TERMINAL_TASK_STATUSES.includes(t.status) && (
                        <>
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
                        </>
                      )}
                      {["pending", "assigned", "in_progress"].includes(t.status) &&
                        t.work_stations?.is_outsource_capable === true && (
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
            <p className="text-sm text-destructive">{humanizeError(logErr, "載入工序日誌")}</p>
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
                          {(TASK_STATUS_LABEL[l.old_status ?? ""] ?? l.old_status ?? "—")} →{" "}
                          {(TASK_STATUS_LABEL[l.new_status ?? ""] ?? l.new_status ?? "—")}
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
        </TabsContent>

        <TabsContent value="costs" className="space-y-4">
          <CostsTab orderId={orderId} companyId={company?.id ?? null} canEdit={isManager} />
        </TabsContent>
      </Tabs>

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

      <CreateDeliveryDialog
        open={showDelivery}
        orderId={orderId}
        orderNo={order?.order_no ?? ""}
        defaultReceiver={order?.customers?.contact ?? ""}
        customerAddress={order?.customers?.address ?? ""}
        onClose={() => setShowDelivery(false)}
        onDone={() => {
          void qc.invalidateQueries({ queryKey: ["order_detail", orderId] });
          void qc.invalidateQueries({ queryKey: tasksKey });
          void qc.invalidateQueries({ queryKey: ["order_delivery_notes", orderId] });
          void qc.invalidateQueries({ queryKey: ["order_cost_summary", orderId] });
        }}
      />

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
  dispatched: "已發派，待對方接單",
  accepted: "對方已接單",
  in_progress: "對方生產中",
  completed: "已完成",
  rejected: "對方退回",
  cancelled: "已取消",
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

function CreateDeliveryDialog({
  open,
  orderId,
  orderNo,
  defaultReceiver,
  customerAddress,
  onClose,
  onDone,
}: {
  open: boolean;
  orderId: string;
  orderNo: string;
  defaultReceiver: string;
  customerAddress: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [date, setDate] = useState("");
  const [receiver, setReceiver] = useState("");
  const [address, setAddress] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setDate(taipeiToday());
      setReceiver(defaultReceiver);
      setAddress("");
      setNote("");
    }
    // 只在開啟時帶入預設值
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = async () => {
    setSaving(true);
    const { data, error } = await supabase.rpc("create_delivery_note", {
      p_order_id: orderId,
      p_delivery_date: date || null,
      p_receiver: receiver.trim() || null,
      p_address: address.trim() || null,
      p_note: note.trim() || null,
    });
    setSaving(false);
    if (error) {
      toast.error(humanizeError(error, "開立出貨單"));
      return;
    }
    const res = (Array.isArray(data) ? data[0] : data) as {
      ok?: boolean;
      delivery_no?: string;
      receivable_no?: string | null;
      due_date?: string | null;
    } | null;
    if (!res?.ok) {
      toast.error("出貨單沒有開立成功（可能沒有權限），請重新整理後再試");
      return;
    }
    toast.success(
      res.receivable_no
        ? `已開立出貨單 ${res.delivery_no ?? ""}，並產生應收 ${res.receivable_no}${res.due_date ? `（到期 ${fmtDate(res.due_date)}）` : ""}`
        : `已開立出貨單 ${res.delivery_no ?? ""}`,
    );
    onDone();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>開立出貨單</DialogTitle>
          <DialogDescription>
            {orderNo}｜開立後訂單轉為「已出貨」，出貨站工序自動完成，並依客戶付款條件產生應收帳款。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>出貨日期 *</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>收貨人</Label>
            <Input value={receiver} onChange={(e) => setReceiver(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>地址</Label>
            <Input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder={customerAddress ? `預設帶客戶地址：${customerAddress}` : "預設帶客戶地址"}
            />
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
          <Button onClick={() => void submit()} disabled={saving || !date}>
            {saving ? "開立中…" : "確認開立"}
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

// ============== 成本 Tab ==============

interface CostSummaryRow {
  order_id: string;
  /** 訂單含稅金額 */
  order_amount?: number | string | null;
  /** 訂單未稅金額（營收以未稅計） */
  order_amount_untaxed?: number | string | null;
  material_cost?: number | string | null;
  outsource_cost?: number | string | null;
  labor_cost?: number | string | null;
  other_cost?: number | string | null;
  total_cost?: number | string | null;
  gross_profit?: number | string | null;
  [key: string]: unknown;
}

interface CostRow {
  id: string;
  cost_type: string;
  source_type: string;
  amount: number | string;
  recognized_at: string;
  note: string | null;
}

const COST_TYPE_LABEL: Record<string, string> = {
  material: "材料",
  outsource: "外包",
  labor: "人工",
  other: "其他",
};
const SOURCE_TYPE_LABEL: Record<string, string> = {
  manual: "手動",
  purchase: "進貨",
  inventory: "庫存領料",
  outsource: "外包",
};

function num(v: number | string | null | undefined): number {
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n as number) ? (n as number) : 0;
}

function CostsTab({
  orderId,
  companyId,
  canEdit,
}: {
  orderId: string;
  companyId: string | null;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);

  const { data: summary, error: sumErr } = useQuery({
    queryKey: ["order_cost_summary", orderId],
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("order_cost_summary")
        .select("*")
        .eq("order_id", orderId)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as CostSummaryRow | null;
    },
  });

  const { data: costs = [], error: costErr } = useQuery({
    queryKey: ["order_costs", orderId],
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("order_costs")
        .select("*")
        .eq("order_id", orderId)
        .order("recognized_at");
      if (error) throw error;
      return data as unknown as CostRow[];
    },
  });

  if (sumErr || costErr) {
    return (
      <p className="text-sm text-destructive">{humanizeError(sumErr ?? costErr, "載入成本")}</p>
    );
  }

  const revenue = num(summary?.order_amount_untaxed);
  const material = num(summary?.material_cost);
  const outsource = num(summary?.outsource_cost);
  const labor = num(summary?.labor_cost);
  const other = num(summary?.other_cost);
  const totalCost = summary?.total_cost != null ? num(summary.total_cost) : material + outsource + labor + other;
  const grossProfit = revenue - totalCost;
  const margin = revenue > 0 ? (grossProfit / revenue) * 100 : null;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
            <Field label="訂單金額（未稅）" value={formatTWD(revenue)} />
            <Field label="材料成本" value={formatTWD(material)} />
            <Field label="外包成本" value={formatTWD(outsource)} />
            <Field label="人工成本" value={formatTWD(labor)} />
            <Field label="其他成本" value={formatTWD(other)} />
            <Field label="成本合計" value={<span className="font-medium">{formatTWD(totalCost)}</span>} />
            <Field
              label="毛利"
              value={
                <span className={grossProfit < 0 ? "font-semibold text-destructive" : "font-semibold"}>
                  {formatTWD(grossProfit)}
                </span>
              }
            />
            <Field
              label="毛利率"
              value={
                margin === null ? (
                  "—"
                ) : (
                  <span className={grossProfit < 0 ? "font-semibold text-destructive" : "font-semibold"}>
                    {margin.toFixed(1)}%
                  </span>
                )
              }
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">成本明細（{costs.length}）</h3>
        {canEdit && (
          <Button size="sm" onClick={() => setShowAdd(true)}>
            手動新增成本
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>成本類型</TableHead>
                <TableHead>來源類型</TableHead>
                <TableHead className="text-right">金額</TableHead>
                <TableHead>認列日期</TableHead>
                <TableHead>備註</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {costs.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>{COST_TYPE_LABEL[c.cost_type] ?? c.cost_type}</TableCell>
                  <TableCell>{SOURCE_TYPE_LABEL[c.source_type] ?? c.source_type}</TableCell>
                  <TableCell className="text-right">{formatTWD(c.amount)}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {fmtDate(c.recognized_at) || "—"}
                  </TableCell>
                  <TableCell className="max-w-[16rem] break-words">{c.note ?? "—"}</TableCell>
                </TableRow>
              ))}
              {costs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    目前沒有成本紀錄
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <AddCostDialog
        open={showAdd}
        orderId={orderId}
        companyId={companyId}
        onClose={() => setShowAdd(false)}
        onDone={() => {
          void qc.invalidateQueries({ queryKey: ["order_costs", orderId] });
          void qc.invalidateQueries({ queryKey: ["order_cost_summary", orderId] });
        }}
      />
    </div>
  );
}

function AddCostDialog({
  open,
  orderId,
  companyId,
  onClose,
  onDone,
}: {
  open: boolean;
  orderId: string;
  companyId: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [costType, setCostType] = useState("material");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setCostType("material");
      setAmount("");
      setDate(taipeiToday());
      setNote("");
    }
  }, [open]);

  const submit = async () => {
    if (!companyId) return;
    const amt = Number(amount);
    if (!amount || !Number.isFinite(amt) || amt <= 0) {
      toast.error("請填寫正確的成本金額");
      return;
    }
    if (!date) {
      toast.error("請選擇認列日期");
      return;
    }
    setSaving(true);
    // 手動成本只能透過 add_order_cost RPC 寫入（直接 insert order_costs 已收回權限）
    const { data, error } = await supabase.rpc("add_order_cost", {
      p_order_id: orderId,
      p_cost_type: costType,
      p_amount: amt,
      p_recognized_at: date || null,
      p_note: note.trim() || null,
    });
    setSaving(false);
    if (error) {
      toast.error(humanizeError(error, "新增成本"));
      return;
    }
    const res = (Array.isArray(data) ? data[0] : data) as { ok?: boolean; cost_id?: string } | null;
    if (!res?.ok || !res.cost_id) {
      toast.error(humanizeError(null, "新增成本（寫入 0 筆）"));
      return;
    }
    toast.success("已新增成本");
    onDone();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>手動新增成本</DialogTitle>
          <DialogDescription>來源類型固定為「手動」，認列後計入該訂單成本。</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>成本類型 *</Label>
            <Select value={costType} onValueChange={setCostType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(COST_TYPE_LABEL).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>金額 *</Label>
            <Input
              type="number"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
            />
          </div>
          <div className="space-y-1">
            <Label>認列日期 *</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
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
            {saving ? "儲存中…" : "確認新增"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
