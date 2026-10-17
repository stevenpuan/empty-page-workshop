/** 出勤管理：請假審核（待核准＋本月請假紀錄） */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Loader2, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { humanizeError } from "@/lib/app-error";
import { fmtDateTime, taipeiToday } from "@/lib/dates";
import {
  LEAVE_COLUMNS,
  LEAVE_HINT,
  LEAVE_LABEL,
  LEAVE_STATUS,
  hoursText,
  leaveRange,
  num,
  type LeaveRow,
} from "@/lib/payroll";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const EMPTY: LeaveRow[] = [];
const COLS = `${LEAVE_COLUMNS}, employee:employees!leave_requests_employee_id_fkey(name, emp_no)`;

export function LeaveReviewTab() {
  const qc = useQueryClient();
  const [month, setMonth] = useState(taipeiToday().slice(0, 7));
  const [busy, setBusy] = useState<string | null>(null);
  const [reject, setReject] = useState<LeaveRow | null>(null);
  const [note, setNote] = useState("");

  const pending = useQuery({
    queryKey: ["leave_pending"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leave_requests")
        .select(COLS)
        .eq("status", "pending")
        .order("date_from");
      if (error) throw error;
      return (data ?? []) as unknown as LeaveRow[];
    },
  });

  const history = useQuery({
    queryKey: ["leave_month", month],
    enabled: /^\d{4}-\d{2}$/.test(month),
    queryFn: async () => {
      const [y, m] = month.split("-").map(Number) as [number, number];
      const end = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const { data, error } = await supabase
        .from("leave_requests")
        .select(COLS)
        .gte("date_from", `${month}-01`)
        .lte("date_from", `${month}-${String(end).padStart(2, "0")}`)
        .neq("status", "pending")
        .order("date_from");
      if (error) throw error;
      return (data ?? []) as unknown as LeaveRow[];
    },
  });

  const reload = () => {
    void qc.invalidateQueries({ queryKey: ["leave_pending"] });
    void qc.invalidateQueries({ queryKey: ["leave_month"] });
  };

  const decide = async (r: LeaveRow, approve: boolean, n: string) => {
    setBusy(r.id);
    const { error } = await supabase.rpc("leave_decide", {
      p_id: r.id,
      p_approve: approve,
      p_note: n || null,
    });
    setBusy(null);
    if (error) {
      toast.error(humanizeError(error, approve ? "核准請假" : "駁回請假"));
      return;
    }
    toast.success(approve ? "已核准，員工會收到通知" : "已駁回，員工會收到通知");
    setReject(null);
    setNote("");
    reload();
  };

  const cancel = async (r: LeaveRow) => {
    setBusy(r.id);
    const { error } = await supabase.rpc("leave_cancel", { p_id: r.id });
    setBusy(null);
    if (error) {
      toast.error(humanizeError(error, "取消請假"));
      return;
    }
    toast.success("已取消這筆請假");
    reload();
  };

  const rows = pending.data ?? EMPTY;
  const hist = history.data ?? EMPTY;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">待核准的請假</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {pending.error ? (
            <p className="py-6 text-center text-sm text-destructive">
              {humanizeError(pending.error, "讀取請假")}
            </p>
          ) : pending.isLoading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">載入中…</p>
          ) : rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">目前沒有待核准的請假</p>
          ) : (
            rows.map((r) => (
              <div
                key={r.id}
                className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3"
              >
                <div className="space-y-1 text-sm">
                  <div className="font-medium">
                    {r.employee?.name ?? "—"}
                    <Badge variant="outline" className="ml-2">
                      {LEAVE_LABEL[r.leave_type]}
                    </Badge>
                  </div>
                  <div>
                    {leaveRange(r.date_from, r.date_to)}，共 {hoursText(num(r.hours))}
                  </div>
                  <div className="text-muted-foreground">原因：{r.reason ?? "—"}</div>
                  <div className="text-xs text-muted-foreground">
                    {LEAVE_HINT[r.leave_type]}；申請於 {fmtDateTime(r.created_at)}
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
                      setReject(r);
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
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 pb-3">
          <CardTitle className="text-base">請假紀錄</CardTitle>
          <div className="flex items-center gap-2">
            <Label htmlFor="lv-month" className="text-sm">
              月份
            </Label>
            <Input
              id="lv-month"
              type="month"
              className="w-40"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>員工</TableHead>
                <TableHead>假別</TableHead>
                <TableHead>日期</TableHead>
                <TableHead className="text-right">時數</TableHead>
                <TableHead>原因／備註</TableHead>
                <TableHead>狀態</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {hist.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">
                    {history.isLoading ? "載入中…" : "這個月沒有請假紀錄"}
                  </TableCell>
                </TableRow>
              )}
              {hist.map((r) => {
                const st = LEAVE_STATUS[r.status];
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.employee?.name ?? "—"}</TableCell>
                    <TableCell>{LEAVE_LABEL[r.leave_type]}</TableCell>
                    <TableCell className="tabular-nums">
                      {leaveRange(r.date_from, r.date_to)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{num(r.hours)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {[r.reason, r.approver_note].filter(Boolean).join("／") || "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={st?.cls}>
                        {st?.label ?? r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {r.status === "approved" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy === r.id}
                          onClick={() => void cancel(r)}
                        >
                          取消
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!reject} onOpenChange={(o) => !o && setReject(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>駁回請假</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="lv-reject">駁回原因（員工會看到）</Label>
            <Textarea
              id="lv-reject"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReject(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={!note.trim() || busy !== null}
              onClick={() => reject && void decide(reject, false, note.trim())}
            >
              確認駁回
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
