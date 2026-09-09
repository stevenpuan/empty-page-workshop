import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, ChevronDown, ChevronRight, Play, Check } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { humanizeError } from "@/lib/app-error";
import { fmtDate, taipeiToday } from "@/lib/dates";
import { useBoardRealtime } from "@/hooks/useBoardRealtime";
import { RequirePerm } from "@/components/RequirePerm";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

export const Route = createFileRoute("/dashboard/my-work")({
  head: () => ({
    meta: [
      { title: "我的工作" },
      { name: "description", content: "查看並推進自己負責的工序。" },
      { property: "og:title", content: "我的工作" },
      { property: "og:description", content: "查看並推進自己負責的工序。" },
    ],
  }),
  component: () => (
    <RequirePerm module="my_work">
      <Page />
    </RequirePerm>
  ),
});

interface MyTask {
  id: string;
  status: string;
  blocked_reason: string | null;
  step_no: number | null;
  orders: { order_no: string; item_name: string | null; due_date: string | null } | null;
  work_stations: { name: string; color: string | null } | null;
}

const STATUS_LABEL: Record<string, string> = {
  pending: "待排工",
  assigned: "已指派",
  in_progress: "進行中",
  blocked: "卡關",
  waiting_customer: "等客戶",
  outsourced: "外包中",
  done: "完成",
  skipped: "跳過",
};

const STATUS_ORDER = [
  "in_progress",
  "blocked",
  "assigned",
  "pending",
  "waiting_customer",
  "outsourced",
  "done",
  "skipped",
];

