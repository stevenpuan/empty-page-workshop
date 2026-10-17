import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Plus,
  ChevronDown,
  ChevronRight,
  Copy,
  Send,
  Ban,
  FileOutput,
  ExternalLink,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { humanizeError } from "@/lib/app-error";
import { taipeiToday, fmtDate, formatTWD } from "@/lib/dates";
import { RequirePerm } from "@/components/RequirePerm";
import { usePriceList, type PriceList } from "@/lib/price-list";
import {
  QuoteLineEditor,
  newLine,
  lineAmount,
  linePayload,
  type QuoteLine,
} from "@/components/quotation/QuoteLineEditor";
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
  price_category_id?: string | null;
  price_category?: string | null;
  price_item?: string | null;
  price_option?: string | null;
  width_cm?: number | null;
  height_cm?: number | null;
  addons?: { id: string; count?: number }[] | null;
  suggested_amount?: number | null;
  price_detail?: unknown;
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
  contact_name: string | null;
  contact_phone: string | null;
  created_at: string;
  order_id: string | null;
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

const QUOTATION_COLUMNS =
  "id, company_id, quote_no, customer_id, quote_date, valid_until, status, subtotal, tax_type, tax_amount, total, note, contact_name, contact_phone, created_at, order_id, " +
  "customer:customers(name, customer_code), " +
  "items:quotation_items(id, quotation_id, item_name, spec, qty, unit, unit_price, amount, sort_order, " +
  "price_category_id, price_category, price_item, price_option, width_cm, height_cm, addons, suggested_amount, price_detail)";

/** 報價單狀態只能透過 set_quotation_status RPC 轉換（直接 update status 會被 DB 擋下 P0007） */
async function setQuotationStatus(id: string, status: string, ctx: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("set_quotation_status", {
    p_quotation_id: id,
    p_status: status,
  });
  if (error) {
    toast.error(humanizeError(error, ctx));
    return false;
  }
  const res = (Array.isArray(data) ? data[0] : data) as { ok?: boolean } | null;
  if (!res?.ok) {
    toast.error("報價單狀態沒有更新（可能沒有權限），請重新整理後再試");
    return false;
  }
  return true;
}

