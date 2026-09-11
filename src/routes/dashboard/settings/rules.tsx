import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { humanizeError } from "@/lib/app-error";
import { RequirePerm } from "@/components/RequirePerm";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

export const Route = createFileRoute("/dashboard/settings/rules")({
  component: () => (
    <RequirePerm module="notification_rules">
      <Page />
    </RequirePerm>
  ),
});

interface Rule {
  id: string;
  rule_code: string;
  name: string;
  category: string;
  trigger_kind: "event" | "scan";
  is_enabled: boolean;
  recipient_scopes: string[];
  in_app_enabled: boolean;
  line_enabled: boolean;
  line_mode: "immediate" | "digest";
}

const CATEGORY_LABEL: Record<string, string> = {
  dispatch: "派工通知",
  outsource: "外包通知",
  payable: "應付帳款",
  receivable: "應收帳款",
  attendance: "出勤通知",
  system: "系統通知",
};
const CATEGORY_ORDER = ["dispatch", "outsource", "payable", "receivable", "attendance", "system"];

function Page() {
  const { company, isManager, permsLoaded } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  // 僅 owner / manager 可見
  useEffect(() => {
    if (permsLoaded && !isManager) navigate({ to: "/" });
  }, [permsLoaded, isManager, navigate]);

  const { data: rules = [] } = useQuery({
    queryKey: ["notification_rules", company?.id],
    enabled: !!company?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notification_rules")
        .select("*")
        .order("category")
        .order("rule_code");
      if (error) throw error;
      return data as Rule[];
    },
  });

  // 只傳變更的欄位，其餘 null，由 RPC coalesce 保留原值
  const updateRule = async (
    rule: Rule,
    patch: Partial<Pick<Rule, "is_enabled" | "in_app_enabled" | "line_enabled" | "line_mode">>,
  ) => {
    const { error } = await supabase.rpc("update_notification_rule", {
      p_rule_id: rule.id,
      p_is_enabled: patch.is_enabled ?? null,
      p_in_app_enabled: patch.in_app_enabled ?? null,
      p_line_enabled: patch.line_enabled ?? null,
      p_line_mode: patch.line_mode ?? null,
    });
    if (error) {
      toast.error(humanizeError(error, "更新通知規則"));
      return;
    }
    qc.invalidateQueries({ queryKey: ["notification_rules", company?.id] });
  };

  const categories = Array.from(new Set(rules.map((r) => r.category))).sort(
    (a, b) =>
      (CATEGORY_ORDER.indexOf(a) === -1 ? 99 : CATEGORY_ORDER.indexOf(a)) -
      (CATEGORY_ORDER.indexOf(b) === -1 ? 99 : CATEGORY_ORDER.indexOf(b)),
  );

  if (permsLoaded && !isManager) return null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="通知規則"
        description="設定各類通知規則的啟用狀態與推播方式。「事件」由系統動作即時觸發；「排程」定期掃描門檻。LINE 可選即時推播或每日摘要。"
      />
      <Accordion type="multiple" defaultValue={categories} className="space-y-3">
        {categories.map((cat) => (
          <AccordionItem key={cat} value={cat} className="rounded-lg border bg-card px-4">
            <AccordionTrigger className="py-3 text-sm font-semibold hover:no-underline">
              {CATEGORY_LABEL[cat] ?? cat}
            </AccordionTrigger>
            <AccordionContent className="pb-2">
              <div className="divide-y">
                {rules
                  .filter((r) => r.category === cat)
                  .map((r) => (
                    <div
                      key={r.id}
                      className={`flex flex-wrap items-center justify-between gap-4 py-4 ${
                        r.is_enabled ? "" : "opacity-60"
                      }`}
                    >
                      {/* 左側：規則名稱與資訊 */}
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{r.name}</span>
                          <Badge variant={r.trigger_kind === "event" ? "default" : "secondary"}>
                            {r.trigger_kind === "event" ? "事件" : "排程"}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground font-mono">{r.rule_code}</div>
                        {r.recipient_scopes.length > 0 && (
                          <div className="flex flex-wrap gap-1 pt-0.5">
                            {r.recipient_scopes.map((s) => (
                              <Badge key={s} variant="outline" className="text-[11px]">
                                {s}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                      {/* 右側：開關與選項 */}
                      <div className="flex flex-wrap items-center gap-5 shrink-0">
                        <label className="flex items-center gap-2 text-sm">
                          <Switch
                            checked={r.in_app_enabled}
                            disabled={!r.is_enabled}
                            onCheckedChange={(v) => updateRule(r, { in_app_enabled: v })}
                          />
                          站內通知
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                          <Switch
                            checked={r.line_enabled}
                            disabled={!r.is_enabled}
                            onCheckedChange={(v) => updateRule(r, { line_enabled: v })}
                          />
                          LINE 推播
                        </label>
                        <Select
                          value={r.line_mode}
                          disabled={!r.is_enabled || !r.line_enabled}
                          onValueChange={(v) =>
                            updateRule(r, { line_mode: v as Rule["line_mode"] })
                          }
                        >
                          <SelectTrigger className="w-[130px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="immediate">即時推播</SelectItem>
                            <SelectItem value="digest">每日摘要</SelectItem>
                          </SelectContent>
                        </Select>
                        <label className="flex items-center gap-2 text-sm font-medium">
                          <Switch
                            checked={r.is_enabled}
                            onCheckedChange={(v) => updateRule(r, { is_enabled: v })}
                          />
                          啟用
                        </label>
                      </div>
                    </div>
                  ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}
