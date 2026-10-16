import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CalendarDays, CheckCircle2, Info, Pencil, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { humanizeError } from "@/lib/app-error";
import { taipeiToday } from "@/lib/dates";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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

export const Route = createFileRoute("/dashboard/holidays")({
  head: () => ({
    meta: [
      { title: "假日行事曆" },
      { name: "description", content: "國定假日、公司休假日與補班日" },
      { property: "og:title", content: "假日行事曆" },
      { property: "og:description", content: "國定假日、公司休假日與補班日" },
    ],
  }),
  component: () => (
    <RequirePerm module="holidays">
      <Page />
    </RequirePerm>
  ),
});

type HolidayKind = "national" | "company" | "makeup_workday";

interface Holiday {
  id: string;
  company_id: string;
  holiday_date: string;
  name: string;
  kind: HolidayKind;
  is_confirmed: boolean;
  note: string | null;
}
type Draft = Partial<Holiday>;

// kind 是 DB CHECK 的值（非代碼字典），故在頁面定義
const KINDS: ReadonlyArray<readonly [HolidayKind, string]> = [
  ["national", "國定假日"],
  ["company", "公司休假"],
  ["makeup_workday", "補班日"],
];
const KIND_CLASS: Record<HolidayKind, string> = {
  national: "bg-red-100 text-red-800 border-red-200",
  company: "bg-blue-100 text-blue-800 border-blue-200",
  makeup_workday: "bg-amber-100 text-amber-800 border-amber-200",
};
const kindLabel = (k: string) => KINDS.find(([v]) => v === k)?.[1] ?? k;

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
/** date 字串（YYYY-MM-DD）→ 星期；以 UTC 解析，不受瀏覽器時區影響 */
function weekdayOf(d: string): string {
  const day = new Date(`${d}T00:00:00Z`).getUTCDay();
  return WEEKDAYS[day] ?? "";
}
function fmtMonthDay(d: string): string {
  const [, m, dd] = d.split("-");
  return `${Number(m)}/${Number(dd)}`;
}

