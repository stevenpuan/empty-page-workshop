import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Building2 } from "lucide-react";
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

export const Route = createFileRoute("/dashboard/vendors")({
  head: () => ({
    meta: [
      { title: "廠商管理" },
      { name: "description", content: "廠商主檔管理" },
      { property: "og:title", content: "廠商管理" },
      { property: "og:description", content: "廠商主檔管理" },
    ],
  }),
  component: () => (
    <RequirePerm module="vendors">
      <Page />
    </RequirePerm>
  ),
});

interface Vendor {
  id: string;
  vendor_code: string;
  name: string;
  tax_id: string | null;
  vendor_type: string;
  contact: string | null;
  phone: string | null;
  payment_term: string;
  bank_account: string | null;
  is_outsource: boolean;
  note: string | null;
  is_active: boolean;
}
type Draft = Partial<Vendor>;

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

const VENDOR_TYPES: ReadonlyArray<string> = [
  "紙材",
  "油墨版材",
  "外包印刷",
  "後加工",
  "設備耗材",
  "其他",
];

const blank = (): Draft => ({
  vendor_code: "",
  name: "",
  tax_id: "",
  vendor_type: "其他",
  contact: "",
  phone: "",
  payment_term: "cash",
  bank_account: "",
  is_outsource: false,
  note: "",
  is_active: true,
});

function Page() {
  const { can, company } = useAuth();
  const qc = useQueryClient();
  const canCreate = can("vendors", "create");
  const canEdit = can("vendors", "edit");

  const {
    data: rows = [],
    isLoading,
    error: loadErr,
  } = useQuery({
    queryKey: ["vendors", company?.id],
    enabled: !!company?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vendors")
        .select(
          "id, vendor_code, name, tax_id, vendor_type, contact, phone, payment_term, bank_account, is_outsource, note, is_active",
        )
        .order("vendor_code");
      if (error) throw error;
      return data as Vendor[];
    },
  });
  const reload = () => qc.invalidateQueries({ queryKey: ["vendors", company?.id] });

  // ---- 新增／編輯 ----
  const [form, setForm] = useState<Draft | null>(null);
  const isNew = !!form && !form.id;
  const save = async () => {
    if (!form || !company) return;
    if (!form.vendor_code?.trim() || !form.name?.trim()) {
      toast.error("廠商代碼、名稱為必填");
      return;
    }
    const payload = {
      company_id: company.id,
      vendor_code: form.vendor_code.trim(),
      name: form.name.trim(),
      tax_id: form.tax_id?.trim() || null,
      vendor_type: form.vendor_type || "其他",
      contact: form.contact?.trim() || null,
      phone: form.phone?.trim() || null,
      payment_term: form.payment_term || "cash",
      bank_account: form.bank_account?.trim() || null,
      is_outsource: !!form.is_outsource,
      note: form.note?.trim() || null,
      is_active: form.is_active ?? true,
    };
    const res = form.id
      ? await supabase.from("vendors").update(payload).eq("id", form.id).select("id")
      : await supabase.from("vendors").insert(payload).select("id");
    if (res.error) {
      toast.error(humanizeError(res.error, isNew ? "新增廠商" : "更新廠商"));
      return;
    }
    if (!res.data?.length) {
      toast.error("沒有寫入任何資料（可能沒有權限），請重新整理後再試");
      return;
    }
    toast.success(isNew ? "已新增廠商" : "已更新");
    setForm(null);
    reload();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="廠商管理"
        description="廠商主檔：代碼、類型、聯絡資訊、付款條件與外包廠標記。點擊列可編輯；廠商不刪除，改為停用。"
        actions={
          canCreate ? (
            <Button onClick={() => setForm(blank())}>
              <Building2 className="w-4 h-4 mr-1" />
              新增廠商
            </Button>
          ) : undefined
        }
      />
      {loadErr && <p className="text-sm text-destructive">{humanizeError(loadErr, "載入廠商")}</p>}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>廠商代碼</TableHead>
                <TableHead>名稱</TableHead>
                <TableHead>廠商類型</TableHead>
                <TableHead>聯絡人</TableHead>
                <TableHead>電話</TableHead>
                <TableHead>付款條件</TableHead>
                <TableHead>外包廠</TableHead>
                <TableHead>狀態</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    載入中…
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    尚無廠商，請按「新增廠商」
                  </TableCell>
                </TableRow>
              )}
              {rows.map((v) => (
                <TableRow
                  key={v.id}
                  className={`${canEdit ? "cursor-pointer" : ""} ${!v.is_active ? "opacity-60" : ""}`}
                  onClick={() => canEdit && setForm({ ...v })}
                >
                  <TableCell className="font-mono text-sm">{v.vendor_code}</TableCell>
                  <TableCell className="font-medium">
                    {v.name}
                    {v.is_outsource && (
                      <Badge variant="outline" className="ml-2 text-xs">
                        外包
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{v.vendor_type}</TableCell>
                  <TableCell className="text-sm">{v.contact ?? "—"}</TableCell>
                  <TableCell className="text-sm">{v.phone ?? "—"}</TableCell>
                  <TableCell className="text-sm">{paymentTermLabel(v.payment_term)}</TableCell>
                  <TableCell className="text-sm">{v.is_outsource ? "是" : "—"}</TableCell>
                  <TableCell>
                    <Badge variant={v.is_active ? "default" : "outline"}>
                      {v.is_active ? "啟用" : "停用"}
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
            <DialogTitle>{isNew ? "新增廠商" : "編輯廠商"}</DialogTitle>
            <DialogDescription>
              廠商不提供刪除；不再往來時請關閉「啟用」改為停用。
            </DialogDescription>
          </DialogHeader>
          {form && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>廠商代碼 *</Label>
                  <Input
                    value={form.vendor_code ?? ""}
                    onChange={(e) => setForm({ ...form, vendor_code: e.target.value })}
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
                  <Label>廠商類型</Label>
                  <Select
                    value={form.vendor_type ?? "其他"}
                    onValueChange={(v) => setForm({ ...form, vendor_type: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {VENDOR_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>聯絡人</Label>
                  <Input
                    value={form.contact ?? ""}
                    onChange={(e) => setForm({ ...form, contact: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>電話</Label>
                  <Input
                    value={form.phone ?? ""}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
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
                <div className="space-y-1">
                  <Label>匯款帳號</Label>
                  <Input
                    value={form.bank_account ?? ""}
                    onChange={(e) => setForm({ ...form, bank_account: e.target.value })}
                  />
                </div>
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
                <Label>外包廠商</Label>
                <Switch
                  checked={!!form.is_outsource}
                  onCheckedChange={(v) => setForm({ ...form, is_outsource: v })}
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
