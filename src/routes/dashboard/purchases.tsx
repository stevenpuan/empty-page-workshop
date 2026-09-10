import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, FileText } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { humanizeError } from "@/lib/app-error";
import { taipeiToday, fmtDate, formatTWD } from "@/lib/dates";
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

export const Route = createFileRoute("/dashboard/purchases")({
  head: () => ({
    meta: [
      { title: "進貨單" },
      { name: "description", content: "進貨單管理：採購明細、稅額計算、確認與作廢" },
      { property: "og:title", content: "進貨單" },
      { property: "og:description", content: "進貨單管理：採購明細、稅額計算、確認與作廢" },
    ],
  }),
  component: () => (
    <RequirePerm module="purchases">
      <Page />
    </RequirePerm>
  ),
});

interface PurchaseItem {
  id?: string;
  purchase_id?: string;
  item_name: string;
  spec: string | null;
  qty: number;
  unit: string | null;
  unit_price: number;
  amount: number;
  is_stocked: boolean;
}
interface Purchase {
  id: string;
  company_id: string;
  purchase_no: string;
  vendor_id: string | null;
  purchase_date: string;
  source_type: string;
  order_id: string | null;
  invoice_no: string | null;
  invoice_date: string | null;
  tax_type: string;
  subtotal: number;
  tax_amount: number;
  total: number;
  status: string;
  vendor?: { name: string; vendor_code: string } | null;
  items?: PurchaseItem[];
}
type Draft = {
  id?: string;
  vendor_id: string;
  purchase_date: string;
  source_type: string;
  order_id: string | null;
  invoice_no: string;
  invoice_date: string;
  tax_type: string;
  items: PurchaseItem[];
};

const SOURCE_LABEL: Record<string, string> = { stock: "庫存補貨", direct: "直接採購" };
const TAX_LABEL: Record<string, string> = { taxable: "應稅", zero: "零稅率", exempt: "免稅" };
const STATUS_LABEL: Record<string, string> = { draft: "草稿", confirmed: "已確認", void: "已作廢" };
const statusVariant = (s: string) =>
  s === "confirmed" ? "default" : s === "void" ? "outline" : "secondary";

const num = (v: unknown) => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};
const blankItem = (): PurchaseItem => ({
  item_name: "",
  spec: "",
  qty: 1,
  unit: "",
  unit_price: 0,
  amount: 0,
  is_stocked: true,
});
const blankDraft = (): Draft => ({
  vendor_id: "",
  purchase_date: taipeiToday(),
  source_type: "stock",
  order_id: null,
  invoice_no: "",
  invoice_date: "",
  tax_type: "taxable",
  items: [blankItem()],
});

