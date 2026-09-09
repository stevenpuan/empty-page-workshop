import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { humanizeError } from "@/lib/app-error";
import type { LookupRow } from "@/lib/lookups";
import { RequirePerm } from "@/components/RequirePerm";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export const Route = createFileRoute("/dashboard/settings/lookups")({
  component: () => (
    <RequirePerm module="lookups">
      <Page />
    </RequirePerm>
  ),
});

// 哪些類別真的被程式讀（沿用 EIP 的誠實標示）。未列出的類別代表尚無消費端。
const CATEGORY_NOTE: Record<string, { label: string; used: boolean; note: string }> = {
  payment_term: {
    label: "付款條件",
    used: true,
    note: "廠商／客戶主檔下拉；到期日計算函式只認得既有 code，新增 code 前請先調整 calc_due_date()",
  },
  payment_method: { label: "付款方式", used: true, note: "收款／付款單下拉（S5）" },
  tax_type: { label: "稅別", used: true, note: "進貨單下拉（S5）；meta.rate 為稅率" },
  unit: { label: "單位", used: true, note: "訂單／進貨明細下拉（S2、S5）" },
  vendor_type: { label: "廠商類型", used: true, note: "廠商主檔下拉（S5）" },
  product_category: { label: "品項分類", used: true, note: "品項主檔與工序範本對應（S2）" },
  position: { label: "職稱", used: true, note: "員工與帳號頁下拉" },
  blocked_reason: { label: "卡關原因", used: true, note: "派工看板卡關時的常用原因（S3）" },
  changelog_type: { label: "版本類型", used: true, note: "版本更新頁" },
};

