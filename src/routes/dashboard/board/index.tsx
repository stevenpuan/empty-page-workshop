import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  DndContext,
  DragOverlay,
  pointerWithin,
  rectIntersection,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
  type CollisionDetection,
} from "@dnd-kit/core";
import { ChevronDown, ChevronRight, Monitor, Search } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { humanizeError } from "@/lib/app-error";
import { RequirePerm } from "@/components/RequirePerm";
import { PageHeader } from "@/components/layout/PageHeader";
import { JobCard, type BoardTask } from "@/components/JobCard";
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

export const Route = createFileRoute("/dashboard/board/")({
  head: () => ({
    meta: [
      { title: "派工看板" },
      { name: "description", content: "工序派工看板：拖拉推進工序狀態，即時同步。" },
      { property: "og:title", content: "派工看板" },
      { property: "og:description", content: "工序派工看板：拖拉推進工序狀態，即時同步。" },
    ],
  }),
  component: () => (
    <RequirePerm module="board">
      <Page />
    </RequirePerm>
  ),
});

const COLUMNS: ReadonlyArray<readonly [string, string]> = [
  ["pending", "待排工"],
  ["assigned", "已指派"],
  ["in_progress", "進行中"],
  ["blocked", "卡關"],
  ["waiting_customer", "等客戶"],
  ["outsourced", "外包中"],
  ["done", "完成"],
  ["skipped", "跳過"],
];
const COLLAPSED_BY_DEFAULT = ["done", "skipped"];

/** 出貨站代碼：只剩這些站沒完成時，即可開立出貨單（開立時自動完成出貨站） */
const SHIP_STATION_CODES = ["SHIP", "QCSHIP"];
type TaskDoneResult = { order_all_done?: boolean; order_id?: string; order_no?: string };

/** 該訂單未完成的工序是否只剩出貨站 */
async function onlyShippingLeft(orderId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("order_tasks")
    .select("id, work_stations:station_id(code)")
    .eq("order_id", orderId)
    .not("status", "in", "(done,skipped)");
  if (error || !data?.length) return false;
  return (data as unknown as { work_stations: { code: string | null } | null }[]).every((t) =>
    SHIP_STATION_CODES.includes(t.work_stations?.code ?? ""),
  );
}

/**
 * 允許的狀態轉換（與資料庫 trg_task_transition_check_fn 一致；後端也會擋）
 * 「外包中」只能透過工單明細的「派外包」／外包追蹤的取消、退回進出，不提供拖拉。
 */
const ALLOWED: Readonly<Record<string, readonly string[]>> = {
  pending: ["assigned", "in_progress", "skipped"],
  assigned: ["in_progress", "skipped"],
  in_progress: ["done", "blocked", "waiting_customer", "skipped"],
  blocked: ["in_progress", "skipped"],
  waiting_customer: ["in_progress", "skipped"],
  outsourced: [],
  done: [],
  skipped: [],
};

const EMPTY_STATIONS: string[] = [];

interface Emp {
  id: string;
  name: string;
}
interface Station {
  id: string;
  code: string;
  name: string;
  color: string | null;
}

