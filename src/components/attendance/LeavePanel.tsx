/** 請假申請（表單＋我的請假紀錄），直接嵌在打卡頁展開 */
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Send } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { humanizeError } from "@/lib/app-error";
import { taipeiToday } from "@/lib/dates";
import {
  LEAVE_COLUMNS,
  LEAVE_HINT,
  LEAVE_LABEL,
  LEAVE_MAIN,
  LEAVE_MORE,
  LEAVE_STATUS,
  daysBetween,
  hoursText,
  leaveRange,
  num,
  type LeaveRow,
  type LeaveType,
} from "@/lib/payroll";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const EMPTY: LeaveRow[] = [];

export function LeavePanel() {
  const qc = useQueryClient();
  const { employee } = useAuth();
  const empId = employee?.id;
  const today = taipeiToday();

  const [type, setType] = useState<LeaveType>("annual");
  const [more, setMore] = useState(false);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [mode, setMode] = useState<"full" | "half" | "custom">("full");
  const [custom, setCustom] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const days = daysBetween(from, to);
  const hours = mode === "full" ? days * 8 : mode === "half" ? 4 : num(custom);

  const { data: rows = EMPTY, isLoading } = useQuery({
    queryKey: ["my_leaves", empId],
    enabled: !!empId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leave_requests")
        .select(LEAVE_COLUMNS)
        .eq("employee_id", empId!)
        .gte("date_from", `${today.slice(0, 4)}-01-01`)
        .order("date_from", { ascending: false });
      if (error) throw error;
      return (data ?? []) as LeaveRow[];
    },
  });

  // 今年已核准的時數（依假別）
  const used = useMemo(() => {
    const m = new Map<LeaveType, number>();
    for (const r of rows)
      if (r.status === "approved") m.set(r.leave_type, (m.get(r.leave_type) ?? 0) + num(r.hours));
    return [...m.entries()];
  }, [rows]);

  const reload = () => {
    void qc.invalidateQueries({ queryKey: ["my_leaves", empId] });
  };

  const submit = async () => {
    if (!employee) {
      toast.error("找不到你的員工資料，請聯絡老闆");
      return;
    }
    if (days <= 0) {
      toast.error("結束日期不能早於開始日期");
      return;
    }
    if (from.slice(0, 7) !== to.slice(0, 7)) {
      toast.error("請假跨月份，請分成兩張申請");
      return;
    }
    if (mode === "half" && days !== 1) {
      toast.error("半天只能選同一天");
      return;
    }
    if (!(hours > 0)) {
      toast.error("請填請假時數");
      return;
    }
    if ((type === "personal" || type === "other_paid") && !reason.trim()) {
      toast.error("請寫請假原因");
      return;
    }
    setSaving(true);
    const { error } = await supabase.rpc("leave_request", {
      p_type: type,
      p_from: from,
      p_to: to,
      p_hours: hours,
      p_reason: reason.trim() || null,
    });
    setSaving(false);
    if (error) {
      toast.error(humanizeError(error, "送出請假"));
      return;
    }
    toast.success("請假已送出，等主管核准");
    setReason("");
    setCustom("");
    setMode("full");
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
    toast.success("已取消");
    reload();
  };

  if (!employee) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        尚未綁定員工資料，無法請假，請聯絡老闆確認帳號設定。
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {/* 假別 */}
      <div className="space-y-2">
        <Label>假別</Label>
        <div className="grid grid-cols-2 gap-2">
          {[...LEAVE_MAIN, ...(more ? LEAVE_MORE : [])].map((t) => (
            <Button
              key={t}
              type="button"
              variant={type === t ? "default" : "outline"}
              className="h-12 text-base"
              onClick={() => setType(t)}
            >
              {LEAVE_LABEL[t]}
            </Button>
          ))}
        </div>
        {!more && (
          <button
            type="button"
            className="text-sm text-primary underline-offset-2 hover:underline"
            onClick={() => setMore(true)}
          >
            其他假別（婚假、喪假、公傷、生理假…）
          </button>
        )}
        <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
          {LEAVE_LABEL[type]}：{LEAVE_HINT[type]}
        </p>
      </div>

      {/* 日期 */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="lv-from">從</Label>
          <Input
            id="lv-from"
            type="date"
            className="h-12 text-base"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              if (e.target.value > to) setTo(e.target.value);
            }}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="lv-to">到</Label>
          <Input
            id="lv-to"
            type="date"
            className="h-12 text-base"
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
      </div>

      {/* 時數 */}
      <div className="space-y-2">
        <Label>請多久</Label>
        <div className="grid grid-cols-3 gap-2">
          <Button
            type="button"
            variant={mode === "full" ? "default" : "outline"}
            className="h-12 text-base"
            onClick={() => setMode("full")}
          >
            {days > 1 ? `整天 ×${days}` : "整天"}
          </Button>
          <Button
            type="button"
            variant={mode === "half" ? "default" : "outline"}
            className="h-12 text-base"
            onClick={() => setMode("half")}
            disabled={days !== 1}
          >
            半天
          </Button>
          <Button
            type="button"
            variant={mode === "custom" ? "default" : "outline"}
            className="h-12 text-base"
            onClick={() => setMode("custom")}
          >
            幾小時
          </Button>
        </div>
        {mode === "custom" && (
          <Input
            type="number"
            inputMode="decimal"
            min={0.5}
            step={0.5}
            className="h-12 text-base"
            placeholder="例：2 或 1.5"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
          />
        )}
        <p className="text-sm text-muted-foreground">
          共 {hours > 0 ? hoursText(hours) : "—"}（一天以 8 小時計）
        </p>
      </div>

      <div className="space-y-1">
        <Label htmlFor="lv-reason">
          原因{type === "personal" || type === "other_paid" ? "（必填）" : "（選填）"}
        </Label>
        <Textarea
          id="lv-reason"
          rows={2}
          maxLength={300}
          className="text-base"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>

      <Button className="h-12 w-full text-base" onClick={() => void submit()} disabled={saving}>
        {saving ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Send className="mr-2 h-4 w-4" />
        )}
        送出請假
      </Button>

      {/* 我的請假 */}
      <div className="space-y-2 border-t pt-4">
        <p className="text-sm font-medium">今年已請（已核准）</p>
        {used.length === 0 ? (
          <p className="text-sm text-muted-foreground">還沒有</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {used.map(([t, h]) => (
              <Badge key={t} variant="secondary" className="text-sm font-normal">
                {LEAVE_LABEL[t]} {hoursText(h)}
              </Badge>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">我的請假紀錄</p>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">載入中…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">今年還沒有請假紀錄</p>
        ) : (
          rows.map((r) => {
            const st = LEAVE_STATUS[r.status];
            return (
              <div key={r.id} className="space-y-1 rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    {LEAVE_LABEL[r.leave_type]} {leaveRange(r.date_from, r.date_to)}
                  </span>
                  <Badge variant="outline" className={st?.cls}>
                    {st?.label ?? r.status}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {hoursText(num(r.hours))}
                  {r.reason ? `，${r.reason}` : ""}
                </p>
                {r.approver_note && (
                  <p className="text-sm text-muted-foreground">主管備註：{r.approver_note}</p>
                )}
                {r.status === "pending" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9"
                    disabled={busy === r.id}
                    onClick={() => void cancel(r)}
                  >
                    取消這筆
                  </Button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
