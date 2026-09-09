import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { FilePlus2, MoreHorizontal, ChevronLeft, ChevronRight } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { humanizeError } from "@/lib/app-error";
import { taipeiToday } from "@/lib/dates";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const Route = createFileRoute("/dashboard/orders/")({
  head: () => ({
    meta: [
      { title: "訂單管理" },
      { name: "description", content: "訂單列表與新增" },
      { property: "og:title", content: "訂單管理" },
      { property: "og:description", content: "訂單列表與新增" },
    ],
  }),
  component: () => (
    <RequirePerm module="orders">
      <Page />
    </RequirePerm>
  ),
});

interface Order {
  id: string;
  order_no: string;
  customer_id: string | null;
  product_id: string | null;
  item_name: string;
  spec: string | null;
  qty: number;
  unit: string;
  amount_total: number;
  due_date: string | null;
  status: string;
  customers: { name: string } | null;
  products: { name: string } | null;
}
interface CustomerOpt {
  id: string;
  name: string;
}
interface ProductOpt {
  id: string;
  name: string;
  category: string | null;
  default_routing_template_id: string | null;
}
interface TemplateOpt {
  id: string;
  name: string;
  product_category: string | null;
}
interface OrderDraft {
  order_no: string;
  customer_id: string | null;
  product_id: string | null;
  item_name: string;
  spec: string;
  qty: number;
  unit: string;
  amount_untaxed: number;
  tax_amount: number;
  due_date: string;
  status: string;
  routing_template_id: string | null;
  note: string;
}

const PAGE_SIZE = 50;

const STATUSES: ReadonlyArray<readonly [string, string]> = [
  ["draft", "草稿"],
  ["active", "進行中"],
  ["shipped", "已出貨"],
  ["closed", "已結案"],
  ["void", "作廢"],
];
const statusLabel = (v: string) => STATUSES.find(([k]) => k === v)?.[1] ?? v;
const statusBadgeClass: Record<string, string> = {
  draft: "bg-muted text-muted-foreground border-transparent",
  active: "bg-blue-600 text-white border-transparent",
  shipped: "bg-green-600 text-white border-transparent",
  closed: "bg-zinc-700 text-white border-transparent",
  void: "bg-destructive text-destructive-foreground border-transparent",
};

const fmtMoney = new Intl.NumberFormat("zh-TW");

const blank = (): OrderDraft => ({
  order_no: "",
  customer_id: null,
  product_id: null,
  item_name: "",
  spec: "",
  qty: 0,
  unit: "張",
  amount_untaxed: 0,
  tax_amount: 0,
  due_date: "",
  status: "draft",
  routing_template_id: null,
  note: "",
});

