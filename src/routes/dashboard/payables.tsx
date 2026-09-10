import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
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

export const Route = createFileRoute("/dashboard/payables")({
  head: () => ({
    meta: [
      { title: "應付與付款" },
      { name: "description", content: "應付帳款管理與付款沖帳：到期追蹤、逾期提醒、付款作廢" },
      { property: "og:title", content: "應付與付款" },
      {
        property: "og:description",
        content: "應付帳款管理與付款沖帳：到期追蹤、逾期提醒、付款作廢",
      },
    ],
  }),
  component: () => (
    <RequirePerm module="payables">
      <Page />
    </RequirePerm>
  ),
});

interface Payable {
  id: string;
  company_id: string;
  doc_no: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  source_type: string | null;
  amount: number | null;
  paid_amount: number | null;
  balance: number | null;
  status: string | null;
  due_date: string | null;
  is_overdue: boolean | null;
  overdue_days: number | null;
  purchase_id?: string | null;
  source_id?: string | null;
}
interface Payment {
  id: string;
  payment_no: string | null;
  vendor_id: string | null;
  pay_date: string | null;
  method: string | null;
  amount: number | null;
  status: string | null;
  note: string | null;
  bank_account: string | null;
  check_no: string | null;
  check_due_date: string | null;
  vendor?: { name: string } | null;
  allocations?: {
    id: string;
    payable_id: string | null;
    amount: number | null;
    payable?: { doc_no: string | null } | null;
  }[];
}

const SOURCE_LABEL: Record<string, string> = {
  outsource: "外包",
  purchase: "進貨",
  manual: "手動",
};
const PAYABLE_STATUS: Record<string, string> = {
  unpaid: "未付",
  partial: "部分付款",
  paid: "已付清",
  void: "已作廢",
};
const METHOD_LABEL: Record<string, string> = {
  cash: "現金",
  transfer: "匯款",
  check: "支票",
  atm: "ATM",
};
const PAYMENT_STATUS: Record<string, string> = {
  confirmed: "已確認",
  void: "已作廢",
  draft: "草稿",
};

const num = (v: unknown) => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};
const payStatusVariant = (s: string | null) =>
  s === "paid" ? "default" : s === "void" ? "outline" : "secondary";

function Page() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="應付與付款"
        description="應付帳款到期追蹤與付款沖帳。作廢付款會反沖所有已沖帳金額。"
      />
      <Tabs defaultValue="payables">
        <TabsList>
          <TabsTrigger value="payables">應付管理</TabsTrigger>
          <TabsTrigger value="payments">付款管理</TabsTrigger>
        </TabsList>
        <TabsContent value="payables" className="mt-4">
          <PayablesTab />
        </TabsContent>
        <TabsContent value="payments" className="mt-4">
          <PaymentsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function useVendors(companyId: string | undefined) {
  return useQuery({
    queryKey: ["vendors_min", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vendors")
        .select("id, name, vendor_code")
        .order("vendor_code");
      if (error) throw error;
      return data as { id: string; name: string; vendor_code: string }[];
    },
  });
}