/* ---- main page ---- */
function Page() {
  const { company, can } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const canCreate = can("quotations", "create");
  const canEdit = can("quotations", "edit");
  const canCreateOrder = can("orders", "create");
  const [convertTarget, setConvertTarget] = useState<Quotation | null>(null);

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
        .select(QUOTATION_COLUMNS)
        .eq("company_id", company!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Quotation[];
    },
  });

  // 已轉訂單的報價單：另外依 order_id 查訂單單號（不依賴 FK 名稱做 embed）
  const orderIds = useMemo(
    () => Array.from(new Set(rows.map((r) => r.order_id).filter((x): x is string => !!x))).sort(),
    [rows],
  );
  const { data: orderNoMap = {} } = useQuery({
    queryKey: ["quotation_order_nos", company?.id, orderIds],
    enabled: !!company?.id && orderIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("id, order_no")
        .in("id", orderIds);
      if (error) throw error;
      const map: Record<string, string> = {};
      for (const o of (data ?? []) as { id: string; order_no: string }[]) map[o.id] = o.order_no;
      return map;
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
    const ok = await setQuotationStatus(voidTarget.id, "void", "作廢報價單");
    if (!ok) return;
    toast.success("已作廢報價單");
    setVoidTarget(null);
    reload();
  };

  const markSent = async (q: Quotation) => {
    const ok = await setQuotationStatus(q.id, "sent", "更新狀態");
    if (!ok) return;
    toast.success("已標記為已報價");
    reload();
  };

  const markAccepted = async (q: Quotation) => {
    const ok = await setQuotationStatus(q.id, "accepted", "更新狀態");
    if (!ok) return;
    toast.success("已標記為已接受");
    reload();
  };

  const onConverted = (orderId: string, orderNo: string) => {
    toast.success(`已轉為訂單 ${orderNo}（草稿）`, {
      action: {
        label: "查看訂單",
        onClick: () => void navigate({ to: "/dashboard/orders/$orderId", params: { orderId } }),
      },
    });
    setConvertTarget(null);
    reload();
    void qc.invalidateQueries({ queryKey: ["orders", company?.id] });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="報價單"
        description="選品項、填數量或尺寸，系統依「價目設定」帶出建議價，可以改價。送出報價時老闆的 LINE 會收到通知，有改價的會標出來。"
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
          <Button
            onClick={() => {
              setEditTarget(null);
              setOpenForm(true);
            }}
          >
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
                      {q.contact_name && (
                        <span className="ml-1 text-xs font-normal text-muted-foreground">
                          {q.contact_name}
                        </span>
                      )}
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
                              onClick={() => {
                                setEditTarget(q);
                                setOpenForm(true);
                              }}
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
                        {q.status === "accepted" && !q.order_id && canCreateOrder && (
                          <Button size="sm" variant="outline" onClick={() => setConvertTarget(q)}>
                            <FileOutput className="w-4 h-4 mr-1" />
                            轉訂單
                          </Button>
                        )}
                        {q.order_id && (
                          <Button size="sm" variant="ghost" asChild>
                            <Link to="/dashboard/orders/$orderId" params={{ orderId: q.order_id }}>
                              已轉訂單
                              {orderNoMap[q.order_id] ? ` ${orderNoMap[q.order_id]}` : ""}
                              <ExternalLink className="w-3.5 h-3.5 ml-1" />
                            </Link>
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
        onClose={() => {
          setOpenForm(false);
          setEditTarget(null);
        }}
        onSaved={reload}
      />

      <ConvertDialog
        quotation={convertTarget}
        onClose={() => setConvertTarget(null)}
        onConverted={onConverted}
      />

      <AlertDialog open={!!voidTarget} onOpenChange={(o) => !o && setVoidTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>作廢報價單 {voidTarget?.quote_no}</AlertDialogTitle>
            <AlertDialogDescription>作廢後無法恢復，確定要作廢此報價單嗎？</AlertDialogDescription>
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

/* ---- convert to order ---- */
function ConvertDialog({
  quotation,
  onClose,
  onConverted,
}: {
  quotation: Quotation | null;
  onClose: () => void;
  onConverted: (orderId: string, orderNo: string) => void;
}) {
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!quotation) return;
    setSaving(true);
    const { data, error } = await supabase.rpc("convert_quotation_to_order", {
      p_quotation_id: quotation.id,
      p_due_date: dueDate || null,
    });
    setSaving(false);
    if (error) {
      toast.error(humanizeError(error, "報價單轉訂單"));
      return;
    }
    const res = (Array.isArray(data) ? data[0] : data) as {
      ok?: boolean;
      order_id?: string;
      order_no?: string;
    } | null;
    if (!res?.ok || !res.order_id) {
      toast.error("沒有建立訂單（可能沒有權限），請重新整理後再試");
      return;
    }
    setDueDate("");
    onConverted(res.order_id, res.order_no ?? "");
  };

  return (
    <Dialog
      open={!!quotation}
      onOpenChange={(o) => {
        if (!o) {
          setDueDate("");
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>報價單轉訂單 {quotation?.quote_no}</DialogTitle>
          <DialogDescription>
            將依報價單的客戶、第一筆品名／規格與金額建立一張「草稿」訂單，每張報價單只能轉一次。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label>交期（選填）</Label>
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              setDueDate("");
              onClose();
            }}
          >
            取消
          </Button>
          <Button onClick={() => void submit()} disabled={saving}>
            {saving ? "轉換中…" : "確認轉訂單"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---- detail expand ---- */
function QuotationDetail({ quotation }: { quotation: Quotation }) {
  const items = quotation.items ?? [];
  return (
    <div className="py-3 space-y-3">
      <div className="flex flex-wrap gap-4 text-sm">
        <span>稅別：{TAX_LABEL[quotation.tax_type] ?? quotation.tax_type}</span>
        <span>未稅：{formatTWD(quotation.subtotal)}</span>
        <span>稅額：{formatTWD(quotation.tax_amount)}</span>
        <span className="font-medium">含稅合計：{formatTWD(quotation.total)}</span>
      </div>
      {(quotation.contact_name || quotation.contact_phone) && (
        <p className="text-sm">
          聯絡人：{[quotation.contact_name, quotation.contact_phone].filter(Boolean).join(" ")}
        </p>
      )}
      {quotation.note && <p className="text-sm text-muted-foreground">備註：{quotation.note}</p>}
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
              <TableHead className="text-right">建議價</TableHead>
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
                  <TableCell className="text-right text-sm tabular-nums">
                    <SuggestedCell item={it} />
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

/** 明細的建議價欄：照建議價／改低改高／自填 */
function SuggestedCell({ item }: { item: QuotationItem }) {
  if (!item.price_detail) return <span className="text-muted-foreground">自己填</span>;
  if (item.suggested_amount === null || item.suggested_amount === undefined)
    return <span className="text-amber-700 dark:text-amber-400">需老闆報價</span>;
  const diff = Math.round(num(item.amount)) - Math.round(num(item.suggested_amount));
  if (diff === 0) return <span className="text-muted-foreground">照建議價</span>;
  return (
    <span className="text-amber-700 dark:text-amber-400">
      {formatTWD(item.suggested_amount)}（{diff < 0 ? "改低" : "改高"} {formatTWD(Math.abs(diff))}）
    </span>
  );
}

/* ---- create / edit dialog ---- */
const WALKIN = "__walkin__";

/** 已存的明細 → 編輯用的明細 */
function toLine(it: QuotationItem, pl: PriceList | undefined): QuoteLine {
  const base = newLine("free");
  const cat = it.price_category_id
    ? pl?.categories.find((c) => c.id === it.price_category_id)
    : undefined;
  if (cat) {
    const sugg =
      it.suggested_amount === null || it.suggested_amount === undefined
        ? null
        : num(it.suggested_amount);
    return {
      ...base,
      kind: "price",
      category_id: cat.id,
      item: it.price_item ?? it.item_name,
      option: it.price_option ?? "",
      qty: String(num(it.qty)),
      width: it.width_cm ? String(num(it.width_cm)) : "",
      height: it.height_cm ? String(num(it.height_cm)) : "",
      addons: Object.fromEntries((it.addons ?? []).map((a) => [a.id, String(a.count ?? 1)])),
      amount: String(num(it.amount)),
      touched: sugg === null || Math.round(sugg) !== Math.round(num(it.amount)),
      suggested: sugg,
    };
  }
  return {
    ...base,
    item_name: it.item_name,
    spec: it.spec ?? "",
    qty: String(num(it.qty)),
    unit: it.unit ?? "式",
    unit_price: String(num(it.unit_price)),
  };
}

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
  const { company } = useAuth();
  const { data: customers = [] } = useCustomers(company?.id);
  const { data: priceList } = usePriceList(company?.id);
  const isEdit = !!editTarget;

  const [customerId, setCustomerId] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [quoteDate, setQuoteDate] = useState(taipeiToday());
  const [validUntil, setValidUntil] = useState("");
  const [taxType, setTaxType] = useState("taxable");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<QuoteLine[]>(() => [newLine()]);
  const [saving, setSaving] = useState(false);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  // 打開編輯時載入一次（等價目載入後才轉換，才認得出大類）
  const loadKey = open ? (editTarget ? `${editTarget.id}:${priceList ? 1 : 0}` : "new") : null;
  if (loadKey !== loadedFor) {
    setLoadedFor(loadKey);
    if (open && editTarget) {
      const walkin =
        customers.find((c) => c.id === editTarget.customer_id)?.customer_code === "WALKIN";
      setCustomerId(walkin ? WALKIN : editTarget.customer_id);
      setContactName(editTarget.contact_name ?? "");
      setContactPhone(editTarget.contact_phone ?? "");
      setQuoteDate(editTarget.quote_date);
      setValidUntil(editTarget.valid_until ?? "");
      setTaxType(editTarget.tax_type);
      setNote(editTarget.note ?? "");
      const its = [...(editTarget.items ?? [])].sort((a, b) => a.sort_order - b.sort_order);
      setLines(its.length ? its.map((it) => toLine(it, priceList)) : [newLine()]);
    } else if (open) {
      setCustomerId("");
      setContactName("");
      setContactPhone("");
      setQuoteDate(taipeiToday());
      setValidUntil("");
      setTaxType("taxable");
      setNote("");
      setLines([newLine((priceList?.categories.length ?? 0) > 0 || !priceList ? "price" : "free")]);
    }
  }

  const subtotal = Math.round(lines.reduce((s, l) => s + lineAmount(l), 0));
  const taxAmount = calcTax(subtotal, taxType);
  const total = subtotal + taxAmount;
  const flagged = lines.filter(
    (l) =>
      l.kind === "free" ||
      l.suggested === null ||
      Math.round(num(l.amount)) !== Math.round(l.suggested),
  ).length;

  const updateLine = (key: string, patch: Partial<QuoteLine>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const submit = async (send: boolean) => {
    if (!company) return;
    if (!customerId) {
      toast.error("請選擇客戶（現場客人選「散客」）");
      return;
    }
    const payload = [];
    for (const [i, l] of lines.entries()) {
      const p = linePayload(l, priceList);
      const blank = l.kind === "free" ? !l.item_name.trim() : !l.category_id;
      if (blank) {
        if (lines.length === 1) {
          toast.error("請至少填一筆報價明細");
          return;
        }
        continue;
      }
      if (!p.item_name) {
        toast.error(`第 ${i + 1} 筆請選品項或填品名`);
        return;
      }
      if (num(l.qty) <= 0) {
        toast.error(`第 ${i + 1} 筆的數量要大於 0`);
        return;
      }
      if (l.kind === "price" && l.amount.trim() === "") {
        toast.error(`第 ${i + 1} 筆請填報價金額`);
        return;
      }
      payload.push(p);
    }
    if (payload.length === 0) {
      toast.error("請至少填一筆報價明細");
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc("save_quotation", {
        p_id: editTarget?.id ?? null,
        p_header: {
          customer_id: customerId === WALKIN ? null : customerId,
          contact_name: contactName,
          contact_phone: contactPhone,
          quote_date: quoteDate,
          valid_until: validUntil,
          tax_type: taxType,
          note,
        },
        p_items: payload,
        p_send: send,
      });
      if (error) throw error;
      const res = data as { ok?: boolean; quote_no?: string } | null;
      if (!res?.ok) throw new Error("沒有寫入任何資料（可能沒有權限）");
      toast.success(
        send
          ? `已送出報價 ${res.quote_no ?? ""}，老闆會收到通知`
          : `已存草稿 ${res.quote_no ?? ""}`,
      );
      onClose();
      onSaved();
    } catch (e) {
      toast.error(humanizeError(e, send ? "送出報價" : "儲存報價單"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? `編輯報價單 ${editTarget?.quote_no}` : "新增報價單"}</DialogTitle>
          <DialogDescription>
            選品項、填數量或尺寸，系統帶出建議價（未稅）；金額可以改。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-1 sm:col-span-2">
              <Label>客戶 *</Label>
              <Select value={customerId} onValueChange={setCustomerId}>
                <SelectTrigger>
                  <SelectValue placeholder="選擇客戶" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={WALKIN}>散客（現場客人，下面填姓名電話）</SelectItem>
                  {customers
                    .filter((c) => c.customer_code !== "WALKIN" || c.id === customerId)
                    .map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>聯絡人</Label>
              <Input value={contactName} onChange={(e) => setContactName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>電話</Label>
              <Input
                inputMode="tel"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>報價日期 *</Label>
              <Input type="date" value={quoteDate} onChange={(e) => setQuoteDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>有效期限</Label>
              <Input
                type="date"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
              />
            </div>
            <div className="space-y-1">
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
          </div>

          <div className="space-y-2">
            <Label>報價明細</Label>
            {lines.map((l, i) => (
              <QuoteLineEditor
                key={l.key}
                index={i}
                line={l}
                priceList={priceList}
                canRemove={lines.length > 1}
                onChange={(patch) => updateLine(l.key, patch)}
                onRemove={() => setLines((prev) => prev.filter((x) => x.key !== l.key))}
              />
            ))}
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setLines((p) => [...p, newLine()])}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                從價目表加一筆
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setLines((p) => [...p, newLine("free")])}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                自己填一筆
              </Button>
            </div>
          </div>

          <div className="flex flex-col items-end gap-1 border-t pt-3 text-sm">
            <div className="flex gap-3">
              <span className="text-muted-foreground">未稅金額</span>
              <span className="w-28 text-right tabular-nums">{formatTWD(subtotal)}</span>
            </div>
            <div className="flex gap-3">
              <span className="text-muted-foreground">
                稅額{taxType === "taxable" ? "（5%）" : ""}
              </span>
              <span className="w-28 text-right tabular-nums">{formatTWD(taxAmount)}</span>
            </div>
            <div className="flex gap-3 text-base font-bold">
              <span>含稅合計</span>
              <span className="w-28 text-right tabular-nums">{formatTWD(total)}</span>
            </div>
          </div>

          <div className="space-y-1">
            <Label>備註</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:items-center">
          {flagged > 0 && (
            <p className="mr-auto text-xs text-muted-foreground">
              有 {flagged} 筆改過價或自己填價，送出時會一起通知老闆
            </p>
          )}
          <Button variant="outline" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button variant="secondary" onClick={() => void submit(false)} disabled={saving}>
            存草稿
          </Button>
          <Button onClick={() => void submit(true)} disabled={saving}>
            <Send className="mr-1 h-4 w-4" />
            {saving ? "送出中…" : "送出報價"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