function Page() {
  const { company, isManager } = useAuth();
  const qc = useQueryClient();
  const today = taipeiToday();
  const thisYear = Number(today.slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const years = useMemo(() => [thisYear - 1, thisYear, thisYear + 1], [thisYear]);

  const queryKey = ["holidays", company?.id, year];
  const {
    data: rows = [],
    isLoading,
    error: loadErr,
  } = useQuery({
    queryKey,
    enabled: !!company?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("holidays")
        .select("id, company_id, holiday_date, name, kind, is_confirmed, note")
        .gte("holiday_date", `${year}-01-01`)
        .lte("holiday_date", `${year}-12-31`)
        .order("holiday_date")
        .range(0, 199);
      if (error) throw error;
      return data as Holiday[];
    },
  });
  const reload = () => qc.invalidateQueries({ queryKey: ["holidays", company?.id] });

  const pendingCount = rows.filter((r) => !r.is_confirmed).length;

  // ---- 新增／編輯 ----
  const [form, setForm] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const isNew = !!form && !form.id;

  const save = async () => {
    if (!form || !company) return;
    if (!form.holiday_date || !form.name?.trim()) {
      toast.error("日期、名稱為必填");
      return;
    }
    const payload = {
      company_id: company.id,
      holiday_date: form.holiday_date,
      name: form.name.trim(),
      kind: form.kind ?? "national",
      is_confirmed: !!form.is_confirmed,
      note: form.note?.trim() || null,
    };
    setSaving(true);
    const res = form.id
      ? await supabase.from("holidays").update(payload).eq("id", form.id).select("id")
      : await supabase.from("holidays").insert(payload).select("id");
    setSaving(false);
    if (res.error) {
      toast.error(humanizeError(res.error, isNew ? "新增假日" : "更新假日"));
      return;
    }
    if (!res.data?.length) {
      toast.error("沒有寫入任何資料（可能沒有權限），請重新整理後再試");
      return;
    }
    toast.success(isNew ? "已新增假日" : "已更新");
    setForm(null);
    reload();
  };

  const toggleConfirm = async (h: Holiday) => {
    const { data, error } = await supabase
      .from("holidays")
      .update({ is_confirmed: !h.is_confirmed })
      .eq("id", h.id)
      .select("id");
    if (error) {
      toast.error(humanizeError(error, "確認假日"));
      return;
    }
    if (!data?.length) {
      toast.error("沒有寫入任何資料（可能沒有權限），請重新整理後再試");
      return;
    }
    toast.success(h.is_confirmed ? "已改回待確認" : "已確認");
    reload();
  };

  const remove = async (h: Holiday) => {
    if (!confirm(`刪除 ${h.holiday_date}「${h.name}」？`)) return;
    const { data, error } = await supabase.from("holidays").delete().eq("id", h.id).select("id");
    if (error) {
      toast.error(humanizeError(error, "刪除假日"));
      return;
    }
    if (!data?.length) {
      toast.error("沒有刪除任何資料（可能沒有權限），請重新整理後再試");
      return;
    }
    toast.success("已刪除");
    reload();
  };

  const colCount = isManager ? 6 : 5;

  return (
    <div className="space-y-6">
      <PageHeader
        title="假日行事曆"
        description={`${year} 年共 ${rows.length} 天${pendingCount ? `・待確認 ${pendingCount} 天` : ""}`}
        actions={
          <div className="flex items-center gap-2">
            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {years.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y} 年
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isManager && (
              <Button
                onClick={() =>
                  setForm({
                    holiday_date: year === thisYear ? today : `${year}-01-01`,
                    name: "",
                    kind: "national",
                    is_confirmed: true,
                    note: "",
                  })
                }
              >
                <Plus className="w-4 h-4 mr-1" />
                新增假日
              </Button>
            )}
          </div>
        }
      />

      <div className="flex gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-100">
        <Info className="h-4 w-4 shrink-0 mt-0.5" />
        <p>
          在「國定假日」或「公司休假」當天打卡上班，工時會自動全數計為<strong>國定假日加班</strong>
          （不計遲到早退）。「補班日」視為一般上班日。「待確認」的日期一樣會套用，請盡早確認或刪除。
        </p>
      </div>

      {loadErr && <p className="text-sm text-destructive">{humanizeError(loadErr, "載入假日")}</p>}

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-36">日期</TableHead>
                <TableHead>名稱</TableHead>
                <TableHead>類型</TableHead>
                <TableHead>狀態</TableHead>
                <TableHead>備註</TableHead>
                {isManager && <TableHead className="text-right">操作</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={colCount} className="text-center text-muted-foreground py-8">
                    載入中…
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && !loadErr && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={colCount} className="text-center text-muted-foreground py-8">
                    {year} 年尚未設定假日{isManager ? "，請按「新增假日」" : ""}
                  </TableCell>
                </TableRow>
              )}
              {rows.map((h) => {
                const past = h.holiday_date < today;
                return (
                  <TableRow key={h.id} className={past ? "opacity-60" : undefined}>
                    <TableCell className="tabular-nums">
                      <span className="font-medium">{fmtMonthDay(h.holiday_date)}</span>
                      <span className="ml-1 text-muted-foreground">（{weekdayOf(h.holiday_date)}）</span>
                      {h.holiday_date === today && (
                        <Badge variant="outline" className="ml-2 text-xs">
                          今天
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-medium">{h.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={KIND_CLASS[h.kind] ?? ""}>
                        {kindLabel(h.kind)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {h.is_confirmed ? (
                        <span className="inline-flex items-center gap-1 text-sm text-green-700 dark:text-green-400">
                          <CheckCircle2 className="h-4 w-4" />
                          已確認
                        </span>
                      ) : (
                        <Badge
                          variant="outline"
                          className="bg-amber-100 text-amber-800 border-amber-200"
                        >
                          待確認
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-xs whitespace-pre-wrap">
                      {h.note ?? "—"}
                    </TableCell>
                    {isManager && (
                      <TableCell className="text-right whitespace-nowrap">
                        <Button
                          size="sm"
                          variant={h.is_confirmed ? "ghost" : "outline"}
                          onClick={() => void toggleConfirm(h)}
                        >
                          {h.is_confirmed ? "取消確認" : "確認"}
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="編輯"
                          onClick={() => setForm({ ...h })}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="刪除"
                          onClick={() => void remove(h)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* 新增／編輯 */}
      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5" />
              {isNew ? "新增假日" : "編輯假日"}
            </DialogTitle>
            <DialogDescription>
              國定假日與公司休假當天上班，工時自動計為國定假日加班。同一天只能設定一筆。
            </DialogDescription>
          </DialogHeader>
          {form && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>日期 *</Label>
                  <Input
                    type="date"
                    value={form.holiday_date ?? ""}
                    onChange={(e) => setForm({ ...form, holiday_date: e.target.value })}
                  />
                  {form.holiday_date && (
                    <p className="text-xs text-muted-foreground">
                      星期{weekdayOf(form.holiday_date)}
                    </p>
                  )}
                </div>
                <div className="space-y-1">
                  <Label>類型</Label>
                  <Select
                    value={form.kind ?? "national"}
                    onValueChange={(v) => setForm({ ...form, kind: v as HolidayKind })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {KINDS.map(([k, label]) => (
                        <SelectItem key={k} value={k}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1">
                <Label>名稱 *</Label>
                <Input
                  value={form.name ?? ""}
                  placeholder="例：國慶日、公司尾牙補休"
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>備註</Label>
                <Textarea
                  value={form.note ?? ""}
                  rows={2}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                />
              </div>
              <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                <Label>已確認</Label>
                <Switch
                  checked={!!form.is_confirmed}
                  onCheckedChange={(v) => setForm({ ...form, is_confirmed: v })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>
              取消
            </Button>
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? "儲存中…" : isNew ? "新增" : "儲存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