/* ---------------- Tab 1：應付管理 ---------------- */
function PayablesTab() {
  const { company } = useAuth();
  const { data: vendors = [] } = useVendors(company?.id);

  const [statusFilter, setStatusFilter] = useState("all");
  const [vendorFilter, setVendorFilter] = useState("all");
  const [overdueFilter, setOverdueFilter] = useState("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const {
    data: rows = [],
    isLoading,
    error: loadErr,
  } = useQuery({
    queryKey: ["payables_summary", company?.id],
    enabled: !!company?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payables_summary")
        .select("*")
        .eq("company_id", company!.id)
        .order("due_date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Payable[];
    },
  });

  const filtered = rows.filter(
    (r) =>
      (statusFilter === "all" || r.status === statusFilter) &&
      (vendorFilter === "all" || r.vendor_id === vendorFilter) &&
      (overdueFilter === "all" ||
        (overdueFilter === "yes" ? !!r.is_overdue : !r.is_overdue)),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <div className="w-40">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger>
              <SelectValue placeholder="狀態" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部狀態</SelectItem>
              <SelectItem value="unpaid">未付</SelectItem>
              <SelectItem value="partial">部分付款</SelectItem>
              <SelectItem value="paid">已付清</SelectItem>
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
        <div className="w-36">
          <Select value={overdueFilter} onValueChange={setOverdueFilter}>
            <SelectTrigger>
              <SelectValue placeholder="逾期" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">逾期不限</SelectItem>
              <SelectItem value="yes">只看逾期</SelectItem>
              <SelectItem value="no">未逾期</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {loadErr && (
        <p className="text-sm text-destructive">{humanizeError(loadErr, "載入應付帳款")}</p>
      )}

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>單號</TableHead>
                <TableHead>廠商</TableHead>
                <TableHead>來源</TableHead>
                <TableHead className="text-right">金額</TableHead>
                <TableHead className="text-right">已付</TableHead>
                <TableHead className="text-right">餘額</TableHead>
                <TableHead>狀態</TableHead>
                <TableHead>到期日</TableHead>
                <TableHead>逾期</TableHead>
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
                    尚無應付帳款
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((p) => (
                <Fragment key={p.id}>
                  <TableRow
                    className={`cursor-pointer ${p.is_overdue ? "bg-destructive/10" : ""}`}
                    onClick={() => setExpanded(expanded === p.id ? null : p.id)}
                  >
                    <TableCell>
                      {expanded === p.id ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronRight className="w-4 h-4" />
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-sm">{p.doc_no ?? "—"}</TableCell>
                    <TableCell className="font-medium">{p.vendor_name ?? "—"}</TableCell>
                    <TableCell className="text-sm">
                      {SOURCE_LABEL[p.source_type ?? ""] ?? p.source_type ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatTWD(p.amount)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatTWD(p.paid_amount)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {formatTWD(p.balance)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={payStatusVariant(p.status)}>
                        {PAYABLE_STATUS[p.status ?? ""] ?? p.status ?? "—"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">{fmtDate(p.due_date)}</TableCell>
                    <TableCell className="text-sm">
                      {p.is_overdue ? (
                        <span className="inline-flex items-center gap-1 text-destructive font-medium">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          逾期 {num(p.overdue_days)} 天
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  </TableRow>
                  {expanded === p.id && (
                    <TableRow>
                      <TableCell colSpan={10} className="bg-muted/40">
                        <PayableDetail payable={p} />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function PayableDetail({ payable }: { payable: Payable }) {
  const purchaseId = payable.purchase_id ?? payable.source_id ?? null;

  const { data: purchase } = useQuery({
    queryKey: ["payable_purchase", purchaseId],
    enabled: !!purchaseId && payable.source_type === "purchase",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchases")
        .select("id, purchase_no, purchase_date, total, status, items:purchase_items(item_name, qty, unit_price, amount)")
        .eq("id", purchaseId!)
        .maybeSingle();
      if (error) throw error;
      return data as {
        purchase_no: string;
        purchase_date: string;
        total: number;
        status: string;
        items: { item_name: string; qty: number; unit_price: number; amount: number }[];
      } | null;
    },
  });

  const { data: allocations = [] } = useQuery({
    queryKey: ["payable_allocations", payable.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payment_allocations")
        .select("id, amount, payment:payments(payment_no, pay_date, method, status)")
        .eq("payable_id", payable.id);
      if (error) throw error;
      return (data ?? []) as {
        id: string;
        amount: number;
        payment?: {
          payment_no: string;
          pay_date: string;
          method: string;
          status: string;
        } | null;
      }[];
    },
  });

  return (
    <div className="grid gap-6 md:grid-cols-2 py-3">
      <div className="space-y-2">
        <p className="text-sm font-medium">關聯採購單</p>
        {purchase ? (
          <div className="text-sm space-y-1">
            <p className="font-mono">
              {purchase.purchase_no} · {fmtDate(purchase.purchase_date)} ·{" "}
              {formatTWD(purchase.total)}
            </p>
            <ul className="text-muted-foreground space-y-0.5">
              {(purchase.items ?? []).map((it, i) => (
                <li key={i}>
                  {it.item_name} × {num(it.qty)} = {formatTWD(it.amount)}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">無關聯採購單</p>
        )}
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">付款沖帳明細</p>
        {allocations.length === 0 ? (
          <p className="text-sm text-muted-foreground">尚無沖帳紀錄</p>
        ) : (
          <ul className="text-sm space-y-1">
            {allocations.map((a) => (
              <li key={a.id} className="flex justify-between gap-3">
                <span className="font-mono">
                  {a.payment?.payment_no ?? "—"} · {fmtDate(a.payment?.pay_date)} ·{" "}
                  {METHOD_LABEL[a.payment?.method ?? ""] ?? a.payment?.method ?? "—"}
                  {a.payment?.status === "void" && (
                    <Badge variant="outline" className="ml-2">
                      已作廢
                    </Badge>
                  )}
                </span>
                <span className="tabular-nums">{formatTWD(a.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ---------------- Tab 2：付款管理 ---------------- */
function PaymentsTab() {
  const { company, can } = useAuth();
  const qc = useQueryClient();
  const canCreate = can("payables", "create");
  const canEdit = can("payables", "edit");

  const [openForm, setOpenForm] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [voidTarget, setVoidTarget] = useState<Payment | null>(null);

  const {
    data: rows = [],
    isLoading,
    error: loadErr,
  } = useQuery({
    queryKey: ["payments", company?.id],
    enabled: !!company?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments")
        .select(
          "id, payment_no, vendor_id, pay_date, method, amount, status, note, bank_account, check_no, check_due_date, vendor:vendors(name), allocations:payment_allocations(id, payable_id, amount, payable:payables(doc_no))",
        )
        .eq("company_id", company!.id)
        .order("pay_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Payment[];
    },
  });

  const reload = () => {
    qc.invalidateQueries({ queryKey: ["payments", company?.id] });
    qc.invalidateQueries({ queryKey: ["payables_summary", company?.id] });
    qc.invalidateQueries({ queryKey: ["vendor_open_payables"] });
    qc.invalidateQueries({ queryKey: ["payable_allocations"] });
  };

  const doVoid = async () => {
    if (!voidTarget) return;
    const { error } = await supabase.rpc("void_payment", { p_payment_id: voidTarget.id });
    if (error) {
      toast.error(humanizeError(error, "作廢付款"));
      return;
    }
    toast.success("已作廢付款，沖帳金額已反沖");
    setVoidTarget(null);
    reload();
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {canCreate && (
          <Button onClick={() => setOpenForm(true)}>
            <Plus className="w-4 h-4 mr-1" />
            新增付款
          </Button>
        )}
      </div>

      {loadErr && <p className="text-sm text-destructive">{humanizeError(loadErr, "載入付款")}</p>}

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>付款單號</TableHead>
                <TableHead>廠商</TableHead>
                <TableHead>付款日</TableHead>
                <TableHead>方式</TableHead>
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
              {!isLoading && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    尚無付款紀錄
                  </TableCell>
                </TableRow>
              )}
              {rows.map((p) => (
                <Fragment key={p.id}>
                  <TableRow
                    className={`cursor-pointer ${p.status === "void" ? "opacity-60" : ""}`}
                    onClick={() => setExpanded(expanded === p.id ? null : p.id)}
                  >
                    <TableCell>
                      {expanded === p.id ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronRight className="w-4 h-4" />
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-sm">{p.payment_no ?? "—"}</TableCell>
                    <TableCell className="font-medium">{p.vendor?.name ?? "—"}</TableCell>
                    <TableCell className="text-sm">{fmtDate(p.pay_date)}</TableCell>
                    <TableCell className="text-sm">
                      {METHOD_LABEL[p.method ?? ""] ?? p.method ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {formatTWD(p.amount)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={p.status === "void" ? "outline" : "default"}>
                        {PAYMENT_STATUS[p.status ?? ""] ?? p.status ?? "—"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      {canEdit && p.status === "confirmed" && (
                        <Button size="sm" variant="destructive" onClick={() => setVoidTarget(p)}>
                          作廢
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                  {expanded === p.id && (
                    <TableRow>
                      <TableCell colSpan={8} className="bg-muted/40">
                        <div className="py-3 space-y-2">
                          <p className="text-sm font-medium">沖帳明細</p>
                          {(p.allocations ?? []).length === 0 ? (
                            <p className="text-sm text-muted-foreground">無沖帳明細</p>
                          ) : (
                            <ul className="text-sm space-y-1 max-w-md">
                              {(p.allocations ?? []).map((a) => (
                                <li key={a.id} className="flex justify-between gap-3">
                                  <span className="font-mono">{a.payable?.doc_no ?? "—"}</span>
                                  <span className="tabular-nums">{formatTWD(a.amount)}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                          {(p.bank_account || p.check_no || p.note) && (
                            <p className="text-sm text-muted-foreground">
                              {p.bank_account && `銀行帳號 ${p.bank_account}　`}
                              {p.check_no &&
                                `支票號碼 ${p.check_no}（到期 ${fmtDate(p.check_due_date)}）　`}
                              {p.note && `備註：${p.note}`}
                            </p>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <PaymentDialog open={openForm} onClose={() => setOpenForm(false)} onSaved={reload} />

      <AlertDialog open={!!voidTarget} onOpenChange={(o) => !o && setVoidTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>作廢付款 {voidTarget?.payment_no}</AlertDialogTitle>
            <AlertDialogDescription>
              作廢將反沖所有已沖帳金額，確定？
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

function PaymentDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { company, user } = useAuth();
  const { data: vendors = [] } = useVendors(company?.id);

  const [vendorId, setVendorId] = useState("");
  const [payDate, setPayDate] = useState(taipeiToday());
  const [method, setMethod] = useState("transfer");
  const [bankAccount, setBankAccount] = useState("");
  const [checkNo, setCheckNo] = useState("");
  const [checkDueDate, setCheckDueDate] = useState("");
  const [note, setNote] = useState("");
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setVendorId("");
    setPayDate(taipeiToday());
    setMethod("transfer");
    setBankAccount("");
    setCheckNo("");
    setCheckDueDate("");
    setNote("");
    setAlloc({});
  };

  const { data: openPayables = [] } = useQuery({
    queryKey: ["vendor_open_payables", company?.id, vendorId],
    enabled: !!company?.id && !!vendorId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payables_summary")
        .select("*")
        .eq("company_id", company!.id)
        .eq("vendor_id", vendorId)
        .in("status", ["unpaid", "partial"])
        .order("due_date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Payable[];
    },
  });

  const total = useMemo(
    () => Object.values(alloc).reduce((s, v) => s + num(v), 0),
    [alloc],
  );

  const toggle = (p: Payable, checked: boolean) => {
    setAlloc((prev) => {
      const next = { ...prev };
      if (checked) next[p.id] = String(num(p.balance));
      else delete next[p.id];
      return next;
    });
  };

  const submit = async () => {
    if (!company) return;
    if (!vendorId) {
      toast.error("請選擇廠商");
      return;
    }
    const allocations = Object.entries(alloc)
      .filter(([, v]) => num(v) > 0)
      .map(([payable_id, v]) => ({ payable_id, amount: num(v) }));
    if (!allocations.length) {
      toast.error("請至少勾選一筆應付並填寫沖帳金額");
      return;
    }
    const over = allocations.find((a) => {
      const p = openPayables.find((x) => x.id === a.payable_id);
      return p && a.amount > num(p.balance);
    });
    if (over) {
      toast.error("沖帳金額不可大於該筆應付餘額");
      return;
    }
    if (method === "check" && !checkNo.trim()) {
      toast.error("支票付款請填寫支票號碼");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.rpc("allocate_payment", {
        p_company_id: company.id,
        p_vendor_id: vendorId,
        p_pay_date: payDate,
        p_method: method,
        p_amount: total,
        p_allocations: JSON.stringify(allocations),
        p_bank_account: bankAccount.trim() || null,
        p_check_no: checkNo.trim() || null,
        p_check_due_date: checkDueDate || null,
        p_note: note.trim() || null,
        p_created_by: user?.id ?? null,
      });
      if (error) throw error;
      toast.success("已建立付款並完成沖帳");
      reset();
      onClose();
      onSaved();
    } catch (e) {
      toast.error(humanizeError(e, "建立付款"));
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
        }
      }}
    >
      <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>新增付款</DialogTitle>
          <DialogDescription>
            選擇廠商後載入未付／部分付的應付；合計金額由沖帳金額自動加總。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label>廠商 *</Label>
              <Select
                value={vendorId}
                onValueChange={(v) => {
                  setVendorId(v);
                  setAlloc({});
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="選擇廠商" />
                </SelectTrigger>
                <SelectContent>
                  {vendors.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>付款日期 *</Label>
              <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>付款方式 *</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">現金</SelectItem>
                  <SelectItem value="transfer">匯款</SelectItem>
                  <SelectItem value="check">支票</SelectItem>
                  <SelectItem value="atm">ATM</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {method === "transfer" && (
            <div className="space-y-1 sm:max-w-sm">
              <Label>銀行帳號</Label>
              <Input value={bankAccount} onChange={(e) => setBankAccount(e.target.value)} />
            </div>
          )}
          {method === "check" && (
            <div className="grid gap-3 sm:grid-cols-2 sm:max-w-lg">
              <div className="space-y-1">
                <Label>支票號碼 *</Label>
                <Input value={checkNo} onChange={(e) => setCheckNo(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>票據到期日</Label>
                <Input
                  type="date"
                  value={checkDueDate}
                  onChange={(e) => setCheckDueDate(e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label>沖帳應付</Label>
            {!vendorId && <p className="text-sm text-muted-foreground">請先選擇廠商</p>}
            {vendorId && openPayables.length === 0 && (
              <p className="text-sm text-muted-foreground">此廠商目前沒有未付的應付帳款</p>
            )}
            {openPayables.length > 0 && (
              <div className="border rounded-md overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10" />
                      <TableHead>單號</TableHead>
                      <TableHead>到期日</TableHead>
                      <TableHead className="text-right">餘額</TableHead>
                      <TableHead className="text-right w-40">本次沖帳</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {openPayables.map((p) => {
                      const checked = p.id in alloc;
                      return (
                        <TableRow key={p.id} className={p.is_overdue ? "bg-destructive/10" : ""}>
                          <TableCell>
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(c) => toggle(p, c === true)}
                            />
                          </TableCell>
                          <TableCell className="font-mono text-sm">{p.doc_no ?? "—"}</TableCell>
                          <TableCell className="text-sm">{fmtDate(p.due_date)}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatTWD(p.balance)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              min={0}
                              disabled={!checked}
                              className="text-right"
                              value={alloc[p.id] ?? ""}
                              onChange={(e) =>
                                setAlloc((prev) => ({ ...prev, [p.id]: e.target.value }))
                              }
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>

          <div className="flex justify-end items-baseline gap-3 border-t pt-3">
            <span className="text-sm text-muted-foreground">合計金額</span>
            <span className="text-xl font-bold tabular-nums">{formatTWD(total)}</span>
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
          <Button onClick={submit} disabled={saving || total <= 0}>
            {saving ? "送出中…" : "送出付款"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
