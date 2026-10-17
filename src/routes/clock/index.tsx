import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  LogIn,
  LogOut,
  CheckCircle2,
  MapPin,
  Loader2,
  ClipboardEdit,
  Smartphone,
  X,
  ArrowLeft,
  ChevronDown,
  RefreshCw,
  CalendarDays,
  Wallet,
} from "lucide-react";
import { AmendmentPanel } from "@/components/attendance/AmendmentPanel";
import { LeavePanel } from "@/components/attendance/LeavePanel";
import { PayslipPanel } from "@/components/attendance/PayslipPanel";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { humanizeError } from "@/lib/app-error";
import { taipeiToday } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/clock/")({
  head: () => ({
    meta: [
      { title: "打卡 — 營運系統" },
      { name: "description", content: "員工每日上下班打卡。" },
      { property: "og:title", content: "打卡 — 營運系統" },
      { property: "og:description", content: "員工每日上下班打卡。" },
    ],
  }),
  validateSearch: (
    search: Record<string, unknown>,
  ): { amend?: string; leave?: string; pay?: string } => {
    const out: { amend?: string; leave?: string; pay?: string } = {};
    for (const k of ["amend", "leave", "pay"] as const) {
      const v = search[k];
      if (typeof v === "string" || typeof v === "number") out[k] = String(v);
    }
    return out;
  },
  component: ClockPage,
});

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

interface Attendance {
  id: string;
  clock_in_at: string | null;
  clock_in_distance_m: number | null;
  clock_out_at: string | null;
  clock_out_distance_m: number | null;
  status: string | null;
  late_minutes: number | null;
  early_leave_minutes: number | null;
  work_minutes: number | null;
  ot_minutes_134: number | null;
  ot_minutes_167: number | null;
  ot_minutes_holiday: number | null;
  is_abnormal_location: boolean | null;
  abnormal_reason: string | null;
}

interface Shift {
  name: string;
  start_time: string;
  end_time: string;
}

interface Place {
  lat: number | null;
  lng: number | null;
  radius: number;
}

type Geo =
  | { state: "idle" | "locating" }
  | { state: "ok"; lat: number; lng: number; distance: number | null }
  | { state: "error"; message: string };

