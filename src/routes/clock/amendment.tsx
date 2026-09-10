import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, ClipboardEdit, Loader2, Plus } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { humanizeError } from "@/lib/app-error";
import { fmtDateTime } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/clock/amendment")({
  head: () => ({
    meta: [
      { title: "補卡申請 — 營運系統" },
      { name: "description", content: "忘記打卡或打卡異常時，提交補卡申請並查詢審核狀態。" },
      { property: "og:title", content: "補卡申請 — 營運系統" },
      { property: "og:description", content: "忘記打卡或打卡異常時，提交補卡申請並查詢審核狀態。" },
    ],
  }),
  component: AmendmentPage,
});

type RequestType = "clock_in" | "clock_out" | "both";

const REQUEST_TYPES: ReadonlyArray<{ value: RequestType; label: string }> = [
  { value: "clock_in", label: "補上班卡" },
  { value: "clock_out", label: "補下班卡" },
  { value: "both", label: "補上下班卡" },
];

const TYPE_LABEL: Record<string, string> = {
  clock_in: "補上班卡",
  clock_out: "補下班卡",
  both: "補上下班卡",
};

const STATUS_META: Record<string, { label: string; cls: string }> = {
  pending: { label: "待核准", cls: "bg-yellow-100 text-yellow-800 border-yellow-200" },
  approved: { label: "已核准", cls: "bg-green-100 text-green-800 border-green-200" },
  rejected: { label: "已駁回", cls: "bg-red-100 text-red-800 border-red-200" },
};

const REASON_MAX = 500;

interface Amendment {
  id: string;
  created_at: string | null;
  request_type: string | null;
  request_time: string | null;
  request_time_out: string | null;
  reason: string | null;
  status: string | null;
  review_note?: string | null;
  reviewer_note?: string | null;
  approved_note?: string | null;
  reviewed_note?: string | null;
  note?: string | null;
}

