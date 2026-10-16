import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Search, PackageMinus, ClipboardCheck, Pencil, AlertTriangle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { humanizeError } from "@/lib/app-error";
import { fmtDateTime, formatTWD } from "@/lib/dates";
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
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

export const Route = createFileRoute("/dashboard/inventory")({
  head: () => ({
    meta: [
      { title: "庫存管理" },
      { name: "description", content: "庫存品項、安全庫存、領料與盤點" },
      { property: "og:title", content: "庫存管理" },
      { property: "og:description", content: "庫存品項、安全庫存、領料與盤點" },
    ],
  }),
  component: () => (
    <RequirePerm module="inventory">
      <Page />
    </RequirePerm>
  ),
});

interface InvItem {
  id: string;
  company_id: string;
  item_code: string | null;
  name: string;
  spec: string | null;
  unit: string | null;
  qty_on_hand: number;
  avg_cost: number;
  safety_qty: number | null;
  is_active: boolean;
  note: string | null;
  updated_at: string | null;
}

interface InvMove {
  id: string;
  move_type: string;
  qty: number;
  unit_cost: number | null;
  source_type: string | null;
  source_id: string | null;
  order_id: string | null;
  note: string | null;
  created_at: string;
  order?: { order_no: string | null } | null;
}

interface OrderOpt {
  id: string;
  order_no: string;
  item_name: string | null;
}

const ITEM_COLS =
  "id, company_id, item_code, name, spec, unit, qty_on_hand, avg_cost, safety_qty, is_active, note, updated_at";

const MOVE_TYPE_LABEL: Record<string, string> = { in: "入庫", out: "出庫", adjust: "盤點調整" };
const SOURCE_LABEL: Record<string, string> = {
  purchase: "進貨",
  purchase_void: "進貨作廢",
  issue: "領料",
  adjust: "盤點",
};

const num = (v: unknown) => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};
const fmtQty = (v: unknown) =>
  new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 3 }).format(num(v));
const isLow = (it: InvItem) =>
  it.safety_qty !== null && num(it.safety_qty) > 0 && num(it.qty_on_hand) < num(it.safety_qty);
const rpcRow = <T,>(data: unknown) => (Array.isArray(data) ? data[0] : data) as T | null;

