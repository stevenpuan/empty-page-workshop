import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { humanizeError } from "@/lib/app-error";
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
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  params: Record<string, unknown>;
  recipient_scopes: string[];
  in_app_enabled: boolean;
  line_enabled: boolean;
  line_mode: "immediate" | "digest";
}
interface Emp {
  id: string;
  name: string;
  emp_no: string;
}
interface Role {
  code: string;
  name: string;
}

const CATEGORY_LABEL: Record<string, string> = {
  dispatch: "派工",
  outsource: "外包",
  payable: "應付",
  receivable: "應收",
  attendance: "出勤",
  system: "系統",
};
const FIXED_SCOPES: [string, string][] = [
  ["owner", "該筆負責人"],
  ["manager", "本公司主管（店長／老闆）"],
  ["all_company", "全公司"],
  ["counterpart", "跨公司對方主管"],
];
// 收件人由呼叫端當場指定的規則，空 scopes 是正常設計
const SCOPELESS_BY_DESIGN = new Set<string>([]);

function scopeLabel(s: string, emps: Emp[], roles: Role[]) {
  const fixed = FIXED_SCOPES.find(([k]) => k === s);
  if (fixed) return fixed[1];
  if (s.startsWith("role:"))
    return `角色：${roles.find((r) => r.code === s.slice(5))?.name ?? s.slice(5)}`;
  if (s.startsWith("user:"))
    return `指定：${emps.find((e) => e.id === s.slice(5))?.name ?? "（已離職）"}`;
  return s;
}