function fmtTime(iso: string | null): string {
  if (!iso) return "--:--";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

/** 兩點距離（公尺） */
function distanceM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const fmtDistance = (m: number) =>
  m >= 1000 ? `${(m / 1000).toFixed(1)} 公里` : `${Math.round(m)} 公尺`;

const geoMessage = (e: GeolocationPositionError) =>
  e.code === e.PERMISSION_DENIED
    ? "沒有定位權限，請在手機設定允許瀏覽器使用位置"
    : e.code === e.TIMEOUT
      ? "定位逾時，請到戶外或靠窗再試"
      : "無法取得位置";

function ClockPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { session, employee, company, loading, permsLoaded } = useAuth();
  const [now, setNow] = useState(() => new Date());
  const [busy, setBusy] = useState(false);
  const [confirmOut, setConfirmOut] = useState(false);
  const [geo, setGeo] = useState<Geo>({ state: "idle" });
  const [justDone, setJustDone] = useState<string | null>(null);
  const { amend, leave, pay } = Route.useSearch();
  const [amendOpen, setAmendOpen] = useState(!!amend);
  const [leaveOpen, setLeaveOpen] = useState(!!leave);
  const [payOpen, setPayOpen] = useState(!!pay);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!loading && !session) navigate({ to: "/login" });
  }, [loading, session, navigate]);

  const today = taipeiToday();
  const empId = employee?.id ?? null;

  const hm = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  const sec = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Taipei", second: "2-digit" })
    .format(now)
    .padStart(2, "0");
  const dateStr = new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "long",
    day: "numeric",
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
        .select(
          "id, clock_in_at, clock_in_distance_m, clock_out_at, clock_out_distance_m, status, late_minutes, early_leave_minutes, work_minutes, ot_minutes_134, ot_minutes_167, ot_minutes_holiday, is_abnormal_location, abnormal_reason",
        )
        .eq("employee_id", empId!)
        .eq("work_date", today)
        .maybeSingle();
      if (error) throw error;
      return (data as Attendance | null) ?? null;
    },
  });

  // 班別：員工自己的，沒設定就用公司的第一個班別（與資料庫打卡規則相同）
  const { data: shift } = useQuery({
    queryKey: ["employee_shift", empId],
    enabled: !!empId,
    queryFn: async (): Promise<Shift | null> => {
      const { data: emp, error: eErr } = await supabase
        .from("employees")
        .select("shift_id")
        .eq("id", empId!)
        .maybeSingle();
      if (eErr) throw eErr;
      const shiftId = (emp as { shift_id?: string | null } | null)?.shift_id;
      let q = supabase.from("shifts").select("name, start_time, end_time");
      q = shiftId ? q.eq("id", shiftId) : q.eq("is_active", true).order("created_at").limit(1);
      const { data, error } = await q;
      if (error) throw error;
      return ((data ?? [])[0] as Shift | undefined) ?? null;
    },
  });

  // 公司打卡座標與範圍（只用來事先顯示距離，實際判斷在資料庫）
  const { data: place } = useQuery({
    queryKey: ["clock_place", company?.id],
    enabled: !!company?.id,
    queryFn: async (): Promise<Place> => {
      const { data, error } = await supabase
        .from("companies")
        .select("lat, lng, clock_radius_m")
        .eq("id", company!.id)
        .maybeSingle();
      if (error) throw error;
      const r = (data ?? {}) as {
        lat?: number | string | null;
        lng?: number | string | null;
        clock_radius_m?: number | null;
      };
      return {
        lat: r.lat == null ? null : Number(r.lat),
        lng: r.lng == null ? null : Number(r.lng),
        radius: r.clock_radius_m ?? 150,
      };
    },
  });

  const locate = useCallback(
    (maximumAge = 30000) =>
      new Promise<{ lat: number; lng: number } | null>((resolve) => {
        if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
          setGeo({ state: "error", message: "這支手機不支援定位" });
          resolve(null);
          return;
        }
        setGeo((g) => (g.state === "ok" ? g : { state: "locating" }));
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;
            setGeo({
              state: "ok",
              lat,
              lng,
              distance:
                place?.lat != null && place.lng != null
                  ? distanceM(place.lat, place.lng, lat, lng)
                  : null,
            });
            resolve({ lat, lng });
          },
          (e) => {
            setGeo({ state: "error", message: geoMessage(e) });
            resolve(null);
          },
          { enableHighAccuracy: true, timeout: 10000, maximumAge },
        );
      }),
    [place],
  );

  // 進頁面先定位一次，讓員工打卡前就知道有沒有在範圍內
  useEffect(() => {
    if (place) void locate();
  }, [place, locate]);

  const clockedIn = !!att?.clock_in_at;
  const clockedOut = !!att?.clock_out_at;
  const kind: "in" | "out" | null = !clockedIn ? "in" : !clockedOut ? "out" : null;

  // 還沒到下班時間就按下班：要再按一次確認，避免誤觸
  const beforeShiftEnd = (() => {
    if (!shift?.end_time) return false;
    const [h = 0, m = 0] = shift.end_time.split(":").map(Number);
    const [nh = 0, nm = 0] = hm.split(":").map(Number);
    return nh * 60 + nm < h * 60 + m;
  })();

  const doClock = async () => {
    if (!kind || busy) return;
    if (kind === "out" && beforeShiftEnd && !confirmOut) {
      setConfirmOut(true);
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
      confirmTimer.current = setTimeout(() => setConfirmOut(false), 4000);
      return;
    }
    setConfirmOut(false);
    setBusy(true);
    try {
      const pos = await locate(5000);
      if (!pos) toast.warning("沒有取得位置，這次打卡不會記錄位置");
      const { error } = await supabase.rpc(kind === "in" ? "clock_in" : "clock_out", {
        p_lat: pos?.lat ?? null,
        p_lng: pos?.lng ?? null,
      });
      if (error) {
        toast.error(humanizeError(error, kind === "in" ? "上班打卡" : "下班打卡"));
        return;
      }
      try {
        navigator.vibrate?.(80);
      } catch {
        /* 部分手機不支援震動 */
      }
      setJustDone(kind === "in" ? `上班打卡完成 ${hm}` : `下班打卡完成 ${hm}`);
      setTimeout(() => setJustDone(null), 4000);
      await refetch();
      void qc.invalidateQueries({ queryKey: ["attendance_today"] });
    } finally {
      setBusy(false);
    }
  };

  if (loading || !permsLoaded) {
    return (
      <div className="grid min-h-[100dvh] place-items-center text-muted-foreground">載入中…</div>
    );
  }
  if (!session) return null;

  const inRange =
    geo.state === "ok" && geo.distance != null && place ? geo.distance <= place.radius : null;
  const otMin =
    (att?.ot_minutes_134 ?? 0) + (att?.ot_minutes_167 ?? 0) + (att?.ot_minutes_holiday ?? 0);
  const workText =
    att?.work_minutes != null
      ? `${Math.floor(att.work_minutes / 60)} 小時 ${att.work_minutes % 60} 分`
      : null;

  return (
    <div
      className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col bg-background"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {/* 頂列：返回、公司、姓名 */}
      <header
        className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background/95 px-2 py-1.5 backdrop-blur"
        style={{ paddingTop: "max(0.375rem, env(safe-area-inset-top))" }}
      >
        <Button asChild variant="ghost" className="h-11 px-2 text-base">
          <Link to="/dashboard" aria-label="回營運系統">
            <ArrowLeft className="mr-1 h-5 w-5" />
            系統
          </Link>
        </Button>
        <div className="flex-1 truncate text-center text-base font-semibold">
          {company?.short_name ?? company?.name ?? "打卡"}
        </div>
        <div className="max-w-[6rem] truncate px-2 text-right text-sm text-muted-foreground">
          {employee?.name ?? ""}
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-5 px-4 pt-5">
        {/* 時間 */}
        <section className="text-center">
          <div className="font-mono text-6xl font-bold tabular-nums tracking-tight">
            {hm}
            <span className="ml-1 align-top text-2xl text-muted-foreground">{sec}</span>
          </div>
          <div className="mt-1 text-lg text-muted-foreground">
            {dateStr}（{weekday}）
          </div>
          {shift && (
            <div className="mt-0.5 text-sm text-muted-foreground">
              班別 {shift.start_time.slice(0, 5)}～{shift.end_time.slice(0, 5)}
            </div>
          )}
        </section>

        {/* 定位狀態 */}
        <button
          type="button"
          onClick={() => void locate(0)}
          className={`flex min-h-12 items-center justify-center gap-2 rounded-full px-4 py-2 text-base ${
            geo.state === "ok" && inRange === true
              ? "bg-green-100 text-green-800 dark:bg-green-950/50 dark:text-green-300"
              : geo.state === "ok" && inRange === false
                ? "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-300"
                : geo.state === "error"
                  ? "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300"
                  : "bg-muted text-muted-foreground"
          }`}
        >
          {geo.state === "locating" || geo.state === "idle" ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <MapPin className="h-5 w-5 shrink-0" />
          )}
          <span>
            {geo.state === "ok"
              ? geo.distance == null
                ? "已取得位置"
                : inRange
                  ? `在公司範圍內（${fmtDistance(geo.distance)}）`
                  : `離公司 ${fmtDistance(geo.distance)}，超出範圍`
              : geo.state === "error"
                ? geo.message
                : "定位中…"}
          </span>
          {geo.state !== "locating" && <RefreshCw className="h-4 w-4 shrink-0 opacity-60" />}
        </button>
        {geo.state === "ok" && inRange === false && (
          <p className="-mt-3 text-center text-sm text-muted-foreground">
            還是可以打卡，但會標示異常並通知主管
          </p>
        )}

        {/* 打卡大按鈕 */}
        <section className="flex flex-col items-center gap-3 py-2">
          {kind ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void doClock()}
              className={`flex h-56 w-56 select-none flex-col items-center justify-center gap-2 rounded-full text-white shadow-xl transition active:scale-95 disabled:opacity-70 ${
                kind === "in"
                  ? "bg-green-600 active:bg-green-700"
                  : confirmOut
                    ? "bg-red-600 active:bg-red-700"
                    : "bg-orange-500 active:bg-orange-600"
              }`}
              style={{ WebkitTapHighlightColor: "transparent" }}
            >
              {busy ? (
                <>
                  <Loader2 className="h-12 w-12 animate-spin" />
                  <span className="text-xl">打卡中…</span>
                </>
              ) : (
                <>
                  {kind === "in" ? (
                    <LogIn className="h-12 w-12" />
                  ) : (
                    <LogOut className="h-12 w-12" />
                  )}
                  <span className="text-3xl font-bold">{kind === "in" ? "上班" : "下班"}</span>
                  <span className="text-base opacity-90">
                    {confirmOut ? "還沒到下班時間，再按一次" : "點一下打卡"}
                  </span>
                </>
              )}
            </button>
          ) : (
            <div className="flex h-56 w-56 flex-col items-center justify-center gap-2 rounded-full bg-muted text-muted-foreground">
              <CheckCircle2 className="h-12 w-12 text-green-600" />
              <span className="text-2xl font-semibold text-foreground">今天辛苦了</span>
              <span className="text-base">上下班都打好了</span>
            </div>
          )}
          {justDone && (
            <div className="flex items-center gap-2 rounded-full bg-green-600 px-4 py-2 text-base font-medium text-white">
              <CheckCircle2 className="h-5 w-5" />
              {justDone}
            </div>
          )}
        </section>

        {/* 今天 */}
        <section className="grid grid-cols-2 gap-3">
          <TimeTile
            label="上班"
            time={fmtTime(att?.clock_in_at ?? null)}
            note={
              att?.status === "late" && (att.late_minutes ?? 0) > 0
                ? `遲到 ${att.late_minutes} 分`
                : att?.clock_in_at
                  ? "準時"
                  : null
            }
            warn={att?.status === "late"}
          />
          <TimeTile
            label="下班"
            time={fmtTime(att?.clock_out_at ?? null)}
            note={
              (att?.early_leave_minutes ?? 0) > 0
                ? `早退 ${att?.early_leave_minutes} 分`
                : att?.clock_out_at
                  ? "正常"
                  : null
            }
            warn={(att?.early_leave_minutes ?? 0) > 0}
          />
        </section>
        {(workText || otMin > 0 || att?.is_abnormal_location) && (
          <section className="space-y-1 rounded-xl bg-muted/50 px-4 py-3 text-base">
            {workText && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">今天工時</span>
                <span className="tabular-nums">{workText}</span>
              </div>
            )}
            {otMin > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">加班</span>
                <span className="tabular-nums">{(otMin / 60).toFixed(1)} 小時</span>
              </div>
            )}
            {att?.is_abnormal_location && (
              <div className="text-sm text-amber-700 dark:text-amber-400">
                ⚠ {att.abnormal_reason ?? "打卡位置異常"}（主管會看到，有需要請申請補卡說明）
              </div>
            )}
          </section>
        )}

        {/* 補卡：在這頁直接展開 */}
        <Card>
          <button
            type="button"
            className="flex min-h-14 w-full items-center justify-between px-4 text-left"
            onClick={() => setAmendOpen((v) => !v)}
            aria-expanded={amendOpen}
          >
            <span className="flex items-center gap-2 text-base font-medium">
              <ClipboardEdit className="h-5 w-5 text-muted-foreground" />
              忘記打卡？申請補卡
            </span>
            <ChevronDown
              className={`h-5 w-5 text-muted-foreground transition-transform ${amendOpen ? "rotate-180" : ""}`}
            />
          </button>
          {amendOpen && (
            <CardContent className="border-t pt-4">
              <AmendmentPanel />
            </CardContent>
          )}
        </Card>

        {/* 請假：在這頁直接展開 */}
        <Card>
          <button
            type="button"
            className="flex min-h-14 w-full items-center justify-between px-4 text-left"
            onClick={() => setLeaveOpen((v) => !v)}
            aria-expanded={leaveOpen}
          >
            <span className="flex items-center gap-2 text-base font-medium">
              <CalendarDays className="h-5 w-5 text-muted-foreground" />
              請假
            </span>
            <ChevronDown
              className={`h-5 w-5 text-muted-foreground transition-transform ${leaveOpen ? "rotate-180" : ""}`}
            />
          </button>
          {leaveOpen && (
            <CardContent className="border-t pt-4">
              <LeavePanel />
            </CardContent>
          )}
        </Card>

        {/* 我的薪資條 */}
        <Card>
          <button
            type="button"
            className="flex min-h-14 w-full items-center justify-between px-4 text-left"
            onClick={() => setPayOpen((v) => !v)}
            aria-expanded={payOpen}
          >
            <span className="flex items-center gap-2 text-base font-medium">
              <Wallet className="h-5 w-5 text-muted-foreground" />
              我的薪資條
            </span>
            <ChevronDown
              className={`h-5 w-5 text-muted-foreground transition-transform ${payOpen ? "rotate-180" : ""}`}
            />
          </button>
          {payOpen && (
            <CardContent className="border-t pt-4">
              <PayslipPanel />
            </CardContent>
          )}
        </Card>

        <InstallHint />
        <div className="h-4" />
      </main>
    </div>
  );
}