function Page() {
  const { company, isManager } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const canDrag = isManager;

  const [collapsed, setCollapsed] = useState<string[]>(COLLAPSED_BY_DEFAULT);
  const [stationFilter, setStationFilter] = useState<string[]>(EMPTY_STATIONS);
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [dragging, setDragging] = useState<BoardTask | null>(null);
  const [blockTarget, setBlockTarget] = useState<BoardTask | null>(null);
  const [blockReason, setBlockReason] = useState("");
  const [assignTarget, setAssignTarget] = useState<BoardTask | null>(null);
  const [assignee, setAssignee] = useState<string>("");

  const tasksKey = ["order_tasks_board", company?.id];
  const reload = () => qc.invalidateQueries({ queryKey: tasksKey });

  const {
    data: tasks = [],
    isLoading,
    error: loadErr,
  } = useQuery({
    queryKey: tasksKey,
    enabled: !!company?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("order_tasks")
        .select(
          "id, status, blocked_reason, assignee_id, station_id, order_id, orders:order_id(order_no, item_name, due_date, customer_id), work_stations:station_id(name, color), employees:assignee_id(name), vendors:vendor_id(name)",
        )
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as unknown as BoardTask[];
    },
  });

  const { data: employees = [] } = useQuery({
    queryKey: ["board_employees", company?.id],
    enabled: !!company?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employees")
        .select("id, name")
        .eq("is_active", true)
        .order("emp_no");
      if (error) throw error;
      return data as Emp[];
    },
  });

  const { data: stations = [] } = useQuery({
    queryKey: ["board_stations", company?.id],
    enabled: !!company?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_stations")
        .select("id, code, name, color")
        .eq("is_active", true)
        .order("sort_order");
      if (error) throw error;
      return data as Station[];
    },
  });

  // Realtime：任何人推進工序，其他螢幕跟著更新
  // 伺服器端以 company_id 過濾；channel 名稱加亂數尾碼，避免 StrictMode 重複掛載共用同一 channel；
  // 一連串工序更新以 300ms debounce 合併成一次重新查詢。
  useEffect(() => {
    const companyId = company?.id;
    if (!companyId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const suffix = Math.random().toString(36).slice(2, 10);
    const ch = supabase
      .channel(`board-${companyId}-${suffix}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "order_tasks",
          filter: `company_id=eq.${companyId}`,
        },
        () => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => {
            timer = null;
            void qc.invalidateQueries({ queryKey: ["order_tasks_board", companyId] });
          }, 300);
        },
      )
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      timer = null;
      void supabase.removeChannel(ch);
    };
  }, [company?.id, qc]);

  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase();
    return tasks.filter((t) => {
      if (stationFilter.length && (!t.station_id || !stationFilter.includes(t.station_id)))
        return false;
      if (assigneeFilter !== "all") {
        if (assigneeFilter === "none" ? !!t.assignee_id : t.assignee_id !== assigneeFilter)
          return false;
      }
      if (kw) {
        const hay = `${t.orders?.order_no ?? ""} ${t.orders?.item_name ?? ""}`.toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });
  }, [tasks, stationFilter, assigneeFilter, search]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const runRpc = async (fn: string, args: Record<string, unknown>, ctx: string) => {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) {
      toast.error(humanizeError(error, ctx));
      return null;
    }
    reload();
    return data;
  };

  const move = async (task: BoardTask, to: string) => {
    if (to === "blocked") {
      setBlockReason("");
      setBlockTarget(task);
      return;
    }
    if (to === "assigned") {
      setAssignee(task.assignee_id ?? "");
      setAssignTarget(task);
      return;
    }
    if (to === "in_progress") {
      await runRpc("task_start", { p_task_id: task.id }, "開始工序");
      return;
    }
    if (to === "skipped") {
      await runRpc("task_skip", { p_task_id: task.id }, "跳過工序");
      return;
    }
    if (to === "done") {
      const raw = (await runRpc("task_done", { p_task_id: task.id }, "完成工序")) as
        | TaskDoneResult
        | TaskDoneResult[]
        | null;
      if (raw === null) return;
      const res = (Array.isArray(raw) ? raw[0] : raw) ?? null;
      const orderId = res?.order_id ?? task.order_id;
      const orderNo = res?.order_no ?? task.orders?.order_no ?? "";
      const goDeliver = orderId
        ? {
            label: "開立出貨單",
            onClick: () =>
              void navigate({ to: "/dashboard/orders/$orderId", params: { orderId } }),
          }
        : undefined;
      if (res?.order_all_done) {
        toast.success(`訂單 ${orderNo} 全部工序完成！`, { action: goDeliver, duration: 10000 });
      } else if (orderId && (await onlyShippingLeft(orderId))) {
        toast.success(`訂單 ${orderNo} 只剩出貨站，可開立出貨單`, {
          action: goDeliver,
          duration: 10000,
        });
      } else {
        toast.success("已完成此工序");
      }
      return;
    }
    // waiting_customer：直接更新狀態（其餘一律走 RPC）
    if (to !== "waiting_customer") {
      toast.error("這個狀態不能直接轉換");
      return;
    }
    const { data, error } = await supabase
      .from("order_tasks")
      .update({ status: to })
      .eq("id", task.id)
      .select("id");
    if (error) {
      toast.error(humanizeError(error, "更新工序狀態"));
      return;
    }
    if (!data?.length) {
      toast.error("沒有更新任何資料（可能沒有權限），請重新整理後再試");
      return;
    }
    toast.success("已更新工序狀態");
    reload();
  };

  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    const task = tasks.find((t) => t.id === e.active.id);
    const to = e.over?.id ? String(e.over.id) : null;
    if (!task || !to || to === task.status) return;
    if (to === "outsourced") {
      toast.info("外包請到工單明細按「派外包」");
      return;
    }
    if (task.status === "outsourced") {
      toast.info("外包中的工序會在對方完工後自動完成；要收回請到「外包追蹤」取消");
      return;
    }
    if (!ALLOWED[task.status]?.includes(to)) {
      toast.error("這個狀態不能直接轉換到目標欄位");
      return;
    }
    void move(task, to);
  };
  const onDragStart = (e: DragStartEvent) => {
    setDragging(tasks.find((t) => t.id === e.active.id) ?? null);
  };

  const confirmBlock = async () => {
    if (!blockTarget) return;
    if (!blockReason.trim()) {
      toast.error("請填寫卡關理由");
      return;
    }
    const res = await runRpc(
      "task_block",
      { p_task_id: blockTarget.id, p_reason: blockReason.trim() },
      "標記卡關",
    );
    if (res !== null) {
      toast.success("已標記卡關");
      setBlockTarget(null);
    }
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="派工看板"
        description={
          canDrag
            ? "拖拉卡片可推進工序狀態；卡關需填理由。畫面會即時同步其他人的操作。"
            : "檢視各工序目前狀態。畫面會即時同步。（只有主管以上可拖拉推進）"
        }
        actions={
          <Button variant="outline" asChild>
            <Link to="/dashboard/board/tv">
              <Monitor className="h-4 w-4 mr-1" />
              電視模式
            </Link>
          </Button>
        }
      />

      {loadErr && <p className="text-sm text-destructive">{humanizeError(loadErr, "載入看板")}</p>}

      {/* 篩選列 */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {stations.map((s) => {
            const on = stationFilter.includes(s.id);
            return (
              <button
                key={s.id}
                type="button"
                onClick={() =>
                  setStationFilter((prev) =>
                    prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id],
                  )
                }
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                  on ? "bg-primary text-primary-foreground border-primary" : "border-border"
                }`}
              >
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: s.color ?? "#94a3b8" }}
                />
                {s.name}
              </button>
            );
          })}
          {stationFilter.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setStationFilter(EMPTY_STATIONS)}>
              清除站別
            </Button>
          )}
        </div>

        <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部負責人</SelectItem>
            <SelectItem value="none">未指派</SelectItem>
            {employees.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                {e.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="relative w-56">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="搜尋單號或品名"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground py-8">載入中…</p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={boardCollision}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        >
          <div className="flex gap-3 overflow-x-auto pb-4">
            {COLUMNS.map(([status, label]) => {
              const items = filtered.filter((t) => t.status === status);
              const isCollapsed = collapsed.includes(status);
              return (
                <Column
                  key={status}
                  status={status}
                  label={label}
                  count={items.length}
                  collapsed={isCollapsed}
                  onToggle={() =>
                    setCollapsed((prev) =>
                      prev.includes(status)
                        ? prev.filter((x) => x !== status)
                        : [...prev, status],
                    )
                  }
                >
                  {items.map((t) => (
                    <DraggableCard
                      key={t.id}
                      task={t}
                      canDrag={canDrag}
                      onAssign={(task) => {
                        setAssignee(task.assignee_id ?? "");
                        setAssignTarget(task);
                      }}
                    />
                  ))}
                  {items.length === 0 && (
                    <p className="text-xs text-muted-foreground py-6 text-center">沒有卡片</p>
                  )}
                </Column>
              );
            })}
          </div>

          <DragOverlay>{dragging && <JobCard task={dragging} overlay />}</DragOverlay>
        </DndContext>
      )}

      {/* 卡關理由 */}
      <Dialog open={!!blockTarget} onOpenChange={(o) => !o && setBlockTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>標記卡關</DialogTitle>
            <DialogDescription>
              請說明卡在哪裡，讓接手的人知道要處理什麼。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label>卡關理由 *</Label>
            <Textarea
              rows={3}
              value={blockReason}
              placeholder="例：客戶尚未提供正確稿件"
              onChange={(e) => setBlockReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBlockTarget(null)}>
              取消
            </Button>
            <Button onClick={confirmBlock}>確認卡關</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 指派 */}
      <Dialog open={!!assignTarget} onOpenChange={(o) => !o && setAssignTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>指派負責人</DialogTitle>
            <DialogDescription>
              {assignTarget?.orders?.order_no ?? ""}｜{assignTarget?.work_stations?.name ?? ""}
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
    </div>
  );
}

