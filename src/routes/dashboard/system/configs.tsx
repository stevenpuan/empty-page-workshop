import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { humanizeError } from "@/lib/app-error";
import { RequirePerm } from "@/components/RequirePerm";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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

export const Route = createFileRoute("/dashboard/system/configs")({
  component: () => (
    <RequirePerm module="system_configs">
      <Page />
    </RequirePerm>
  ),
});

type ValueType = "string" | "int" | "numeric" | "bool" | "json" | "time";
interface Config {
  id: string;
  company_id: string | null;
  key: string;
  value: string | null;
  value_type: ValueType;
  group_name: string | null;
  description: string | null;
  is_secret: boolean;
}
const EMPTY: Config[] = [];
const TYPES: ValueType[] = ["string", "int", "numeric", "bool", "json", "time"];

function validate(v: string, t: ValueType): string | null {
  if (v === "") return null;
  if (t === "int" && !/^-?\d+$/.test(v)) return "必須是整數";
  if (t === "numeric" && Number.isNaN(Number(v))) return "必須是數字";
  if (t === "bool" && !/^(true|false)$/.test(v)) return "必須是 true／false";
  if (t === "time" && !/^\d{2}:\d{2}$/.test(v)) return "格式 HH:MM";
  if (t === "json") {
    try {
      JSON.parse(v);
    } catch {
      return "不是合法的 JSON";
    }
  }
  return null;
}

