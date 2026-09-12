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

export const Route = createFileRoute("/dashboard/receivables")({
  head: () => ({
    meta: [
      { title: "應收與收款" },
      { name: "description", content: "應收帳款管理與收款沖帳：到期追蹤、逾期提醒、收款作廢" },
      { property: "og:title", content: "應收與收款" },
      {
        property: "og:description",
        content: "應收帳款管理與收款沖帳：到期追蹤、逾期提醒、收款作廢",
      },
    ],
  }),
  component: () => (
    <RequirePerm module="receivables">
      <Page />
    </RequirePerm>
  ),
});

/* ---- types ---- */
interface Receivable {
  id: string;
  company_id: string;
  doc_no: string | null;
  customer_id: string | null;
  customer_name: string | null;
  customer_code: string | null;
  source_type: string | null;
  amount: number | null;
  received_amount: number | null;
  balance: number | null;
  status: string | null;
  due_date: string | null;
  is_overdue: boolean | null;
  overdue_days: number | null;
  related_order_id?: string | null;
  invoice_no?: string | null;
}
interface Collection {
  id: string;
  collection_no: string | null;
  customer_id: string | null;
  collect_date: string | null;
  method: string | null;
  amount: number | null;
  status: string | null;
  note: string | null;
  bank_account: string | null;
  check_no: string | null;
  check_due_date: string | null;
  customer?: { name: string } | null;
  allocations?: {
    id: string;
    receivable_id: string | null;
    allocated_amount: number | null;
    receivable?: { doc_no: string | null } | null;
  }[];
}

const SOURCE_LABEL: Record<string, string> = {
  outsource: "外包",
  order: "訂單",
  manual: "手動",
  quotation: "報價單",
};
const RECV_STATUS: Record<string, string> = {
  unreceived: "未收",
  partial: "部分收款",
  received: "已收清",
  void: "已作廢",
};
const METHOD_LABEL: Record<string, string> = {
  cash: "現金",
  transfer: "匯款",
  check: "支票",
  atm: "ATM",
};
const COLL_STATUS: Record<string, string> = {
  confirmed: "已確認",
  void: "已作廢",
  draft: "草稿",
};

const num = (v: unknown) => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};
const recvStatusVariant = (s: string | null) =>
  s === "received" ? "default" : s === "void" ? "outline" : "secondary";

/* ---- main page ---- */
function Page() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="應收與收款"
        description="應收帳款到期追蹤與收款沖帳。作廢收款會反沖所有已沖帳金額。"
      />
      <Tabs defaultValue="receivables">
        <TabsList>
          <TabsTrigger value="receivables">應收管理</TabsTrigger>
          <TabsTrigger value="collections">收款管理</TabsTrigger>
        </TabsList>
        <TabsContent value="receivables" className="mt-4">
          <ReceivablesTab />
        </TabsContent>
        <TabsContent value="collections" className="mt-4">
          <CollectionsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function useCustomers(companyId: string | undefined) {
  return useQuery({
    queryKey: ["customers_min", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id, name, customer_code")
        .order("customer_code");
      if (error) throw error;
      return data as { id: string; name: string; customer_code: string }[];
    },
  });
}

