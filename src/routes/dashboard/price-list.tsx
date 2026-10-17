/**
 * 價目設定：品項大類（計價方式）、價目表（品項／價格選項／數量級距）、加工加價。
 * 可上傳 Excel 範本整份匯入（import_price_list），也可以在畫面上直接改。
 * 員工報價時依這裡的價目自動算建議價（calc_price，032）。
 */
import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Download, Upload, Plus, Pencil, Trash2, AlertTriangle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { humanizeError } from "@/lib/app-error";
import { formatTWD } from "@/lib/dates";
import {
  usePriceList,
  parsePriceWorkbook,
  exportPriceWorkbook,
  MODE_LABEL,
  MODE_HELP,
  ADDON_MODE_LABEL,
  addonRateText,
  num,
  type ImportResult,
  type PriceCategory,
  type PriceItem,
  type PriceAddon,
  type PricingMode,
  type AddonMode,
} from "@/lib/price-list";
import { RequirePerm } from "@/components/RequirePerm";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/dashboard/price-list")({
  head: () => ({
    meta: [
      { title: "價目設定" },
      { name: "description", content: "報價用的品項大類、價目表與加工加價" },
      { property: "og:title", content: "價目設定" },
      { property: "og:description", content: "報價用的品項大類、價目表與加工加價" },
    ],
  }),
  component: () => (
    <RequirePerm module="price_list">
      <Page />
    </RequirePerm>
  ),
});

/* ---------- 共用：欄位設定式的編輯視窗 ---------- */
interface Field {
  key: string;
  label: string;
  type?: "text" | "number" | "select";
  options?: { value: string; label: string }[];
  help?: string;
  placeholder?: string;
  required?: boolean;
}
type Values = Record<string, string>;