function Page() {
  const { can, company } = useAuth();
  const qc = useQueryClient();
  const canCreate = can("orders", "create");
  const canEdit = can("orders", "edit");

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [page, setPage] = useState(0);
  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const {
    data: rows = [],
    isLoading,
    error: loadErr,
  } = useQuery({
    queryKey: ["orders", company?.id, statusFilter, page],
    enabled: !!company?.id,
    queryFn: async () => {
      let q = supabase
        .from("orders")
        .select(
          "id, order_no, customer_id, product_id, item_name, spec, qty, unit, amount_total, due_date, status, customers:customer_id(name), products:product_id(name)",
        )
        .order("created_at", { ascending: false })
        .range(from, to);
      if (statusFilter !== "all") q = q.eq("status", statusFilter);
      const { data, error } = await q;
      if (error) throw error;
      return data as unknown as Order[];
    },
  });
  const reload = () => qc.invalidateQueries({ queryKey: ["orders", company?.id] });

  // ---- 下拉選項 ----
  const { data: customers = [] } = useQuery({
    queryKey: ["customers_active", company?.id],
    enabled: !!company?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id, name")
        .eq("is_active", true)
        .order("customer_code");
      if (error) throw error;
      return data as CustomerOpt[];
    },
  });
  const { data: products = [] } = useQuery({
    queryKey: ["products_opts", company?.id],
    enabled: !!company?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, name, category, default_routing_template_id")
        .eq("is_active", true)
        .order("product_code");
      if (error) throw error;
      return data as ProductOpt[];
    },
  });
  const { data: templates = [] } = useQuery({
    queryKey: ["routing_templates_active", company?.id],
    enabled: !!company?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("routing_templates")
        .select("id, name, product_category")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data as TemplateOpt[];
    },
  });

  // ---- 新增 ----
  const [form, setForm] = useState<OrderDraft | null>(null);
  const setProduct = (id: string | null) => {
    if (!form) return;
    const p = products.find((x) => x.id === id);
    setForm({
      ...form,
      product_id: id,
      routing_template_id: p?.default_routing_template_id ?? form.routing_template_id,
    });
  };
  const save = async () => {
    if (!form || !company) return;
    if (!form.customer_id) {
      toast.error("請選擇客戶");
      return;
    }
    if (!form.item_name.trim()) {
      toast.error("品名為必填");
      return;
    }
    const payload = {
      company_id: company.id,
      order_no: form.order_no.trim() || "AUTO",
      customer_id: form.customer_id,
      product_id: form.product_id || null,
      item_name: form.item_name.trim(),
      spec: form.spec.trim() || null,
      qty: Number(form.qty) || 0,
      unit: form.unit.trim() || "張",
      amount_untaxed: Number(form.amount_untaxed) || 0,
      tax_amount: Number(form.tax_amount) || 0,
      amount_total: (Number(form.amount_untaxed) || 0) + (Number(form.tax_amount) || 0),
      due_date: form.due_date || null,
      status: form.status || "draft",
      routing_template_id: form.routing_template_id || null,
      note: form.note.trim() || null,
    };
    const { data, error } = await supabase.from("orders").insert(payload).select("id");
    if (error) {
      toast.error(humanizeError(error, "新增訂單"));
      return;
    }
    if (!data?.length) {
      toast.error("沒有寫入任何資料（可能沒有權限），請重新整理後再試");
      return;
    }
    toast.success("已新增訂單");
    setForm(null);
    setPage(0);
    reload();
  };

  // ---- 狀態操作 ----
  const [voidTarget, setVoidTarget] = useState<Order | null>(null);
  const updateStatus = async (o: Order, next: string) => {
    const { data, error } = await supabase
      .from("orders")
      .update({ status: next })
      .eq("id", o.id)
      .select("id");
    if (error) {
      toast.error(humanizeError(error, "更新訂單狀態"));
      return;
    }
    if (!data?.length) {
      toast.error("沒有更新任何資料（可能沒有權限）");
      return;
    }
    toast.success(next === "active" ? "訂單已確認" : "訂單已作廢");
    setVoidTarget(null);
    reload();
  };

  const today = taipeiToday();

  return (
    <div className="space-y-6">
      <PageHeader
        title="訂單管理"
        description="訂單列表：草稿可確認，確認後自動展開工序；進行中訂單可作廢（不可恢復）。"
        actions={
          canCreate ? (
            <Button onClick={() => setForm(blank())}>
              <FilePlus2 className="w-4 h-4 mr-1" />
              新增訂單
            </Button>
          ) : undefined
        }
      />

      {/* 狀態篩選 */}
      <div className="flex flex-wrap gap-2">
        {[["all", "全部"] as const, ...STATUSES].map(([k, label]) => (
          <Button
            key={k}
            size="sm"
            variant={statusFilter === k ? "default" : "outline"}
            onClick={() => {
              setStatusFilter(k);
              setPage(0);
            }}
          >
            {label}
          </Button>
        ))}
      </div>

      {loadErr && <p className="text-sm text-destructive">{humanizeError(loadErr, "載入訂單")}</p>}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>單號</TableHead>
                <TableHead>客戶名稱</TableHead>
                <TableHead>品名</TableHead>
                <TableHead>規格</TableHead>
                <TableHead className="text-right">數量</TableHead>
                <TableHead className="text-right">含稅金額</TableHead>
                <TableHead>交期</TableHead>
                <TableHead>狀態</TableHead>
                <TableHead className="w-10" />
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
              {!isLoading && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                    尚無訂單，請按「新增訂單」
                  </TableCell>
                </TableRow>
              )}
              {rows.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="font-mono text-sm">{o.order_no}</TableCell>
                  <TableCell className="font-medium">{o.customers?.name ?? "—"}</TableCell>
                  <TableCell className="text-sm">{o.item_name}</TableCell>
                  <TableCell className="text-sm max-w-[200px] truncate">{o.spec ?? "—"}</TableCell>
                  <TableCell className="text-sm text-right">
                    {fmtMoney.format(o.qty)} {o.unit}
                  </TableCell>
                  <TableCell className="text-sm text-right font-mono">
                    {fmtMoney.format(o.amount_total ?? 0)}
                  </TableCell>
                  <TableCell
                    className={`text-sm ${o.due_date && o.due_date < today && o.status !== "closed" && o.status !== "void" && o.status !== "shipped" ? "text-destructive font-medium" : ""}`}
                  >
                    {o.due_date ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={statusBadgeClass[o.status] ?? ""}>
                      {statusLabel(o.status)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {canEdit && (o.status === "draft" || o.status === "active") && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {o.status === "draft" && (
                            <DropdownMenuItem onClick={() => updateStatus(o, "active")}>
                              確認訂單（展開工序）
                            </DropdownMenuItem>
                          )}
                          {o.status === "active" && (
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => setVoidTarget(o)}
                            >
                              作廢訂單
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
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

      {/* 新增訂單 */}
      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto max-w-2xl">
          <DialogHeader>
            <DialogTitle>新增訂單</DialogTitle>
            <DialogDescription>
              單號留空將由系統自動產生。選擇「確認」狀態時，儲存後會自動展開工序。
            </DialogDescription>
          </DialogHeader>
          {form && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>單號</Label>
                  <Input
                    value={form.order_no}
                    placeholder="留空自動產生"
                    onChange={(e) => setForm({ ...form, order_no: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>客戶 *</Label>
                  <Select
                    value={form.customer_id ?? ""}
                    onValueChange={(v) => setForm({ ...form, customer_id: v })}
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
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>品項（選填）</Label>
                  <Select
                    value={form.product_id ?? "none"}
                    onValueChange={(v) => setProduct(v === "none" ? null : v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="選擇品項" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">不指定</SelectItem>
                      {products.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>品名 *</Label>
                  <Input
                    value={form.item_name}
                    onChange={(e) => setForm({ ...form, item_name: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label>規格描述</Label>
                <Textarea
                  value={form.spec}
                  rows={2}
                  onChange={(e) => setForm({ ...form, spec: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>數量 *</Label>
                  <Input
                    type="number"
                    value={form.qty}
                    onChange={(e) => setForm({ ...form, qty: Number(e.target.value) })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>單位</Label>
                  <Input
                    value={form.unit}
                    onChange={(e) => setForm({ ...form, unit: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label>未稅金額</Label>
                  <Input
                    type="number"
                    value={form.amount_untaxed}
                    onChange={(e) => setForm({ ...form, amount_untaxed: Number(e.target.value) })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>稅額</Label>
                  <Input
                    type="number"
                    value={form.tax_amount}
                    onChange={(e) => setForm({ ...form, tax_amount: Number(e.target.value) })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>含稅總額</Label>
                  <Input
                    type="number"
                    value={(Number(form.amount_untaxed) || 0) + (Number(form.tax_amount) || 0)}
                    readOnly
                    className="bg-muted"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>交期</Label>
                  <Input
                    type="date"
                    value={form.due_date}
                    onChange={(e) => setForm({ ...form, due_date: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>狀態</Label>
                  <Select
                    value={form.status}
                    onValueChange={(v) => setForm({ ...form, status: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">草稿</SelectItem>
                      <SelectItem value="active">確認</SelectItem>
                    </SelectContent>
                  </Select>
                  {form.status === "active" && (
                    <p className="text-xs text-amber-600">確認後將自動展開工序</p>
                  )}
                </div>
              </div>
              <div className="space-y-1">
                <Label>工序範本</Label>
                <Select
                  value={form.routing_template_id ?? "none"}
                  onValueChange={(v) =>
                    setForm({ ...form, routing_template_id: v === "none" ? null : v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="未指定" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">未指定</SelectItem>
                    {templates.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>備註</Label>
                <Textarea
                  value={form.note}
                  rows={2}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>
              取消
            </Button>
            <Button onClick={save}>新增</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 作廢確認 */}
      <Dialog open={!!voidTarget} onOpenChange={(o) => !o && setVoidTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>作廢訂單</DialogTitle>
            <DialogDescription>確定要作廢此訂單？作廢後不可恢復。</DialogDescription>
          </DialogHeader>
          {voidTarget && (
            <p className="text-sm">
              單號 <span className="font-mono font-medium">{voidTarget.order_no}</span>（
              {voidTarget.customers?.name ?? "—"}／{voidTarget.item_name}）
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoidTarget(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => voidTarget && updateStatus(voidTarget, "void")}
            >
              確定作廢
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
