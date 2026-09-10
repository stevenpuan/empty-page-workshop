import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { LogIn, LogOut, CheckCircle2, MapPin, Loader2, ClipboardEdit } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { humanizeError } from "@/lib/app-error";
import { taipeiToday } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/clock")({
  head: () => ({
    meta: [
      { title: "打卡 — 營運系統" },
      { name: "description", content: "員工每日上下班打卡。" },
      { property: "og:title", content: "打卡 — 營運系統" },
      { property: "og:description", content: "員工每日上下班打卡。" },
    ],
  }),
  component: ClockPage,
});

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

interface Attendance {
  id: string;
  employee_id: string;
  work_date: string;
  clock_in_at: string | null;
  clock_in_lat: number | null;
  clock_in_lng: number | null;
  clock_in_distance_m: number | null;
  clock_in_abnormal: boolean | null;
  clock_out_at: string | null;
  clock_out_lat: number | null;
  clock_out_lng: number | null;
  clock_out_distance_m: number | null;
  clock_out_abnormal: boolean | null;
  status: string | null;
  work_minutes: number | null;
  overtime_minutes: number | null;
}

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  normal: { label: "正常", cls: "bg-green-100 text-green-800 border-green-200" },
  late: { label: "遲到", cls: "bg-red-100 text-red-800 border-red-200" },
  early_leave: { label: "早退", cls: "bg-orange-100 text-orange-800 border-orange-200" },
  missing: { label: "缺卡", cls: "bg-gray-100 text-gray-600 border-gray-200" },
};

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function ClockPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { session, employee, loading, permsLoaded } = useAuth();
  const [now, setNow] = useState(() => new Date());
  const [locating, setLocating] = useState<"in" | "out" | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!loading && !session) navigate({ to: "/login" });
  }, [loading, session, navigate]);

  const today = taipeiToday();
  const empId = employee?.id ?? null;

  const timeStr = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(now);
  const dateStr = new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const weekdayName = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    weekday: "short",
  }).format(now);
  const weekday =
    WEEKDAYS[["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekdayName)] ?? "";

  const { data: att, refetch } = useQuery({
    queryKey: ["attendance_today", empId, today],
    enabled: !!empId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("attendances")
        .select("*")
        .eq("employee_id", empId!)
        .eq("work_date", today)
        .maybeSingle();
      if (error) throw error;
      return (data as Attendance | null) ?? null;
    },
  });

  // 員工班別（employees.shift_id → shifts.name）
  const { data: shift } = useQuery({
    queryKey: ["employee_shift", empId],
    enabled: !!empId,
    queryFn: async () => {
      const { data: emp, error: eErr } = await supabase
        .from("employees")
        .select("shift_id")
        .eq("id", empId!)
        .maybeSingle();
      if (eErr) throw eErr;
      const shiftId = (emp as { shift_id?: string | null } | null)?.shift_id;
      if (!shiftId) return null;
      const { data: s, error: sErr } = await supabase
        .from("shifts")
        .select("name, start_time, end_time")
        .eq("id", shiftId)
        .maybeSingle();
      if (sErr) throw sErr;
      return (s as { name: string; start_time: string; end_time: string } | null) ?? null;
    },
  });

  const clockedIn = !!att?.clock_in_at;
  const clockedOut = !!att?.clock_out_at;

  const doClock = async (kind: "in" | "out") => {
    setLocating(kind);
    const invoke = async (lat: number | null, lng: number | null) => {
      const rpc = kind === "in" ? "clock_in" : "clock_out";
      const { data, error } = await supabase.rpc(rpc, { p_lat: lat, p_lng: lng });
      if (error) {
        toast.error(humanizeError(error, kind === "in" ? "上班打卡" : "下班打卡"));
      } else {
        toast.success(
          typeof data === "string"
            ? data
            : kind === "in"
              ? "上班打卡成功"
              : "下班打卡成功",
        );
        await refetch();
        qc.invalidateQueries({ queryKey: ["attendance_today"] });
      }
      setLocating(null);
    };
    if (!("geolocation" in navigator)) {
      toast.warning("此裝置不支援定位，將不帶座標打卡");
      await invoke(null, null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => void invoke(pos.coords.latitude, pos.coords.longitude),
      (geoErr) => {
        toast.warning(`定位失敗（${geoErr.message}），將不帶座標打卡`);
        void invoke(null, null);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  };

  const statusInfo = att?.status ? STATUS_LABEL[att.status] : null;
  const workHours = useMemo(
    () => (att?.work_minutes != null ? (att.work_minutes / 60).toFixed(1) : "—"),
    [att],
  );
  const overtimeHours = useMemo(
    () => (att?.overtime_minutes != null ? (att.overtime_minutes / 60).toFixed(1) : "—"),
    [att],
  );

  if (loading || !permsLoaded) {
    return <div className="min-h-screen grid place-items-center text-muted-foreground">載入中…</div>;
  }
  if (!session) return null;

  return (
    <div className="min-h-screen bg-background flex flex-col items-center px-4 py-8">
      <div className="w-full max-w-md space-y-6">
        {/* 頂部時間與員工資訊 */}
        <div className="text-center space-y-1">
          <div className="text-5xl font-mono font-bold tracking-wider tabular-nums">{timeStr}</div>
          <div className="text-muted-foreground">
            {dateStr} 星期{weekday}
          </div>
          <div className="text-sm text-muted-foreground pt-1">
            {employee?.name ?? "—"}
            {shift ? `・${shift.name}` : ""}
          </div>
        </div>

        {/* 打卡大按鈕 */}
        <div className="flex justify-center py-4">
          {!clockedIn ? (
            <button
              type="button"
              disabled={locating !== null}
              onClick={() => void doClock("in")}
              className="w-44 h-44 rounded-full bg-green-600 hover:bg-green-700 active:scale-95 transition text-white flex flex-col items-center justify-center gap-2 shadow-lg disabled:opacity-60"
            >
              {locating === "in" ? (
                <>
                  <Loader2 className="h-10 w-10 animate-spin" />
                  <span className="text-lg">定位中…</span>
                </>
              ) : (
                <>
                  <LogIn className="h-10 w-10" />
                  <span className="text-xl font-bold">上班打卡</span>
                </>
              )}
            </button>
          ) : !clockedOut ? (
            <button
              type="button"
              disabled={locating !== null}
              onClick={() => void doClock("out")}
              className="w-44 h-44 rounded-full bg-orange-500 hover:bg-orange-600 active:scale-95 transition text-white flex flex-col items-center justify-center gap-2 shadow-lg disabled:opacity-60"
            >
              {locating === "out" ? (
                <>
                  <Loader2 className="h-10 w-10 animate-spin" />
                  <span className="text-lg">定位中…</span>
                </>
              ) : (
                <>
                  <LogOut className="h-10 w-10" />
                  <span className="text-xl font-bold">下班打卡</span>
                </>
              )}
            </button>
          ) : (
            <div className="w-44 h-44 rounded-full bg-muted text-muted-foreground flex flex-col items-center justify-center gap-2 shadow-inner">
              <CheckCircle2 className="h-10 w-10" />
              <span className="text-lg font-medium">今日已完成打卡</span>
            </div>
          )}
        </div>

        {/* 今日打卡資訊 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center justify-between">
              今日打卡資訊
              {statusInfo && (
                <Badge variant="outline" className={statusInfo.cls}>
                  {statusInfo.label}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <InfoRow
              label="上班"
              time={fmtTime(att?.clock_in_at ?? null)}
              distance={att?.clock_in_distance_m ?? null}
              abnormal={att?.clock_in_abnormal ?? null}
            />
            <InfoRow
              label="下班"
              time={fmtTime(att?.clock_out_at ?? null)}
              distance={att?.clock_out_distance_m ?? null}
              abnormal={att?.clock_out_abnormal ?? null}
            />
            <div className="flex justify-between border-t pt-3">
              <span className="text-muted-foreground">工時</span>
              <span className="font-medium tabular-nums">{workHours === "—" ? "—" : `${workHours} 小時`}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">加班時數</span>
              <span className="font-medium tabular-nums">{overtimeHours === "—" ? "—" : `${overtimeHours} 小時`}</span>
            </div>
          </CardContent>
        </Card>

        {/* 補卡入口 */}
        <div className="text-center">
          <Button asChild variant="link" className="text-muted-foreground">
            <a href="/clock/amendment">
              <ClipboardEdit className="h-4 w-4 mr-1" />
              申請補卡
            </a>
          </Button>
        </div>
      </div>
    </div>
  );
}

function InfoRow({
  label,
  time,
  distance,
  abnormal,
}: {
  label: string;
  time: string;
  distance: number | null;
  abnormal: boolean | null;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <span className="font-medium tabular-nums text-base">{time}</span>
        {distance != null && (
          <span className="text-xs text-muted-foreground flex items-center gap-0.5">
            <MapPin className="h-3 w-3" />
            {Math.round(distance)} m
          </span>
        )}
        {abnormal && (
          <Badge variant="outline" className="bg-red-100 text-red-800 border-red-200">
            異常
          </Badge>
        )}
      </div>
    </div>
  );
}