function TimeTile({
  label,
  time,
  note,
  warn,
}: {
  label: string;
  time: string;
  note: string | null;
  warn?: boolean;
}) {
  return (
    <div className="rounded-xl border px-4 py-3 text-center">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="font-mono text-3xl font-semibold tabular-nums">{time}</div>
      <div className={`h-5 text-sm ${warn ? "text-red-600" : "text-muted-foreground"}`}>
        {note ?? ""}
      </div>
    </div>
  );
}

/** Android Chrome 的安裝事件（非標準型別） */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const INSTALL_HINT_KEY = "clock-install-hint-dismissed";

/**
 * 「加到主畫面」提示：只在瀏覽器分頁（非已安裝的 standalone）顯示；
 * Android 有安裝事件時給按鈕，iOS 給 Safari 分享選單的步驟。
 * 全部在 useEffect 決定是否顯示，SSR 一律不輸出，避免 hydration 不一致。
 */
function InstallHint() {
  const [show, setShow] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (standalone) return;
    let dismissed = false;
    try {
      dismissed = window.localStorage.getItem(INSTALL_HINT_KEY) === "1";
    } catch {
      /* 私密瀏覽等情況讀不到，當作沒關過 */
    }
    if (dismissed) return;
    const ua = navigator.userAgent;
    setIsIOS(
      /iPad|iPhone|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1),
    );
    setShow(true);
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setShow(false);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!show) return null;

  const dismiss = () => {
    setShow(false);
    try {
      window.localStorage.setItem(INSTALL_HINT_KEY, "1");
    } catch {
      /* 寫不進去就只關這一次 */
    }
  };
  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    setDeferred(null);
    if (outcome === "accepted") setShow(false);
  };

  return (
    <Card className="border-dashed">
      <CardContent className="p-4 flex gap-3 text-sm">
        <Smartphone className="h-5 w-5 shrink-0 text-primary mt-0.5" />
        <div className="flex-1 space-y-2">
          <p className="font-medium">把打卡加到手機主畫面</p>
          {deferred ? (
            <Button size="sm" onClick={() => void install()}>
              加到主畫面
            </Button>
          ) : isIOS ? (
            <p className="text-muted-foreground">
              用 Safari 開啟本頁，點下方「分享」按鈕，選「加入主畫面」。
            </p>
          ) : (
            <p className="text-muted-foreground">
              在瀏覽器選單（右上角 ⋮）選「加到主畫面」或「安裝應用程式」，之後一點就能打卡。
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="self-start text-muted-foreground hover:text-foreground"
          aria-label="不再顯示"
        >
          <X className="h-4 w-4" />
        </button>
      </CardContent>
    </Card>
  );
}