function RowDialog({
  open,
  title,
  fields,
  initial,
  onClose,
  onSave,
}: {
  open: boolean;
  title: string;
  fields: Field[];
  initial: Values;
  onClose: () => void;
  onSave: (v: Values) => Promise<boolean>;
}) {
  const [v, setV] = useState<Values>(initial);
  const [saving, setSaving] = useState(false);
  const [lastInitial, setLastInitial] = useState(initial);
  if (initial !== lastInitial) {
    setLastInitial(initial);
    setV(initial);
  }

  const submit = async () => {
    for (const f of fields) {
      if (f.required && !(v[f.key] ?? "").trim()) {
        toast.error(`請填「${f.label}」`);
        return;
      }
    }
    setSaving(true);
    const ok = await onSave(v);
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>金額一律填未稅。</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {fields.map((f) => (
            <div
              key={f.key}
              className={`space-y-1 ${f.type === "select" || f.key === "note" ? "sm:col-span-2" : ""}`}
            >
              <Label>
                {f.label}
                {f.required ? " *" : ""}
              </Label>
              {f.type === "select" ? (
                <Select
                  value={v[f.key] ?? ""}
                  onValueChange={(x) => setV((p) => ({ ...p, [f.key]: x }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="請選擇" />
                  </SelectTrigger>
                  <SelectContent>
                    {(f.options ?? []).map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  type={f.type === "number" ? "number" : "text"}
                  inputMode={f.type === "number" ? "decimal" : undefined}
                  value={v[f.key] ?? ""}
                  placeholder={f.placeholder}
                  onChange={(e) => setV((p) => ({ ...p, [f.key]: e.target.value }))}
                />
              )}
              {f.help && <p className="text-xs text-muted-foreground">{f.help}</p>}
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={() => void submit()} disabled={saving}>
            {saving ? "儲存中…" : "儲存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const optNum = (s: string | undefined): number | null => {
  const t = (s ?? "").trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const optText = (s: string | undefined) => (s ?? "").trim() || null;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

type Editing =
  | { kind: "category"; row: PriceCategory | null }
  | { kind: "item"; row: PriceItem | null }
  | { kind: "addon"; row: PriceAddon | null };
type Deleting =
  | { kind: "category"; row: PriceCategory }
  | { kind: "item"; row: PriceItem }
  | { kind: "addon"; row: PriceAddon };

const ALL = "__all__";
const EMPTY_CATS: PriceCategory[] = [];
const EMPTY_ITEMS: PriceItem[] = [];
const EMPTY_ADDONS: PriceAddon[] = [];
const TABLE: Record<Deleting["kind"], string> = {
  category: "price_categories",
  item: "price_items",
  addon: "price_addons",
};

/* ---------- 主頁 ---------- */
function Page() {
  const { company, companies, can } = useAuth();
  const qc = useQueryClient();
  const canEdit = can("price_list", "edit");
  const { data, isLoading, error } = usePriceList(company?.id);
  const categories = data?.categories ?? EMPTY_CATS;
  const items = data?.items ?? EMPTY_ITEMS;
  const addons = data?.addons ?? EMPTY_ADDONS;
  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const [tab, setTab] = useState("categories");
  const [catFilter, setCatFilter] = useState(ALL);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deleting, setDeleting] = useState<Deleting | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = () => qc.invalidateQueries({ queryKey: ["price_list", company?.id] });

  const onFile = async (file: File | undefined) => {
    if (!file || !company) return;
    try {
      setPreview(await parsePriceWorkbook(file, companies, company));
    } catch (e) {
      toast.error(humanizeError(e, "讀取 Excel"));
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const doImport = async () => {
    if (!preview) return;
    setImporting(true);
    const done: string[] = [];
    try {
      for (const b of preview.batches) {
        const { data: res, error: e } = await supabase.rpc("import_price_list", {
          p_company_id: b.company.id,
          p_categories: b.categories,
          p_items: b.items,
          p_addons: b.addons,
        });
        if (e) throw e;
        const r = res as { categories: number; items: number; addons: number };
        done.push(
          `${b.company.short_name ?? b.company.name}：大類 ${r.categories}、價目 ${r.items}、加工 ${r.addons}`,
        );
      }
      toast.success(`匯入完成：${done.join("；")}`);
      setPreview(null);
      void reload();
    } catch (e) {
      toast.error(
        (done.length ? `已完成 ${done.join("；")}。` : "") + humanizeError(e, "匯入價目"),
      );
      void reload();
    } finally {
      setImporting(false);
    }
  };

  const doExport = async () => {
    if (!company || !data) return;
    try {
      await exportPriceWorkbook(company, data);
    } catch (e) {
      toast.error(humanizeError(e, "匯出價目"));
    }
  };

  /* ----- 寫入 ----- */
  const write = async (
    table: string,
    id: string | undefined,
    row: Record<string, unknown>,
    what: string,
  ): Promise<boolean> => {
    if (!company) return false;
    const q = id
      ? supabase.from(table).update(row).eq("id", id).select("id")
      : supabase
          .from(table)
          .insert({ ...row, company_id: company.id })
          .select("id");
    const { data: res, error: e } = await q;
    if (e) {
      toast.error(humanizeError(e, what));
      return false;
    }
    if (!res?.length) {
      toast.error("沒有寫入任何資料（可能沒有權限）");
      return false;
    }
    toast.success(`已儲存${what.replace(/^(新增|修改)/, "")}`);
    void reload();
    return true;
  };

  const doDelete = async () => {
    if (!deleting) return;
    const { data: res, error: e } = await supabase
      .from(TABLE[deleting.kind])
      .delete()
      .eq("id", deleting.row.id)
      .select("id");
    if (e) {
      toast.error(humanizeError(e, "刪除"));
      return;
    }
    if (!res?.length) {
      toast.error("沒有刪除任何資料（可能沒有權限）");
      return;
    }
    toast.success("已刪除");
    setDeleting(null);
    void reload();
  };

  /* ----- 編輯視窗設定 ----- */
  const catOptions = categories.map((c) => ({ value: c.id, label: c.name }));
  const dialog = useMemo(() => {
    if (!editing) return null;
    if (editing.kind === "category") {
      const r = editing.row;
      return {
        title: r ? `修改大類「${r.name}」` : "新增品項大類",
        fields: [
          { key: "name", label: "大類名稱", required: true, placeholder: "例：名片" },
          {
            key: "pricing_mode",
            label: "計價方式",
            type: "select",
            required: true,
            options: (Object.keys(MODE_LABEL) as PricingMode[]).map((m) => ({
              value: m,
              label: `${MODE_LABEL[m]}——${MODE_HELP[m]}`,
            })),
          },
          { key: "unit", label: "計價單位", placeholder: "例：盒、張、才" },
          {
            key: "min_charge",
            label: "最低收費",
            type: "number",
            help: "算出來低於這個金額時，以這個金額計；空白＝沒有",
          },
          { key: "note", label: "備註" },
        ] as Field[],
        initial: {
          name: str(r?.name),
          pricing_mode: r?.pricing_mode ?? "tier",
          unit: str(r?.unit),
          min_charge: str(r?.min_charge),
          note: str(r?.note),
        },
        save: (v: Values) =>
          write(
            "price_categories",
            r?.id,
            {
              name: v["name"]?.trim(),
              pricing_mode: v["pricing_mode"],
              unit: optText(v["unit"]),
              min_charge: optNum(v["min_charge"]),
              note: optText(v["note"]),
              ...(r ? {} : { sort_order: categories.length + 1 }),
            },
            r ? "修改大類" : "新增大類",
          ),
      };
    }
    if (editing.kind === "item") {
      const r = editing.row;
      return {
        title: r ? `修改價目「${r.item}${r.option ? "・" + r.option : ""}」` : "新增價目",
        fields: [
          {
            key: "category_id",
            label: "大類",
            type: "select",
            required: true,
            options: catOptions,
          },
          { key: "item", label: "品項", required: true, placeholder: "例：名片" },
          {
            key: "option",
            label: "價格選項",
            placeholder: "例：一般紙・雙面",
            help: "只放會改變價格的規格；沒有就空白",
          },
          { key: "unit", label: "單位", placeholder: "例：盒" },
          { key: "qty_from", label: "數量從", type: "number", required: true },
          { key: "qty_to", label: "數量到", type: "number", help: "空白＝不限" },
          {
            key: "unit_price",
            label: "單價（未稅）",
            type: "number",
            required: true,
            help: "面積計價填每才單價",
          },
          { key: "note", label: "備註" },
        ] as Field[],
        initial: {
          category_id:
            r?.category_id ?? (catFilter !== ALL ? catFilter : (categories[0]?.id ?? "")),
          item: str(r?.item),
          option: str(r?.option),
          unit: str(r?.unit),
          qty_from: r ? str(r.qty_from) : "1",
          qty_to: str(r?.qty_to),
          unit_price: str(r?.unit_price),
          note: str(r?.note),
        },
        save: async (v: Values) => {
          const from = optNum(v["qty_from"]);
          const to = optNum(v["qty_to"]);
          const price = optNum(v["unit_price"]);
          if (from === null || from < 0) {
            toast.error("數量從要填 0 以上的數字");
            return false;
          }
          if (to !== null && to < from) {
            toast.error("數量到要大於等於數量從");
            return false;
          }
          if (price === null || price < 0) {
            toast.error("單價要填 0 以上的數字");
            return false;
          }
          return write(
            "price_items",
            r?.id,
            {
              category_id: v["category_id"],
              item: v["item"]?.trim(),
              option: (v["option"] ?? "").trim(),
              unit: optText(v["unit"]),
              qty_from: from,
              qty_to: to,
              unit_price: price,
              note: optText(v["note"]),
              ...(r ? {} : { sort_order: items.length + 1 }),
            },
            r ? "修改價目" : "新增價目",
          );
        },
      };
    }
    const r = editing.row;
    return {
      title: r ? `修改加工「${r.name}」` : "新增加工加價",
      fields: [
        { key: "name", label: "加工名稱", required: true, placeholder: "例：上霧膜" },
        {
          key: "category_id",
          label: "適用大類",
          type: "select",
          options: [{ value: ALL, label: "全部大類都可以選" }, ...catOptions],
        },
        {
          key: "mode",
          label: "加價方式",
          type: "select",
          required: true,
          options: (Object.keys(ADDON_MODE_LABEL) as AddonMode[]).map((m) => ({
            value: m,
            label: ADDON_MODE_LABEL[m],
          })),
          help: "每個計價單位：乘以報價數量（名片每盒）；每才：乘以才數；每個／固定金額：報價時可填個數；總價加成：填比例",
        },
        {
          key: "amount",
          label: "金額或比例（未稅）",
          type: "number",
          required: true,
          help: "總價加成填 0.3＝加 30%",
        },
        { key: "note", label: "備註" },
      ] as Field[],
      initial: {
        name: str(r?.name),
        category_id: r?.category_id ?? ALL,
        mode: r?.mode ?? "fixed",
        amount: str(r?.amount),
        note: str(r?.note),
      },
      save: async (v: Values) => {
        let amount = optNum(v["amount"]);
        if (amount === null || amount < 0) {
          toast.error("金額要填 0 以上的數字");
          return false;
        }
        if (v["mode"] === "percent" && amount > 1) amount = amount / 100;
        return write(
          "price_addons",
          r?.id,
          {
            name: v["name"]?.trim(),
            category_id: v["category_id"] && v["category_id"] !== ALL ? v["category_id"] : null,
            mode: v["mode"],
            amount,
            note: optText(v["note"]),
            ...(r ? {} : { sort_order: addons.length + 1 }),
          },
          r ? "修改加工" : "新增加工",
        );
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, categories, items.length, addons.length, catFilter]);

  const shownItems = catFilter === ALL ? items : items.filter((i) => i.category_id === catFilter);
  const empty = !isLoading && categories.length === 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="價目設定"
        description="設定每個品項怎麼算價。員工報價時選品項、填數量或尺寸，就會自動帶出建議價；員工可以改價，送出時老闆的 LINE 會收到通知。金額一律未稅。"
        actions={
          <>
            <Button variant="outline" onClick={() => void doExport()} disabled={!data}>
              <Download className="mr-1 h-4 w-4" />
              匯出 Excel
            </Button>
            {canEdit && (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={(e) => void onFile(e.target.files?.[0])}
                />
                <Button onClick={() => fileRef.current?.click()}>
                  <Upload className="mr-1 h-4 w-4" />
                  上傳 Excel
                </Button>
              </>
            )}
          </>
        }
      />

      {!!error && <p className="text-sm text-destructive">{humanizeError(error, "載入價目")}</p>}

      {empty && (
        <Card>
          <CardContent className="space-y-2 py-6 text-sm">
            <p className="font-medium">還沒有價目。</p>
            <p className="text-muted-foreground">
              最快的做法：用「報價價目表範本.xlsx」填好價格後，按右上角「上傳
              Excel」。也可以在下面一筆一筆新增。
            </p>
          </CardContent>
        </Card>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="categories">品項大類（{categories.length}）</TabsTrigger>
          <TabsTrigger value="items">價目表（{items.length}）</TabsTrigger>
          <TabsTrigger value="addons">加工加價（{addons.length}）</TabsTrigger>
        </TabsList>

        {/* 品項大類 */}
        <TabsContent value="categories" className="space-y-3">
          {canEdit && (
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setEditing({ kind: "category", row: null })}>
                <Plus className="mr-1 h-4 w-4" />
                新增大類
              </Button>
            </div>
          )}
          <Card>
            <CardContent className="overflow-x-auto p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>大類</TableHead>
                    <TableHead>計價方式</TableHead>
                    <TableHead>計價單位</TableHead>
                    <TableHead className="text-right">最低收費</TableHead>
                    <TableHead className="text-right">價目筆數</TableHead>
                    <TableHead>備註</TableHead>
                    {canEdit && <TableHead className="w-24" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {categories.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell>
                        <Badge variant={c.pricing_mode === "manual" ? "outline" : "secondary"}>
                          {MODE_LABEL[c.pricing_mode]}
                        </Badge>
                      </TableCell>
                      <TableCell>{c.unit ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {c.min_charge === null ? "—" : formatTWD(c.min_charge)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <button
                          type="button"
                          className="underline-offset-2 hover:underline"
                          onClick={() => {
                            setCatFilter(c.id);
                            setTab("items");
                          }}
                        >
                          {items.filter((i) => i.category_id === c.id).length}
                        </button>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {c.note ?? ""}
                      </TableCell>
                      {canEdit && (
                        <RowActions
                          onEdit={() => setEditing({ kind: "category", row: c })}
                          onDelete={() => setDeleting({ kind: "category", row: c })}
                        />
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 價目表 */}
        <TabsContent value="items" className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="w-48">
              <Select value={catFilter} onValueChange={setCatFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>全部大類</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1" />
            {canEdit && categories.length > 0 && (
              <Button size="sm" onClick={() => setEditing({ kind: "item", row: null })}>
                <Plus className="mr-1 h-4 w-4" />
                新增價目
              </Button>
            )}
          </div>
          <Card>
            <CardContent className="overflow-x-auto p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>大類</TableHead>
                    <TableHead>品項</TableHead>
                    <TableHead>價格選項</TableHead>
                    <TableHead className="text-right">數量</TableHead>
                    <TableHead className="text-right">單價（未稅）</TableHead>
                    <TableHead>單位</TableHead>
                    <TableHead>備註</TableHead>
                    {canEdit && <TableHead className="w-24" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shownItems.map((i) => {
                    const c = catById.get(i.category_id);
                    return (
                      <TableRow key={i.id}>
                        <TableCell className="text-sm text-muted-foreground">
                          {c?.name ?? "—"}
                        </TableCell>
                        <TableCell className="font-medium">{i.item}</TableCell>
                        <TableCell>{i.option || "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {num(i.qty_from)} ～ {i.qty_to === null ? "不限" : num(i.qty_to)}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {formatTWD(i.unit_price)}
                          {c?.pricing_mode === "area" ? "／才" : ""}
                        </TableCell>
                        <TableCell>{i.unit ?? c?.unit ?? "—"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {i.note ?? ""}
                        </TableCell>
                        {canEdit && (
                          <RowActions
                            onEdit={() => setEditing({ kind: "item", row: i })}
                            onDelete={() => setDeleting({ kind: "item", row: i })}
                          />
                        )}
                      </TableRow>
                    );
                  })}
                  {shownItems.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                        沒有價目
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 加工加價 */}
        <TabsContent value="addons" className="space-y-3">
          {canEdit && (
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setEditing({ kind: "addon", row: null })}>
                <Plus className="mr-1 h-4 w-4" />
                新增加工
              </Button>
            </div>
          )}
          <Card>
            <CardContent className="overflow-x-auto p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>加工名稱</TableHead>
                    <TableHead>適用大類</TableHead>
                    <TableHead>加價方式</TableHead>
                    <TableHead className="text-right">金額或比例</TableHead>
                    <TableHead>備註</TableHead>
                    {canEdit && <TableHead className="w-24" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {addons.map((a) => {
                    const c = a.category_id ? catById.get(a.category_id) : null;
                    return (
                      <TableRow key={a.id}>
                        <TableCell className="font-medium">{a.name}</TableCell>
                        <TableCell>{c ? c.name : "全部"}</TableCell>
                        <TableCell>{ADDON_MODE_LABEL[a.mode]}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {addonRateText(a, c?.unit)}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {a.note ?? ""}
                        </TableCell>
                        {canEdit && (
                          <RowActions
                            onEdit={() => setEditing({ kind: "addon", row: a })}
                            onDelete={() => setDeleting({ kind: "addon", row: a })}
                          />
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {dialog && (
        <RowDialog
          open={!!editing}
          title={dialog.title}
          fields={dialog.fields}
          initial={dialog.initial}
          onClose={() => setEditing(null)}
          onSave={dialog.save}
        />
      )}

      {/* 刪除確認 */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>確定刪除？</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.kind === "category"
                ? `刪除大類「${deleting.row.name}」會一起刪掉它底下的價目和專屬加工。已開的報價單不受影響。`
                : "刪除後報價時就選不到這一筆。已開的報價單不受影響。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void doDelete()}>刪除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 匯入預覽 */}
      <Dialog open={!!preview} onOpenChange={(o) => !o && !importing && setPreview(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>匯入價目</DialogTitle>
            <DialogDescription>
              匯入會「整份取代」下列公司目前的價目。已開的報價單不受影響。
            </DialogDescription>
          </DialogHeader>
          {preview && (
            <div className="max-h-[60vh] space-y-3 overflow-y-auto text-sm">
              {preview.batches.map((b) => (
                <div key={b.company.id} className="rounded-md border p-3">
                  <p className="font-medium">{b.company.name}</p>
                  <p className="text-muted-foreground">
                    品項大類 {b.categories.length} 筆、價目 {b.items.length} 筆、加工加價{" "}
                    {b.addons.length} 筆
                  </p>
                </div>
              ))}
              {preview.batches.length === 0 && preview.errors.length === 0 && (
                <p className="text-muted-foreground">檔案裡沒有資料。</p>
              )}
              {preview.warnings.length > 0 && (
                <div className="space-y-1 rounded-md bg-muted p-3">
                  {preview.warnings.map((w) => (
                    <p key={w}>{w}</p>
                  ))}
                </div>
              )}
              {preview.errors.length > 0 && (
                <div className="space-y-1 rounded-md border border-destructive/50 bg-destructive/5 p-3 text-destructive">
                  <p className="flex items-center gap-1 font-medium">
                    <AlertTriangle className="h-4 w-4" />有 {preview.errors.length} 個問題，請改好
                    Excel 再上傳：
                  </p>
                  {preview.errors.slice(0, 30).map((e) => (
                    <p key={e}>・{e}</p>
                  ))}
                  {preview.errors.length > 30 && <p>…還有 {preview.errors.length - 30} 個</p>}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreview(null)} disabled={importing}>
              取消
            </Button>
            <Button
              onClick={() => void doImport()}
              disabled={
                importing || !preview || preview.errors.length > 0 || preview.batches.length === 0
              }
            >
              {importing ? "匯入中…" : "確認匯入"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RowActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  return (
    <TableCell className="text-right">
      <div className="flex justify-end gap-1">
        <Button size="sm" variant="ghost" title="修改" onClick={onEdit}>
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-destructive"
          title="刪除"
          onClick={onDelete}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </TableCell>
  );
}