function Page() {
  const { can, company } = useAuth();
  const qc = useQueryClient();
  const canCreate = can("purchases", "create");
  const canEdit = can("purchases", "edit");

  const [statusFilter, setStatusFilter] = useState("all");
  const [vendorFilter, setVendorFilter] = useState("all");

  const { data: vendors = [] } = useQuery({
    queryKey: ["vendors_min", company?.id],
    enabled: !!company?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vendors")
        .select("id, name, vendor_code, is_active")
        .order("vendor_code");
      if (error) throw error;
      return data as { id: string; name: string; vendor_code: string; is_active: boolean }[];
    },
  });

  const { data: orders = [] } = useQuery({
    queryKey: ["orders_open", company?.id],
    enabled: !!company?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("id, order_no, item_name, status")
        .neq("status", "completed")
        .order("created_at", { ascending: false })
        .range(0, 199);
      if (error) throw error;
      return data as { id: string; order_no: string; item_name: string | null }[];
    },
  });

  const {
    data: rows = [],
    isLoading,
    error: loadErr,
  } = useQuery({
    queryKey: ["purchases", company?.id],
    enabled: !!company?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchases")
        .select("*, vendor:vendors(name, vendor_code), items:purchase_items(*)")
        .eq("company_id", company!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Purchase[];
    },
  });
  const reload = () => qc.invalidateQueries({ queryKey: ["purchases", company?.id] });

  const filtered = rows.filter(
    (r) =>
      (statusFilter === "all" || r.status === statusFilter) &&
      (vendorFilter === "all" || r.vendor_id === vendorFilter),
  );

  // ---- 表單 ----
  const [form, setForm] = useState<Draft | null>(null);
  const [readonlyDoc, setReadonlyDoc] = useState<Purchase | null>(null);
  const [saving, setSaving] = useState(false);
  const [voidTarget, setVoidTarget] = useState<Purchase | null>(null);
  const isNew = !!form && !form.id;

  const openRow = (p: Purchase) => {
    if (p.status === "draft" && canEdit) {
      setForm({
        id: p.id,
        vendor_id: p.vendor_id ?? "",
        purchase_date: p.purchase_date ?? taipeiToday(),
        source_type: p.source_type ?? "stock",
        order_id: p.order_id,
        invoice_no: p.invoice_no ?? "",
        invoice_date: p.invoice_date ?? "",
        tax_type: p.tax_type ?? "taxable",
        items: (p.items ?? []).length
          ? (p.items ?? []).map((it) => ({
              ...it,
              qty: num(it.qty),
              unit_price: num(it.unit_price),
              amount: num(it.amount),
            }))
          : [blankItem()],
      });
    } else {
      setReadonlyDoc(p);
    }
  };

  const totalsOf = (items: PurchaseItem[], taxType: string) => {
    const subtotal = items.reduce((s, it) => s + num(it.qty) * num(it.unit_price), 0);
    const tax = taxType === "taxable" ? Math.round(subtotal * 0.05) : 0;
    return { subtotal, tax, total: subtotal + tax };
  };
  const totals = form ? totalsOf(form.items, form.tax_type) : { subtotal: 0, tax: 0, total: 0 };

  const setItem = (idx: number, patch: Partial<PurchaseItem>) => {
    if (!form) return;
    const items = form.items.map((it, i) => (i === idx ? { ...it, ...patch } : it));
    setForm({ ...form, items });
  };

  const save = async () => {
    if (!form || !company) return;
    if (!form.vendor_id) {
      toast.error("請選擇廠商");
      return;
    }
    const items = form.items.filter((it) => it.item_name.trim());
    if (!items.length) {
      toast.error("請至少填寫一筆明細");
      return;
    }
    if (form.source_type === "direct" && !form.order_id) {
      toast.error("直接採購請選擇關聯工單");
      return;
    }
    setSaving(true);
    try {
      const t = totalsOf(items, form.tax_type);
      let purchaseId = form.id;

      const header = {
        company_id: company.id,
        vendor_id: form.vendor_id,
        purchase_date: form.purchase_date,
        source_type: form.source_type,
        order_id: form.source_type === "direct" ? form.order_id : null,
        invoice_no: form.invoice_no.trim() || null,
        invoice_date: form.invoice_date || null,
        tax_type: form.tax_type,
        subtotal: t.subtotal,
        tax_amount: t.tax,
        total: t.total,
      };

      if (purchaseId) {
        const res = await supabase
          .from("purchases")
          .update(header)
          .eq("id", purchaseId)
          .select("id");
        if (res.error) throw res.error;
        if (!res.data?.length) throw new Error("沒有寫入任何資料（可能沒有權限）");
        const del = await supabase.from("purchase_items").delete().eq("purchase_id", purchaseId);
        if (del.error) throw del.error;
      } else {
        const noRes = await supabase.rpc("next_doc_no", {
          p_company_id: company.id,
          p_doc_type: "PO",
        });
        if (noRes.error) throw noRes.error;
        const res = await supabase
          .from("purchases")
          .insert({ ...header, purchase_no: noRes.data as string, status: "draft" })
          .select("id");
        if (res.error) throw res.error;
        if (!res.data?.length) throw new Error("沒有寫入任何資料（可能沒有權限）");
        purchaseId = (res.data[0] as { id: string }).id;
      }

      const itemRows = items.map((it) => ({
        purchase_id: purchaseId,
        company_id: company.id,
        item_name: it.item_name.trim(),
        spec: it.spec?.trim() || null,
        qty: num(it.qty),
        unit: it.unit?.trim() || null,
        unit_price: num(it.unit_price),
        amount: num(it.qty) * num(it.unit_price),
        is_stocked: !!it.is_stocked,
      }));
      const insItems = await supabase.from("purchase_items").insert(itemRows).select("id");
      if (insItems.error) throw insItems.error;
      if ((insItems.data ?? []).length !== itemRows.length) {
        throw new Error("明細寫入筆數不符，請重新整理後再試");
      }

      toast.success(isNew ? "已建立進貨單" : "已儲存");
      setForm(null);
      reload();
    } catch (e) {
      toast.error(humanizeError(e, isNew ? "建立進貨單" : "儲存進貨單"));
    } finally {
      setSaving(false);
    }
  };

  const confirmPurchase = async (p: Purchase) => {
    const { data, error } = await supabase.rpc("confirm_purchase", { p_purchase_id: p.id });
    if (error) {
      toast.error(humanizeError(error, "確認進貨單"));
      return;
    }
    const r = (Array.isArray(data) ? data[0] : data) as
      | { payable_doc_no?: string; due_date?: string }
      | null;
    toast.success(
      r?.payable_doc_no
        ? `已確認，應付單號 ${r.payable_doc_no}${r.due_date ? `，到期日 ${fmtDate(r.due_date)}` : ""}`
        : "已確認",
    );
    setReadonlyDoc(null);
    reload();
  };

  const doVoid = async () => {
    if (!voidTarget) return;
    const { error } = await supabase.rpc("void_purchase", { p_purchase_id: voidTarget.id });
    if (error) {
      toast.error(humanizeError(error, "作廢進貨單"));
      return;
    }
    toast.success("已作廢");
    setVoidTarget(null);
    setReadonlyDoc(null);
    reload();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="進貨單"
        description="採購進貨管理：草稿可編輯，確認後產生應付帳款，已確認單可作廢。"
        actions={
          canCreate ? (
            <Button onClick={() => setForm(blankDraft())}>
              <Plus className="w-4 h-4 mr-1" />
              新增進貨單
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-wrap gap-3">
        <div className="w-40">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger>
              <SelectValue placeholder="狀態" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部狀態</SelectItem>
              <SelectItem value="draft">草稿</SelectItem>
              <SelectItem value="confirmed">已確認</SelectItem>
              <SelectItem value="void">已作廢</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-56">
          <Select value={vendorFilter} onValueChange={setVendorFilter}>
            <SelectTrigger>
              <SelectValue placeholder="廠商" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部廠商</SelectItem>
              {vendors.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {loadErr && (
        <p className="text-sm text-destructive">{humanizeError(loadErr, "載入進貨單")}</p>
      )}

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>採購單號</TableHead>
                <TableHead>廠商</TableHead>
                <TableHead>進貨日</TableHead>
                <TableHead>來源</TableHead>
                <TableHead>稅別</TableHead>
                <TableHead className="text-right">未稅額</TableHead>
                <TableHead className="text-right">稅額</TableHead>
                <TableHead className="text-right">合計</TableHead>
                <TableHead>狀態</TableHead>
                <TableHead className="text-right">動作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                    載入中…
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                    尚無進貨單
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((p) => (
                <TableRow
                  key={p.id}
                  className={`cursor-pointer ${p.status === "void" ? "opacity-60" : ""}`}
                  onClick={() => openRow(p)}
                >
                  <TableCell className="font-mono text-sm">{p.purchase_no}</TableCell>
                  <TableCell className="font-medium">{p.vendor?.name ?? "—"}</TableCell>
                  <TableCell className="text-sm">{fmtDate(p.purchase_date)}</TableCell>
                  <TableCell className="text-sm">
                    {SOURCE_LABEL[p.source_type] ?? p.source_type}
                  </TableCell>
                  <TableCell className="text-sm">{TAX_LABEL[p.tax_type] ?? p.tax_type}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatTWD(p.subtotal)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatTWD(p.tax_amount)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-medium">
                    {formatTWD(p.total)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(p.status)}>
                      {STATUS_LABEL[p.status] ?? p.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                    {canEdit && p.status === "draft" && (
                      <Button size="sm" onClick={() => confirmPurchase(p)}>
                        確認
                      </Button>
                    )}
                    {canEdit && p.status === "confirmed" && (
                      <Button size="sm" variant="destructive" onClick={() => setVoidTarget(p)}>
                        作廢
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* 新增／編輯 */}
      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="max-w-4xl max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isNew ? "新增進貨單" : "編輯進貨單（草稿）"}</DialogTitle>
            <DialogDescription>
              採購單號於建立時自動產生；稅額於應稅時以未稅金額 5% 計算。
            </DialogDescription>
          </DialogHeader>
          {form && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label>廠商 *</Label>
                  <Select
                    value={form.vendor_id}
                    onValueChange={(v) => setForm({ ...form, vendor_id: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="選擇廠商" />
                    </SelectTrigger>
                    <SelectContent>
                      {vendors.map((v) => (
                        <SelectItem key={v.id} value={v.id}>
                          {v.vendor_code} {v.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>進貨日</Label>
                  <Input
                    type="date"
                    value={form.purchase_date}
                    onChange={(e) => setForm({ ...form, purchase_date: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>來源類型</Label>
                  <Select
                    value={form.source_type}
                    onValueChange={(v) =>
                      setForm({ ...form, source_type: v, order_id: v === "direct" ? form.order_id : null })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="stock">庫存補貨</SelectItem>
                      <SelectItem value="direct">直接採購</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {form.source_type === "direct" && (
                <div className="space-y-1">
                  <Label>關聯工單 *</Label>
                  <Select
                    value={form.order_id ?? ""}
                    onValueChange={(v) => setForm({ ...form, order_id: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="選擇工單" />
                    </SelectTrigger>
                    <SelectContent>
                      {orders.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.order_no} {o.item_name ?? ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label>發票號碼</Label>
                  <Input
                    value={form.invoice_no}
                    onChange={(e) => setForm({ ...form, invoice_no: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>發票日期</Label>
                  <Input
                    type="date"
                    value={form.invoice_date}
                    onChange={(e) => setForm({ ...form, invoice_date: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>稅別</Label>
                  <Select
                    value={form.tax_type}
                    onValueChange={(v) => setForm({ ...form, tax_type: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="taxable">應稅</SelectItem>
                      <SelectItem value="zero">零稅率</SelectItem>
                      <SelectItem value="exempt">免稅</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>明細</Label>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setForm({ ...form, items: [...form.items, blankItem()] })}
                  >
                    <Plus className="w-4 h-4 mr-1" />
                    新增一列
                  </Button>
                </div>
                <div className="overflow-x-auto rounded-md border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="min-w-40">品項名稱</TableHead>
                        <TableHead className="min-w-32">規格</TableHead>
                        <TableHead className="w-24">數量</TableHead>
                        <TableHead className="w-20">單位</TableHead>
                        <TableHead className="w-28">單價</TableHead>
                        <TableHead className="w-28 text-right">金額</TableHead>
                        <TableHead className="w-20">入庫</TableHead>
                        <TableHead className="w-12" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {form.items.map((it, idx) => (
                        <TableRow key={idx}>
                          <TableCell>
                            <Input
                              value={it.item_name}
                              onChange={(e) => setItem(idx, { item_name: e.target.value })}
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              value={it.spec ?? ""}
                              onChange={(e) => setItem(idx, { spec: e.target.value })}
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              value={String(it.qty)}
                              onChange={(e) => setItem(idx, { qty: Number(e.target.value) })}
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              value={it.unit ?? ""}
                              onChange={(e) => setItem(idx, { unit: e.target.value })}
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              value={String(it.unit_price)}
                              onChange={(e) => setItem(idx, { unit_price: Number(e.target.value) })}
                            />
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatTWD(num(it.qty) * num(it.unit_price))}
                          </TableCell>
                          <TableCell>
                            <Switch
                              checked={!!it.is_stocked}
                              onCheckedChange={(v) => setItem(idx, { is_stocked: v })}
                            />
                          </TableCell>
                          <TableCell>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              onClick={() =>
                                setForm({
                                  ...form,
                                  items: form.items.filter((_, i) => i !== idx),
                                })
                              }
                              aria-label="刪除此列"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>

              <div className="ml-auto w-full sm:w-72 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">未稅小計</span>
                  <span className="tabular-nums">{formatTWD(totals.subtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">稅額</span>
                  <span className="tabular-nums">{formatTWD(totals.tax)}</span>
                </div>
                <div className="flex justify-between font-semibold text-base border-t border-border pt-1">
                  <span>合計</span>
                  <span className="tabular-nums">{formatTWD(totals.total)}</span>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>
              取消
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? "儲存中…" : isNew ? "建立" : "儲存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 唯讀檢視 */}
      <Dialog open={!!readonlyDoc} onOpenChange={(o) => !o && setReadonlyDoc(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-4 h-4" />
              {readonlyDoc?.purchase_no}
            </DialogTitle>
            <DialogDescription>
              {readonlyDoc &&
                `${STATUS_LABEL[readonlyDoc.status] ?? readonlyDoc.status}・${readonlyDoc.vendor?.name ?? "—"}・${fmtDate(readonlyDoc.purchase_date)}`}
            </DialogDescription>
          </DialogHeader>
          {readonlyDoc && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                <div>
                  <span className="text-muted-foreground">來源：</span>
                  {SOURCE_LABEL[readonlyDoc.source_type] ?? readonlyDoc.source_type}
                </div>
                <div>
                  <span className="text-muted-foreground">稅別：</span>
                  {TAX_LABEL[readonlyDoc.tax_type] ?? readonlyDoc.tax_type}
                </div>
                <div>
                  <span className="text-muted-foreground">發票：</span>
                  {readonlyDoc.invoice_no ?? "—"}
                </div>
              </div>
              <div className="overflow-x-auto rounded-md border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>品項</TableHead>
                      <TableHead>規格</TableHead>
                      <TableHead className="text-right">數量</TableHead>
                      <TableHead className="text-right">單價</TableHead>
                      <TableHead className="text-right">金額</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(readonlyDoc.items ?? []).map((it, i) => (
                      <TableRow key={it.id ?? i}>
                        <TableCell>{it.item_name}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {it.spec ?? "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {num(it.qty)} {it.unit ?? ""}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatTWD(it.unit_price)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatTWD(it.amount)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="ml-auto w-full sm:w-72 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">未稅小計</span>
                  <span className="tabular-nums">{formatTWD(readonlyDoc.subtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">稅額</span>
                  <span className="tabular-nums">{formatTWD(readonlyDoc.tax_amount)}</span>
                </div>
                <div className="flex justify-between font-semibold text-base border-t border-border pt-1">
                  <span>合計</span>
                  <span className="tabular-nums">{formatTWD(readonlyDoc.total)}</span>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            {readonlyDoc?.status === "draft" && canEdit && (
              <Button onClick={() => confirmPurchase(readonlyDoc)}>確認進貨</Button>
            )}
            {readonlyDoc?.status === "confirmed" && canEdit && (
              <Button variant="destructive" onClick={() => setVoidTarget(readonlyDoc)}>
                作廢
              </Button>
            )}
            <Button variant="outline" onClick={() => setReadonlyDoc(null)}>
              關閉
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 作廢二次確認 */}
      <Dialog open={!!voidTarget} onOpenChange={(o) => !o && setVoidTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>確定作廢此進貨單？</DialogTitle>
            <DialogDescription>
              {voidTarget?.purchase_no}　作廢後會一併沖銷對應的應付帳款，且無法復原。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoidTarget(null)}>
              取消
            </Button>
            <Button variant="destructive" onClick={doVoid}>
              確定作廢
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