function Column({
  status,
  label,
  count,
  collapsed,
  onToggle,
  children,
}: {
  status: string;
  label: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div
      ref={setNodeRef}
      className={`shrink-0 rounded-lg border bg-muted/30 p-2 transition-colors ${
        collapsed ? "w-14" : "w-64"
      } ${isOver ? "border-primary bg-primary/5" : "border-border"}`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 px-1 py-1 text-sm font-medium"
      >
        {collapsed ? (
          <ChevronRight className="h-4 w-4 shrink-0" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0" />
        )}
        {!collapsed && <span className="truncate">{label}</span>}
        <Badge variant="secondary" className="ml-auto">
          {count}
        </Badge>
      </button>
      {!collapsed && <div className="mt-2 space-y-2">{children}</div>}
    </div>
  );
}

/**
 * 欄位判定：先看指標落在哪一欄（看板橫向捲動時 closestCorners 會誤判到相鄰欄），
 * 指標不在任何欄內時才退回矩形重疊判定。
 */
const boardCollision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length > 0 ? hits : rectIntersection(args);
};

/** 已結束的工序（完成／跳過／外包中）不再顯示「指派」 */
const NO_ASSIGN_STATUSES = ["done", "skipped", "outsourced"];

function DraggableCard({
  task,
  canDrag,
  onAssign,
}: {
  task: BoardTask;
  canDrag: boolean;
  onAssign: (t: BoardTask) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    disabled: !canDrag,
  });
  return (
    <div ref={setNodeRef} className={isDragging ? "opacity-40" : ""}>
      <JobCard
        task={task}
        draggable={canDrag}
        canAssign={canDrag && !NO_ASSIGN_STATUSES.includes(task.status)}
        onAssign={onAssign}
        dragProps={canDrag ? { ...listeners, ...attributes } : undefined}
      />
    </div>
  );
}