function Page() {
  const { can, company } = useAuth();
  const qc = useQueryClient();
  const editable = can("notification_rules", "edit");

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
  const { data: emps = [] } = useQuery({
    queryKey: ["employees_min", company?.id],
    enabled: !!company?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employees")
        .select("id, name, emp_no")
        .eq("is_active", true)
        .order("emp_no");
      if (error) throw error;
      return data as Emp[];
    },
  });
  const { data: roles = [] } = useQuery({
    queryKey: ["roles_min", company?.id],
    enabled: !!company?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("roles")
        .select("code, name")
        .eq("is_active", true)
        .order("sort_order");
      if (error) throw error;
      return data as Role[];
    },
  });

  const quickToggle = async (r: Rule, patch: Partial<Rule>) => {
    const { data, error } = await supabase
      .from("notification_rules")
      .update(patch)
      .eq("id", r.id)
      .select("id");
    if (error) {
      toast.error(humanizeError(error, "更新規則"));
      return;
    }
    if (!data?.length) {
      toast.error("沒有寫入任何資料（可能沒有權限）");
      return;
    }
    qc.invalidateQueries({ queryKey: ["notification_rules", company?.id] });
  };

  const [form, setForm] = useState<(Rule & { paramsText: string }) | null>(null);
  const openEdit = (r: Rule) =>
    setForm({ ...r, paramsText: JSON.stringify(r.params ?? {}, null, 0) });
  const save = async () => {
    if (!form) return;
    let params: Record<string, unknown> = {};
    try {
      params = form.paramsText.trim() ? JSON.parse(form.paramsText) : {};
    } catch {
      {
        toast.error("門檻參數不是合法 JSON");
        return;
      }
    }
    if (
      form.is_enabled &&
      (form.in_app_enabled || form.line_enabled) &&
      form.recipient_scopes.length === 0 &&
      !SCOPELESS_BY_DESIGN.has(form.rule_code)
    ) {
      {
        toast.error("沒有選任何收件範圍，這樣不會通知到任何人。請至少選一個，或把規則關掉。");
        return;
      }
    }
    const { data, error } = await supabase
      .from("notification_rules")
      .update({
        name: form.name.trim(),
        is_enabled: form.is_enabled,
        params,
        recipient_scopes: form.recipient_scopes,
        in_app_enabled: form.in_app_enabled,
        line_enabled: form.line_enabled,
        line_mode: form.line_mode,
      })
      .eq("id", form.id)
      .select("id");
    if (error) {
      toast.error(humanizeError(error, "儲存規則"));
      return;
    }
    if (!data?.length) {
      toast.error("沒有寫入任何資料（可能沒有權限）");
      return;
    }
    toast.success("已儲存");
    setForm(null);
    qc.invalidateQueries({ queryKey: ["notification_rules", company?.id] });
  };
  const addScope = (s: string) =>
    form &&
    !form.recipient_scopes.includes(s) &&
    setForm({ ...form, recipient_scopes: [...form.recipient_scopes, s] });
  const removeScope = (s: string) =>
    form && setForm({ ...form, recipient_scopes: form.recipient_scopes.filter((x) => x !== s) });

  const categories = Array.from(new Set(rules.map((r) => r.category)));

  return (
    <div className="space-y-6">
      <PageHeader
        title="通知規則"
        description="每家公司各一套。「事件型」由系統動作即時觸發；「排程型」每 5 分鐘掃描一次門檻。LINE 可選即時或每日 08:00 彙整（每人一則）。"
      />
      {categories.map((cat) => (
        <Card key={cat}>
          <CardContent className="p-0 overflow-x-auto">
            <div className="px-4 py-2 text-xs font-semibold text-muted-foreground bg-muted/40">
              {CATEGORY_LABEL[cat] ?? cat}
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>規則</TableHead>
                  <TableHead>類型</TableHead>
                  <TableHead>收件範圍</TableHead>
                  <TableHead>門檻</TableHead>
                  <TableHead className="text-center">站內</TableHead>
                  <TableHead className="text-center">LINE</TableHead>
                  <TableHead className="text-center">啟用</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules
                  .filter((r) => r.category === cat)
                  .map((r) => (
                    <TableRow key={r.id} className={r.is_enabled ? "" : "opacity-50"}>
                      <TableCell>
                        <div className="font-medium">{r.name}</div>
                        <div className="text-xs font-mono text-muted-foreground">{r.rule_code}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {r.trigger_kind === "event" ? "事件" : "排程"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {r.recipient_scopes.map((s) => (
                            <Badge key={s} variant="secondary" className="text-[11px]">
                              {scopeLabel(s, emps, roles)}
                            </Badge>
                          ))}
                          {r.recipient_scopes.length === 0 && (
                            <span className="text-xs text-destructive">未設收件人</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {Object.keys(r.params ?? {}).length ? JSON.stringify(r.params) : "—"}
                      </TableCell>
                      <TableCell className="text-center">
                        <Switch
                          checked={r.in_app_enabled}
                          disabled={!editable || !r.is_enabled}
                          onCheckedChange={(v) => quickToggle(r, { in_app_enabled: v })}
                        />
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex flex-col items-center gap-0.5">
                          <Switch
                            checked={r.line_enabled}
                            disabled={!editable || !r.is_enabled}
                            onCheckedChange={(v) => quickToggle(r, { line_enabled: v })}
                          />
                          <span className="text-[10px] text-muted-foreground">
                            {r.line_mode === "digest" ? "彙整" : "即時"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <Switch
                          checked={r.is_enabled}
                          disabled={!editable}
                          onCheckedChange={(v) => quickToggle(r, { is_enabled: v })}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        {editable && (
                          <Button size="sm" variant="outline" onClick={() => openEdit(r)}>
                            編輯
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>編輯規則</DialogTitle>
            <DialogDescription className="font-mono text-xs">{form?.rule_code}</DialogDescription>
          </DialogHeader>
          {form && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>名稱</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>收件範圍</Label>
                <div className="flex flex-wrap gap-1.5 min-h-[32px] rounded-md border p-2">
                  {form.recipient_scopes.map((s) => (
                    <Badge key={s} variant="secondary" className="gap-1">
                      {scopeLabel(s, emps, roles)}
                      <button type="button" onClick={() => removeScope(s)} aria-label="移除">
                        <X className="w-3 h-3" />
                      </button>
                    </Badge>
                  ))}
                  {form.recipient_scopes.length === 0 && (
                    <span className="text-xs text-muted-foreground">尚未選擇</span>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2 pt-1">
                  <Select onValueChange={(v) => addScope(v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="＋範圍" />
                    </SelectTrigger>
                    <SelectContent>
                      {FIXED_SCOPES.map(([k, l]) => (
                        <SelectItem key={k} value={k}>
                          {l}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select onValueChange={(v) => addScope(`role:${v}`)}>
                    <SelectTrigger>
                      <SelectValue placeholder="＋角色" />
                    </SelectTrigger>
                    <SelectContent>
                      {roles.map((r) => (
                        <SelectItem key={r.code} value={r.code}>
                          {r.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select onValueChange={(v) => addScope(`user:${v}`)}>
                    <SelectTrigger>
                      <SelectValue placeholder="＋指定人員" />
                    </SelectTrigger>
                    <SelectContent>
                      {emps.map((e) => (
                        <SelectItem key={e.id} value={e.id}>
                          {e.name}（{e.emp_no}）
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1">
                <Label>門檻參數（JSON）</Label>
                <Textarea
                  value={form.paramsText}
                  onChange={(e) => setForm({ ...form, paramsText: e.target.value })}
                  className="font-mono text-xs min-h-[64px]"
                  placeholder='{"days_before":3}'
                />
              </div>
              <div className="grid grid-cols-3 gap-3 items-end">
                <label className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={form.in_app_enabled}
                    onCheckedChange={(v) => setForm({ ...form, in_app_enabled: v })}
                  />
                  站內通知
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={form.line_enabled}
                    onCheckedChange={(v) => setForm({ ...form, line_enabled: v })}
                  />
                  LINE 推播
                </label>
                <div className="space-y-1">
                  <Label>LINE 方式</Label>
                  <Select
                    value={form.line_mode}
                    onValueChange={(v) => setForm({ ...form, line_mode: v as Rule["line_mode"] })}
                    disabled={!form.line_enabled}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="immediate">即時</SelectItem>
                      <SelectItem value="digest">每日 08:00 彙整</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={form.is_enabled}
                  onCheckedChange={(v) => setForm({ ...form, is_enabled: v })}
                />
                啟用此規則
              </label>
            </div>
          )}
          <DialogFooter>
            <Button onClick={save}>儲存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