function Page() {
  const { can, company, isPlatformAdmin } = useAuth();
  const qc = useQueryClient();
  const editable = can("system_configs", "edit");

  const { data: rowsData } = useQuery({
    queryKey: ["system_configs", company?.id],
    enabled: !!company?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("system_configs")
        .select("*")
        .order("group_name")
        .order("key");
      if (error) throw error;
      return data as Config[];
    },
  });
  const rows = rowsData ?? EMPTY;
  const [draft, setDraft] = useState<Record<string, string>>({});
  useEffect(() => {
    const m: Record<string, string> = {};
    rows.forEach((r) => (m[r.id] = r.value ?? ""));
    setDraft(m);
  }, [rows]);

  const save = async (scope: "global" | "company") => {
    const target = rows.filter((r) =>
      scope === "global" ? r.company_id === null : r.company_id !== null,
    );
    const changed = target.filter((r) => (draft[r.id] ?? "") !== (r.value ?? ""));
    if (!changed.length) {
      toast.info("沒有變更");
      return;
    }
    for (const r of changed) {
      const err = validate(draft[r.id] ?? "", r.value_type);
      if (err) {
        toast.error(`${r.description ?? r.key}：${err}`);
        return;
      }
    }
    const results = await Promise.all(
      changed.map((r) =>
        supabase.from("system_configs").update({ value: draft[r.id] }).eq("id", r.id).select("id"),
      ),
    );
    const failed = results.find((x) => x.error);
    if (failed?.error) {
      toast.error(humanizeError(failed.error, "儲存參數"));
      return;
    }
    const blocked = results.filter((x) => !x.data?.length).length;
    if (blocked) {
      toast.error(`有 ${blocked} 筆沒有寫入（可能沒有權限）`);
      return;
    }
    toast.success("已儲存");
    qc.invalidateQueries({ queryKey: ["system_configs", company?.id] });
  };

  // 新增本公司覆寫／新參數
  const [form, setForm] = useState<Partial<Config> | null>(null);
  const create = async () => {
    if (!form?.key?.trim()) {
      toast.error("請填寫參數鍵");
      return;
    }
    const err = validate(form.value ?? "", (form.value_type as ValueType) ?? "string");
    if (err) {
      toast.error(err);
      return;
    }
    const { data, error } = await supabase
      .from("system_configs")
      .insert({
        company_id: form.company_id ?? null,
        key: form.key.trim(),
        value: form.value ?? null,
        value_type: form.value_type ?? "string",
        group_name: form.group_name || null,
        description: form.description || null,
        is_secret: !!form.is_secret,
      })
      .select("id");
    if (error) {
      toast.error(humanizeError(error, "新增參數"));
      return;
    }
    if (!data?.length) {
      toast.error("沒有寫入任何資料（可能沒有權限）");
      return;
    }
    toast.success("已新增");
    setForm(null);
    qc.invalidateQueries({ queryKey: ["system_configs", company?.id] });
  };

  const Section = ({ scope }: { scope: "global" | "company" }) => {
    const list = rows.filter((r) =>
      scope === "global" ? r.company_id === null : r.company_id !== null,
    );
    const canWrite = editable && (scope === "company" || isPlatformAdmin);
    const groups = Array.from(new Set(list.map((r) => r.group_name ?? "其他")));
    return (
      <div className="space-y-4 mt-4">
        <div className="flex justify-between items-center">
          <p className="text-sm text-muted-foreground">
            {scope === "global"
              ? "全系統參數：兩家公司共用；只有系統維護者可改。"
              : `本公司參數：優先於全系統參數（get_config 先找公司層）。`}
          </p>
          <div className="flex gap-2">
            {canWrite && (
              <Button
                variant="outline"
                onClick={() =>
                  setForm({
                    company_id: scope === "company" ? (company?.id ?? null) : null,
                    value_type: "string",
                    value: "",
                  })
                }
              >
                新增
              </Button>
            )}
            {canWrite && <Button onClick={() => save(scope)}>儲存</Button>}
          </div>
        </div>
        {list.length === 0 && (
          <p className="text-sm text-muted-foreground py-6 text-center">尚無參數</p>
        )}
        {groups.map((g) => (
          <Card key={g}>
            <CardHeader>
              <CardTitle className="text-base">{g}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {list
                .filter((r) => (r.group_name ?? "其他") === g)
                .map((r) => (
                  <div
                    key={r.id}
                    className="grid gap-1 sm:grid-cols-[240px_1fr] sm:items-center sm:gap-4"
                  >
                    <div>
                      <Label className="text-sm">{r.description ?? r.key}</Label>
                      <div className="text-xs text-muted-foreground font-mono flex items-center gap-1.5">
                        {r.key}
                        <Badge variant="outline" className="text-[10px] px-1 py-0">
                          {r.value_type}
                        </Badge>
                        {r.is_secret && (
                          <Badge variant="secondary" className="text-[10px] px-1 py-0">
                            secret
                          </Badge>
                        )}
                      </div>
                    </div>
                    <ValueInput
                      type={r.value_type}
                      value={draft[r.id] ?? ""}
                      disabled={!canWrite}
                      secret={r.is_secret}
                      onChange={(v) => setDraft((d) => ({ ...d, [r.id]: v }))}
                    />
                  </div>
                ))}
            </CardContent>
          </Card>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="系統參數"
        description="key／value 參數，依型別驗證。結構性欄位（統編、座標、LINE 頻道）在「公司設定」；密鑰一律放 Supabase Secrets，不放這裡。"
      />
      <Tabs defaultValue="company">
        <TabsList>
          <TabsTrigger value="company">本公司</TabsTrigger>
          <TabsTrigger value="global">全系統</TabsTrigger>
        </TabsList>
        <TabsContent value="company">
          <Section scope="company" />
        </TabsContent>
        <TabsContent value="global">
          <Section scope="global" />
        </TabsContent>
      </Tabs>

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新增參數</DialogTitle>
            <DialogDescription>
              {form?.company_id ? "本公司參數（會覆蓋同 key 的全系統值）" : "全系統參數"}
            </DialogDescription>
          </DialogHeader>
          {form && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>參數鍵 key</Label>
                <Input
                  value={form.key ?? ""}
                  onChange={(e) => setForm({ ...form, key: e.target.value })}
                  placeholder="notify.line_digest_time"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>型別</Label>
                  <Select
                    value={form.value_type ?? "string"}
                    onValueChange={(v) => setForm({ ...form, value_type: v as ValueType })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>分組</Label>
                  <Input
                    value={form.group_name ?? ""}
                    onChange={(e) => setForm({ ...form, group_name: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label>說明</Label>
                <Input
                  value={form.description ?? ""}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>值</Label>
                <ValueInput
                  type={(form.value_type as ValueType) ?? "string"}
                  value={form.value ?? ""}
                  onChange={(v) => setForm({ ...form, value: v })}
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={!!form.is_secret}
                  onCheckedChange={(v) => setForm({ ...form, is_secret: v })}
                />
                敏感值（畫面遮罩）
              </label>
            </div>
          )}
          <DialogFooter>
            <Button onClick={create}>新增</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ValueInput({
  type,
  value,
  onChange,
  disabled,
  secret,
}: {
  type: ValueType;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  secret?: boolean;
}) {
  if (type === "bool") {
    return (
      <label className="flex items-center gap-2 text-sm">
        <Switch
          checked={value === "true"}
          disabled={disabled}
          onCheckedChange={(v) => onChange(v ? "true" : "false")}
        />
        {value === "true" ? "true" : "false"}
      </label>
    );
  }
  if (type === "json")
    return (
      <Textarea
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="font-mono text-xs min-h-[80px]"
      />
    );
  if (type === "time")
    return (
      <Input
        type="time"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="w-40"
      />
    );
  if (type === "int" || type === "numeric")
    return (
      <Input
        type="number"
        step={type === "int" ? 1 : "any"}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="w-48"
      />
    );
  return (
    <Input
      type={secret ? "password" : "text"}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
