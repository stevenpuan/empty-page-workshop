import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { humanizeError } from "@/lib/app-error";
import { fmtDateTime } from "@/lib/dates";
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

export interface LogColumn {
  key: string;
  label: string;
  render?: (row: Record<string, unknown>) => React.ReactNode;
  className?: string;
}

/** 三張 log 頁共用的 40 行模板（EIP 三頁抽成一個元件）。最新 200 筆，唯讀。 */
export function LogTable({
  table,
  module,
  title,
  description,
  columns,
}: {
  table: string;
  module: string;
  title: string;
  description: string;
  columns: LogColumn[];
}) {
  return (
    <RequirePerm module={module}>
      <Inner table={table} title={title} description={description} columns={columns} />
    </RequirePerm>
  );
}

function Inner({
  table,
  title,
  description,
  columns,
}: {
  table: string;
  title: string;
  description: string;
  columns: LogColumn[];
}) {
  const { company } = useAuth();
  const {
    data: rows = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: [table, company?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from(table)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data as Record<string, unknown>[];
    },
  });
  return (
    <div className="space-y-6">
      <PageHeader title={title} description={description} />
      {error && <p className="text-sm text-destructive">{humanizeError(error, "載入日誌")}</p>}
      {isLoading ? (
        <p className="text-muted-foreground">載入中…</p>
      ) : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((c) => (
                    <TableHead key={c.key}>{c.label}</TableHead>
                  ))}
                  <TableHead>時間</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={columns.length + 1}
                      className="text-center text-muted-foreground py-8"
                    >
                      尚無紀錄
                    </TableCell>
                  </TableRow>
                )}
                {rows.map((r) => (
                  <TableRow key={String(r["id"])}>
                    {columns.map((c) => (
                      <TableCell key={c.key} className={c.className}>
                        {c.render ? c.render(r) : String(r[c.key] ?? "—")}
                      </TableCell>
                    ))}
                    <TableCell className="text-muted-foreground whitespace-nowrap">
                      {fmtDateTime(r["created_at"] as string)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
