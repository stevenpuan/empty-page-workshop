/**
 * 應收／應付共用頁面：帳款、收付款紀錄、收付款沖帳、預收預付再沖帳、沖銷、手動帳款。
 * 所有寫入都走資料庫 RPC（028_ar_ap_complete）；帳務表前端只能讀。
 */
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Download,
  FilePlus2,
  MoreHorizontal,
  Plus,
  Wand2,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { humanizeError } from "@/lib/app-error";
import { fmtDate, formatTWD, taipeiToday } from "@/lib/dates";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  METHOD_LABEL,
  TX_METHODS,
  num,
  round2,
  type LedgerConfig,
} from "@/components/finance/ledger-config";

/* ======================= 型別與資料 ======================= */

interface Party {
  id: string;
  name: string;
  code: string | null;
}

interface Doc {
  id: string;
  doc_no: string;
  party_id: string;
  party_name: string;
  party_code: string | null;
  source_type: string;
  amount: number;
  settled: number;
  balance: number;
  status: string;
  due_date: string | null;
  invoice_no: string | null;
  note: string | null;
  related_order_id: string | null;
  order_no: string | null;
  is_open: boolean;
  is_overdue: boolean;
  overdue_days: number;
}

interface TxAlloc {
  id: string;
  doc_id: string;
  doc_no: string | null;
  amount: number;
  voided: boolean;
}

interface Tx {
  id: string;
  tx_no: string;
  party_id: string;
  party_name: string;
  tx_date: string;
  method: string;
  amount: number;
  fee: number;
  discount: number;
  allocated: number;
  unallocated: number;
  status: string;
  note: string | null;
  bank_account: string | null;
  check_no: string | null;
  check_due_date: string | null;
  allocations: TxAlloc[];
}

/** 查詢回來的原始列（欄位名稱依應收／應付不同，固定欄位列在這裡方便存取） */
type Row = {
  [k: string]: unknown;
  id?: unknown;
  name?: unknown;
  doc_no?: unknown;
  party?: unknown;
  order?: unknown;
  doc?: unknown;
  tx?: unknown;
  allocations?: unknown;
  amount?: unknown;
  fee_amount?: unknown;
  discount_amount?: unknown;
  allocated_amount?: unknown;
  unallocated_amount?: unknown;
  status?: unknown;
  method?: unknown;
  due_date?: unknown;
  source_type?: unknown;
  invoice_no?: unknown;
  note?: unknown;
  related_order_id?: unknown;
  bank_account?: unknown;
  check_no?: unknown;
  check_due_date?: unknown;
  voided_at?: unknown;
};

const daysBetween = (from: string, to: string) => {
  const toUtc = (s: string) => {
    const [y = 0, m = 1, d = 1] = s.slice(0, 10).split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(to) - toUtc(from)) / 86400000);
};

function toDoc(cfg: LedgerConfig, r: Row, today: string): Doc {
  const party = (r.party ?? null) as { name?: string; [k: string]: unknown } | null;
  const order = (r.order ?? null) as { order_no?: string } | null;
  const amount = num(r.amount);
  const settled = num(r[cfg.settledCol]);
  const status = String(r.status ?? "");
  const due = (r.due_date as string | null) ?? null;
  const isOpen = cfg.openStatuses.includes(status);
  const overdue = isOpen && !!due && due < today;
  return {
    id: String(r.id),
    doc_no: String(r.doc_no ?? ""),
    party_id: String(r[cfg.partyFk] ?? ""),
    party_name: party?.name ?? "—",
    party_code: (party?.[cfg.partyCodeCol] as string | null) ?? null,
    source_type: String(r.source_type ?? ""),
    amount,
    settled,
    balance: round2(amount - settled),
    status,
    due_date: due,
    invoice_no: (r.invoice_no as string | null) ?? null,
    note: (r.note as string | null) ?? null,
    related_order_id: (r.related_order_id as string | null) ?? null,
    order_no: order?.order_no ?? null,
    is_open: isOpen,
    is_overdue: overdue,
    overdue_days: overdue && due ? daysBetween(due, today) : 0,
  };
}

function toTx(cfg: LedgerConfig, r: Row): Tx {
  const party = (r.party ?? null) as { name?: string } | null;
  const allocs = (r.allocations ?? []) as Row[];
  return {
    id: String(r.id),
    tx_no: String(r[cfg.txNoCol] ?? ""),
    party_id: String(r[cfg.partyFk] ?? ""),
    party_name: party?.name ?? "—",
    tx_date: String(r[cfg.txDateCol] ?? ""),
    method: String(r.method ?? ""),
    amount: num(r.amount),
    fee: num(r.fee_amount),
    discount: num(r.discount_amount),
    allocated: num(r.allocated_amount),
    unallocated: num(r.unallocated_amount),
    status: String(r.status ?? ""),
    note: (r.note as string | null) ?? null,
    bank_account: (r.bank_account as string | null) ?? null,
    check_no: (r.check_no as string | null) ?? null,
    check_due_date: (r.check_due_date as string | null) ?? null,
    allocations: allocs.map((a) => ({
      id: String(a.id),
      doc_id: String(a[cfg.docIdKey] ?? ""),
      doc_no: ((a.doc as { doc_no?: string } | null)?.doc_no ?? null) as string | null,
      amount: num(a.allocated_amount),
      voided: !!a.voided_at,
    })),
  };
}

function docSelect(cfg: LedgerConfig) {
  return `id, doc_no, ${cfg.partyFk}, source_type, amount, ${cfg.settledCol}, status, due_date, invoice_no, note, related_order_id, party:${cfg.partyTable}(name, ${cfg.partyCodeCol}), order:related_order_id(order_no)`;
}
function txSelect(cfg: LedgerConfig) {
  return `id, ${cfg.txNoCol}, ${cfg.partyFk}, ${cfg.txDateCol}, method, amount, fee_amount, discount_amount, allocated_amount, unallocated_amount, status, note, bank_account, check_no, check_due_date, party:${cfg.partyTable}(name), allocations:${cfg.allocTable}(id, ${cfg.docIdKey}, allocated_amount, voided_at, doc:${cfg.docTable}(doc_no))`;
}