function Page() {
  const { can, company, isPlatformAdmin } = useAuth();
  const qc = useQueryClient();
  const canEdit = can("lookups", "edit");

  const { data: rows = [] } = useQuery({
    queryKey: ["lookups_all", company?.id],
    enabled: !!company?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lookups")
        .select("*")
        .order("category")
        .order("sort_order");
      if (error) throw error;
      return data as LookupRow[];
    },
  });
  const reload = () => {
    qc.invalidateQueries({ queryKey: ["lookups_all", company?.id] });
    qc.invalidateQueries({ queryKey: ["lookups"] });
  };

  const [form, setForm] = useState<Partial<LookupRow> | null>(null);
  const isNew = !!form && !form.id;
  const save = async () => {
    if (!form) return;
    if (!form.category?.trim() || !form.code?.trim() || !form.label?.trim()) {
      toast.error("請填寫類別、代碼、標籤");
      return;
    }
    let meta: Record<string, unknown> | null = null;
    if (
      typeof (form as { metaText?: string }).metaText === "string" &&
      (form as { metaText?: string }).metaText!.trim()
    ) {
      try {
        meta = JSON.parse((form as { metaText?: string }).metaText!);
      } catch {
        {
          toast.error("meta 不是合法 JSON");
          return;
        }
      }
    } else meta = form.meta ?? null;
    const payload = {
      company_id: form.company_id ?? null,
      category: form.category.trim(),
      code: form.code.trim(),
      label: form.label.trim(),
      sort_order: form.sort_order ?? 10,
      is_active: form.is_active ?? true,
      meta,
    };
    const res = form.id
      ? await supabase
          .from("lookups")
          .update({
            label: payload.label,
            sort_order: payload.sort_order,
            is_active: payload.is_active,
            meta,
          })
          .eq("id", form.id)
          .select("id")
      : await supabase.from("lookups").insert(payload).select("id");
    if (res.error) {
      toast.error(humanizeError(res.error, isNew ? "新增代碼" : "更新代碼"));
      return;
    }
    if (!res.data?.length) {
      toast.error("沒有寫入任何資料（可能沒有權限）");
      return;
    }
    toast.success(isNew ? "已新增" : "已更新");
    setForm(null);
    reload();
  };
  const del = async (r: LookupRow) => {
    if (!confirm(`確定刪除「${r.label}」？已被歷史資料引用的代碼建議改為停用而非刪除。`)) return;
    const { data, error } = await supabase.from("lookups").delete().eq("id", r.id).select("id");
    if (error) {
      toast.error(humanizeError(error, "刪除代碼"));
      return;
    }
    if (!data?.length) {
      toast.error("沒有刪除任何資料（可能沒有權限）");
      return;
    }
    toast.success("已刪除");
    reload();
  };

  const Section = ({ scope }: { scope: "shared" | "company" }) => {
    const list = rows.filter((r) =>
      scope === "shared" ? r.company_id === null : r.company_id !== null,
    );
    const canWrite = canEdit && (scope === "company" || isPlatformAdmin);
    const categories = Array.from(new Set(list.map((r) => r.category)));
    return (
      <div className="space-y-4 mt-4">
        <div className="flex justify-between items-center">
          <p className="text-sm text-muted-foreground">
            {scope === "shared"
              ? "共用字典：兩家公司都看得到；只有系統維護者可改。本公司同 code 的列會覆蓋共用列。"
              : "本公司字典：只有本公司看得到，可自由增減。"}
          </p>
          {canWrite && (
            <Button
              onClick={() =>
                setForm({
                  company_id: scope === "company" ? (company?.id ?? null) : null,
                  category: "",
                  code: "",
                  label: "",
                  sort_order: 10,
                  is_active: true,
                })
              }
            >
              新增代碼
            </Button>
          )}
        </div>
        {list.length === 0 && (
          <p className="text-sm text-muted-foreground py-6 text-center">尚無代碼</p>
        )}
        {categories.map((cat) => (
          <Card key={cat}>
            <CardHeader className="space-y-1">
              <CardTitle className="text-base">
                {CATEGORY_NOTE[cat]?.label ?? cat}
                <span className="ml-2 text-xs font-mono text-muted-foreground">{cat}</span>
              </CardTitle>
              <p
                className={
                  "text-xs " +
                  (CATEGORY_NOTE[cat]?.used === false
                    ? "text-destructive"
                    : "text-muted-foreground")
                }
              >
                {CATEGORY_NOTE[cat]
                  ? (CATEGORY_NOTE[cat].used ? "" : "⚠ ") + CATEGORY_NOTE[cat].note
                  : "⚠ 尚無程式讀取此類別"}
              </p>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>代碼</TableHead>
                    <TableHead>標籤</TableHead>
                    <TableHead>排序</TableHead>
                    <TableHead>meta</TableHead>
                    <TableHead>狀態</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list
                    .filter((r) => r.category === cat)
                    .map((r) => (
                      <TableRow key={r.id} className={r.is_active ? "" : "opacity-60"}>
                        <TableCell className="font-mono text-sm">{r.code}</TableCell>
                        <TableCell>{r.label}</TableCell>
                        <TableCell>{r.sort_order}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {r.meta ? JSON.stringify(r.meta) : "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={r.is_active ? "default" : "outline"}>
                            {r.is_active ? "啟用" : "停用"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right space-x-2 whitespace-nowrap">
                          {canWrite && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                setForm({
                                  ...r,
                                  ...({ metaText: r.meta ? JSON.stringify(r.meta) : "" } as object),
                                })
                              }
                            >
                              編輯
                            </Button>
                          )}
                          {canWrite && (
                            <Button size="sm" variant="outline" onClick={() => del(r)}>
                              刪除
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
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="代碼字典"
        description="下拉選項集中維護。狀態機（工序狀態、單據狀態）不在這裡——那些寫在資料庫 CHECK 約束裡，改了字典不會生效。"
      />
      <Tabs defaultValue="company">
        <TabsList>
          <TabsTrigger value="company">本公司</TabsTrigger>
          <TabsTrigger value="shared">共用</TabsTrigger>
        </TabsList>
        <TabsContent value="company">
          <Section scope="company" />
        </TabsContent>
        <TabsContent value="shared">
          <Section scope="shared" />
        </TabsContent>
      </Tabs>

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isNew ? "新增代碼" : "編輯代碼"}</DialogTitle>
            <DialogDescription>{form?.company_id ? "本公司字典" : "共用字典"}</DialogDescription>
          </DialogHeader>
          {form && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>類別 category</Label>
                  <Input
                    value={form.category ?? ""}
                    disabled={!isNew}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    placeholder="vendor_type"
                  />
                </div>
                <div className="space-y-1">
                  <Label>代碼 code</Label>
                  <Input
                    value={form.code ?? ""}
                    disabled={!isNew}
                    onChange={(e) => setForm({ ...form, code: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label>標籤 label</Label>
                <Input
                  value={form.label ?? ""}
                  onChange={(e) => setForm({ ...form, label: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>排序</Label>
                  <Input
                    type="number"
                    value={form.sort_order ?? 10}
                    onChange={(e) =>
                      setForm({ ...form, sort_order: parseInt(e.target.value || "0", 10) })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label>meta（JSON，選填）</Label>
                  <Input
                    value={(form as { metaText?: string }).metaText ?? ""}
                    onChange={(e) =>
                      setForm({ ...form, ...({ metaText: e.target.value } as object) })
                    }
                    placeholder='{"days":30}'
                    className="font-mono text-xs"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={form.is_active ?? true}
                  onCheckedChange={(v) => setForm({ ...form, is_active: v })}
                />
                啟用
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