/** 台北＝UTC+8 且無夏令時間，所以 datetime-local 的牆-clock 時間直接加 +08:00 就是正確時刻 */
function localToIso(v: string): string | null {
  if (!v) return null;
  const withSec = v.length === 16 ? `${v}:00` : v;
  const d = new Date(`${withSec}+08:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** 目前台北牆-clock 時間 → datetime-local 可用值（YYYY-MM-DDTHH:mm） */
function nowLocalInput(): string {
  const d = new Date();
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return `${date}T${time}`;
}

function noteOf(a: Amendment): string | null {
  const n =
    a.review_note ??
    a.reviewer_note ??
    a.approved_note ??
    a.reviewed_note ??
    a.note ??
    null;
  return typeof n === "string" && n.trim() ? n : null;
}

function AmendmentPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { session, user, company, employee, loading, permsLoaded } = useAuth();

  const [requestType, setRequestType] = useState<RequestType>("clock_in");
  const [requestTime, setRequestTime] = useState<string>(() => nowLocalInput());
  const [requestTimeOut, setRequestTimeOut] = useState<string>(() => nowLocalInput());
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && !session) navigate({ to: "/login" });
  }, [loading, session, navigate]);

  const empId = employee?.id ?? null;

  const {
    data: rows,
    isLoading,
    isError,
    error: listError,
  } = useQuery({
    queryKey: ["attendance_amendments", empId],
    enabled: !!empId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("attendance_amendments")
        .select("*")
        .eq("employee_id", empId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data as Amendment[]) ?? [];
    },
  });

  const list = useMemo(() => rows ?? [], [rows]);

  const submit = async () => {
    if (!user || !company || !employee) {
      toast.error("員工資料尚未載入完成，請重新整理頁面後再試");
      return;
    }

    // ① 前端驗證（後端 RLS／CHECK 仍是最後一道防線）
    if (!requestType) {
      toast.error("請選擇補卡類型");
      return;
    }
    const isoIn = localToIso(requestTime);
    if (!isoIn) {
      toast.error("請選擇補打時間");
      return;
    }
    let isoOut: string | null = null;
    if (requestType === "both") {
      isoOut = localToIso(requestTimeOut);
      if (!isoOut) {
        toast.error("請選擇補打下班時間");
        return;
      }
      if (new Date(isoOut).getTime() < new Date(isoIn).getTime()) {
        toast.error("下班時間不能早於上班時間");
        return;
      }
    }
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      toast.error("請填寫補卡原因");
      return;
    }
    if (trimmedReason.length > REASON_MAX) {
      toast.error(`補卡原因請控制在 ${REASON_MAX} 字以內`);
      return;
    }
    if (new Date(isoIn).getTime() > Date.now()) {
      toast.error("補打時間不能晚於現在");
      return;
    }

    setSubmitting(true);
    try {
      // ② 寫入（帶 company_id，政策 with check 需要）＋ .select("id") 驗筆數
      const { data: inserted, error } = await supabase
        .from("attendance_amendments")
        .insert({
          company_id: company.id,
          employee_id: employee.id,
          request_type: requestType,
          request_time: isoIn,
          request_time_out: requestType === "both" ? isoOut : null,
          reason: trimmedReason,
          status: "pending",
          created_by: user.id,
          updated_by: user.id,
        })
        .select("id");
      if (error) {
        toast.error(
          error.code === "42P01"
            ? "補卡功能尚未啟用（資料庫資料表尚未建立）"
            : humanizeError(error, "送出補卡申請"),
        );
        return;
      }
      if (!inserted || inserted.length !== 1) {
        toast.error("送出補卡申請失敗：資料庫沒有寫入任何資料，可能被權限規則擋掉");
        return;
      }

      toast.success("補卡申請已送出，等待主管核准");
      setReason("");
      setRequestType("clock_in");
      setRequestTime(nowLocalInput());
      setRequestTimeOut(nowLocalInput());
      qc.invalidateQueries({ queryKey: ["attendance_amendments", empId] });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || !permsLoaded) {
    return (
      <div className="min-h-screen grid place-items-center text-muted-foreground">載入中…</div>
    );
  }
  if (!session) return null;

  return (
    <div className="min-h-screen bg-background px-4 py-6">
      <div className="w-full max-w-md mx-auto space-y-5">
        {/* 返回與標題 */}
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" className="-ml-2">
            <Link to="/clock" aria-label="返回打卡">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="flex items-center gap-2">
            <ClipboardEdit className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-lg font-semibold">補卡申請</h1>
          </div>
        </div>

        {!employee || !company ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              尚未綁定員工資料，無法申請補卡，請聯絡老闆確認帳號設定。
            </CardContent>
          </Card>
        ) : (
          <>
            {/* 申請表單 */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">填寫補卡資料</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="request-type">補卡類型</Label>
                  <Select
                    value={requestType}
                    onValueChange={(v) => setRequestType(v as RequestType)}
                  >
                    <SelectTrigger id="request-type">
                      <SelectValue placeholder="請選擇補卡類型" />
                    </SelectTrigger>
                    <SelectContent>
                      {REQUEST_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="request-time">
                    {requestType === "clock_out" ? "補打時間（下班）" : "補打時間（上班）"}
                  </Label>
                  <Input
                    id="request-time"
                    type="datetime-local"
                    value={requestTime}
                    onChange={(e) => setRequestTime(e.target.value)}
                    className="tabular-nums"
                  />
                </div>

                {requestType === "both" && (
                  <div className="space-y-2">
                    <Label htmlFor="request-time-out">補打下班時間</Label>
                    <Input
                      id="request-time-out"
                      type="datetime-local"
                      value={requestTimeOut}
                      onChange={(e) => setRequestTimeOut(e.target.value)}
                      className="tabular-nums"
                    />
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="reason">原因</Label>
                  <Textarea
                    id="reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="例如：忘記打上班卡／手機沒電／打卡異常…"
                    rows={4}
                    maxLength={REASON_MAX}
                  />
                  <div className="text-xs text-muted-foreground text-right tabular-nums">
                    {reason.trim().length} / {REASON_MAX}
                  </div>
                </div>

                <Button
                  type="button"
                  className="w-full"
                  onClick={() => void submit()}
                  disabled={submitting}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      送出中…
                    </>
                  ) : (
                    <>
                      <Plus className="h-4 w-4 mr-2" />
                      送出申請
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>

            {/* 我的申請紀錄 */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">我的補卡申請</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {isLoading ? (
                  <div className="py-6 text-center text-sm text-muted-foreground">載入中…</div>
                ) : isError ? (
                  <div className="py-6 text-center text-sm text-muted-foreground">
                    {listError && "code" in listError && (listError as { code?: string }).code ===
                    "42P01"
                      ? "補卡功能尚未啟用（資料庫資料表尚未建立）"
                      : "補卡申請紀錄無法載入，請稍後再試"}
                  </div>
                ) : list.length === 0 ? (
                  <div className="py-6 text-center text-sm text-muted-foreground">
                    還沒有補卡申請紀錄
                  </div>
                ) : (
                  list.map((a) => {
                    const meta = a.status ? STATUS_META[a.status] : null;
                    const note = noteOf(a);
                    return (
                      <div key={a.id} className="rounded-lg border p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-sm font-medium">
                            {TYPE_LABEL[a.request_type ?? ""] ?? a.request_type ?? "—"}
                          </div>
                          <Badge
                            variant="outline"
                            className={meta?.cls ?? "bg-gray-100 text-gray-600 border-gray-200"}
                          >
                            {meta?.label ?? a.status ?? "—"}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          申請時間：{fmtDateTime(a.created_at)}
                        </div>
                        <div className="text-sm tabular-nums">
                          補打時間：{fmtDateTime(a.request_time)}
                          {a.request_time_out ? ` ～ ${fmtDateTime(a.request_time_out)}` : ""}
                        </div>
                        <div className="text-sm whitespace-pre-wrap">
                          原因：{a.reason ?? "—"}
                        </div>
                        {note && (
                          <div className="text-sm text-muted-foreground border-t pt-2">
                            核准備註：{note}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