function useParties(cfg: LedgerConfig, companyId: string | undefined) {
  return useQuery({
    queryKey: ["ledger_parties", cfg.partyTable, companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<Party[]> => {
      const { data, error } = await supabase
        .from(cfg.partyTable)
        .select(`id, name, ${cfg.partyCodeCol}`)
        .eq("company_id", companyId!)
        .order(cfg.partyCodeCol);
      if (error) throw error;
      return ((data ?? []) as unknown as Row[]).map((p) => ({
        id: String(p.id),
        name: String(p.name ?? ""),
        code: (p[cfg.partyCodeCol] as string | null) ?? null,
      }));
    },
  });
}

function useDocs(cfg: LedgerConfig, companyId: string | undefined) {
  return useQuery({
    queryKey: ["ledger_docs", cfg.kind, companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<Doc[]> => {
      const { data, error } = await supabase
        .from(cfg.docTable)
        .select(docSelect(cfg))
        .eq("company_id", companyId!)
        .order("due_date", { ascending: true })
        .limit(1000);
      if (error) throw error;
      const today = taipeiToday();
      return ((data ?? []) as unknown as Row[]).map((r) => toDoc(cfg, r, today));
    },
  });
}

function useTxs(cfg: LedgerConfig, companyId: string | undefined) {
  return useQuery({
    queryKey: ["ledger_txs", cfg.kind, companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<Tx[]> => {
      const { data, error } = await supabase
        .from(cfg.txTable)
        .select(txSelect(cfg))
        .eq("company_id", companyId!)
        .order(cfg.txDateCol, { ascending: false })
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return ((data ?? []) as unknown as Row[]).map((r) => toTx(cfg, r));
    },
  });
}

function useReload(cfg: LedgerConfig) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["ledger_docs", cfg.kind] });
    void qc.invalidateQueries({ queryKey: ["ledger_txs", cfg.kind] });
    void qc.invalidateQueries({ queryKey: ["ledger_doc_history"] });
    // 其他頁面用到的舊 key
    void qc.invalidateQueries({ queryKey: [`${cfg.docTable}_summary`] });
  };
}

const EMPTY_DOCS: Doc[] = [];
const EMPTY_TXS: Tx[] = [];

/* ======================= 頁面 ======================= */

