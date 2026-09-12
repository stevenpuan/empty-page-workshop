import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, ChevronDown, ChevronRight, Copy, Send, Ban } from "lucide-react";
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
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

export const Route = createFileRoute("/dashboard/quotations")({
  head: () => ({
    meta: [
      { title: "報價單" },
      { name: "description", content: "報價單管理：建立報價、報價明細、轉訂單" },
      { property: "og:title", content: "報價單" },
      { property: "og:description", content: "報價單管理：建立報價、報價明細、轉訂單" },
    ],
  }),
  component: () => (
    <RequirePerm module="quotations">
      <Page />
    </RequirePerm>
  ),
});

/* ---- types ---- */
interface QuotationItem {
  id?: string;
  quotation_id?: string;
  item_name: string;
  spec: string | null;
  qty: number;
  unit: string | null;
  unit_price: number;
  amount: number;
  sort_order: number;
}
interface Quotation {
  id: string;
  company_id: string;
  quote_no: string;
  customer_id: string;
  quote_date: string;
  valid_until: string | null;
  status: string;
  subtotal: number;
  tax_type: string;
  tax_amount: number;
  total: number;
  note: string | null;
  created_at: string;
  customer?: { name: string; customer_code: string } | null;
  items?: QuotationItem[];
}

const STATUS_LABEL: Record<string, string> = {
  draft: "草稿",
  sent: "已報價",
  accepted: "已接受",
  rejected: "已拒絕",
  expired: "已過期",
  void: "已作廢",
};
const TAX_LABEL: Record<string, string> = {
  taxable: "應稅 5%",
  zero_tax: "零稅率",
  tax_free: "免稅",
};
const statusVariant = (s: string) =>
  s === "accepted"
    ? "default"
    : s === "void" || s === "rejected" || s === "expired"
      ? "outline"
      : "secondary";
const num = (v: unknown) => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};

/* ---- helpers ---- */
function useCustomers(companyId: string | undefined) {
  return useQuery({
    queryKey: ["customers_min", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id, name, customer_code")
        .eq("is_active", true)
        .order("customer_code");
      if (error) throw error;
      return data as { id: string; name: string; customer_code: string }[];
    },
  });
}

function calcTax(subtotal: number, taxType: string) {
  if (taxType === "taxable") return Math.round(subtotal * 0.05);
  return 0;
}

