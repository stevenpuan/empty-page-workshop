import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { PackagePlus } from "lucide-react";
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

export const Route = createFileRoute("/dashboard/products")({
  head: () => ({
    meta: [
      { title: "品項管理" },
      { name: "description", content: "品項主檔管理" },
      { property: "og:title", content: "品項管理" },
      { property: "og:description", content: "品項主檔管理" },
    ],
  }),
  component: () => (
    <RequirePerm module="products">
      <Page />
    </RequirePerm>
  ),
});

interface Product {
  id: string;
  product_code: string;
  name: string;
  category: string;
  spec_template: string | null;
  unit: string;
  default_routing_template_id: string | null;
  is_active: boolean;
  routing_templates: { name: string } | null;
}
interface Template {
  id: string;
  name: string;
  product_category: string | null;
}
type Draft = Partial<Product>;

const CATEGORIES: ReadonlyArray<readonly [string, string]> = [
  ["business_card", "名片"],
  ["banner", "布條帆布"],
  ["postcard_dm", "明信片DM"],
  ["pure_print", "純代印"],
  ["paper_box", "紙盒"],
  ["sticker", "貼紙"],
  ["other", "其他"],
];
const categoryLabel = (v: string | null | undefined) =>
  CATEGORIES.find(([k]) => k === v)?.[1] ?? v ?? "—";

const blank = (): Draft => ({
  product_code: "",
  name: "",
  category: "other",
  spec_template: "",
  unit: "張",
  default_routing_template_id: null,
  is_active: true,
});

function Page() {
  const { can, company } = useAuth();
  const qc = useQueryClient();
  const canCreate = can("products", "create");
  const canEdit = can("products", "edit");

  const {
    data: rows = [],
    isLoading,
    error: loadErr,
  } = useQuery({
    queryKey: ["products", company?.id],
    enabled: !!company?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select(
          "id, product_code, name, category, spec_template, unit, default_routing_template_id, is_active, routing_templates:default_routing_template_id(name)",
        )
        .order("product_code");
      if (error) throw error;
      return data as unknown as Product[];
    },
  });
  const { data: templates = [] } = useQuery({
    queryKey: ["routing_templates_active", company?.id],
    enabled: !!company?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("routing_templates")
        .select("id, name, product_category")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data as Template[];
    },
  });
  const reload = () => qc.invalidateQueries({ queryKey: ["products", company?.id] });

  // ---- 新增／編輯 ----
  const [form, setForm] = useState<Draft | null>(null);
  const isNew = !!form && !form.id;
  const filteredTemplates = form?.category
    ? templates.filter((t) => !t.product_category || t.product_category === form.category)
    : templates;

  const save = async () => {
    if (!form || !company) return;
    if (!form.product_code?.trim() || !form.name?.trim()) {
      toast.error("品項代碼、名稱為必填");
      return;
    }
    const payload = {
      company_id: company.id,
      product_code: form.product_code.trim(),
      name: form.name.trim(),
      category: form.category || "other",
      spec_template: form.spec_template?.trim() || null,
      unit: form.unit?.trim() || "張",
      default_routing_template_id: form.default_routing_template_id || null,
      is_active: form.is_active ?? true,
    };
    const res = form.id
      ? await supabase.from("products").update(payload).eq("id", form.id).select("id")
      : await supabase.from("products").insert(payload).select("id");
    if (res.error) {
      toast.error(humanizeError(res.error, isNew ? "新增品項" : "更新品項"));
      return;
    }
    if (!res.data?.length) {
      toast.error("沒有寫入任何資料（可能沒有權限），請重新整理後再試");
      return;
    }
    toast.success(isNew ? "已新增品項" : "已更新");
    setForm(null);
    reload();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="品項管理"
        description="品項主檔：代碼、類別、單位與預設工序範本。點擊列可編輯；品項不刪除，改為停用。"
        actions={
          canCreate ? (
            <Button onClick={() => setForm(blank())}>
              <PackagePlus className="w-4 h-4 mr-1" />
              新增品項
            </Button>
          ) : undefined
        }
      />
      {loadErr && <p className="text-sm text-destructive">{humanizeError(loadErr, "載入品項")}</p>}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>品項代碼</TableHead>
                <TableHead>名稱</TableHead>
                <TableHead>品項類別</TableHead>
                <TableHead>單位</TableHead>
                <TableHead>預設工序範本</TableHead>
                <TableHead>狀態</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    載入中…
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    尚無品項，請按「新增品項」
                  </TableCell>
                </TableRow>
              )}
              {rows.map((p) => (
                <TableRow
                  key={p.id}
                  className={`${canEdit ? "cursor-pointer" : ""} ${!p.is_active ? "opacity-60" : ""}`}
                  onClick={() => canEdit && setForm({ ...p })}
                >
                  <TableCell className="font-mono text-sm">{p.product_code}</TableCell>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell className="text-sm">{categoryLabel(p.category)}</TableCell>
                  <TableCell className="text-sm">{p.unit}</TableCell>
                  <TableCell className="text-sm">{p.routing_templates?.name ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={p.is_active ? "default" : "outline"}>
                      {p.is_active ? "啟用" : "停用"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* 新增／編輯 */}
      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isNew ? "新增品項" : "編輯品項"}</DialogTitle>
            <DialogDescription>
              品項不提供刪除；不再需要時請關閉「啟用」改為停用。
            </DialogDescription>
          </DialogHeader>
          {form && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>品項代碼 *</Label>
                  <Input
                    value={form.product_code ?? ""}
                    onChange={(e) => setForm({ ...form, product_code: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>名稱 *</Label>
                  <Input
                    value={form.name ?? ""}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>品項類別</Label>
                  <Select
                    value={form.category ?? "other"}
                    onValueChange={(v) =>
                      setForm({
                        ...form,
                        category: v,
                        default_routing_template_id: null,
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map(([k, label]) => (
                        <SelectItem key={k} value={k}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>單位</Label>
                  <Input
                    value={form.unit ?? ""}
                    onChange={(e) => setForm({ ...form, unit: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label>規格範本</Label>
                <Textarea
                  value={form.spec_template ?? ""}
                  rows={2}
                  placeholder="例：300P 銅西雙面四色 上霧P"
                  onChange={(e) => setForm({ ...form, spec_template: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>預設工序範本</Label>
                <Select
                  value={form.default_routing_template_id ?? "none"}
                  onValueChange={(v) =>
                    setForm({ ...form, default_routing_template_id: v === "none" ? null : v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="未指定" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">未指定</SelectItem>
                    {filteredTemplates.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.product_category ? `${categoryLabel(t.product_category)}｜` : ""}
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                <Label>啟用</Label>
                <Switch
                  checked={form.is_active ?? true}
                  onCheckedChange={(v) => setForm({ ...form, is_active: v })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>
              取消
            </Button>
            <Button onClick={save}>{isNew ? "新增" : "儲存"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