function Page() {
  const { company, isManager } = useAuth();
  const qc = useQueryClient();
  const companyId = company?.id;

  const [search, setSearch] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [issueTarget, setIssueTarget] = useState<InvItem | null>(null);
  const [adjustTarget, setAdjustTarget] = useState<InvItem | null>(null);
  const [editTarget, setEditTarget] = useState<InvItem | null>(null);
  const [historyTarget, setHistoryTarget] = useState<InvItem | null>(null);

  const {
    data: items = [],
    isLoading,
    error: loadErr,
  } = useQuery({
    queryKey: ["inventory_items", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_items")
        .select(ITEM_COLS)
        .eq("company_id", companyId!)
        .order("item_code", { ascending: true, nullsFirst: false })
        .order("name");
      if (error) throw error;
      return (data ?? []) as InvItem[];
    },
  });

  const reload = () => {
    void qc.invalidateQueries({ queryKey: ["inventory_items", companyId] });
    void qc.invalidateQueries({ queryKey: ["inventory_moves"] });
  };

  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase();
    return items.filter((it) => {
      if (!showInactive && !it.is_active) return false;
      if (lowOnly && !isLow(it)) return false;
      if (!kw) return true;
      return [it.item_code, it.name, it.spec, it.note]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(kw));
    });
  }, [items, search, lowOnly, showInactive]);

  const lowCount = items.filter((it) => it.is_active && isLow(it)).length;
  const totalValue = filtered.reduce((s, it) => s + num(it.qty_on_hand) * num(it.avg_cost), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="庫存管理"
        description="庫存數量由進貨確認（入庫）、領料與盤點自動異動；點選品項可查看異動紀錄。"
        actions={
          isManager ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="w-4 h-4 mr-1" />
              新增品項
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="搜尋代號、品名、規格"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button
          variant={lowOnly ? "default" : "outline"}
          size="sm"
          onClick={() => setLowOnly((v) => !v)}
        >
          <AlertTriangle className="w-4 h-4 mr-1" />
          低於安全量{lowCount > 0 ? `（${lowCount}）` : ""}
        </Button>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Switch checked={showInactive} onCheckedChange={setShowInactive} />
          顯示停用品項
        </label>
        <div className="ml-auto text-sm text-muted-foreground">
          庫存金額合計：
          <span className="font-semibold text-foreground tabular-nums">
            {formatTWD(Math.round(totalValue))}
          </span>
        </div>
      </div>

      {loadErr && <p className="text-sm text-destructive">{humanizeError(loadErr, "載入庫存")}</p>}

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>代號</TableHead>
                <TableHead>品名</TableHead>
                <TableHead>規格</TableHead>
                <TableHead className="text-right">庫存量</TableHead>
                <TableHead>單位</TableHead>
                <TableHead className="text-right">安全量</TableHead>
                <TableHead className="text-right">平均成本</TableHead>
                <TableHead className="text-right">庫存金額</TableHead>
                {isManager && <TableHead className="text-right">動作</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                    載入中…
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                    {items.length === 0 ? "尚無庫存品項" : "沒有符合條件的品項"}
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((it) => {
                const low = isLow(it);
                return (
                  <TableRow
                    key={it.id}
                    className={`cursor-pointer ${!it.is_active ? "opacity-60" : ""} ${
                      low ? "bg-destructive/5" : ""
                    }`}
                    onClick={() => setHistoryTarget(it)}
                  >
                    <TableCell className="font-mono text-sm">{it.item_code ?? "—"}</TableCell>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {it.name}
                        {low && (
                          <Badge variant="destructive" className="text-[10px]">
                            低於安全量
                          </Badge>
                        )}
                        {!it.is_active && (
                          <Badge variant="outline" className="text-[10px]">
                            停用
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {it.spec ?? "—"}
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums font-medium ${low ? "text-destructive" : ""}`}
                    >
                      {fmtQty(it.qty_on_hand)}
                    </TableCell>
                    <TableCell className="text-sm">{it.unit ?? ""}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {it.safety_qty === null ? "—" : fmtQty(it.safety_qty)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatTWD(it.avg_cost)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatTWD(Math.round(num(it.qty_on_hand) * num(it.avg_cost)))}
                    </TableCell>
                    {isManager && (
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!it.is_active}
                            onClick={() => setIssueTarget(it)}
                          >
                            <PackageMinus className="w-3.5 h-3.5 mr-1" />
                            領料
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setAdjustTarget(it)}>
                            <ClipboardCheck className="w-3.5 h-3.5 mr-1" />
                            盤點
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            aria-label="編輯安全量／備註"
                            onClick={() => setEditTarget(it)}
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <CreateItemDialog open={createOpen} onClose={() => setCreateOpen(false)} onDone={reload} />
      <IssueDialog
        key={`issue-${issueTarget?.id ?? "none"}`}
        item={issueTarget}
        onClose={() => setIssueTarget(null)}
        onDone={reload}
      />
      <AdjustDialog
        key={`adjust-${adjustTarget?.id ?? "none"}`}
        item={adjustTarget}
        onClose={() => setAdjustTarget(null)}
        onDone={reload}
      />
      <EditDialog
        key={`edit-${editTarget?.id ?? "none"}`}
        item={editTarget}
        onClose={() => setEditTarget(null)}
        onDone={reload}
      />
      <HistorySheet item={historyTarget} onClose={() => setHistoryTarget(null)} />
    </div>
  );
}

/* ---------------- 新增品項 ---------------- */
function CreateItemDialog({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [itemCode, setItemCode] = useState("");
  const [name, setName] = useState("");
  const [spec, setSpec] = useState("");
  const [unit, setUnit] = useState("");
  const [qty, setQty] = useState("0");
  const [unitCost, setUnitCost] = useState("0");
  const [safetyQty, setSafetyQty] = useState("0");
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setItemCode("");
    setName("");
    setSpec("");
    setUnit("");
    setQty("0");
    setUnitCost("0");
    setSafetyQty("0");
  };
  const close = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    if (!name.trim()) {
      toast.error("請填寫品名");
      return;
    }
    const q = Number(qty || 0);
    const c = Number(unitCost || 0);
    const s = Number(safetyQty || 0);
    if (![q, c, s].every((n) => Number.isFinite(n) && n >= 0)) {
      toast.error("數量、成本與安全量不可為負數");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.rpc("inventory_create_item", {
        p_name: name.trim(),
        p_spec: spec.trim() || null,
        p_unit: unit.trim() || null,
        p_qty: q,
        p_unit_cost: c,
        p_safety_qty: s,
        p_item_code: itemCode.trim() || null,
      });
      if (error) throw error;
      toast.success(`已新增品項 ${name.trim()}`);
      onDone();
      close();
    } catch (e) {
      toast.error(humanizeError(e, "新增庫存品項"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>新增庫存品項</DialogTitle>
          <DialogDescription>期初數量大於 0 時會以單位成本建立一筆入庫紀錄。</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>品名 *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>代號</Label>
            <Input
              value={itemCode}
              placeholder="留空自動編號"
              onChange={(e) => setItemCode(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>規格</Label>
            <Input value={spec} onChange={(e) => setSpec(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>單位</Label>
            <Input
              value={unit}
              placeholder="例：張、令、kg"
              onChange={(e) => setUnit(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>期初數量</Label>
            <Input type="number" min={0} value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>單位成本</Label>
            <Input
              type="number"
              min={0}
              value={unitCost}
              onChange={(e) => setUnitCost(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>安全庫存量</Label>
            <Input
              type="number"
              min={0}
              value={safetyQty}
              onChange={(e) => setSafetyQty(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={saving}>
            取消
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? "建立中…" : "建立"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- 領料 ---------------- */
const NO_ORDER = "__none__";

function IssueDialog({
  item,
  onClose,
  onDone,
}: {
  item: InvItem | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { company } = useAuth();
  const [qty, setQty] = useState("");
  const [orderId, setOrderId] = useState(NO_ORDER);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: orders = [] } = useQuery({
    queryKey: ["inventory_active_orders", company?.id],
    enabled: !!item && !!company?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("id, order_no, item_name")
        .in("status", ["draft", "active"])
        .order("created_at", { ascending: false })
        .range(0, 199);
      if (error) throw error;
      return (data ?? []) as OrderOpt[];
    },
  });

  const submit = async () => {
    if (!item) return;
    const q = Number(qty);
    if (!Number.isFinite(q) || q <= 0) {
      toast.error("請輸入領料數量");
      return;
    }
    if (q > num(item.qty_on_hand)) {
      toast.error(`領料數量超過庫存（目前 ${fmtQty(item.qty_on_hand)} ${item.unit ?? ""}）`);
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc("inventory_issue", {
        p_item_id: item.id,
        p_qty: q,
        p_order_id: orderId === NO_ORDER ? null : orderId,
        p_note: note.trim() || null,
      });
      if (error) throw error;
      const r = rpcRow<{ ok?: boolean; move_id?: string; cost?: number }>(data);
      if (r && r.ok === false) throw new Error("領料未完成");
      toast.success(
        `已領料 ${fmtQty(q)} ${item.unit ?? ""}${
          r?.cost !== undefined && r?.cost !== null ? `，成本 ${formatTWD(r.cost)}` : ""
        }${orderId !== NO_ORDER ? "（已計入訂單材料成本）" : ""}`,
      );
      onDone();
      onClose();
    } catch (e) {
      toast.error(humanizeError(e, "領料"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>領料：{item?.name}</DialogTitle>
          <DialogDescription>
            目前庫存 {fmtQty(item?.qty_on_hand)} {item?.unit ?? ""}，平均成本{" "}
            {formatTWD(item?.avg_cost ?? null)}。指定訂單時會同時認列該訂單材料成本。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>數量 *</Label>
            <Input type="number" min={0} value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>用於訂單（選填）</Label>
            <Select value={orderId} onValueChange={setOrderId}>
              <SelectTrigger>
                <SelectValue placeholder="不指定訂單" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_ORDER}>不指定訂單</SelectItem>
                {orders.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.order_no} {o.item_name ?? ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>備註</Label>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? "處理中…" : "確認領料"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- 盤點 ---------------- */
function AdjustDialog({
  item,
  onClose,
  onDone,
}: {
  item: InvItem | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [actual, setActual] = useState(item ? String(num(item.qty_on_hand)) : "");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const diff = item && actual.trim() !== "" ? Number(actual) - num(item.qty_on_hand) : 0;

  const submit = async () => {
    if (!item) return;
    const a = Number(actual);
    if (actual.trim() === "" || !Number.isFinite(a) || a < 0) {
      toast.error("請輸入實盤數量");
      return;
    }
    if (diff !== 0 && !note.trim()) {
      toast.error("盤盈／盤虧請填寫說明");
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc("inventory_adjust", {
        p_item_id: item.id,
        p_actual_qty: a,
        p_note: note.trim() || null,
      });
      if (error) throw error;
      const r = rpcRow<{ ok?: boolean; diff?: number }>(data);
      if (r && r.ok === false) throw new Error("盤點未完成");
      const d = r?.diff ?? diff;
      toast.success(
        num(d) === 0
          ? "盤點完成，數量無差異"
          : `盤點完成，${num(d) > 0 ? "盤盈" : "盤虧"} ${fmtQty(Math.abs(num(d)))} ${item.unit ?? ""}`,
      );
      onDone();
      onClose();
    } catch (e) {
      toast.error(humanizeError(e, "盤點"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>盤點：{item?.name}</DialogTitle>
          <DialogDescription>
            帳上數量 {fmtQty(item?.qty_on_hand)} {item?.unit ?? ""}
            ；輸入實盤數量後系統會產生調整紀錄。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>實盤數量 *</Label>
            <Input
              type="number"
              min={0}
              value={actual}
              onChange={(e) => setActual(e.target.value)}
            />
            {Number.isFinite(diff) && diff !== 0 && (
              <p className={`text-sm ${diff > 0 ? "text-green-600" : "text-destructive"}`}>
                {diff > 0 ? "盤盈" : "盤虧"} {fmtQty(Math.abs(diff))} {item?.unit ?? ""}
              </p>
            )}
          </div>
          <div className="space-y-1">
            <Label>說明{diff !== 0 ? " *" : ""}</Label>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? "處理中…" : "確認盤點"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- 編輯安全量／備註 ---------------- */
function EditDialog({
  item,
  onClose,
  onDone,
}: {
  item: InvItem | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [itemCode, setItemCode] = useState(item?.item_code ?? "");
  const [unit, setUnit] = useState(item?.unit ?? "");
  const [safetyQty, setSafetyQty] = useState(
    item?.safety_qty === null || item?.safety_qty === undefined ? "" : String(item.safety_qty),
  );
  const [isActive, setIsActive] = useState(item?.is_active ?? true);
  const [note, setNote] = useState(item?.note ?? "");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!item) return;
    const s = safetyQty.trim() === "" ? null : Number(safetyQty);
    if (s !== null && (!Number.isFinite(s) || s < 0)) {
      toast.error("安全量不可為負數");
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase
        .from("inventory_items")
        .update({
          item_code: itemCode.trim() || null,
          unit: unit.trim() || null,
          safety_qty: s,
          is_active: isActive,
          note: note.trim() || null,
        })
        .eq("id", item.id)
        .select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("沒有寫入任何資料（可能沒有權限）");
      toast.success("已儲存");
      onDone();
      onClose();
    } catch (e) {
      toast.error(humanizeError(e, "儲存庫存品項"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>編輯：{item?.name}</DialogTitle>
          <DialogDescription>數量與成本只能透過進貨、領料、盤點異動。</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>代號</Label>
            <Input value={itemCode} onChange={(e) => setItemCode(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>單位</Label>
            <Input value={unit} onChange={(e) => setUnit(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>安全庫存量</Label>
            <Input
              type="number"
              min={0}
              value={safetyQty}
              onChange={(e) => setSafetyQty(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>啟用</Label>
            <div className="flex h-10 items-center">
              <Switch checked={isActive} onCheckedChange={setIsActive} />
            </div>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>備註</Label>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
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

/* ---------------- 異動紀錄 ---------------- */
function HistorySheet({ item, onClose }: { item: InvItem | null; onClose: () => void }) {
  const {
    data: moves = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["inventory_moves", item?.id],
    enabled: !!item,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_moves")
        .select(
          "id, move_type, qty, unit_cost, source_type, source_id, order_id, note, created_at, order:orders(order_no)",
        )
        .eq("item_id", item!.id)
        .order("created_at", { ascending: false })
        .range(0, 99);
      if (error) throw error;
      return (data ?? []) as unknown as InvMove[];
    },
  });

  return (
    <Sheet open={!!item} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            {item?.item_code ? `${item.item_code} ` : ""}
            {item?.name}
          </SheetTitle>
          <SheetDescription>
            {item?.spec ? `${item.spec}・` : ""}庫存 {fmtQty(item?.qty_on_hand)} {item?.unit ?? ""}
            ・平均成本 {formatTWD(item?.avg_cost ?? null)}（最近 100 筆異動）
          </SheetDescription>
        </SheetHeader>
        {item?.note && <p className="mt-3 text-sm text-muted-foreground">備註：{item.note}</p>}
        <div className="mt-4">
          {error && (
            <p className="text-sm text-destructive">{humanizeError(error, "載入異動紀錄")}</p>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>時間</TableHead>
                <TableHead>類型</TableHead>
                <TableHead>來源</TableHead>
                <TableHead className="text-right">數量</TableHead>
                <TableHead className="text-right">單位成本</TableHead>
                <TableHead>訂單／備註</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                    載入中…
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && moves.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                    尚無異動紀錄
                  </TableCell>
                </TableRow>
              )}
              {moves.map((m) => {
                const q = num(m.qty);
                return (
                  <TableRow key={m.id}>
                    <TableCell className="whitespace-nowrap text-sm">
                      {fmtDateTime(m.created_at)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={m.move_type === "out" ? "secondary" : "outline"}>
                        {MOVE_TYPE_LABEL[m.move_type] ?? m.move_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {SOURCE_LABEL[m.source_type ?? ""] ?? m.source_type ?? "—"}
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${q < 0 ? "text-destructive" : "text-green-600"}`}
                    >
                      {q > 0 ? "+" : ""}
                      {fmtQty(q)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {m.unit_cost === null ? "—" : formatTWD(m.unit_cost)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-48">
                      {m.order?.order_no && (
                        <span className="font-mono text-foreground mr-1">{m.order.order_no}</span>
                      )}
                      {m.note ?? (m.order?.order_no ? "" : "—")}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </SheetContent>
    </Sheet>
  );
}
