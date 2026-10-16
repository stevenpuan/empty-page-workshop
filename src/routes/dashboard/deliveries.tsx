import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Printer, Search, ArrowLeft } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { humanizeError } from "@/lib/app-error";
import { fmtDate, formatTWD } from "@/lib/dates";
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
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

export const Route = createFileRoute("/dashboard/deliveries")({
  head: () => ({
    meta: [
      { title: "出貨單" },
      { name: "description", content: "出貨單列表、列印與作廢" },
      { property: "og:title", content: "出貨單" },
      { property: "og:description", content: "出貨單列表、列印與作廢" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): { print?: string } => {
    const p = search["print"];
    return typeof p === "string" && p ? { print: p } : {};
  },
  component: () => (
    <RequirePerm module="delivery">
      <Page />
    </RequirePerm>
  ),
});

interface DeliveryListRow {
  id: string;
  delivery_no: string;
  order_id: string;
  delivery_date: string;
  amount_total: number | string | null;
  status: string;
  orders: { order_no: string } | null;
  customers: { name: string } | null;
  receivables: { doc_no: string | null } | null;
}

interface DeliveryPrintRow {
  id: string;
  delivery_no: string;
  delivery_date: string;
  qty: number | string | null;
  unit: string | null;
  amount_untaxed: number | string | null;
  tax_amount: number | string | null;
  amount_total: number | string | null;
  status: string;
  receiver: string | null;
  address: string | null;
  note: string | null;
  orders: {
    order_no: string;
    item_name: string;
    spec: string | null;
    qty: number | string | null;
    unit: string | null;
  } | null;
  customers: {
    name: string;
    tax_id: string | null;
    contact: string | null;
    phone: string | null;
    address: string | null;
  } | null;
  receivables: { doc_no: string | null; due_date: string | null } | null;
}

const PAGE_SIZE = 50;

const STATUSES: ReadonlyArray<readonly [string, string]> = [
  ["issued", "已開立"],
  ["void", "作廢"],
];
const statusLabel = (v: string) => STATUSES.find(([k]) => k === v)?.[1] ?? v;
const statusBadgeClass: Record<string, string> = {
  issued: "bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/40",
  void: "bg-destructive text-destructive-foreground border-transparent",
};

function Page() {
  const { print } = Route.useSearch();
  if (print) return <PrintView deliveryId={print} />;
  return <ListView />;
}

// ============== 列表 ==============

function ListView() {
  const { company, isManager } = useAuth();
  const qc = useQueryClient();

  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [keywordInput, setKeywordInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(0);
  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  // 搜尋框輸入停頓後才查詢
  useEffect(() => {
    const h = setTimeout(() => {
      setKeyword(keywordInput.trim());
      setPage(0);
    }, 300);
    return () => clearTimeout(h);
  }, [keywordInput]);

  const {
    data: rows = [],
    isLoading,
    error: loadErr,
  } = useQuery({
    queryKey: ["delivery_notes", company?.id, statusFilter, dateFrom, dateTo, keyword, page],
    enabled: !!company?.id,
    queryFn: async () => {
      let q = supabase
        .from("delivery_notes")
        .select(
          "id, delivery_no, order_id, delivery_date, amount_total, status, orders:order_id(order_no), customers:customer_id(name), receivables:receivable_id(doc_no)",
        )
        .order("delivery_date", { ascending: false })
        .order("created_at", { ascending: false })
        .range(from, to);
      if (statusFilter !== "all") q = q.eq("status", statusFilter);
      if (dateFrom) q = q.gte("delivery_date", dateFrom);
      if (dateTo) q = q.lte("delivery_date", dateTo);
      if (keyword) q = q.ilike("delivery_no", `%${keyword.replace(/[%_]/g, "")}%`);
      const { data, error } = await q;
      if (error) throw error;
      return data as unknown as DeliveryListRow[];
    },
  });
  const reload = () => qc.invalidateQueries({ queryKey: ["delivery_notes", company?.id] });

  // ---- 作廢 ----
  const [voidTarget, setVoidTarget] = useState<DeliveryListRow | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voiding, setVoiding] = useState(false);
  const confirmVoid = async () => {
    if (!voidTarget) return;
    if (!voidReason.trim()) {
      toast.error("請填寫作廢原因");
      return;
    }
    setVoiding(true);
    const { data, error } = await supabase.rpc("void_delivery_note", {
      p_delivery_id: voidTarget.id,
      p_reason: voidReason.trim(),
    });
    setVoiding(false);
    if (error) {
      toast.error(humanizeError(error, "作廢出貨單"));
      return;
    }
    const res = (Array.isArray(data) ? data[0] : data) as { ok?: boolean } | null;
    if (res && res.ok === false) {
      toast.error("出貨單沒有作廢（可能沒有權限），請重新整理後再試");
      return;
    }
    toast.success(`出貨單 ${voidTarget.delivery_no} 已作廢，訂單回到進行中，應收已作廢`);
    setVoidTarget(null);
    reload();
    void qc.invalidateQueries({ queryKey: ["orders", company?.id] });
    void qc.invalidateQueries({ queryKey: ["order_detail", voidTarget.order_id] });
    void qc.invalidateQueries({ queryKey: ["order_delivery_notes", voidTarget.order_id] });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="出貨單"
        description="出貨單由工單明細「開立出貨單」產生；開立時同步建立應收帳款。作廢會讓訂單回到進行中並作廢應收。"
      />

      {/* 篩選 */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs">狀態</Label>
          <Select
            value={statusFilter}
            onValueChange={(v) => {
              setStatusFilter(v);
              setPage(0);
            }}
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部</SelectItem>
              {STATUSES.map(([k, label]) => (
                <SelectItem key={k} value={k}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">出貨日期（起）</Label>
          <Input
            type="date"
            className="w-40"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setPage(0);
            }}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">出貨日期（迄）</Label>
          <Input
            type="date"
            className="w-40"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setPage(0);
            }}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">出貨單號</Label>
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="w-48 pl-8"
              placeholder="搜尋出貨單號"
              value={keywordInput}
              onChange={(e) => setKeywordInput(e.target.value)}
            />
          </div>
        </div>
      </div>

      {loadErr && (
        <p className="text-sm text-destructive">{humanizeError(loadErr, "載入出貨單")}</p>
      )}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>出貨單號</TableHead>
                <TableHead>日期</TableHead>
                <TableHead>工單號</TableHead>
                <TableHead>客戶</TableHead>
                <TableHead className="text-right">金額</TableHead>
                <TableHead>應收單號</TableHead>
                <TableHead>狀態</TableHead>
                <TableHead className="text-right">操作</TableHead>
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
                    沒有符合條件的出貨單
                  </TableCell>
                </TableRow>
              )}
              {rows.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-mono text-sm">{d.delivery_no}</TableCell>
                  <TableCell className="whitespace-nowrap text-sm">
                    {fmtDate(d.delivery_date)}
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {d.orders ? (
                      <Link
                        to="/dashboard/orders/$orderId"
                        params={{ orderId: d.order_id }}
                        className="text-primary hover:underline"
                      >
                        {d.orders.order_no}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="font-medium">{d.customers?.name ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {formatTWD(d.amount_total)}
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {d.receivables?.doc_no ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={statusBadgeClass[d.status] ?? ""}>
                      {statusLabel(d.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Button asChild size="sm" variant="ghost">
                      <Link to="/dashboard/deliveries" search={{ print: d.id }}>
                        <Printer className="h-3.5 w-3.5 mr-1" />
                        列印
                      </Link>
                    </Button>
                    {isManager && d.status === "issued" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => {
                          setVoidReason("");
                          setVoidTarget(d);
                        }}
                      >
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

      {/* 分頁 */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          第 {page + 1} 頁（每頁 {PAGE_SIZE} 筆）
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
          >
            <ChevronLeft className="w-4 h-4 mr-1" />
            上一頁
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={rows.length < PAGE_SIZE}
            onClick={() => setPage(page + 1)}
          >
            下一頁
            <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      </div>

      {/* 作廢確認 */}
      <Dialog open={!!voidTarget} onOpenChange={(o) => !o && setVoidTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>作廢出貨單</DialogTitle>
            <DialogDescription>
              作廢後訂單會回到「進行中」，對應的應收帳款也會一併作廢。此動作不可恢復。
            </DialogDescription>
          </DialogHeader>
          {voidTarget && (
            <p className="text-sm">
              出貨單 <span className="font-mono font-medium">{voidTarget.delivery_no}</span>（
              {voidTarget.customers?.name ?? "—"}／工單 {voidTarget.orders?.order_no ?? "—"}）
            </p>
          )}
          <div className="space-y-1">
            <Label>作廢原因 *</Label>
            <Textarea value={voidReason} rows={3} onChange={(e) => setVoidReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoidTarget(null)}>
              取消
            </Button>
            <Button variant="destructive" disabled={voiding} onClick={() => void confirmVoid()}>
              {voiding ? "作廢中…" : "確定作廢"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============== 列印 ==============

/** 列印時只印出貨單本體，隱藏側欄／頁首等外框（版面元件不在本頁控制內） */
const PRINT_CSS = `
@media print {
  @page { size: A4; margin: 12mm; }
  body * { visibility: hidden !important; }
  #delivery-print, #delivery-print * { visibility: visible !important; }
  #delivery-print { position: absolute; left: 0; top: 0; width: 100%; padding: 0 !important; border: 0 !important; box-shadow: none !important; }
}
`;

function PrintView({ deliveryId }: { deliveryId: string }) {
  const { company } = useAuth();
  const navigate = useNavigate();

  const {
    data: d,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["delivery_note_print", deliveryId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("delivery_notes")
        .select(
          "id, delivery_no, delivery_date, qty, unit, amount_untaxed, tax_amount, amount_total, status, receiver, address, note, orders:order_id(order_no, item_name, spec, qty, unit), customers:customer_id(name, tax_id, contact, phone, address), receivables:receivable_id(doc_no, due_date)",
        )
        .eq("id", deliveryId)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as DeliveryPrintRow | null;
    },
  });

  const back = () => void navigate({ to: "/dashboard/deliveries", search: {} });

  const qty = d?.qty ?? d?.orders?.qty ?? null;
  const unit = d?.unit ?? d?.orders?.unit ?? "";

  return (
    <div className="space-y-4">
      <style>{PRINT_CSS}</style>
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Button variant="outline" size="sm" onClick={back}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          回出貨單列表
        </Button>
        <Button size="sm" onClick={() => window.print()} disabled={!d}>
          <Printer className="h-4 w-4 mr-1" />
          列印
        </Button>
      </div>

      {isLoading && <p className="text-muted-foreground print:hidden">載入中…</p>}
      {error && (
        <p className="text-sm text-destructive print:hidden">
          {humanizeError(error, "載入出貨單")}
        </p>
      )}
      {!isLoading && !error && !d && (
        <p className="text-sm text-muted-foreground print:hidden">
          找不到這張出貨單（可能沒有權限）。
        </p>
      )}

      {d && (
        <div
          id="delivery-print"
          className="mx-auto max-w-[210mm] bg-white text-black p-8 border rounded-md shadow-sm space-y-6 text-sm"
        >
          <div className="text-center space-y-1">
            <div className="text-xl font-bold">{company?.name ?? ""}</div>
            <div className="text-lg tracking-[0.5em]">出貨單</div>
            {d.status === "void" && (
              <div className="text-red-600 font-bold text-lg">【已作廢】</div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
            <PrintField label="出貨單號" value={d.delivery_no} mono />
            <PrintField label="出貨日期" value={fmtDate(d.delivery_date)} />
            <PrintField label="客戶" value={d.customers?.name ?? "—"} />
            <PrintField label="統一編號" value={d.customers?.tax_id ?? "—"} />
            <PrintField label="收貨人" value={d.receiver ?? d.customers?.contact ?? "—"} />
            <PrintField label="電話" value={d.customers?.phone ?? "—"} />
            <div className="col-span-2">
              <PrintField label="送貨地址" value={d.address ?? d.customers?.address ?? "—"} />
            </div>
            <PrintField label="工單號" value={d.orders?.order_no ?? "—"} mono />
            <PrintField
              label="應收單號"
              value={
                d.receivables?.doc_no
                  ? `${d.receivables.doc_no}${d.receivables.due_date ? `（到期 ${fmtDate(d.receivables.due_date)}）` : ""}`
                  : "—"
              }
            />
          </div>

          <table className="w-full border-collapse">
            <thead>
              <tr className="border-y border-black">
                <th className="py-2 px-1 text-left w-10">項次</th>
                <th className="py-2 px-1 text-left">品名</th>
                <th className="py-2 px-1 text-left">規格</th>
                <th className="py-2 px-1 text-right w-24">數量</th>
                <th className="py-2 px-1 text-left w-14">單位</th>
                <th className="py-2 px-1 text-right w-28">未稅金額</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-black/40 align-top">
                <td className="py-2 px-1">1</td>
                <td className="py-2 px-1">{d.orders?.item_name ?? "—"}</td>
                <td className="py-2 px-1 whitespace-pre-wrap break-words">
                  {d.orders?.spec ?? ""}
                </td>
                <td className="py-2 px-1 text-right">
                  {qty != null ? new Intl.NumberFormat("zh-TW").format(Number(qty)) : "—"}
                </td>
                <td className="py-2 px-1">{unit}</td>
                <td className="py-2 px-1 text-right">{formatTWD(d.amount_untaxed)}</td>
              </tr>
            </tbody>
          </table>

          <div className="flex justify-end">
            <div className="w-64 space-y-1">
              <div className="flex justify-between">
                <span>未稅金額</span>
                <span className="font-mono">{formatTWD(d.amount_untaxed)}</span>
              </div>
              <div className="flex justify-between">
                <span>營業稅</span>
                <span className="font-mono">{formatTWD(d.tax_amount)}</span>
              </div>
              <div className="flex justify-between border-t border-black pt-1 font-bold">
                <span>含稅總計</span>
                <span className="font-mono">{formatTWD(d.amount_total)}</span>
              </div>
            </div>
          </div>

          {d.note && (
            <div>
              <span className="text-gray-600">備註：</span>
              <span className="whitespace-pre-wrap">{d.note}</span>
            </div>
          )}

          <div className="grid grid-cols-3 gap-6 pt-12">
            {["出貨人", "送貨人", "客戶簽收"].map((t) => (
              <div key={t} className="space-y-1">
                <div className="border-b border-black h-10" />
                <div className="text-center text-gray-600">{t}</div>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-500 text-right">簽收日期：＿＿＿＿年＿＿月＿＿日</p>
        </div>
      )}
    </div>
  );
}

function PrintField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-2">
      <span className="text-gray-600 shrink-0 w-16">{label}</span>
      <span className={mono ? "font-mono break-all" : "break-words"}>{value}</span>
    </div>
  );
}
