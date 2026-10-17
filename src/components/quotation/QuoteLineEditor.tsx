/**
 * 報價明細一筆：從價目表選（大類→品項→價格選項→數量或寬高→加工）自動帶出建議價，
 * 或「自己填」品名／數量／單價。建議價由資料庫 calc_price 計算；員工可以改報價金額。
 */
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { RotateCcw, Trash2, AlertTriangle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { humanizeError } from "@/lib/app-error";
import { formatTWD } from "@/lib/dates";
import {
  ADDON_NEEDS_COUNT,
  MODE_LABEL,
  addonRateText,
  num,
  type PriceList,
  type PricingMode,
} from "@/lib/price-list";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface CalcDetail {
  mode: PricingMode;
  category: string;
  unit: string | null;
  suggested: number | null;
  note?: string;
  min_charge?: number | null;
  tier?: { qty_from: number; qty_to: number | null; unit_price: number; unit: string | null };
  billing_qty?: number;
  cai_each?: number | null;
  total_cai?: number | null;
  base?: number;
  min_applied?: boolean;
  addons?: {
    id: string;
    name: string;
    mode: string;
    rate: number;
    count: number | null;
    amount: number | null;
  }[];
  percent?: number;
  percent_amount?: number;
}

export interface QuoteLine {
  key: string;
  kind: "price" | "free";
  qty: string;
  // 從價目表
  category_id: string;
  item: string;
  option: string;
  width: string;
  height: string;
  /** 勾選的加工：id → 個數（字串） */
  addons: Record<string, string>;
  extra_spec: string;
  /** 報價金額（未稅） */
  amount: string;
  /** 員工自己改過金額（不再跟著建議價變） */
  touched: boolean;
  suggested: number | null;
  detail: CalcDetail | null;
  // 自己填
  item_name: string;
  spec: string;
  unit: string;
  unit_price: string;
}

let seq = 0;
export const newLine = (kind: QuoteLine["kind"] = "price"): QuoteLine => ({
  key: `l${Date.now()}_${seq++}`,
  kind,
  qty: "1",
  category_id: "",
  item: "",
  option: "",
  width: "",
  height: "",
  addons: {},
  extra_spec: "",
  amount: "",
  touched: false,
  suggested: null,
  detail: null,
  item_name: "",
  spec: "",
  unit: "式",
  unit_price: "",
});

/** 這筆的金額（未稅） */
export function lineAmount(l: QuoteLine): number {
  if (l.kind === "price") return num(l.amount);
  return Math.round(num(l.qty) * num(l.unit_price) * 100) / 100;
}

/** 組成 save_quotation 的明細格式 */
export function linePayload(l: QuoteLine, pl: PriceList | undefined) {
  if (l.kind === "free") {
    return {
      item_name: l.item_name.trim(),
      spec: l.spec.trim(),
      qty: num(l.qty),
      unit: l.unit.trim() || "式",
      unit_price: num(l.unit_price),
    };
  }
  const cat = pl?.categories.find((c) => c.id === l.category_id);
  const tierUnit = l.detail?.tier?.unit;
  const addonList = Object.entries(l.addons).map(([id, count]) => ({ id, count: num(count) || 1 }));
  const addonNames = addonList
    .map(({ id, count }) => {
      const a = pl?.addons.find((x) => x.id === id);
      if (!a) return "";
      return ADDON_NEEDS_COUNT.includes(a.mode) && count !== 1 ? `${a.name}×${count}` : a.name;
    })
    .filter(Boolean);
  const isArea = cat?.pricing_mode === "area";
  const dims =
    isArea && l.width && l.height
      ? `${num(l.width)}×${num(l.height)}cm${l.detail?.cai_each ? `（每件 ${l.detail.cai_each} 才）` : ""}`
      : "";
  return {
    item_name: l.item.trim() || cat?.name || "",
    spec: [l.option, dims, addonNames.join("、"), l.extra_spec.trim()].filter(Boolean).join("；"),
    qty: num(l.qty),
    unit: isArea ? "件" : tierUnit || cat?.unit || "式",
    line_total: num(l.amount),
    price_category_id: l.category_id,
    price_item: l.item,
    price_option: l.option,
    width_cm: isArea ? num(l.width) || null : null,
    height_cm: isArea ? num(l.height) || null : null,
    addons: addonList,
  };
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const EMPTY_ITEMS: string[] = [];

export function QuoteLineEditor({
  index,
  line,
  priceList,
  canRemove,
  onChange,
  onRemove,
}: {
  index: number;
  line: QuoteLine;
  priceList: PriceList | undefined;
  canRemove: boolean;
  onChange: (patch: Partial<QuoteLine>) => void;
  onRemove: () => void;
}) {
  const { company } = useAuth();
  const cats = priceList?.categories ?? [];
  const cat = cats.find((c) => c.id === line.category_id);
  const mode = cat?.pricing_mode;

  const itemNames = useMemo(() => {
    if (!cat || !priceList) return EMPTY_ITEMS;
    return [...new Set(priceList.items.filter((i) => i.category_id === cat.id).map((i) => i.item))];
  }, [cat, priceList]);
  const options = useMemo(() => {
    if (!cat || !priceList || !line.item) return EMPTY_ITEMS;
    return [
      ...new Set(
        priceList.items
          .filter((i) => i.category_id === cat.id && i.item === line.item)
          .map((i) => i.option),
      ),
    ];
  }, [cat, priceList, line.item]);
  const addons = useMemo(
    () =>
      (priceList?.addons ?? []).filter((a) => !a.category_id || a.category_id === line.category_id),
    [priceList, line.category_id],
  );

  /* ----- 建議價（資料庫算） ----- */
  const calcInput = useDebounced(
    JSON.stringify({
      c: line.category_id,
      i: line.item,
      o: line.option,
      q: num(line.qty),
      w: num(line.width) || null,
      h: num(line.height) || null,
      a: Object.entries(line.addons)
        .map(([id, count]) => ({ id, count: num(count) || 1 }))
        .sort((x, y) => x.id.localeCompare(y.id)),
    }),
    350,
  );
  const ready =
    line.kind === "price" &&
    !!cat &&
    (mode === "manual" || (!!line.item && (options.length === 0 || options.includes(line.option))));
  const calc = useQuery({
    queryKey: ["calc_price", company?.id, calcInput],
    enabled: ready,
    staleTime: 60_000,
    queryFn: async (): Promise<CalcDetail> => {
      const p = JSON.parse(calcInput) as {
        c: string;
        i: string;
        o: string;
        q: number;
        w: number | null;
        h: number | null;
        a: { id: string; count: number }[];
      };
      const { data, error } = await supabase.rpc("calc_price", {
        p_category_id: p.c,
        p_item: p.i || (cat?.name ?? ""),
        p_option: p.o,
        p_qty: p.q,
        p_width: p.w,
        p_height: p.h,
        p_addons: p.a,
      });
      if (error) throw error;
      return data as CalcDetail;
    },
  });

  // 建議價出來後：還沒改過金額的，金額跟著建議價
  const detail = ready ? (calc.data ?? null) : null;
  const suggested = detail?.suggested ?? null;
  useEffect(() => {
    if (line.kind !== "price") return;
    const patch: Partial<QuoteLine> = {};
    if (line.detail !== detail) patch.detail = detail;
    if (line.suggested !== suggested) patch.suggested = suggested;
    if (!line.touched && suggested !== null && line.amount !== String(suggested))
      patch.amount = String(suggested);
    if (Object.keys(patch).length) onChange(patch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, suggested, line.kind, line.touched]);

  const amt = num(line.amount);
  const diff =
    suggested !== null && line.amount !== "" ? Math.round(amt) - Math.round(suggested) : 0;

  const pickCategory = (id: string) => {
    const c = cats.find((x) => x.id === id);
    const names = priceList
      ? [...new Set(priceList.items.filter((i) => i.category_id === id).map((i) => i.item))]
      : [];
    const first = names.length === 1 ? (names[0] ?? "") : "";
    const opts =
      first && priceList
        ? [
            ...new Set(
              priceList.items
                .filter((i) => i.category_id === id && i.item === first)
                .map((i) => i.option),
            ),
          ]
        : [];
    onChange({
      category_id: id,
      item: c?.pricing_mode === "manual" ? (c?.name ?? "") : first,
      option: opts.length === 1 ? (opts[0] ?? "") : "",
      addons: {},
      width: "",
      height: "",
      touched: false,
      amount: "",
    });
  };
  const pickItem = (item: string) => {
    const opts = priceList
      ? [
          ...new Set(
            priceList.items
              .filter((i) => i.category_id === line.category_id && i.item === item)
              .map((i) => i.option),
          ),
        ]
      : [];
    onChange({ item, option: opts.length === 1 ? (opts[0] ?? "") : "" });
  };

  return (
    <div className="space-y-3 rounded-lg border bg-card p-3">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
          {index + 1}
        </span>
        <div className="flex rounded-md border p-0.5 text-sm">
          {(
            [
              ["price", "從價目表選"],
              ["free", "自己填"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={`rounded px-2.5 py-1 ${line.kind === k ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
              onClick={() => onChange({ kind: k })}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <span className="text-sm font-semibold tabular-nums">{formatTWD(lineAmount(line))}</span>
        {canRemove && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0 text-destructive"
            title="刪除這筆"
            onClick={onRemove}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      {line.kind === "free" ? (
        <div className="grid gap-2 sm:grid-cols-12">
          <div className="space-y-1 sm:col-span-4">
            <Label className="text-xs">品名 *</Label>
            <Input
              value={line.item_name}
              onChange={(e) => onChange({ item_name: e.target.value })}
            />
          </div>
          <div className="space-y-1 sm:col-span-4">
            <Label className="text-xs">規格</Label>
            <Input value={line.spec} onChange={(e) => onChange({ spec: e.target.value })} />
          </div>
          <div className="space-y-1 sm:col-span-1">
            <Label className="text-xs">數量</Label>
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              className="text-right"
              value={line.qty}
              onChange={(e) => onChange({ qty: e.target.value })}
            />
          </div>
          <div className="space-y-1 sm:col-span-1">
            <Label className="text-xs">單位</Label>
            <Input value={line.unit} onChange={(e) => onChange({ unit: e.target.value })} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs">單價（未稅）</Label>
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              className="text-right"
              value={line.unit_price}
              onChange={(e) => onChange({ unit_price: e.target.value })}
            />
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-12">
            沒有用價目表的品項，送出時老闆會收到「自己填價」的提醒。
          </p>
        </div>
      ) : cats.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          還沒有設定價目，請先到「價目設定」上傳價目表，或改用「自己填」。
        </p>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-xs">大類 *</Label>
              <Select value={line.category_id} onValueChange={pickCategory}>
                <SelectTrigger>
                  <SelectValue placeholder="選大類" />
                </SelectTrigger>
                <SelectContent>
                  {cats.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                      <span className="ml-1 text-xs text-muted-foreground">
                        （{MODE_LABEL[c.pricing_mode]}）
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {cat && mode !== "manual" && (
              <div className="space-y-1">
                <Label className="text-xs">品項 *</Label>
                <Select value={line.item} onValueChange={pickItem}>
                  <SelectTrigger>
                    <SelectValue placeholder="選品項" />
                  </SelectTrigger>
                  <SelectContent>
                    {itemNames.map((n) => (
                      <SelectItem key={n} value={n}>
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {cat && mode === "manual" && (
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-xs">品名 *</Label>
                <Input value={line.item} onChange={(e) => onChange({ item: e.target.value })} />
              </div>
            )}
            {cat && mode !== "manual" && options.some((o) => o !== "") && (
              <div className="space-y-1">
                <Label className="text-xs">價格選項 *</Label>
                <Select value={line.option} onValueChange={(o) => onChange({ option: o })}>
                  <SelectTrigger>
                    <SelectValue placeholder="選規格" />
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((o) => (
                      <SelectItem key={o || "_none"} value={o}>
                        {o || "（一般）"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {cat && (
            <div className="flex flex-wrap items-end gap-3">
              {mode === "area" && (
                <>
                  <div className="w-24 space-y-1">
                    <Label className="text-xs">寬（公分）</Label>
                    <Input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      className="text-right"
                      value={line.width}
                      onChange={(e) => onChange({ width: e.target.value })}
                    />
                  </div>
                  <span className="pb-2 text-muted-foreground">×</span>
                  <div className="w-24 space-y-1">
                    <Label className="text-xs">高（公分）</Label>
                    <Input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      className="text-right"
                      value={line.height}
                      onChange={(e) => onChange({ height: e.target.value })}
                    />
                  </div>
                </>
              )}
              <div className="w-28 space-y-1">
                <Label className="text-xs">
                  數量（{mode === "area" ? "件" : detail?.tier?.unit || cat.unit || "個"}）
                </Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  className="text-right"
                  value={line.qty}
                  onChange={(e) => onChange({ qty: e.target.value })}
                />
              </div>
              {mode === "area" && detail?.cai_each && (
                <p className="pb-2 text-sm text-muted-foreground">
                  每件 {detail.cai_each} 才，共 {detail.total_cai} 才
                </p>
              )}
            </div>
          )}

          {cat && mode !== "manual" && addons.length > 0 && (
            <div className="space-y-1">
              <Label className="text-xs">加工（勾選會加價）</Label>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {addons.map((a) => {
                  const on = a.id in line.addons;
                  const needCount = ADDON_NEEDS_COUNT.includes(a.mode);
                  return (
                    <div key={a.id} className="flex items-center gap-1.5 text-sm">
                      <Checkbox
                        id={`${line.key}_${a.id}`}
                        checked={on}
                        onCheckedChange={(v) => {
                          const next = { ...line.addons };
                          if (v) next[a.id] = "1";
                          else delete next[a.id];
                          onChange({ addons: next });
                        }}
                      />
                      <label htmlFor={`${line.key}_${a.id}`} className="cursor-pointer">
                        {a.name}
                        <span className="ml-1 text-xs text-muted-foreground">
                          {addonRateText(a, cat.unit)}
                        </span>
                      </label>
                      {on && needCount && (
                        <Input
                          type="number"
                          inputMode="numeric"
                          min={1}
                          className="h-7 w-16 text-right"
                          title="個數"
                          value={line.addons[a.id] ?? "1"}
                          onChange={(e) =>
                            onChange({ addons: { ...line.addons, [a.id]: e.target.value } })
                          }
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {cat && (
            <div className="space-y-1">
              <Label className="text-xs">規格備註（不影響價格）</Label>
              <Input
                value={line.extra_spec}
                placeholder="例：顏色、版面、交貨方式"
                onChange={(e) => onChange({ extra_spec: e.target.value })}
              />
            </div>
          )}

          {cat && (
            <div className="grid gap-3 rounded-md bg-muted/50 p-3 sm:grid-cols-[1fr_auto]">
              <div className="space-y-0.5 text-sm">
                {calc.isFetching && !detail && <p className="text-muted-foreground">計算中…</p>}
                {!!calc.error && (
                  <p className="text-destructive">{humanizeError(calc.error, "計算建議價")}</p>
                )}
                {!ready && mode !== "manual" && (
                  <p className="text-muted-foreground">選好品項和規格後會算出建議價</p>
                )}
                {detail && <Breakdown d={detail} qty={num(line.qty)} />}
              </div>
              <div className="space-y-1 sm:w-44">
                <Label className="text-xs">報價金額（未稅）*</Label>
                <div className="flex gap-1">
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    className="text-right font-semibold"
                    value={line.amount}
                    onChange={(e) => onChange({ amount: e.target.value, touched: true })}
                  />
                  {line.touched && suggested !== null && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-9 w-9 shrink-0 p-0"
                      title="改回建議價"
                      onClick={() => onChange({ amount: String(suggested), touched: false })}
                    >
                      <RotateCcw className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                {num(line.qty) > 0 && amt > 0 && (
                  <p className="text-xs text-muted-foreground">
                    單價約 {formatTWD(Math.round((amt / num(line.qty)) * 100) / 100)}
                  </p>
                )}
              </div>
              {diff !== 0 && suggested !== null && (
                <p className="flex items-center gap-1 text-sm text-amber-700 dark:text-amber-400 sm:col-span-2">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  比建議價{diff < 0 ? "低" : "高"} {formatTWD(Math.abs(diff))}
                  {suggested > 0
                    ? `（${diff < 0 ? "-" : "+"}${Math.round((Math.abs(diff) * 100) / suggested)}%）`
                    : ""}
                  ，送出時老闆會收到通知
                </p>
              )}
              {mode === "manual" && (
                <p className="text-sm text-amber-700 dark:text-amber-400 sm:col-span-2">
                  這個大類需老闆報價，請自己填金額；送出時老闆會收到通知。
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const money = (v: number | null | undefined) => formatTWD(v ?? 0);

function Breakdown({ d, qty }: { d: CalcDetail; qty: number }) {
  if (d.suggested === null) {
    return <p className="text-muted-foreground">{d.note ?? "沒有建議價"}</p>;
  }
  const unit = d.tier?.unit || d.unit || "";
  return (
    <>
      {d.mode === "area" ? (
        <p>
          每件 {d.cai_each} 才 × {qty} 件 ＝ {d.total_cai} 才 × {money(d.tier?.unit_price)}／才 ＝{" "}
          {money(num(d.billing_qty) * num(d.tier?.unit_price))}
        </p>
      ) : (
        <p>
          {num(d.billing_qty)} {unit} × {money(d.tier?.unit_price)} ＝{" "}
          {money(num(d.billing_qty) * num(d.tier?.unit_price))}
          {d.tier && (
            <span className="ml-1 text-xs text-muted-foreground">
              （{num(d.tier.qty_from)}～{d.tier.qty_to === null ? "不限" : num(d.tier.qty_to)}{" "}
              這一級）
            </span>
          )}
        </p>
      )}
      {d.min_applied && <p>未達最低收費，以 {money(d.min_charge)} 計</p>}
      {(d.addons ?? []).map((a) => (
        <p key={a.id}>
          ＋ {a.name}
          {a.count && a.count !== 1 ? ` ×${a.count}` : ""}{" "}
          {a.mode === "percent"
            ? `（總價 +${Math.round(num(a.rate) * 1000) / 10}%）`
            : money(a.amount)}
        </p>
      ))}
      {!!d.percent_amount && <p>＋ 加成 {money(d.percent_amount)}</p>}
      <p className="font-semibold">建議價 {money(d.suggested)}（未稅）</p>
    </>
  );
}
