import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useLookup } from "@/lib/lookups";
import { fmtDate } from "@/lib/dates";
import { humanizeError } from "@/lib/app-error";
import { RequirePerm } from "@/components/RequirePerm";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/dashboard/system/changelog")({
  component: () => (
    <RequirePerm module="changelog">
      <Page />
    </RequirePerm>
  ),
});

interface Row {
  id: string;
  version: string;
  type: string;
  title: string;
  content: string | null;
  released_at: string;
}

function Page() {
  const types = useLookup("changelog_type", { includeInactive: true });
  const { data: rows = [], error } = useQuery({
    queryKey: ["changelogs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("changelogs")
        .select("*")
        .order("released_at", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Row[];
    },
  });
  return (
    <div className="space-y-6">
      <PageHeader
        title="版本更新"
        description="每次上線都會在這裡留一筆，不用再用 LINE 問「今天改了什麼」。"
      />
      {error && <p className="text-sm text-destructive">{humanizeError(error, "載入版本紀錄")}</p>}
      <div className="space-y-3">
        {rows.map((r) => (
          <Card key={r.id}>
            <CardContent className="p-4 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-semibold">v{r.version}</span>
                <Badge variant="outline">{types.labelOf(r.type)}</Badge>
                <span className="text-xs text-muted-foreground">{fmtDate(r.released_at)}</span>
              </div>
              <div className="font-medium">{r.title}</div>
              {r.content && (
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{r.content}</p>
              )}
            </CardContent>
          </Card>
        ))}
        {rows.length === 0 && <p className="text-sm text-muted-foreground">尚無紀錄</p>}
      </div>
    </div>
  );
}