export function LedgerPage({ cfg }: { cfg: LedgerConfig }) {
  const { company, can } = useAuth();
  const canCreate = can(cfg.module, "create");
  const canEdit = can(cfg.module, "edit");
  const docsQ = useDocs(cfg, company?.id);
  const txsQ = useTxs(cfg, company?.id);
  const docs = docsQ.data ?? EMPTY_DOCS;
  const txs = txsQ.data ?? EMPTY_TXS;

  const [tab, setTab] = useState("docs");
  const [txDialog, setTxDialog] = useState<{ partyId?: string; docId?: string } | null>(null);
  const [docForm, setDocForm] = useState(false);

  const stats = useMemo(() => {
    const month = taipeiToday().slice(0, 7);
    let open = 0;
    let overdue = 0;
    let overdueCount = 0;
    for (const d of docs) {
      if (!d.is_open) continue;
      open += d.balance;
      if (d.is_overdue) {
        overdue += d.balance;
        overdueCount += 1;
      }
    }
    let monthTx = 0;
    let prepay = 0;
    for (const t of txs) {
      if (t.status !== "confirmed") continue;
      if (t.method !== "offset" && t.tx_date.startsWith(month)) monthTx += t.amount;
      prepay += t.unallocated;
    }
    return {
      open: round2(open),
      overdue: round2(overdue),
      overdueCount,
      monthTx: round2(monthTx),
      prepay: round2(prepay),
    };
  }, [docs, txs]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={cfg.title}
        description={cfg.description}
        actions={
          <div className="flex flex-wrap gap-2">
            {canCreate && (
              <Button variant="outline" onClick={() => setDocForm(true)}>
                <FilePlus2 className="mr-1 h-4 w-4" />
                新增{cfg.docLabel}
              </Button>
            )}
            {canCreate && (
              <Button onClick={() => setTxDialog({})}>
                <Plus className="mr-1 h-4 w-4" />
                新增{cfg.txLabel}
              </Button>
            )}
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={`未結${cfg.docLabel}`} value={formatTWD(stats.open)} />
        <StatCard
          label={`逾期（${stats.overdueCount} 筆）`}
          value={formatTWD(stats.overdue)}
          tone={stats.overdue > 0 ? "text-destructive" : undefined}
        />
        <StatCard label={`本月${cfg.txLabel}`} value={formatTWD(stats.monthTx)} />
        <StatCard
          label={`${cfg.prepayLabel}未沖`}
          value={formatTWD(stats.prepay)}
          tone={stats.prepay > 0 ? "text-amber-600" : undefined}
          hint={stats.prepay > 0 ? `到「${cfg.txLabel}紀錄」按「沖帳」` : undefined}
        />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="docs">{cfg.docLabel}帳款</TabsTrigger>
          <TabsTrigger value="txs">{cfg.txLabel}紀錄</TabsTrigger>
        </TabsList>
        <TabsContent value="docs" className="mt-4">
          <DocsTab
            cfg={cfg}
            docs={docs}
            loading={docsQ.isLoading}
            error={docsQ.error}
            canCreate={canCreate}
            canEdit={canEdit}
            onSettle={(d) => setTxDialog({ partyId: d.party_id, docId: d.id })}
          />
        </TabsContent>
        <TabsContent value="txs" className="mt-4">
          <TxsTab
            cfg={cfg}
            txs={txs}
            loading={txsQ.isLoading}
            error={txsQ.error}
            canEdit={canEdit}
          />
        </TabsContent>
      </Tabs>

      {txDialog && (
        <TxDialog
          cfg={cfg}
          presetPartyId={txDialog.partyId}
          presetDocId={txDialog.docId}
          docs={docs}
          txs={txs}
          onClose={() => setTxDialog(null)}
        />
      )}
      {docForm && <DocFormDialog cfg={cfg} onClose={() => setDocForm(false)} />}
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: string | undefined;
  hint?: string | undefined;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className={`mt-1 text-2xl font-semibold tabular-nums ${tone ?? ""}`}>{value}</div>
        {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

/* ======================= 帳款分頁 ======================= */

function DocsTab({
  cfg,
  docs,
  loading,
  error,
  canCreate,
  canEdit,
  onSettle,
}: {
  cfg: LedgerConfig;
  docs: Doc[];
  loading: boolean;
  error: unknown;
  canCreate: boolean;
  canEdit: boolean;
  onSettle: (d: Doc) => void;
}) {
  const { company, can } = useAuth();
  const canExport = can(cfg.module, "export");
  const { data: parties = [] } = useParties(cfg, company?.id);
  const [statusFilter, setStatusFilter] = useState("open");
  const [partyFilter, setPartyFilter] = useState("all");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [writeOff, setWriteOff] = useState<Doc | null>(null);
  const [info, setInfo] = useState<Doc | null>(null);
  const [voidDoc, setVoidDoc] = useState<Doc | null>(null);

  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase();
    return docs.filter((d) => {
      if (statusFilter === "open" && !d.is_open) return false;
      if (statusFilter !== "open" && statusFilter !== "all" && d.status !== statusFilter)
        return false;
      if (partyFilter !== "all" && d.party_id !== partyFilter) return false;
      if (overdueOnly && !d.is_overdue) return false;
      if (kw) {
        const hay =
          `${d.doc_no} ${d.invoice_no ?? ""} ${d.party_name} ${d.order_no ?? ""}`.toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });
  }, [docs, statusFilter, partyFilter, overdueOnly, search]);

  const totals = useMemo(
    () =>
      filtered.reduce(
        (s, d) => ({
          amount: s.amount + (d.status === "void" ? 0 : d.amount),
          settled: s.settled + (d.status === "void" ? 0 : d.settled),
          balance: s.balance + (d.is_open ? d.balance : 0),
        }),
        { amount: 0, settled: 0, balance: 0 },
      ),
    [filtered],
  );

  const exportExcel = async () => {
    const list = docs.filter((d) => d.is_open);
    if (!list.length) {
      toast.info(`目前沒有未結清的${cfg.docLabel}帳款`);
      return;
    }
    try {
      const XLSX = await import("xlsx");
      const header = [
        `${cfg.partyLabel}代號`,
        cfg.partyLabel,
        "單號",
        "來源",
        "發票號碼",
        "金額",
        cfg.settledLabel,
        "未結餘額",
        "到期日",
        "逾期天數",
      ];
      const aoa: (string | number)[][] = [header];
      let a = 0;
      let s = 0;
      let b = 0;
      for (const d of list) {
        a += d.amount;
        s += d.settled;
        b += d.balance;
        aoa.push([
          d.party_code ?? "",
          d.party_name,
          d.doc_no,
          cfg.source[d.source_type] ?? d.source_type,
          d.invoice_no ?? "",
          d.amount,
          d.settled,
          d.balance,
          d.due_date ?? "",
          d.overdue_days,
        ]);
      }
      aoa.push(["", "合計", `${list.length} 筆`, "", "", round2(a), round2(s), round2(b), "", ""]);
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws["!cols"] = [10, 22, 16, 8, 14, 12, 12, 12, 12, 10].map((wch) => ({ wch }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, `${cfg.docLabel}未結`);
      XLSX.writeFile(wb, `${cfg.docLabel}未結清單_${taipeiToday()}.xlsx`);
    } catch (e) {
      toast.error(humanizeError(e, `匯出${cfg.docLabel}清單`));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-36">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="open">未結清</SelectItem>
              <SelectItem value="all">全部</SelectItem>
              {Object.entries(cfg.docStatus).map(([v, l]) => (
                <SelectItem key={v} value={v}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-56">
          <Select value={partyFilter} onValueChange={setPartyFilter}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部{cfg.partyLabel}</SelectItem>
              {parties.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={overdueOnly} onCheckedChange={(c) => setOverdueOnly(c === true)} />
          只看逾期
        </label>
        <Input
          className="w-56"
          placeholder="搜尋單號、發票、訂單"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {canExport && (
          <Button variant="outline" className="ml-auto" onClick={exportExcel}>
            <Download className="mr-1 h-4 w-4" />
            匯出未結 Excel
          </Button>
        )}
      </div>

      {!!error && (
        <p className="text-sm text-destructive">
          {humanizeError(error, `載入${cfg.docLabel}帳款`)}
        </p>
      )}

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>單號</TableHead>
                <TableHead>{cfg.partyLabel}</TableHead>
                <TableHead>來源</TableHead>
                <TableHead>發票</TableHead>
                <TableHead className="text-right">金額</TableHead>
                <TableHead className="text-right">{cfg.settledLabel}</TableHead>
                <TableHead className="text-right">餘額</TableHead>
                <TableHead>狀態</TableHead>
                <TableHead>到期日</TableHead>
                <TableHead className="text-right">動作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow>
                  <TableCell colSpan={11} className="py-8 text-center text-muted-foreground">
                    載入中…
                  </TableCell>
                </TableRow>
              )}
              {!loading && filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={11} className="py-8 text-center text-muted-foreground">
                    沒有符合條件的{cfg.docLabel}帳款
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((d) => (
                <Fragment key={d.id}>
                  <TableRow
                    className={`cursor-pointer ${d.is_overdue ? "bg-destructive/10" : ""} ${
                      d.status === "void" ? "opacity-60" : ""
                    }`}
                    onClick={() => setExpanded(expanded === d.id ? null : d.id)}
                  >
                    <TableCell>
                      {expanded === d.id ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-sm">{d.doc_no}</TableCell>
                    <TableCell className="font-medium">{d.party_name}</TableCell>
                    <TableCell className="text-sm">
                      {cfg.source[d.source_type] ?? d.source_type}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{d.invoice_no ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatTWD(d.amount)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatTWD(d.settled)}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {d.status === "void" ? "—" : formatTWD(d.balance)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          d.status === cfg.settledStatus
                            ? "default"
                            : d.status === "void"
                              ? "outline"
                              : "secondary"
                        }
                      >
                        {cfg.docStatus[d.status] ?? d.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {fmtDate(d.due_date)}
                      {d.is_overdue && (
                        <span className="ml-1 inline-flex items-center gap-0.5 font-medium text-destructive">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          {d.overdue_days} 天
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1">
                        {canCreate && d.is_open && (
                          <Button size="sm" onClick={() => onSettle(d)}>
                            {cfg.txLabel}
                          </Button>
                        )}
                        {canEdit && d.status !== "void" && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="sm" variant="ghost" aria-label="更多動作">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {d.is_open && (
                                <DropdownMenuItem onSelect={() => setWriteOff(d)}>
                                  沖銷餘額（尾差／折讓／壞帳）
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem onSelect={() => setInfo(d)}>
                                修改發票號碼／到期日
                              </DropdownMenuItem>
                              {d.source_type === "manual" && d.settled === 0 && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    className="text-destructive"
                                    onSelect={() => setVoidDoc(d)}
                                  >
                                    作廢這筆{cfg.docLabel}
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                  {expanded === d.id && (
                    <TableRow>
                      <TableCell colSpan={11} className="bg-muted/40">
                        <DocHistory cfg={cfg} doc={d} />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
              {filtered.length > 0 && (
                <TableRow className="bg-muted/30 font-medium">
                  <TableCell />
                  <TableCell colSpan={4} className="text-sm">
                    合計 {filtered.length} 筆
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatTWD(round2(totals.amount))}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatTWD(round2(totals.settled))}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatTWD(round2(totals.balance))}
                  </TableCell>
                  <TableCell colSpan={3} />
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {writeOff && <WriteOffDialog cfg={cfg} doc={writeOff} onClose={() => setWriteOff(null)} />}
      {info && <DocInfoDialog cfg={cfg} doc={info} onClose={() => setInfo(null)} />}
      {voidDoc && <VoidDocDialog cfg={cfg} doc={voidDoc} onClose={() => setVoidDoc(null)} />}
    </div>
  );
}

function DocHistory({ cfg, doc }: { cfg: LedgerConfig; doc: Doc }) {
  const {
    data = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["ledger_doc_history", cfg.kind, doc.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from(cfg.allocTable)
        .select(
          `id, allocated_amount, voided_at, created_at, tx:${cfg.txTable}(${cfg.txNoCol}, ${cfg.txDateCol}, method, status, note)`,
        )
        .eq(cfg.docIdKey, doc.id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  return (
    <div className="space-y-2 py-3 text-sm">
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-muted-foreground">
        {doc.order_no && doc.related_order_id && (
          <span>
            關聯訂單：
            <Link
              to="/dashboard/orders/$orderId"
              params={{ orderId: doc.related_order_id }}
              className="text-primary hover:underline"
            >
              {doc.order_no}
            </Link>
          </span>
        )}
        {doc.note && <span>備註：{doc.note}</span>}
      </div>
      <p className="font-medium">{cfg.txLabel}沖帳紀錄</p>
      {isLoading ? (
        <p className="text-muted-foreground">載入中…</p>
      ) : error ? (
        <p className="text-destructive">{humanizeError(error, "載入沖帳紀錄")}</p>
      ) : data.length === 0 ? (
        <p className="text-muted-foreground">尚無沖帳紀錄</p>
      ) : (
        <ul className="max-w-xl space-y-1">
          {data.map((a) => {
            const tx = (a.tx ?? null) as Row | null;
            const voided = !!a.voided_at || tx?.status === "void";
            return (
              <li
                key={String(a.id)}
                className={`flex justify-between gap-3 ${voided ? "opacity-60" : ""}`}
              >
                <span>
                  <span className="font-mono">{String(tx?.[cfg.txNoCol] ?? "—")}</span>
                  {" · "}
                  {fmtDate(tx?.[cfg.txDateCol] as string | null)}
                  {" · "}
                  {METHOD_LABEL[String(tx?.method ?? "")] ?? String(tx?.method ?? "—")}
                  {voided && (
                    <Badge variant="outline" className="ml-2">
                      已作廢
                    </Badge>
                  )}
                </span>
                <span className={`tabular-nums ${voided ? "line-through" : ""}`}>
                  {formatTWD(num(a.allocated_amount))}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ======================= 收付款分頁 ======================= */

function TxsTab({
  cfg,
  txs,
  loading,
  error,
  canEdit,
}: {
  cfg: LedgerConfig;
  txs: Tx[];
  loading: boolean;
  error: unknown;
  canEdit: boolean;
}) {
  const reload = useReload(cfg);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [applyTarget, setApplyTarget] = useState<Tx | null>(null);
  const [voidTarget, setVoidTarget] = useState<Tx | null>(null);
  const [filter, setFilter] = useState("all");

  const shown = useMemo(
    () =>
      txs.filter((t) =>
        filter === "unallocated"
          ? t.status === "confirmed" && t.unallocated > 0
          : filter === "void"
            ? t.status === "void"
            : filter === "confirmed"
              ? t.status === "confirmed"
              : true,
      ),
    [txs, filter],
  );

  const doVoid = async () => {
    if (!voidTarget) return;
    const { error } = await supabase.rpc(cfg.rpc.voidTx, { [cfg.arg.txId]: voidTarget.id });
    if (error) {
      toast.error(humanizeError(error, `作廢${cfg.txLabel}`));
      return;
    }
    toast.success(`已作廢${cfg.txLabel}，沖帳金額已反沖回帳款`);
    setVoidTarget(null);
    reload();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {(
          [
            ["all", "全部"],
            ["confirmed", "有效"],
            ["unallocated", `${cfg.prepayLabel}未沖`],
            ["void", "已作廢"],
          ] as const
        ).map(([v, l]) => (
          <button
            key={v}
            type="button"
            onClick={() => setFilter(v)}
            className={`rounded-full border px-3 py-1 text-sm ${
              filter === v ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent"
            }`}
          >
            {l}
          </button>
        ))}
      </div>

      {!!error && (
        <p className="text-sm text-destructive">{humanizeError(error, `載入${cfg.txLabel}紀錄`)}</p>
      )}

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>{cfg.txLabel}單號</TableHead>
                <TableHead>{cfg.partyLabel}</TableHead>
                <TableHead>日期</TableHead>
                <TableHead>方式</TableHead>
                <TableHead className="text-right">{cfg.actualLabel}</TableHead>
                <TableHead className="text-right">手續費／折讓</TableHead>
                <TableHead className="text-right">已沖帳</TableHead>
                <TableHead className="text-right">未沖</TableHead>
                <TableHead>狀態</TableHead>
                <TableHead className="text-right">動作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow>
                  <TableCell colSpan={11} className="py-8 text-center text-muted-foreground">
                    載入中…
                  </TableCell>
                </TableRow>
              )}
              {!loading && shown.length === 0 && (
                <TableRow>
                  <TableCell colSpan={11} className="py-8 text-center text-muted-foreground">
                    沒有{cfg.txLabel}紀錄
                  </TableCell>
                </TableRow>
              )}
              {shown.map((t) => (
                <Fragment key={t.id}>
                  <TableRow
                    className={`cursor-pointer ${t.status === "void" ? "opacity-60" : ""}`}
                    onClick={() => setExpanded(expanded === t.id ? null : t.id)}
                  >
                    <TableCell>
                      {expanded === t.id ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-sm">{t.tx_no}</TableCell>
                    <TableCell className="font-medium">{t.party_name}</TableCell>
                    <TableCell className="text-sm">{fmtDate(t.tx_date)}</TableCell>
                    <TableCell className="text-sm">{METHOD_LABEL[t.method] ?? t.method}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatTWD(t.amount)}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                      {t.fee || t.discount ? `${formatTWD(t.fee)}／${formatTWD(t.discount)}` : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatTWD(t.allocated)}
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${t.unallocated > 0 ? "font-semibold text-amber-600" : ""}`}
                    >
                      {t.status === "void" ? "—" : formatTWD(t.unallocated)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={t.status === "void" ? "outline" : "default"}>
                        {t.status === "void" ? "已作廢" : "有效"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1">
                        {canEdit && t.status === "confirmed" && t.unallocated > 0 && (
                          <Button size="sm" onClick={() => setApplyTarget(t)}>
                            沖帳
                          </Button>
                        )}
                        {canEdit && t.status === "confirmed" && (
                          <Button size="sm" variant="outline" onClick={() => setVoidTarget(t)}>
                            作廢
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                  {expanded === t.id && (
                    <TableRow>
                      <TableCell colSpan={11} className="bg-muted/40">
                        <div className="space-y-2 py-3 text-sm">
                          <p className="font-medium">沖帳明細</p>
                          {t.allocations.length === 0 ? (
                            <p className="text-muted-foreground">尚未沖帳（{cfg.prepayLabel}款）</p>
                          ) : (
                            <ul className="max-w-md space-y-1">
                              {t.allocations.map((a) => (
                                <li
                                  key={a.id}
                                  className={`flex justify-between gap-3 ${a.voided ? "opacity-60" : ""}`}
                                >
                                  <span className="font-mono">
                                    {a.doc_no ?? "—"}
                                    {a.voided && (
                                      <Badge variant="outline" className="ml-2 font-sans">
                                        已反沖
                                      </Badge>
                                    )}
                                  </span>
                                  <span
                                    className={`tabular-nums ${a.voided ? "line-through" : ""}`}
                                  >
                                    {formatTWD(a.amount)}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                          <p className="text-muted-foreground">
                            {t.bank_account && `帳號 ${t.bank_account}  `}
                            {t.check_no &&
                              `支票 ${t.check_no}（到期 ${fmtDate(t.check_due_date)}）  `}
                            {t.note && `備註：${t.note}`}
                          </p>
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

      {applyTarget && (
        <ApplyDialog cfg={cfg} tx={applyTarget} onClose={() => setApplyTarget(null)} />
      )}

      <AlertDialog open={!!voidTarget} onOpenChange={(o) => !o && setVoidTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              作廢{cfg.txLabel} {voidTarget?.tx_no}
            </AlertDialogTitle>
            <AlertDialogDescription>
              這筆{cfg.txLabel}沖掉的 {formatTWD(voidTarget?.allocated ?? 0)} 會全部反沖回原帳款，
              沖帳紀錄保留並標示已作廢。確定作廢？
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

/* ======================= 沖帳明細選擇（新增收付款、預收預付再沖帳共用） ======================= */

function AllocationPicker({
  cfg,
  openDocs,
  alloc,
  setAlloc,
  credit,
}: {
  cfg: LedgerConfig;
  openDocs: Doc[];
  alloc: Record<string, string>;
  setAlloc: (fn: (prev: Record<string, string>) => Record<string, string>) => void;
  credit: number | null;
}) {
  const allocated = Object.values(alloc).reduce((s, v) => s + num(v), 0);

  const toggle = (d: Doc, checked: boolean) =>
    setAlloc((prev) => {
      const next = { ...prev };
      if (!checked) {
        delete next[d.id];
        return next;
      }
      const used = Object.entries(prev).reduce((s, [, v]) => s + num(v), 0);
      const remaining = credit === null ? d.balance : Math.max(0, round2(credit - used));
      next[d.id] = String(
        credit === null ? d.balance : Math.min(d.balance, remaining) || d.balance,
      );
      return next;
    });

  const autoFill = () => {
    if (credit === null || credit <= 0) {
      toast.info("請先輸入金額，再自動分配");
      return;
    }
    let remaining = credit;
    const next: Record<string, string> = {};
    for (const d of openDocs) {
      if (remaining <= 0) break;
      const a = round2(Math.min(d.balance, remaining));
      if (a > 0) {
        next[d.id] = String(a);
        remaining = round2(remaining - a);
      }
    }
    setAlloc(() => next);
  };

  if (openDocs.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
        這個{cfg.partyLabel}目前沒有未結清的{cfg.docLabel}帳款；送出後整筆記為{cfg.prepayLabel}
        款，之後有帳款再沖帳。
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          勾選要沖的帳款，金額可改成部分沖帳；由到期日最早的排在前面
        </span>
        <Button type="button" size="sm" variant="outline" onClick={autoFill}>
          <Wand2 className="mr-1 h-4 w-4" />
          自動分配
        </Button>
      </div>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10" />
              <TableHead>單號</TableHead>
              <TableHead>發票</TableHead>
              <TableHead>到期日</TableHead>
              <TableHead className="text-right">餘額</TableHead>
              <TableHead className="w-36 text-right">本次沖帳</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {openDocs.map((d) => {
              const checked = d.id in alloc;
              const over = checked && num(alloc[d.id]) > d.balance;
              return (
                <TableRow key={d.id} className={d.is_overdue ? "bg-destructive/10" : ""}>
                  <TableCell>
                    <Checkbox checked={checked} onCheckedChange={(c) => toggle(d, c === true)} />
                  </TableCell>
                  <TableCell className="font-mono text-sm">{d.doc_no}</TableCell>
                  <TableCell className="font-mono text-xs">{d.invoice_no ?? "—"}</TableCell>
                  <TableCell className="text-sm">{fmtDate(d.due_date)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatTWD(d.balance)}</TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number"
                      min={0}
                      step="1"
                      disabled={!checked}
                      className={`text-right ${over ? "border-destructive" : ""}`}
                      value={alloc[d.id] ?? ""}
                      onChange={(e) => setAlloc((prev) => ({ ...prev, [d.id]: e.target.value }))}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <div className="flex justify-end gap-6 text-sm">
        <span>
          本次沖帳合計 <b className="tabular-nums">{formatTWD(round2(allocated))}</b>
        </span>
        {credit !== null && (
          <span>
            可沖金額 <b className="tabular-nums">{formatTWD(round2(credit))}</b>
          </span>
        )}
      </div>
    </div>
  );
}

function buildAllocations(
  cfg: LedgerConfig,
  alloc: Record<string, string>,
  openDocs: Doc[],
): { list: Record<string, unknown>[]; total: number; error?: string } {
  const list: Record<string, unknown>[] = [];
  let total = 0;
  for (const [id, v] of Object.entries(alloc)) {
    const a = round2(num(v));
    if (a <= 0) continue;
    const d = openDocs.find((x) => x.id === id);
    if (d && a > d.balance) {
      return { list, total, error: `${d.doc_no} 沖帳金額不可大於餘額 ${formatTWD(d.balance)}` };
    }
    list.push({ [cfg.docIdKey]: id, amount: a });
    total += a;
  }
  return { list, total: round2(total) };
}

/* ======================= 新增收款／付款 ======================= */

function TxDialog({
  cfg,
  presetPartyId,
  presetDocId,
  docs,
  txs,
  onClose,
}: {
  cfg: LedgerConfig;
  presetPartyId?: string | undefined;
  presetDocId?: string | undefined;
  docs: Doc[];
  txs: Tx[];
  onClose: () => void;
}) {
  const { company, user } = useAuth();
  const reload = useReload(cfg);
  const { data: parties = [] } = useParties(cfg, company?.id);

  const presetDoc = presetDocId ? docs.find((d) => d.id === presetDocId) : undefined;
  const [partyId, setPartyId] = useState(presetPartyId ?? "");
  const [txDate, setTxDate] = useState(taipeiToday());
  const [method, setMethod] = useState<string>("transfer");
  const [amount, setAmount] = useState(presetDoc ? String(presetDoc.balance) : "");
  const [fee, setFee] = useState("");
  const [discount, setDiscount] = useState("");
  const [bankAccount, setBankAccount] = useState("");
  const [checkNo, setCheckNo] = useState("");
  const [checkDue, setCheckDue] = useState("");
  const [note, setNote] = useState("");
  const [alloc, setAlloc] = useState<Record<string, string>>(
    presetDoc ? { [presetDoc.id]: String(presetDoc.balance) } : {},
  );
  const [saving, setSaving] = useState(false);

  const openDocs = useMemo(
    () => docs.filter((d) => d.party_id === partyId && d.is_open),
    [docs, partyId],
  );
  const partyPrepay = useMemo(
    () =>
      round2(
        txs
          .filter((t) => t.party_id === partyId && t.status === "confirmed")
          .reduce((s, t) => s + t.unallocated, 0),
      ),
    [txs, partyId],
  );

  const [amountTouched, setAmountTouched] = useState(!!presetDoc);
  const allocTotal = round2(Object.values(alloc).reduce((s, v) => s + num(v), 0));
  // 還沒手動輸入金額時，金額跟著勾選的沖帳合計走（扣掉手續費、折讓）
  useEffect(() => {
    if (amountTouched) return;
    const v = round2(Math.max(0, allocTotal - num(fee) - num(discount)));
    setAmount(v > 0 ? String(v) : "");
  }, [allocTotal, fee, discount, amountTouched]);
  const credit = round2(num(amount) + num(fee) + num(discount));
  const leftover = round2(credit - allocTotal);

  const submit = async () => {
    if (!company) return;
    if (!partyId) {
      toast.error(`請選擇${cfg.partyLabel}`);
      return;
    }
    if (num(amount) < 0 || num(fee) < 0 || num(discount) < 0) {
      toast.error("金額不可為負數");
      return;
    }
    if (credit <= 0) {
      toast.error(`請輸入${cfg.actualLabel}`);
      return;
    }
    if (method === "check" && !checkNo.trim()) {
      toast.error("支票請填寫支票號碼");
      return;
    }
    const built = buildAllocations(cfg, alloc, openDocs);
    if (built.error) {
      toast.error(built.error);
      return;
    }
    if (built.total > credit) {
      toast.error(
        `沖帳合計 ${formatTWD(built.total)} 超過可沖金額 ${formatTWD(credit)}（${cfg.actualLabel}＋手續費＋折讓）`,
      );
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc(cfg.rpc.create, {
        p_company_id: company.id,
        [cfg.arg.party]: partyId,
        [cfg.arg.txDate]: txDate,
        p_method: method,
        p_amount: round2(num(amount)),
        p_allocations: built.list,
        p_bank_account: bankAccount.trim() || null,
        p_check_no: checkNo.trim() || null,
        p_check_due_date: checkDue || null,
        p_note: note.trim() || null,
        p_created_by: user?.id ?? null,
        p_fee_amount: round2(num(fee)),
        p_discount_amount: round2(num(discount)),
      });
      if (error) throw error;
      const res = (data ?? {}) as { unallocated?: number | string };
      const un = num(res.unallocated);
      toast.success(
        un > 0
          ? `已建立${cfg.txLabel}；${formatTWD(un)} 記為${cfg.prepayLabel}款，之後可再沖帳`
          : `已建立${cfg.txLabel}並完成沖帳`,
      );
      reload();
      onClose();
    } catch (e) {
      toast.error(humanizeError(e, `建立${cfg.txLabel}`));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>新增{cfg.txLabel}</DialogTitle>
          <DialogDescription>
            可一次沖多筆、部分沖帳；沒沖完的金額記為{cfg.prepayLabel}款，之後在「{cfg.txLabel}
            紀錄」按「沖帳」。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label>{cfg.partyLabel} *</Label>
              <Select
                value={partyId}
                onValueChange={(v) => {
                  setPartyId(v);
                  setAlloc({});
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder={`選擇${cfg.partyLabel}`} />
                </SelectTrigger>
                <SelectContent>
                  {parties.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{cfg.txLabel}日期 *</Label>
              <Input type="date" value={txDate} onChange={(e) => setTxDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>方式 *</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TX_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {METHOD_LABEL[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label>{cfg.actualLabel} *</Label>
              <Input
                type="number"
                min={0}
                className="text-right"
                value={amount}
                onChange={(e) => {
                  setAmountTouched(true);
                  setAmount(e.target.value);
                }}
              />
            </div>
            <div className="space-y-1">
              <Label>手續費（匯費）</Label>
              <Input
                type="number"
                min={0}
                className="text-right"
                placeholder="0"
                value={fee}
                onChange={(e) => setFee(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{cfg.feeHelp}</p>
            </div>
            <div className="space-y-1">
              <Label>折讓</Label>
              <Input
                type="number"
                min={0}
                className="text-right"
                placeholder="0"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{cfg.discountHelp}</p>
            </div>
          </div>

          {method === "transfer" && (
            <div className="space-y-1 sm:max-w-sm">
              <Label>帳號末五碼／銀行</Label>
              <Input value={bankAccount} onChange={(e) => setBankAccount(e.target.value)} />
            </div>
          )}
          {method === "check" && (
            <div className="grid gap-3 sm:max-w-lg sm:grid-cols-2">
              <div className="space-y-1">
                <Label>支票號碼 *</Label>
                <Input value={checkNo} onChange={(e) => setCheckNo(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>票據到期日</Label>
                <Input type="date" value={checkDue} onChange={(e) => setCheckDue(e.target.value)} />
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label>沖帳</Label>
            {!partyId ? (
              <p className="text-sm text-muted-foreground">請先選擇{cfg.partyLabel}</p>
            ) : (
              <>
                {partyPrepay > 0 && (
                  <p className="rounded-md bg-amber-50 p-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                    這個{cfg.partyLabel}還有 {formatTWD(partyPrepay)} 的{cfg.prepayLabel}款沒沖，
                    可以先到「{cfg.txLabel}紀錄」用那筆沖帳。
                  </p>
                )}
                <AllocationPicker
                  cfg={cfg}
                  openDocs={openDocs}
                  alloc={alloc}
                  setAlloc={setAlloc}
                  credit={credit}
                />
              </>
            )}
          </div>

          <div className="space-y-1 rounded-md border p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                可沖金額（{cfg.actualLabel}＋手續費＋折讓）
              </span>
              <span className="tabular-nums">{formatTWD(credit)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">本次沖帳</span>
              <span className="tabular-nums">{formatTWD(allocTotal)}</span>
            </div>
            <div className="flex justify-between font-medium">
              <span>{leftover >= 0 ? `記為${cfg.prepayLabel}款` : "超過可沖金額"}</span>
              <span
                className={`tabular-nums ${leftover < 0 ? "text-destructive" : leftover > 0 ? "text-amber-600" : ""}`}
              >
                {formatTWD(Math.abs(leftover))}
              </span>
            </div>
          </div>

          <div className="space-y-1">
            <Label>備註</Label>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={submit} disabled={saving || credit <= 0 || leftover < 0}>
            {saving ? "送出中…" : `送出${cfg.txLabel}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ======================= 預收／預付再沖帳 ======================= */

function ApplyDialog({ cfg, tx, onClose }: { cfg: LedgerConfig; tx: Tx; onClose: () => void }) {
  const { company } = useAuth();
  const reload = useReload(cfg);
  const { data: docs = [] } = useDocs(cfg, company?.id);
  const openDocs = useMemo(
    () => docs.filter((d) => d.party_id === tx.party_id && d.is_open),
    [docs, tx.party_id],
  );
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const allocTotal = round2(Object.values(alloc).reduce((s, v) => s + num(v), 0));

  const submit = async () => {
    const built = buildAllocations(cfg, alloc, openDocs);
    if (built.error) {
      toast.error(built.error);
      return;
    }
    if (!built.list.length) {
      toast.error("請勾選要沖的帳款");
      return;
    }
    if (built.total > tx.unallocated) {
      toast.error(`沖帳合計超過未沖金額 ${formatTWD(tx.unallocated)}`);
      return;
    }
    setSaving(true);
    const { error } = await supabase.rpc(cfg.rpc.apply, {
      [cfg.arg.txId]: tx.id,
      p_allocations: built.list,
    });
    setSaving(false);
    if (error) {
      toast.error(humanizeError(error, "沖帳"));
      return;
    }
    toast.success(`已沖帳 ${formatTWD(built.total)}`);
    reload();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {cfg.prepayLabel}款沖帳：{tx.tx_no}
          </DialogTitle>
          <DialogDescription>
            {tx.party_name}・未沖金額 {formatTWD(tx.unallocated)}
          </DialogDescription>
        </DialogHeader>
        <AllocationPicker
          cfg={cfg}
          openDocs={openDocs}
          alloc={alloc}
          setAlloc={setAlloc}
          credit={tx.unallocated}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            onClick={submit}
            disabled={saving || allocTotal <= 0 || allocTotal > tx.unallocated}
          >
            {saving ? "處理中…" : `確認沖帳 ${formatTWD(allocTotal)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ======================= 沖銷 ======================= */

function WriteOffDialog({
  cfg,
  doc,
  onClose,
}: {
  cfg: LedgerConfig;
  doc: Doc;
  onClose: () => void;
}) {
  const reload = useReload(cfg);
  const [amount, setAmount] = useState(String(doc.balance));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const a = round2(num(amount));
    if (a <= 0) {
      toast.error("沖銷金額必須大於 0");
      return;
    }
    if (a > doc.balance) {
      toast.error(`沖銷金額不可大於餘額 ${formatTWD(doc.balance)}`);
      return;
    }
    if (!reason.trim()) {
      toast.error("請填寫沖銷原因");
      return;
    }
    setSaving(true);
    const { error } = await supabase.rpc(cfg.rpc.writeOff, {
      [cfg.arg.docId]: doc.id,
      p_amount: a,
      p_reason: reason.trim(),
    });
    setSaving(false);
    if (error) {
      toast.error(humanizeError(error, "沖銷"));
      return;
    }
    toast.success(`已沖銷 ${formatTWD(a)}`);
    reload();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>沖銷 {doc.doc_no}</DialogTitle>
          <DialogDescription>
            用於尾差、折讓或確定收不到／不用付的金額。會產生一筆「沖銷」{cfg.txLabel}紀錄，
            之後若要還原，到「{cfg.txLabel}紀錄」把它作廢即可。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm">
            {doc.party_name}・餘額 <b>{formatTWD(doc.balance)}</b>
          </p>
          <div className="space-y-1">
            <Label>沖銷金額 *</Label>
            <Input
              type="number"
              min={0}
              className="text-right"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>原因 *</Label>
            <Textarea
              rows={2}
              placeholder="例：匯款尾差、客戶議價折讓、確認壞帳"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? "處理中…" : "確認沖銷"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ======================= 手動帳款 ======================= */

function DocFormDialog({ cfg, onClose }: { cfg: LedgerConfig; onClose: () => void }) {
  const { company } = useAuth();
  const reload = useReload(cfg);
  const { data: parties = [] } = useParties(cfg, company?.id);
  const [partyId, setPartyId] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!partyId) {
      toast.error(`請選擇${cfg.partyLabel}`);
      return;
    }
    const a = round2(num(amount));
    if (a <= 0) {
      toast.error("金額必須大於 0");
      return;
    }
    if (!note.trim()) {
      toast.error("請填寫說明（例如：期初帳款、雜項費用）");
      return;
    }
    setSaving(true);
    const { data, error } = await supabase.rpc(cfg.rpc.createDoc, {
      [cfg.kind === "ar" ? "p_customer_id" : "p_vendor_id"]: partyId,
      p_amount: a,
      p_due_date: dueDate || null,
      p_invoice_no: invoiceNo.trim() || null,
      p_note: note.trim(),
      p_related_order_id: null,
    });
    setSaving(false);
    if (error) {
      toast.error(humanizeError(error, `新增${cfg.docLabel}`));
      return;
    }
    const res = (data ?? {}) as { doc_no?: string };
    toast.success(`已新增${cfg.docLabel} ${res.doc_no ?? ""}`);
    reload();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新增{cfg.docLabel}（手動）</DialogTitle>
          <DialogDescription>
            用於期初未結帳款、雜項{cfg.kind === "ar" ? "收入" : "費用"}等不是從
            {cfg.kind === "ar" ? "出貨單" : "進貨單"}產生的帳款。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>{cfg.partyLabel} *</Label>
            <Select value={partyId} onValueChange={setPartyId}>
              <SelectTrigger>
                <SelectValue placeholder={`選擇${cfg.partyLabel}`} />
              </SelectTrigger>
              <SelectContent>
                {parties.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>金額（含稅）*</Label>
              <Input
                type="number"
                min={0}
                className="text-right"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>到期日</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              <p className="text-xs text-muted-foreground">空白＝依{cfg.partyLabel}付款條件</p>
            </div>
          </div>
          <div className="space-y-1">
            <Label>發票號碼</Label>
            <Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>說明 *</Label>
            <Textarea
              rows={2}
              placeholder="例：2026 年 9 月期初未收、模具費"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? "儲存中…" : "新增"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DocInfoDialog({
  cfg,
  doc,
  onClose,
}: {
  cfg: LedgerConfig;
  doc: Doc;
  onClose: () => void;
}) {
  const reload = useReload(cfg);
  const [invoiceNo, setInvoiceNo] = useState(doc.invoice_no ?? "");
  const [dueDate, setDueDate] = useState(doc.due_date ?? "");
  const [note, setNote] = useState(doc.note ?? "");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    const { error } = await supabase.rpc(cfg.rpc.updateDoc, {
      [cfg.arg.docId]: doc.id,
      p_invoice_no: invoiceNo.trim() || null,
      p_due_date: dueDate || null,
      p_note: note.trim() || null,
    });
    setSaving(false);
    if (error) {
      toast.error(humanizeError(error, "修改帳款資料"));
      return;
    }
    toast.success("已更新");
    reload();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>修改 {doc.doc_no}</DialogTitle>
          <DialogDescription>
            金額由來源單據決定，不能在這裡改；要調整金額請改來源單據，或用「沖銷」。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>發票號碼</Label>
              <Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>到期日</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>備註</Label>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? "儲存中…" : "儲存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VoidDocDialog({
  cfg,
  doc,
  onClose,
}: {
  cfg: LedgerConfig;
  doc: Doc;
  onClose: () => void;
}) {
  const reload = useReload(cfg);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!reason.trim()) {
      toast.error("請填寫作廢原因");
      return;
    }
    setSaving(true);
    const { error } = await supabase.rpc(cfg.rpc.voidDoc, {
      [cfg.arg.docId]: doc.id,
      p_reason: reason.trim(),
    });
    setSaving(false);
    if (error) {
      toast.error(humanizeError(error, `作廢${cfg.docLabel}`));
      return;
    }
    toast.success(`已作廢 ${doc.doc_no}`);
    reload();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>作廢 {doc.doc_no}</DialogTitle>
          <DialogDescription>
            {doc.party_name}・{formatTWD(doc.amount)}。作廢後不能復原。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label>作廢原因 *</Label>
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button variant="destructive" onClick={submit} disabled={saving}>
            {saving ? "處理中…" : "確認作廢"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
