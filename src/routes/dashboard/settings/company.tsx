import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { humanizeError } from "@/lib/app-error";
import { themeHex } from "@/lib/theme";
import { RequirePerm } from "@/components/RequirePerm";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

export const Route = createFileRoute("/dashboard/settings/company")({
  component: () => (
    <RequirePerm module="company_settings">
      <Page />
    </RequirePerm>
  ),
});

interface CompanyRow {
  id: string;
  code: string;
  name: string;
  short_name: string | null;
  tax_id: string | null;
  invoice_entity: string | null;
  address: string | null;
  phone: string | null;
  lat: number | null;
  lng: number | null;
  clock_radius_m: number;
  line_channel_key: string | null;
  login_domain: string;
  theme_color: string;
  is_active: boolean;
}
interface Mod {
  module_key: string;
  name: string;
  category: string;
}
interface CM {
  module_key: string;
  is_enabled: boolean;
}
const CATEGORY_LABEL: Record<string, string> = {
  ops: "營運",
  finance: "財務",
  hr: "出勤",
  settings: "設定",
  system: "系統",
};

function Page() {
  const { can, company, refresh } = useAuth();
  const qc = useQueryClient();
  const editable = can("company_settings", "edit");

  const { data: row } = useQuery({
    queryKey: ["company_row", company?.id],
    enabled: !!company?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companies")
        .select("*")
        .eq("id", company!.id)
        .maybeSingle();
      if (error) throw error;
      return data as CompanyRow | null;
    },
  });
  const [form, setForm] = useState<CompanyRow | null>(null);
  useEffect(() => {
    if (row) setForm(row);
  }, [row]);

  const save = async () => {
    if (!form) return;
    if (!form.name.trim()) {
      toast.error("公司名稱必填");
      return;
    }
    const { data, error } = await supabase
      .from("companies")
      .update({
        name: form.name.trim(),
        short_name: form.short_name?.trim() || null,
        tax_id: form.tax_id?.trim() || null,
        invoice_entity: form.invoice_entity?.trim() || null,
        address: form.address?.trim() || null,
        phone: form.phone?.trim() || null,
        lat: form.lat === null || (form.lat as unknown) === "" ? null : Number(form.lat),
        lng: form.lng === null || (form.lng as unknown) === "" ? null : Number(form.lng),
        clock_radius_m: Number(form.clock_radius_m) || 150,
        line_channel_key: form.line_channel_key?.trim() || null,
        theme_color: form.theme_color,
      })
      .eq("id", form.id)
      .select("id");
    if (error) {
      toast.error(humanizeError(error, "儲存公司設定"));
      return;
    }
    if (!data?.length) {
      toast.error("沒有寫入任何資料（可能沒有權限）");
      return;
    }
    toast.success("已儲存");
    qc.invalidateQueries({ queryKey: ["company_row", company?.id] });
    await refresh();
  };

  // 模組開關
  const { data: mods = [] } = useQuery({
    queryKey: ["module_registry"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("module_registry")
        .select("module_key, name, category")
        .eq("is_active", true)
        .order("sort_order");
      if (error) throw error;
      return data as Mod[];
    },
  });
  const { data: cms = [] } = useQuery({
    queryKey: ["company_modules", company?.id],
    enabled: !!company?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("company_modules")
        .select("module_key, is_enabled")
        .eq("company_id", company!.id);
      if (error) throw error;
      return data as CM[];
    },
  });
  const enabledOf = (k: string) => cms.find((c) => c.module_key === k)?.is_enabled ?? true;
  const toggleModule = async (k: string, v: boolean) => {
    if (!company) return;
    const { data, error } = await supabase
      .from("company_modules")
      .upsert(
        { company_id: company.id, module_key: k, is_enabled: v },
        { onConflict: "company_id,module_key" },
      )
      .select("module_key");
    if (error) {
      toast.error(humanizeError(error, "切換模組"));
      return;
    }
    if (!data?.length) {
      toast.error("沒有寫入任何資料（可能沒有權限）");
      return;
    }
    qc.invalidateQueries({ queryKey: ["company_modules", company.id] });
    await refresh();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="公司設定"
        description={`${company?.name ?? ""}（${company?.code ?? ""}）的基本資料、打卡定位、LINE 頻道與模組開關。每家公司各自一套。`}
        actions={editable && form ? <Button onClick={save}>儲存</Button> : undefined}
      />
      {form && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">基本資料</CardTitle>
              <CardDescription>統編與開票主體會印在出貨單／對帳單上。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-[80px_1fr] gap-3">
                <div className="space-y-1">
                  <Label>代碼</Label>
                  <Input value={form.code} disabled />
                </div>
                <div className="space-y-1">
                  <Label>公司名稱</Label>
                  <Input
                    value={form.name}
                    disabled={!editable}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>簡稱</Label>
                  <Input
                    value={form.short_name ?? ""}
                    disabled={!editable}
                    onChange={(e) => setForm({ ...form, short_name: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>統一編號</Label>
                  <Input
                    value={form.tax_id ?? ""}
                    disabled={!editable}
                    onChange={(e) => setForm({ ...form, tax_id: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label>開票主體</Label>
                <Input
                  value={form.invoice_entity ?? ""}
                  disabled={!editable}
                  onChange={(e) => setForm({ ...form, invoice_entity: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>地址</Label>
                <Input
                  value={form.address ?? ""}
                  disabled={!editable}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>電話</Label>
                  <Input
                    value={form.phone ?? ""}
                    disabled={!editable}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>主題色</Label>
                  <Select
                    value={form.theme_color}
                    onValueChange={(v) => setForm({ ...form, theme_color: v })}
                    disabled={!editable}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {["cyan", "orange", "green", "violet"].map((c) => (
                        <SelectItem key={c} value={c}>
                          <span
                            className="inline-block w-2.5 h-2.5 rounded-full mr-2"
                            style={{ background: themeHex(c) }}
                          />
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">打卡定位與登入</CardTitle>
              <CardDescription>
                GPS 打卡以此座標為圓心；後端會重算距離，前端傳來的距離不可信。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label>緯度 lat</Label>
                  <Input
                    type="number"
                    step="any"
                    value={form.lat ?? ""}
                    disabled={!editable}
                    onChange={(e) => setForm({ ...form, lat: e.target.value as unknown as number })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>經度 lng</Label>
                  <Input
                    type="number"
                    step="any"
                    value={form.lng ?? ""}
                    disabled={!editable}
                    onChange={(e) => setForm({ ...form, lng: e.target.value as unknown as number })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>半徑（m）</Label>
                  <Input
                    type="number"
                    value={form.clock_radius_m}
                    disabled={!editable}
                    onChange={(e) =>
                      setForm({ ...form, clock_radius_m: parseInt(e.target.value || "150", 10) })
                    }
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>登入網域</Label>
                  <Input value={form.login_domain} disabled />
                  <p className="text-[11px] text-muted-foreground">
                    員工帳號＝員工編號@此網域；變更需系統維護者處理
                  </p>
                </div>
                <div className="space-y-1">
                  <Label>LINE 頻道鍵</Label>
                  <Input
                    value={form.line_channel_key ?? ""}
                    disabled={!editable}
                    onChange={(e) => setForm({ ...form, line_channel_key: e.target.value })}
                    placeholder="XX"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    對應 Secret <code>LINE_CHANNEL_TOKEN_{form.line_channel_key || "XX"}</code>
                    ，token 本身不存資料庫
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">模組開關</CardTitle>
          <CardDescription>
            關閉的模組不會出現在本公司任何人的選單與路由（例：沂融不需要報價單）。系統類模組建議維持開啟。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {Array.from(new Set(mods.map((m) => m.category))).map((cat) => (
            <div key={cat}>
              <div className="text-xs font-semibold text-muted-foreground mb-2">
                {CATEGORY_LABEL[cat] ?? cat}
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {mods
                  .filter((m) => m.category === cat)
                  .map((m) => (
                    <label
                      key={m.module_key}
                      className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
                    >
                      <span className="min-w-0">
                        <span className="font-medium">{m.name}</span>
                        <span className="ml-2 text-xs font-mono text-muted-foreground">
                          {m.module_key}
                        </span>
                      </span>
                      {editable ? (
                        <Switch
                          checked={enabledOf(m.module_key)}
                          onCheckedChange={(v) => toggleModule(m.module_key, v)}
                        />
                      ) : (
                        <Badge variant={enabledOf(m.module_key) ? "default" : "outline"}>
                          {enabledOf(m.module_key) ? "啟用" : "關閉"}
                        </Badge>
                      )}
                    </label>
                  ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
