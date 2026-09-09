import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";
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

export const Route = createFileRoute("/dashboard/customers")({
  head: () => ({
    meta: [
      { title: "客戶管理" },
      { name: "description", content: "客戶主檔管理" },
      { property: "og:title", content: "客戶管理" },
      { property: "og:description", content: "客戶主檔管理" },
    ],
  }),
  component: () => (
    <RequirePerm module="customers">
      <Page />
    </RequirePerm>
  ),
});

interface Customer {
  id: string;
  customer_code: string;
  name: string;
  tax_id: string | null;
  contact: string | null;
  phone: string | null;
  address: string | null;
  payment_term: string;
  is_internal_partner: boolean;
  note: string | null;
  is_active: boolean;
}
type Draft = Partial<Customer>;

const PAYMENT_TERMS: ReadonlyArray<readonly [string, string]> = [
  ["cash", "現金"],
  ["net30", "月結30天"],
  ["net60", "月結60天"],
  ["net90", "月結90天"],
  ["monthly_15", "次月15日"],
  ["monthly_end", "次月底"],
];
const paymentTermLabel = (v: string | null | undefined) =>
  PAYMENT_TERMS.find(([k]) => k === v)?.[1] ?? v ?? "—";

const blank = (): Draft => ({
  customer_code: "",
  name: "",
  tax_id: "",
  contact: "",
  phone: "",
  address: "",
  payment_term: "cash",
  is_internal_partner: false,
  note: "",
  is_active: true,
});

function Page() {
  const { can, company } = useAuth();
  const qc = useQueryClient();
  const canCreate = can("customers", "create");
  const canEdit = can("customers", "edit");

  const {
    data: rows = [],
    isLoading,
    error: loadErr,
  } = useQuery({
    queryKey: ["customers", company?.id],
    enabled: !!company?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select(
          "id, customer_code, name, tax_id, contact, phone, address, payment_term, is_internal_partner, note, is_active",
        )
        .order("customer_code");
      if (error) throw error;
      return data as Customer[];
    },
  });
  const reload = () => qc.invalidateQueries({ queryKey: ["customers", company?.id] });

  // ---- 新增／編輯 ----
  const [form, setForm] = useState<Draft | null>(null);
  const isNew = !!form && !form.id;
  const save = async () => {
    if (!form || !company) return;
    if (!form.customer_code?.trim() || !form.name?.trim()) {
      toast.error("客戶代碼、名稱為必填");
      return;
    }
    const payload = {
      company_id: company.id,
      customer_code: form.customer_code.trim(),
      name: form.name.trim(),
      tax_id: form.tax_id?.trim() || null,
      contact: form.contact?.trim() || null,
      phone: form.phone?.trim() || null,
      address: form.address?.trim() || null,
      payment_term: form.payment_term || "cash",
      is_internal_partner: !!form.is_internal_partner,
      note: form.note?.trim() || null,
      is_active: form.is_active ?? true,
    };
    const res = form.id
      ? await supabase.from("customers").update(payload).eq("id", form.id).select("id")
      : await supabase.from("customers").insert(payload).select("id");
    if (res.error) {
      toast.error(humanizeError(res.error, isNew ? "新增客戶" : "更新客戶"));
      return;
    }
    if (!res.data?.length) {
      toast.error("沒有寫入任何資料（可能沒有權限），請重新整理後再試");
      return;
    }
    toast.success(isNew ? "已新增客戶" : "已更新");
    setForm(null);
    reload();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="客戶管理"
        description="客戶主檔：代碼、聯絡資訊、付款條件與集團內部夥伴標記。點擊列可編輯；客戶不刪除，改為停用。"
        actions={
          canCreate ? (
            <Button onClick={() => setForm(blank())}>
              <UserPlus className="w-4 h-4 mr-1" />
              新增客戶
            </Button>
          ) : undefined
        }
      />
      {loadErr && <p className="text-sm text-destructive">{humanizeError(loadErr, "載入客戶")}</p>}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>客戶代碼</TableHead>
                <TableHead>名稱</TableHead>
                <TableHead>聯絡人</TableHead>
                <TableHead>電話</TableHead>
                <TableHead>付款條件</TableHead>
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
                    尚無客戶，請按「新增客戶」
                  </TableCell>
                </TableRow>
              )}
              {rows.map((c) => (
                <TableRow
                  key={c.id}
                  className={`${canEdit ? "cursor-pointer" : ""} ${!c.is_active ? "opacity-60" : ""}`}
                  onClick={() => canEdit && setForm({ ...c })}
                >
                  <TableCell className="font-mono text-sm">{c.customer_code}</TableCell>
                  <TableCell className="font-medium">
                    {c.name}
                    {c.is_internal_partner && (
                      <Badge variant="outline" className="ml-2 text-xs">
                        集團內部
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{c.contact ?? "—"}</TableCell>
                  <TableCell className="text-sm">{c.phone ?? "—"}</TableCell>
                  <TableCell className="text-sm">{paymentTermLabel(c.payment_term)}</TableCell>
                  <TableCell>
                    <Badge variant={c.is_active ? "default" : "outline"}>
                      {c.is_active ? "啟用" : "停用"}
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
            <DialogTitle>{isNew ? "新增客戶" : "編輯客戶"}</DialogTitle>
            <DialogDescription>
              客戶不提供刪除；不再需要時請關閉「啟用」改為停用。
            </DialogDescription>
          </DialogHeader>
          {form && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>客戶代碼 *</Label>
                  <Input
                    value={form.customer_code ?? ""}
                    onChange={(e) => setForm({ ...form, customer_code: e.target.value })}
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
                  <Label>統一編號</Label>
                  <Input
                    value={form.tax_id ?? ""}
                    onChange={(e) => setForm({ ...form, tax_id: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>聯絡人</Label>
                  <Input
                    value={form.contact ?? ""}
                    onChange={(e) => setForm({ ...form, contact: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>電話</Label>
                  <Input
                    value={form.phone ?? ""}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>付款條件</Label>
                  <Select
                    value={form.payment_term ?? "cash"}
                    onValueChange={(v) => setForm({ ...form, payment_term: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAYMENT_TERMS.map(([k, label]) => (
                        <SelectItem key={k} value={k}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1">
                <Label>地址</Label>
                <Input
                  value={form.address ?? ""}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>備註</Label>
                <Textarea
                  value={form.note ?? ""}
                  rows={3}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                />
              </div>
              <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                <Label>集團內部夥伴</Label>
                <Switch
                  checked={!!form.is_internal_partner}
                  onCheckedChange={(v) => setForm({ ...form, is_internal_partner: v })}
                />
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
