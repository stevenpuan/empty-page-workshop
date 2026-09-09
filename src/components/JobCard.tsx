import { AlertTriangle, Truck, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fmtDate, taipeiToday } from "@/lib/dates";

export interface BoardTask {
  id: string;
  status: string;
  blocked_reason: string | null;
  assignee_id: string | null;
  station_id: string | null;
  order_id: string | null;
  orders: { order_no: string; item_name: string | null; due_date: string | null } | null;
  work_stations: { name: string; color: string | null } | null;
  employees: { name: string } | null;
  vendors: { name: string } | null;
}

/**
 * 看板卡片（純顯示 + 指派按鈕）。
 * 拖拉的 listeners 由 board 頁面透過 dragProps 傳進來，卡片本身不知道 dnd 的存在。
 */
export function JobCard({
  task,
  draggable,
  canAssign,
  onAssign,
  dragProps,
  overlay,
}: {
  task: BoardTask;
  draggable?: boolean;
  canAssign?: boolean;
  onAssign?: (task: BoardTask) => void;
  dragProps?: Record<string, unknown> | undefined;
  overlay?: boolean;
}) {
  const due = task.orders?.due_date ?? null;
  const overdue = !!due && due < taipeiToday() && task.status !== "done" && task.status !== "skipped";

  const tone =
    task.status === "blocked"
      ? "border-orange-500"
      : task.status === "outsourced"
        ? "border-purple-500"
        : "border-border";

  return (
    <div
      className={`rounded-md border-2 ${tone} bg-card p-2.5 space-y-1.5 shadow-sm ${
        draggable ? "cursor-grab active:cursor-grabbing" : ""
      } ${overlay ? "rotate-2 shadow-lg" : ""}`}
      {...(dragProps ?? {})}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs text-muted-foreground">
          {task.orders?.order_no ?? "—"}
        </span>
        {due && (
          <span className={`text-xs ${overdue ? "text-destructive font-medium" : "text-muted-foreground"}`}>
            {fmtDate(due)}
          </span>
        )}
      </div>

      <p className="text-sm font-medium leading-snug break-words">
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
        <span className="inline-flex items-center gap-1">
          <User className="h-3 w-3" />
          {task.employees?.name ?? "未指派"}
        </span>
      </div>

      {task.status === "blocked" && task.blocked_reason && (
        <p className="flex items-start gap-1 text-xs text-orange-600 dark:text-orange-400">
          <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
          <span className="break-words">{task.blocked_reason}</span>
        </p>
      )}

      {task.status === "outsourced" && (
        <Badge variant="outline" className="border-purple-500 text-purple-600 dark:text-purple-400">
          <Truck className="h-3 w-3 mr-1" />
          {task.vendors?.name ?? "外包中"}
        </Badge>
      )}

      {canAssign && onAssign && !overlay && (
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onAssign(task);
          }}
        >
          指派
        </Button>
      )}
    </div>
  );
}