function statusTone(status: string) {
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
  const { employee } = useAuth();
  const qc = useQueryClient();
  useBoardRealtime();

  const [showDone, setShowDone] = useState(false);
  const [blockTarget, setBlockTarget] = useState<MyTask | null>(null);
  const [blockReason, setBlockReason] = useState("");

  const key = ["my_work_tasks", employee?.id];
  const reload = () => qc.invalidateQueries({ queryKey: key });

  const {
    data: tasks = [],
    isLoading,
    error: loadErr,
  } = useQuery({
    queryKey: key,
    enabled: !!employee?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("order_tasks")
        .select(
          "id, status, blocked_reason, step_no, orders:order_id(order_no, item_name, due_date), work_stations:station_id(name, color)",
        )
        .eq("assignee_id", employee!.id);
      if (error) throw error;
      return data as unknown as MyTask[];
    },
  });

  const sorted = useMemo(() => {
    return [...tasks].sort((a, b) => {
      const pa = STATUS_ORDER.indexOf(a.status);
      const pb = STATUS_ORDER.indexOf(b.status);
      if (pa !== pb) return (pa < 0 ? 99 : pa) - (pb < 0 ? 99 : pb);
      const da = a.orders?.due_date ?? "9999-12-31";
      const db = b.orders?.due_date ?? "9999-12-31";
      return da.localeCompare(db);
    });
  }, [tasks]);

  const active = sorted.filter((t) => t.status !== "done" && t.status !== "skipped");
  const finished = sorted.filter((t) => t.status === "done" || t.status === "skipped");

  const counts = {
    in_progress: tasks.filter((t) => t.status === "in_progress").length,
    todo: tasks.filter((t) => t.status === "assigned" || t.status === "pending").length,
    blocked: tasks.filter((t) => t.status === "blocked").length,
  };

  const runRpc = async (fn: string, args: Record<string, unknown>, ctx: string) => {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) {
      toast.error(humanizeError(error, ctx));
      return null;
    }
    reload();
    return data;
  };

  const start = async (t: MyTask) => {
    const res = await runRpc("task_start", { p_task_id: t.id }, "開始工序");
    if (res !== null) toast.success("已開始這道工序");
  };

  const done = async (t: MyTask) => {
    const res = (await runRpc("task_done", { p_task_id: t.id }, "完成工序")) as
      | { order_all_done?: boolean }
      | null;
    if (res === null) return;
    const allDone = Array.isArray(res)
      ? (res[0] as { order_all_done?: boolean } | undefined)?.order_all_done
      : res?.order_all_done;
    if (allDone) toast.success(`訂單 ${t.orders?.order_no ?? ""} 全部工序完成！`);
    else toast.success("已完成此工序");
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

  return (
    <div className="space-y-5">
      <PageHeader title="我的工作" description="只顯示指派給你的工序，可直接開始、完成或回報卡關。" />

      {loadErr && <p className="text-sm text-destructive">{humanizeError(loadErr, "載入我的工作")}</p>}

      <div className="grid grid-cols-3 gap-3">
        <MiniStat label="進行中" value={counts.in_progress} tone="text-blue-600 dark:text-blue-400" />
        <MiniStat label="待處理" value={counts.todo} tone="" />
        <MiniStat
          label="卡關"
          value={counts.blocked}
          tone={counts.blocked > 0 ? "text-orange-600 dark:text-orange-400" : ""}
        />
      </div>

      {isLoading ? (
        <p className="text-muted-foreground py-8">載入中…</p>
      ) : (
        <>
          <div className="space-y-3">
            {active.map((t) => (
              <TaskCard
                key={t.id}
                task={t}
                onStart={() => void start(t)}
                onDone={() => void done(t)}
                onBlock={() => {
                  setBlockReason("");
                  setBlockTarget(t);
                }}
              />
            ))}
            {active.length === 0 && (
              <Card>
                <CardContent className="p-6 text-center text-muted-foreground text-sm">
                  目前沒有待處理的工序
                </CardContent>
              </Card>
            )}
          </div>

          {finished.length > 0 && (
            <div className="space-y-3">
              <button
                type="button"
                className="inline-flex items-center gap-1 text-sm text-muted-foreground"
                onClick={() => setShowDone((v) => !v)}
              >
                {showDone ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
                已完成／已跳過（{finished.length}）
              </button>
              {showDone &&
                finished.map((t) => <TaskCard key={t.id} task={t} />)}
            </div>
          )}
        </>
      )}

      <Dialog open={!!blockTarget} onOpenChange={(o) => !o && setBlockTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>回報卡關</DialogTitle>
            <DialogDescription>請說明卡在哪裡，讓主管知道要處理什麼。</DialogDescription>
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
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <Card>
      <CardContent className="p-4 text-center">
        <div className={`text-2xl font-bold tracking-tight ${tone}`}>{value}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
      </CardContent>
    </Card>
  );
}

function TaskCard({
  task,
  onStart,
  onDone,
  onBlock,
}: {
  task: MyTask;
  onStart?: () => void;
  onDone?: () => void;
  onBlock?: () => void;
}) {
  const due = task.orders?.due_date ?? null;
  const overdue =
    !!due && due < taipeiToday() && task.status !== "done" && task.status !== "skipped";
  const canStart = task.status === "assigned" || task.status === "pending";
  const canResume = task.status === "blocked";
  const running = task.status === "in_progress";

  return (
    <Card className={overdue ? "border-2 border-destructive" : ""}>
      <CardContent className="p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-xs text-muted-foreground">
            {task.orders?.order_no ?? "—"}
          </span>
          <Badge variant="outline" className={statusTone(task.status)}>
            {STATUS_LABEL[task.status] ?? task.status}
          </Badge>
        </div>

        <p className="font-medium leading-snug break-words">
          {task.orders?.item_name ?? "（無品名）"}
        </p>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {task.work_stations && (
            <span className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: task.work_stations.color ?? "#94a3b8" }}
              />
              {task.work_stations.name}
            </span>
          )}
          {due && (
            <span className={overdue ? "text-destructive font-medium" : ""}>
              交期 {fmtDate(due)}
            </span>
          )}
        </div>

        {task.status === "blocked" && task.blocked_reason && (
          <p className="flex items-start gap-1 text-xs text-orange-600 dark:text-orange-400">
            <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
            <span className="break-words">{task.blocked_reason}</span>
          </p>
        )}

        {(canStart || canResume || running) && (
          <div className="flex gap-2 pt-1">
            {canStart && onStart && (
              <Button size="sm" className="flex-1" onClick={onStart}>
                <Play className="h-4 w-4 mr-1" />
                開始
              </Button>
            )}
            {canResume && onStart && (
              <Button size="sm" className="flex-1" onClick={onStart}>
                <Play className="h-4 w-4 mr-1" />
                繼續
              </Button>
            )}
            {running && onDone && (
              <Button size="sm" className="flex-1" onClick={onDone}>
                <Check className="h-4 w-4 mr-1" />
                完成
              </Button>
            )}
            {running && onBlock && (
              <Button size="sm" variant="outline" className="flex-1" onClick={onBlock}>
                <AlertTriangle className="h-4 w-4 mr-1" />
                卡關
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
