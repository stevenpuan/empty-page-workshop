/**
 * 績效統計：每月每人完成多少工序、快單、準時率、經手快單營收。
 * 資料來自「我來做／做好了」與快單的紀錄，不需要另外填寫（performance_stats，030）。
 */
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { humanizeError } from "@/lib/app-error";
import { formatTWD, taipeiToday } from "@/lib/dates";
import { RequirePerm } from "@/components/RequirePerm";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/dashboard/performance")({
  head: () => ({
    meta: [
      { title: "績效統計" },
      { name: "description", content: "每月每人完成的工序、快單與準時率" },
      { property: "og:title", content: "績效統計" },
      { property: "og:description", content: "每月每人完成的工序、快單與準時率" },
    ],
  }),
  component: () => (
    <RequirePerm module="performance">
      <Page />
    </RequirePerm>
  ),
});

interface Row {
  employee_id: string;
  employee_name: string;
  tasks_done: number;
  tasks_on_time: number;
  quick_done: number;
  quick_on_time: number;
  quick_amount: number | string;
  avg_task_hours: number | string | null;
}

const EMPTY: Row[] = [];

const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "—");

function Page() {
  const { company } = useAuth();
  const [month, setMonth] = useState(taipeiToday().slice(0, 7));

  const {
    data = EMPTY,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["performance_stats", company?.id, month],
    enabled: !!company?.id && /^\d{4}-\d{2}$/.test(month),
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase.rpc("performance_stats", { p_month: `${month}-01` });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const total = data.reduce(
    (s, r) => ({
      tasks: s.tasks + r.tasks_done,
      tasksOn: s.tasksOn + r.tasks_on_time,
      quick: s.quick + r.quick_done,
      quickOn: s.quickOn + r.quick_on_time,
      amount: s.amount + Number(r.quick_amount ?? 0),
    }),
    { tasks: 0, tasksOn: 0, quick: 0, quickOn: 0, amount: 0 },
  );

  const exportExcel = async () => {
    if (!data.length) {
      toast.info("這個月沒有資料");
      return;
    }
    try {
      const XLSX = await import("xlsx");
      const aoa: (string | number)[][] = [
        [
          "員工",
          "完成工序",
          "工序準時",
          "工序準時率",
          "完成快單",
          "快單準時",
          "快單準時率",
          "經手快單營收",
          "平均每道工序（小時）",
        ],
        ...data.map((r) => [
          r.employee_name,
          r.tasks_done,
          r.tasks_on_time,
          pct(r.tasks_on_time, r.tasks_done),
          r.quick_done,
          r.quick_on_time,
          pct(r.quick_on_time, r.quick_done),
          Number(r.quick_amount ?? 0),
          r.avg_task_hours == null ? "" : Number(r.avg_task_hours),
        ]),
      ];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "績效");
      XLSX.writeFile(wb, `績效統計_${month}.xlsx`);
    } catch (e) {
      toast.error(humanizeError(e, "匯出績效"));
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="績效統計"
        description="依「我來做／做好了」與快單紀錄自動統計，不用另外填。準時＝在工序交期或快單約定取件時間前完成。"
        actions={
          <Button variant="outline" onClick={exportExcel}>
            <Download className="mr-1 h-4 w-4" />
            匯出 Excel
          </Button>
        }
      />

      <div className="flex items-end gap-3">
        <div className="space-y-1">
          <Label>月份</Label>
          <Input
            type="month"
            className="w-44"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </div>
      </div>

      {!!error && <p className="text-sm text-destructive">{humanizeError(error, "載入績效")}</p>}

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>員工</TableHead>
                <TableHead className="text-right">完成工序</TableHead>
                <TableHead className="text-right">工序準時率</TableHead>
                <TableHead className="text-right">完成快單</TableHead>
                <TableHead className="text-right">快單準時率</TableHead>
                <TableHead className="text-right">經手快單營收</TableHead>
                <TableHead className="text-right">平均每道工序</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    載入中…
                  </TableCell>
                </TableRow>
              )}
              {data.map((r) => (
                <TableRow key={r.employee_id}>
                  <TableCell className="font-medium">{r.employee_name}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.tasks_done}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {pct(r.tasks_on_time, r.tasks_done)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.quick_done}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {pct(r.quick_on_time, r.quick_done)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatTWD(r.quick_amount)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.avg_task_hours == null ? "—" : `${r.avg_task_hours} 小時`}
                  </TableCell>
                </TableRow>
              ))}
              {data.length > 0 && (
                <TableRow className="bg-muted/40 font-semibold">
                  <TableCell>合計</TableCell>
                  <TableCell className="text-right tabular-nums">{total.tasks}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {pct(total.tasksOn, total.tasks)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{total.quick}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {pct(total.quickOn, total.quick)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatTWD(total.amount)}
                  </TableCell>
                  <TableCell />
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