/* ============ Tab 1: 應收管理 ============ */
function ReceivablesTab() {
  const { company } = useAuth();
  const { data: customers = [] } = useCustomers(company?.id);

  const [statusFilter, setStatusFilter] = useState("all");
  const [customerFilter, setCustomerFilter] = useState("all");
  const [overdueFilter, setOverdueFilter] = useState("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const {
    data: rows = [],
    isLoading,
    error: loadErr,
  } = useQuery({
    queryKey: ["receivables_summary", company?.id],
    enabled: !!company?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("receivables_summary")
        .select("*")
        .eq("company_id", company!.id)
        .order("due_date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Receivable[];
    },
  });

  const filtered = rows.filter(
    (r) =>
      (statusFilter === "all" || r.status === statusFilter) &&
      (customerFilter === "all" || r.customer_id === customerFilter) &&
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
              <SelectItem value="unreceived">未收</SelectItem>
              <SelectItem value="partial">部分收款</SelectItem>
              <SelectItem value="received">已收清</SelectItem>
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
        <p className="text-sm text-destructive">{humanizeError(loadErr, "載入應收帳款")}</p>
      )}

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>單號</TableHead>
                <TableHead>客戶</TableHead>
                <TableHead>來源</TableHead>
                <TableHead className="text-right">金額</TableHead>
                <TableHead className="text-right">已收</TableHead>
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
                    尚無應收帳款
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((r) => (
                <Fragment key={r.id}>
                  <TableRow
                    className={`cursor-pointer ${r.is_overdue ? "bg-destructive/10" : ""}`}
                    onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                  >
                    <TableCell>
                      {expanded === r.id ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronRight className="w-4 h-4" />
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-sm">{r.doc_no ?? "—"}</TableCell>
                    <TableCell className="font-medium">{r.customer_name ?? "—"}</TableCell>
                    <TableCell className="text-sm">
                      {SOURCE_LABEL[r.source_type ?? ""] ?? r.source_type ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatTWD(r.amount)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatTWD(r.received_amount)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {formatTWD(r.balance)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={recvStatusVariant(r.status)}>
                        {RECV_STATUS[r.status ?? ""] ?? r.status ?? "—"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">{fmtDate(r.due_date)}</TableCell>
                    <TableCell className="text-sm">
                      {r.is_overdue ? (
                        <span className="inline-flex items-center gap-1 text-destructive font-medium">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          逾期 {num(r.overdue_days)} 天
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  </TableRow>
                  {expanded === r.id && (
                    <TableRow>
                      <TableCell colSpan={10} className="bg-muted/40">
                        <ReceivableDetail receivable={r} />
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

function ReceivableDetail({ receivable }: { receivable: Receivable }) {
  const { data: allocations = [] } = useQuery({
    queryKey: ["receivable_allocations", receivable.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("collection_allocations")
        .select(
          "id, allocated_amount, collection:collections(collection_no, collect_date, method, status)",
        )
        .eq("receivable_id", receivable.id);
      if (error) throw error;
      return (data ?? []) as unknown as {
        id: string;
        allocated_amount: number;
        collection?: {
          collection_no: string;
          collect_date: string;
          method: string;
          status: string;
        } | null;
      }[];
    },
  });

  return (
    <div className="py-3 space-y-2">
      <div className="flex flex-wrap gap-4 text-sm">
        {receivable.invoice_no && <span>發票號碼：{receivable.invoice_no}</span>}
        {receivable.related_order_id && <span>關聯訂單</span>}
      </div>
      <p className="text-sm font-medium">收款沖帳明細</p>
      {allocations.length === 0 ? (
        <p className="text-sm text-muted-foreground">尚無沖帳紀錄</p>
      ) : (
        <ul className="text-sm space-y-1">
          {allocations.map((a) => (
            <li key={a.id} className="flex justify-between gap-3 max-w-lg">
              <span className="font-mono">
                {a.collection?.collection_no ?? "—"} · {fmtDate(a.collection?.collect_date)} ·{" "}
                {METHOD_LABEL[a.collection?.method ?? ""] ?? a.collection?.method ?? "—"}
                {a.collection?.status === "void" && (
                  <Badge variant="outline" className="ml-2">
                    已作廢
                  </Badge>
                )}
              </span>
              <span className="tabular-nums">{formatTWD(a.allocated_amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ============ Tab 2: 收款管理 ============ */
function CollectionsTab() {
  const { company, can } = useAuth();
  const qc = useQueryClient();
  const canCreate = can("receivables", "create");
  const canEdit = can("receivables", "edit");

  const [openForm, setOpenForm] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [voidTarget, setVoidTarget] = useState<Collection | null>(null);

  const {
    data: rows = [],
    isLoading,
    error: loadErr,
  } = useQuery({
    queryKey: ["collections", company?.id],
    enabled: !!company?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("collections")
        .select(
          "id, collection_no, customer_id, collect_date, method, amount, status, note, bank_account, check_no, check_due_date, customer:customers(name), allocations:collection_allocations(id, receivable_id, allocated_amount, receivable:receivables(doc_no))",
        )
        .eq("company_id", company!.id)
        .order("collect_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Collection[];
    },
  });

  const reload = () => {
    qc.invalidateQueries({ queryKey: ["collections", company?.id] });
    qc.invalidateQueries({ queryKey: ["receivables_summary", company?.id] });
    qc.invalidateQueries({ queryKey: ["customer_open_receivables"] });
    qc.invalidateQueries({ queryKey: ["receivable_allocations"] });
  };

  const doVoid = async () => {
    if (!voidTarget) return;
    const { error } = await supabase.rpc("void_collection", {
      p_collection_id: voidTarget.id,
    });
    if (error) {
      toast.error(humanizeError(error, "作廢收款"));
      return;
    }
    toast.success("已作廢收款，沖帳金額已反沖");
    setVoidTarget(null);
    reload();
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {canCreate && (
          <Button onClick={() => setOpenForm(true)}>
            <Plus className="w-4 h-4 mr-1" />
            新增收款
          </Button>
        )}
      </div>

      {loadErr && (
        <p className="text-sm text-destructive">{humanizeError(loadErr, "載入收款")}</p>
      )}

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>收款單號</TableHead>
                <TableHead>客戶</TableHead>
                <TableHead>收款日</TableHead>
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
                    尚無收款紀錄
                  </TableCell>
                </TableRow>
              )}
              {rows.map((c) => (
                <Fragment key={c.id}>
                  <TableRow
                    className={`cursor-pointer ${c.status === "void" ? "opacity-60" : ""}`}
                    onClick={() => setExpanded(expanded === c.id ? null : c.id)}
                  >
                    <TableCell>
                      {expanded === c.id ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronRight className="w-4 h-4" />
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {c.collection_no ?? "—"}
                    </TableCell>
                    <TableCell className="font-medium">{c.customer?.name ?? "—"}</TableCell>
                    <TableCell className="text-sm">{fmtDate(c.collect_date)}</TableCell>
                    <TableCell className="text-sm">
                      {METHOD_LABEL[c.method ?? ""] ?? c.method ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {formatTWD(c.amount)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={c.status === "void" ? "outline" : "default"}>
                        {COLL_STATUS[c.status ?? ""] ?? c.status ?? "—"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      {canEdit && c.status === "confirmed" && (
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => setVoidTarget(c)}
                        >
                          作廢
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                  {expanded === c.id && (
                    <TableRow>
                      <TableCell colSpan={8} className="bg-muted/40">
                        <div className="py-3 space-y-2">
                          <p className="text-sm font-medium">沖帳明細</p>
                          {(c.allocations ?? []).length === 0 ? (
                            <p className="text-sm text-muted-foreground">無沖帳明細</p>
                          ) : (
                            <ul className="text-sm space-y-1 max-w-md">
                              {(c.allocations ?? []).map((a) => (
                                <li key={a.id} className="flex justify-between gap-3">
                                  <span className="font-mono">
                                    {a.receivable?.doc_no ?? "—"}
                                  </span>
                                  <span className="tabular-nums">
                                    {formatTWD(a.allocated_amount)}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                          {(c.bank_account || c.check_no || c.note) && (
                            <p className="text-sm text-muted-foreground">
                              {c.bank_account && `銀行帳號 ${c.bank_account}　`}
                              {c.check_no &&
                                `支票號碼 ${c.check_no}（到期 ${fmtDate(c.check_due_date)}）　`}
                              {c.note && `備註：${c.note}`}
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

      <CollectionDialog open={openForm} onClose={() => setOpenForm(false)} onSaved={reload} />

      <AlertDialog open={!!voidTarget} onOpenChange={(o) => !o && setVoidTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>作廢收款 {voidTarget?.collection_no}</AlertDialogTitle>
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

/* ---- collection dialog ---- */
function CollectionDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { company, user } = useAuth();
  const { data: customers = [] } = useCustomers(company?.id);

  const [customerId, setCustomerId] = useState("");
  const [collectDate, setCollectDate] = useState(taipeiToday());
  const [method, setMethod] = useState("transfer");
  const [bankAccount, setBankAccount] = useState("");
  const [checkNo, setCheckNo] = useState("");
  const [checkDueDate, setCheckDueDate] = useState("");
  const [note, setNote] = useState("");
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setCustomerId("");
    setCollectDate(taipeiToday());
    setMethod("transfer");
    setBankAccount("");
    setCheckNo("");
    setCheckDueDate("");
    setNote("");
    setAlloc({});
  };

  const { data: openReceivables = [] } = useQuery({
    queryKey: ["customer_open_receivables", company?.id, customerId],
    enabled: !!company?.id && !!customerId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("receivables_summary")
        .select("*")
        .eq("company_id", company!.id)
        .eq("customer_id", customerId)
        .in("status", ["unreceived", "partial"])
        .order("due_date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Receivable[];
    },
  });

  const total = useMemo(
    () => Object.values(alloc).reduce((s, v) => s + num(v), 0),
    [alloc],
  );

  const toggle = (r: Receivable, checked: boolean) => {
    setAlloc((prev) => {
      const next = { ...prev };
      if (checked) next[r.id] = String(num(r.balance));
      else delete next[r.id];
      return next;
    });
  };

  const submit = async () => {
    if (!company) return;
    if (!customerId) {
      toast.error("請選擇客戶");
      return;
    }
    const allocations = Object.entries(alloc)
      .filter(([, v]) => num(v) > 0)
      .map(([receivable_id, v]) => ({ receivable_id, amount: num(v) }));
    if (!allocations.length) {
      toast.error("請至少勾選一筆應收並填寫沖帳金額");
      return;
    }
    const over = allocations.find((a) => {
      const r = openReceivables.find((x) => x.id === a.receivable_id);
      return r && a.amount > num(r.balance);
    });
    if (over) {
      toast.error("沖帳金額不可大於該筆應收餘額");
      return;
    }
    if (method === "check" && !checkNo.trim()) {
      toast.error("支票收款請填寫支票號碼");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.rpc("allocate_collection", {
        p_company_id: company.id,
        p_customer_id: customerId,
        p_collect_date: collectDate,
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
      toast.success("已建立收款並完成沖帳");
      reset();
      onClose();
      onSaved();
    } catch (e) {
      toast.error(humanizeError(e, "建立收款"));
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
          <DialogTitle>新增收款</DialogTitle>
          <DialogDescription>
            選擇客戶後載入未收／部分收款的應收帳款；合計金額由沖帳金額自動加總。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label>客戶 *</Label>
              <Select
                value={customerId}
                onValueChange={(v) => {
                  setCustomerId(v);
                  setAlloc({});
                }}
              >
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
              <Label>收款日期 *</Label>
              <Input
                type="date"
                value={collectDate}
                onChange={(e) => setCollectDate(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>收款方式 *</Label>
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
            <Label>沖帳應收</Label>
            {!customerId && (
              <p className="text-sm text-muted-foreground">請先選擇客戶</p>
            )}
            {customerId && openReceivables.length === 0 && (
              <p className="text-sm text-muted-foreground">此客戶目前沒有未收的應收帳款</p>
            )}
            {openReceivables.length > 0 && (
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
                    {openReceivables.map((r) => {
                      const checked = r.id in alloc;
                      return (
                        <TableRow
                          key={r.id}
                          className={r.is_overdue ? "bg-destructive/10" : ""}
                        >
                          <TableCell>
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(c) => toggle(r, c === true)}
                            />
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {r.doc_no ?? "—"}
                          </TableCell>
                          <TableCell className="text-sm">{fmtDate(r.due_date)}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatTWD(r.balance)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              min={0}
                              disabled={!checked}
                              className="text-right"
                              value={alloc[r.id] ?? ""}
                              onChange={(e) =>
                                setAlloc((prev) => ({ ...prev, [r.id]: e.target.value }))
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
            {saving ? "送出中…" : "送出收款"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