/* ---- main page ---- */
function Page() {
  const { company, can } = useAuth();
  const qc = useQueryClient();
  const canCreate = can("quotations", "create");
  const canEdit = can("quotations", "edit");

  const [expanded, setExpanded] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [customerFilter, setCustomerFilter] = useState("all");
  const [openForm, setOpenForm] = useState(false);
  const [editTarget, setEditTarget] = useState<Quotation | null>(null);
  const [voidTarget, setVoidTarget] = useState<Quotation | null>(null);

  const { data: customers = [] } = useCustomers(company?.id);

  const {
    data: rows = [],
    isLoading,
    error: loadErr,
  } = useQuery({
    queryKey: ["quotations", company?.id],
    enabled: !!company?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quotations")
        .select(
          "*, customer:customers(name, customer_code), items:quotation_items(*)",
        )
        .eq("company_id", company!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Quotation[];
    },
  });

  const filtered = rows.filter(
    (r) =>
      (statusFilter === "all" || r.status === statusFilter) &&
      (customerFilter === "all" || r.customer_id === customerFilter),
  );

  const reload = () => qc.invalidateQueries({ queryKey: ["quotations", company?.id] });

  const doVoid = async () => {
    if (!voidTarget) return;
    const { error } = await supabase
      .from("quotations")
      .update({ status: "void", updated_at: new Date().toISOString() })
      .eq("id", voidTarget.id);
    if (error) {
      toast.error(humanizeError(error, "作廢報價單"));
      return;
    }
    toast.success("已作廢報價單");
    setVoidTarget(null);
    reload();
  };

  const markSent = async (q: Quotation) => {
    const { error } = await supabase
      .from("quotations")
      .update({ status: "sent", updated_at: new Date().toISOString() })
      .eq("id", q.id);
    if (error) {
      toast.error(humanizeError(error, "更新狀態"));
      return;
    }
    toast.success("已標記為已報價");
    reload();
  };

  const markAccepted = async (q: Quotation) => {
    const { error } = await supabase
      .from("quotations")
      .update({ status: "accepted", updated_at: new Date().toISOString() })
      .eq("id", q.id);
    if (error) {
      toast.error(humanizeError(error, "更新狀態"));
      return;
    }
    toast.success("已標記為已接受");
    reload();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="報價單"
        description="建立報價單、追蹤報價狀態、標記為已報價或已接受。"
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="w-40">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger>
              <SelectValue placeholder="狀態" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部狀態</SelectItem>
              <SelectItem value="draft">草稿</SelectItem>
              <SelectItem value="sent">已報價</SelectItem>
              <SelectItem value="accepted">已接受</SelectItem>
              <SelectItem value="rejected">已拒絕</SelectItem>
              <SelectItem value="void">已作廢</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-56">
          <Select value={customerFilter} onValueChange={setCustomerFilter}>
            <SelectTrigger>
              <SelectValue placeholder="客戶" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部客戶</SelectItem>
              {customers.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1" />
        {canCreate && (
          <Button onClick={() => { setEditTarget(null); setOpenForm(true); }}>
            <Plus className="w-4 h-4 mr-1" />
            新增報價
          </Button>
        )}
      </div>

      {loadErr && (
        <p className="text-sm text-destructive">{humanizeError(loadErr, "載入報價單")}</p>
      )}

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>報價單號</TableHead>
                <TableHead>客戶</TableHead>
                <TableHead>報價日</TableHead>
                <TableHead>有效期限</TableHead>
                <TableHead className="text-right">金額</TableHead>
                <TableHead>狀態</TableHead>
                <TableHead className="text-right">動作</TableHead>
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
              {!isLoading && filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    尚無報價單
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((q) => (
                <Fragment key={q.id}>
                  <TableRow
                    className={`cursor-pointer ${q.status === "void" ? "opacity-60" : ""}`}
                    onClick={() => setExpanded(expanded === q.id ? null : q.id)}
                  >
                    <TableCell>
                      {expanded === q.id ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronRight className="w-4 h-4" />
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-sm">{q.quote_no}</TableCell>
                    <TableCell className="font-medium">
                      {q.customer?.name ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm">{fmtDate(q.quote_date)}</TableCell>
                    <TableCell className="text-sm">{fmtDate(q.valid_until)}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {formatTWD(q.total)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(q.status)}>
                        {STATUS_LABEL[q.status] ?? q.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1">
                        {canEdit && q.status === "draft" && (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              title="標記已報價"
                              onClick={() => markSent(q)}
                            >
                              <Send className="w-4 h-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              title="編輯"
                              onClick={() => { setEditTarget(q); setOpenForm(true); }}
                            >
                              <Copy className="w-4 h-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive"
                              title="作廢"
                              onClick={() => setVoidTarget(q)}
                            >
                              <Ban className="w-4 h-4" />
                            </Button>
                          </>
                        )}
                        {canEdit && q.status === "sent" && (
                          <Button size="sm" variant="outline" onClick={() => markAccepted(q)}>
                            標記已接受
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                  {expanded === q.id && (
                    <TableRow>
                      <TableCell colSpan={8} className="bg-muted/40">
                        <QuotationDetail quotation={q} />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <QuotationDialog
        open={openForm}
        editTarget={editTarget}
        onClose={() => { setOpenForm(false); setEditTarget(null); }}
        onSaved={reload}
      />

      <AlertDialog open={!!voidTarget} onOpenChange={(o) => !o && setVoidTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>作廢報價單 {voidTarget?.quote_no}</AlertDialogTitle>
            <AlertDialogDescription>
              作廢後無法恢復，確定要作廢此報價單嗎？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={doVoid}>確定作廢</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ---- detail expand ---- */
function QuotationDetail({ quotation }: { quotation: Quotation }) {
  const items = quotation.items ?? [];
  return (
    <div className="py-3 space-y-3">
      <div className="flex flex-wrap gap-4 text-sm">
        <span>
          稅別：{TAX_LABEL[quotation.tax_type] ?? quotation.tax_type}
        </span>
        <span>小計：{formatTWD(quotation.subtotal)}</span>
        <span>稅額：{formatTWD(quotation.tax_amount)}</span>
        <span className="font-medium">合計：{formatTWD(quotation.total)}</span>
      </div>
      {quotation.note && (
        <p className="text-sm text-muted-foreground">備註：{quotation.note}</p>
      )}
      {items.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">#</TableHead>
              <TableHead>品名</TableHead>
              <TableHead>規格</TableHead>
              <TableHead className="text-right">數量</TableHead>
              <TableHead>單位</TableHead>
              <TableHead className="text-right">單價</TableHead>
              <TableHead className="text-right">金額</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items
              .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
              .map((it, i) => (
                <TableRow key={it.id ?? i}>
                  <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                  <TableCell className="font-medium">{it.item_name || "—"}</TableCell>
                  <TableCell className="text-sm">{it.spec || "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{num(it.qty)}</TableCell>
                  <TableCell className="text-sm">{it.unit || "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatTWD(it.unit_price)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-medium">
                    {formatTWD(it.amount)}
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

/* ---- create / edit dialog ---- */
const blankItem = (): QuotationItem => ({
  item_name: "",
  spec: null,
  qty: 1,
  unit: "式",
  unit_price: 0,
  amount: 0,
  sort_order: 0,
});

function QuotationDialog({
  open,
  editTarget,
  onClose,
  onSaved,
}: {
  open: boolean;
  editTarget: Quotation | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { company, user } = useAuth();
  const { data: customers = [] } = useCustomers(company?.id);
  const isEdit = !!editTarget;

  const [customerId, setCustomerId] = useState("");
  const [quoteDate, setQuoteDate] = useState(taipeiToday());
  const [validUntil, setValidUntil] = useState("");
  const [taxType, setTaxType] = useState("taxable");
  const [note, setNote] = useState("");
  const [items, setItems] = useState<QuotationItem[]>([blankItem()]);
  const [saving, setSaving] = useState(false);

  // load edit target
  const loadEdit = () => {
    if (editTarget) {
      setCustomerId(editTarget.customer_id);
      setQuoteDate(editTarget.quote_date);
      setValidUntil(editTarget.valid_until ?? "");
      setTaxType(editTarget.tax_type);
      setNote(editTarget.note ?? "");
      setItems(
        (editTarget.items ?? []).length > 0
          ? (editTarget.items ?? []).sort((a, b) => a.sort_order - b.sort_order)
          : [blankItem()],
      );
    }
  };

  const reset = () => {
    setCustomerId("");
    setQuoteDate(taipeiToday());
    setValidUntil("");
    setTaxType("taxable");
    setNote("");
    setItems([blankItem()]);
  };

  // recalc
  const subtotal = useMemo(
    () => items.reduce((s, it) => s + num(it.amount), 0),
    [items],
  );
  const taxAmount = calcTax(subtotal, taxType);
  const total = subtotal + taxAmount;

  const updateItem = (idx: number, patch: Partial<QuotationItem>) => {
    setItems((prev) => {
      const next = [...prev];
      const cur = { ...next[idx], ...patch };
      cur.amount = num(cur.qty) * num(cur.unit_price);
      next[idx] = cur;
      return next;
    });
  };
  const addItem = () => setItems((prev) => [...prev, { ...blankItem(), sort_order: prev.length }]);
  const removeItem = (idx: number) =>
    setItems((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)));

  const submit = async () => {
    if (!company) return;
    if (!customerId) {
      toast.error("請選擇客戶");
      return;
    }
    const validItems = items.filter((it) => it.item_name.trim());
    if (validItems.length === 0) {
      toast.error("請至少填寫一筆報價明細");
      return;
    }
    setSaving(true);
    try {
      if (isEdit && editTarget) {
        // update quotation header
        const { error: hErr } = await supabase
          .from("quotations")
          .update({
            customer_id: customerId,
            quote_date: quoteDate,
            valid_until: validUntil || null,
            tax_type: taxType,
            subtotal,
            tax_amount: taxAmount,
            total,
            note: note.trim() || null,
            updated_at: new Date().toISOString(),
            updated_by: user?.id ?? null,
          })
          .eq("id", editTarget.id);
        if (hErr) throw hErr;

        // delete old items, insert new
        await supabase.from("quotation_items").delete().eq("quotation_id", editTarget.id);
        const { error: iErr } = await supabase.from("quotation_items").insert(
          validItems.map((it, i) => ({
            quotation_id: editTarget.id,
            item_name: it.item_name.trim(),
            spec: it.spec?.trim() || null,
            qty: num(it.qty),
            unit: it.unit?.trim() || "式",
            unit_price: num(it.unit_price),
            amount: num(it.qty) * num(it.unit_price),
            sort_order: i,
          })),
        );
        if (iErr) throw iErr;
        toast.success("已更新報價單");
      } else {
        // generate quote_no via next_doc_no
        const { data: noData, error: noErr } = await supabase.rpc("next_doc_no", {
          p_company_id: company.id,
          p_doc_type: "QT",
        });
        if (noErr) throw noErr;
        const quoteNo = noData as string;

        const { data: inserted, error: hErr } = await supabase
          .from("quotations")
          .insert({
            company_id: company.id,
            quote_no: quoteNo,
            customer_id: customerId,
            quote_date: quoteDate,
            valid_until: validUntil || null,
            tax_type: taxType,
            subtotal,
            tax_amount: taxAmount,
            total,
            note: note.trim() || null,
            created_by: user?.id ?? null,
            updated_by: user?.id ?? null,
          })
          .select("id")
          .single();
        if (hErr) throw hErr;

        const { error: iErr } = await supabase.from("quotation_items").insert(
          validItems.map((it, i) => ({
            quotation_id: inserted.id,
            item_name: it.item_name.trim(),
            spec: it.spec?.trim() || null,
            qty: num(it.qty),
            unit: it.unit?.trim() || "式",
            unit_price: num(it.unit_price),
            amount: num(it.qty) * num(it.unit_price),
            sort_order: i,
          })),
        );
        if (iErr) throw iErr;
        toast.success(`已建立報價單 ${quoteNo}`);
      }
      reset();
      onClose();
      onSaved();
    } catch (e) {
      toast.error(humanizeError(e, isEdit ? "更新報價單" : "建立報價單"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          reset();
          onClose();
        } else if (editTarget) {
          loadEdit();
        }
      }}
    >
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "編輯報價單" : "新增報價單"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? `編輯 ${editTarget?.quote_no}`
              : "填寫報價明細，系統自動計算稅額與合計。"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* header fields */}
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-1 sm:col-span-2">
              <Label>客戶 *</Label>
              <Select value={customerId} onValueChange={setCustomerId}>
                <SelectTrigger>
                  <SelectValue placeholder="選擇客戶" />
                </SelectTrigger>
                <SelectContent>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>報價日期 *</Label>
              <Input
                type="date"
                value={quoteDate}
                onChange={(e) => setQuoteDate(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>有效期限</Label>
              <Input
                type="date"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
              />
            </div>
          </div>

          <div className="w-48">
            <Label>稅別</Label>
            <Select value={taxType} onValueChange={setTaxType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="taxable">應稅 5%</SelectItem>
                <SelectItem value="zero_tax">零稅率</SelectItem>
                <SelectItem value="tax_free">免稅</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* items */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>報價明細</Label>
              <Button type="button" size="sm" variant="outline" onClick={addItem}>
                <Plus className="w-3.5 h-3.5 mr-1" />
                增加項目
              </Button>
            </div>
            <div className="border rounded-md overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">#</TableHead>
                    <TableHead>品名 *</TableHead>
                    <TableHead>規格</TableHead>
                    <TableHead className="w-24 text-right">數量</TableHead>
                    <TableHead className="w-20">單位</TableHead>
                    <TableHead className="w-28 text-right">單價</TableHead>
                    <TableHead className="w-28 text-right">金額</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((it, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                      <TableCell>
                        <Input
                          value={it.item_name}
                          onChange={(e) => updateItem(idx, { item_name: e.target.value })}
                          placeholder="品名"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={it.spec ?? ""}
                          onChange={(e) => updateItem(idx, { spec: e.target.value })}
                          placeholder="規格"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={0}
                          className="text-right"
                          value={it.qty}
                          onChange={(e) => updateItem(idx, { qty: Number(e.target.value) || 0 })}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={it.unit ?? ""}
                          onChange={(e) => updateItem(idx, { unit: e.target.value })}
                          className="w-16"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={0}
                          className="text-right"
                          value={it.unit_price}
                          onChange={(e) =>
                            updateItem(idx, { unit_price: Number(e.target.value) || 0 })
                          }
                        />
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {formatTWD(it.amount)}
                      </TableCell>
                      <TableCell>
                        {items.length > 1 && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="text-destructive h-8 w-8 p-0"
                            onClick={() => removeItem(idx)}
                          >
                            ×
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* totals */}
          <div className="flex flex-col items-end gap-1 border-t pt-3 text-sm">
            <div className="flex gap-3">
              <span className="text-muted-foreground">小計</span>
              <span className="tabular-nums w-28 text-right">{formatTWD(subtotal)}</span>
            </div>
            <div className="flex gap-3">
              <span className="text-muted-foreground">稅額</span>
              <span className="tabular-nums w-28 text-right">{formatTWD(taxAmount)}</span>
            </div>
            <div className="flex gap-3 text-base font-bold">
              <span>合計</span>
              <span className="tabular-nums w-28 text-right">{formatTWD(total)}</span>
            </div>
          </div>

          <div className="space-y-1">
            <Label>備註</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              reset();
              onClose();
            }}
          >
            取消
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? "送出中…" : isEdit ? "更新報價" : "建立報價"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
