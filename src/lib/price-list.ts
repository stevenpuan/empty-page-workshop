/**
 * 報價價目表共用：型別、中文標籤、Excel 匯入解析與匯出（032_price_list）。
 * 建議價一律由資料庫 calc_price 計算，前端不自己算價。
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Company } from "@/lib/auth";

export type PricingMode = "tier" | "area" | "fixed" | "manual";
export type AddonMode = "per_unit" | "per_cai" | "per_piece" | "fixed" | "percent";

export interface PriceCategory {
  id: string;
  name: string;
  pricing_mode: PricingMode;
  unit: string | null;
  min_charge: number | string | null;
  note: string | null;
  sort_order: number;
}
export interface PriceItem {
  id: string;
  category_id: string;
  item: string;
  option: string;
  qty_from: number | string;
  qty_to: number | string | null;
  unit_price: number | string;
  unit: string | null;
  note: string | null;
  sort_order: number;
}
export interface PriceAddon {
  id: string;
  name: string;
  category_id: string | null;
  mode: AddonMode;
  amount: number | string;
  note: string | null;
  sort_order: number;
}
export interface PriceList {
  categories: PriceCategory[];
  items: PriceItem[];
  addons: PriceAddon[];
}

export const MODE_LABEL: Record<PricingMode, string> = {
  tier: "數量級距",
  area: "面積計價",
  fixed: "固定單價",
  manual: "需老闆報價",
};
export const MODE_HELP: Record<PricingMode, string> = {
  tier: "數量落在哪一級就用那一級的單價",
  area: "每才單價 × 才數（寬×高÷918，不足 1 才算 1 才）",
  fixed: "單價 × 數量",
  manual: "系統不算價，員工自己填，老闆會收到通知",
};
export const ADDON_MODE_LABEL: Record<AddonMode, string> = {
  per_unit: "每個計價單位",
  per_cai: "每才",
  per_piece: "每個",
  fixed: "固定金額",
  percent: "總價加成",
};
/** 報價時要填個數的加工 */
export const ADDON_NEEDS_COUNT: AddonMode[] = ["per_piece", "fixed"];

const reverse = <T extends string>(m: Record<T, string>) =>
  Object.fromEntries(Object.entries(m).map(([k, v]) => [v, k])) as Record<string, T>;
const MODE_BY_LABEL = reverse(MODE_LABEL);
const ADDON_MODE_BY_LABEL = reverse(ADDON_MODE_LABEL);

export const num = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};

/** 讀取目前公司的價目（三張表） */
export function usePriceList(companyId: string | undefined) {
  return useQuery({
    queryKey: ["price_list", companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<PriceList> => {
      const [c, i, a] = await Promise.all([
        supabase
          .from("price_categories")
          .select("id, name, pricing_mode, unit, min_charge, note, sort_order")
          .order("sort_order")
          .order("name"),
        supabase
          .from("price_items")
          .select(
            "id, category_id, item, option, qty_from, qty_to, unit_price, unit, note, sort_order",
          )
          .order("sort_order")
          .order("qty_from"),
        supabase
          .from("price_addons")
          .select("id, name, category_id, mode, amount, note, sort_order")
          .order("sort_order")
          .order("name"),
      ]);
      if (c.error) throw c.error;
      if (i.error) throw i.error;
      if (a.error) throw a.error;
      return {
        categories: (c.data ?? []) as PriceCategory[],
        items: (i.data ?? []) as PriceItem[],
        addons: (a.data ?? []) as PriceAddon[],
      };
    },
  });
}

/** 金額欄的字串轉數字：允許千分位、% */
function parseNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[,，\s$＄元]/g, "");
  if (!s) return null;
  if (s.endsWith("%") || s.endsWith("％")) {
    const n = Number(s.slice(0, -1));
    return Number.isFinite(n) ? n / 100 : null;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
const text = (v: unknown): string => (v === null || v === undefined ? "" : String(v).trim());
const norm = (s: string) => s.replace(/[\s（）()]/g, "").replace(/未稅/g, "");

/** 依表頭找欄位（容許空白、括號、「未稅」字樣不同） */
function pick(row: Record<string, unknown>, ...names: string[]): unknown {
  const keys = Object.keys(row);
  for (const n of names) {
    const want = norm(n);
    const k =
      keys.find((key) => norm(key) === want) ?? keys.find((key) => norm(key).startsWith(want));
    if (k !== undefined) return row[k];
  }
  return undefined;
}

export interface ImportCategory {
  row: number;
  name: string;
  mode: PricingMode;
  unit: string;
  min_charge: number | null;
  note: string;
}
export interface ImportItem {
  row: number;
  category: string;
  item: string;
  option: string;
  qty_from: number;
  qty_to: number | null;
  unit_price: number;
  unit: string;
  note: string;
}
export interface ImportAddon {
  row: number;
  name: string;
  category: string;
  mode: AddonMode;
  amount: number;
  note: string;
}
export interface ImportBatch {
  company: Company;
  categories: ImportCategory[];
  items: ImportItem[];
  addons: ImportAddon[];
}
export interface ImportResult {
  batches: ImportBatch[];
  errors: string[];
  warnings: string[];
}

/** 公司欄的文字對應到公司（「祥興」對得到「祥興印刷」；空白＝目前公司） */
function matchCompany(label: string, companies: Company[], current: Company): Company | null {
  if (!label) return current;
  const l = label.replace(/\s/g, "");
  return (
    companies.find(
      (c) =>
        c.code.toLowerCase() === l.toLowerCase() ||
        c.name.includes(l) ||
        (c.short_name ?? "").includes(l) ||
        (!!c.short_name && l.includes(c.short_name)),
    ) ?? null
  );
}

/** 解析上傳的價目表 Excel（範本格式：品項大類／價目表／加工加價三個工作表） */
export async function parsePriceWorkbook(
  file: File,
  companies: Company[],
  current: Company,
): Promise<ImportResult> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const errors: string[] = [];
  const warnings: string[] = [];
  const byCo = new Map<string, ImportBatch>();
  const batchOf = (co: Company) => {
    let b = byCo.get(co.id);
    if (!b) {
      b = { company: co, categories: [], items: [], addons: [] };
      byCo.set(co.id, b);
    }
    return b;
  };

  const sheet = (name: string) => {
    const ws = wb.Sheets[name];
    if (!ws) {
      errors.push(`找不到工作表「${name}」，請用系統提供的範本格式`);
      return [] as Record<string, unknown>[];
    }
    return XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null, raw: true });
  };
  const isBlank = (r: Record<string, unknown>) => Object.values(r).every((v) => text(v) === "");
  const coOf = (sheetName: string, rowNo: number, r: Record<string, unknown>) => {
    const label = text(pick(r, "公司"));
    const co = matchCompany(label, companies, current);
    if (!co) errors.push(`${sheetName}第 ${rowNo} 列：公司「${label}」對不到你可以管理的公司`);
    return co;
  };

  // 品項大類
  sheet("品項大類").forEach((r, i) => {
    const rowNo = i + 2;
    if (isBlank(r)) return;
    const co = coOf("品項大類", rowNo, r);
    const name = text(pick(r, "大類"));
    const modeLabel = text(pick(r, "計價方式"));
    const mode =
      MODE_BY_LABEL[modeLabel] ??
      (modeLabel in MODE_LABEL ? (modeLabel as PricingMode) : undefined);
    const minRaw = pick(r, "最低收費");
    const min = parseNumber(minRaw);
    if (!name) errors.push(`品項大類第 ${rowNo} 列：沒有填大類名稱`);
    if (!mode)
      errors.push(
        `品項大類第 ${rowNo} 列：計價方式「${modeLabel}」不正確，要用：${Object.values(MODE_LABEL).join("、")}`,
      );
    if (text(minRaw) !== "" && (min === null || min < 0))
      errors.push(`品項大類第 ${rowNo} 列：最低收費「${text(minRaw)}」不是正確的金額`);
    if (co && name && mode)
      batchOf(co).categories.push({
        row: rowNo,
        name,
        mode,
        unit: text(pick(r, "計價單位")),
        min_charge: min,
        note: text(pick(r, "備註")),
      });
  });

  // 價目表
  sheet("價目表").forEach((r, i) => {
    const rowNo = i + 2;
    if (isBlank(r)) return;
    const co = coOf("價目表", rowNo, r);
    const category = text(pick(r, "大類"));
    const item = text(pick(r, "品項"));
    const fromRaw = pick(r, "數量從");
    const toRaw = pick(r, "數量到");
    const priceRaw = pick(r, "單價");
    const from = text(fromRaw) === "" ? 1 : parseNumber(fromRaw);
    const to = text(toRaw) === "" ? null : parseNumber(toRaw);
    const price = parseNumber(priceRaw);
    const bad = (m: string) => errors.push(`價目表第 ${rowNo} 列：${m}`);
    if (!category) bad("沒有填大類");
    if (!item) bad("沒有填品項");
    if (from === null || from < 0) bad(`數量從「${text(fromRaw)}」不是正確的數字`);
    if (text(toRaw) !== "" && (to === null || (from !== null && to < from)))
      bad(`數量到「${text(toRaw)}」不正確（要空白或大於等於數量從）`);
    if (price === null || price < 0) bad(`單價「${text(priceRaw)}」不是正確的金額`);
    if (co && category && item && from !== null && from >= 0 && price !== null && price >= 0)
      batchOf(co).items.push({
        row: rowNo,
        category,
        item,
        option: text(pick(r, "價格選項")),
        qty_from: from,
        qty_to: to,
        unit_price: price,
        unit: text(pick(r, "單位")),
        note: text(pick(r, "備註")),
      });
  });

  // 加工加價
  sheet("加工加價").forEach((r, i) => {
    const rowNo = i + 2;
    if (isBlank(r)) return;
    const co = coOf("加工加價", rowNo, r);
    const name = text(pick(r, "加工名稱"));
    const modeLabel = text(pick(r, "加價方式"));
    const mode =
      ADDON_MODE_BY_LABEL[modeLabel] ??
      (modeLabel in ADDON_MODE_LABEL ? (modeLabel as AddonMode) : undefined);
    const amtRaw = pick(r, "金額或比例", "金額");
    let amount = parseNumber(amtRaw);
    const bad = (m: string) => errors.push(`加工加價第 ${rowNo} 列：${m}`);
    if (!name) bad("沒有填加工名稱");
    if (!mode)
      bad(`加價方式「${modeLabel}」不正確，要用：${Object.values(ADDON_MODE_LABEL).join("、")}`);
    if (amount === null || amount < 0) bad(`金額或比例「${text(amtRaw)}」不正確`);
    if (mode === "percent" && amount !== null && amount > 1) {
      warnings.push(`加工加價第 ${rowNo} 列「${name}」填 ${amount}，當成 ${amount}% 處理`);
      amount = amount / 100;
    }
    if (co && name && mode && amount !== null && amount >= 0)
      batchOf(co).addons.push({
        row: rowNo,
        name,
        category: text(pick(r, "適用大類")),
        mode,
        amount,
        note: text(pick(r, "備註")),
      });
  });

  // 價目表、加工的大類要在品項大類裡
  for (const b of byCo.values()) {
    const names = new Set(b.categories.map((c) => c.name));
    const seen = new Set<string>();
    for (const c of b.categories) {
      if (seen.has(c.name)) errors.push(`品項大類第 ${c.row} 列：「${c.name}」重複了`);
      seen.add(c.name);
    }
    for (const it of b.items)
      if (!names.has(it.category))
        errors.push(
          `價目表第 ${it.row} 列：大類「${it.category}」不在${b.company.short_name ?? b.company.name}的品項大類裡`,
        );
    for (const a of b.addons)
      if (a.category && !names.has(a.category))
        errors.push(`加工加價第 ${a.row} 列：適用大類「${a.category}」不在品項大類裡`);
    const keys = new Set<string>();
    for (const it of b.items) {
      const k = [it.category, it.item, it.option, it.qty_from].join("|");
      if (keys.has(k)) errors.push(`價目表第 ${it.row} 列：和前面重複（同品項、同選項、同數量從）`);
      keys.add(k);
    }
  }

  return { batches: [...byCo.values()], errors, warnings };
}

/** 匯出目前價目為 Excel（格式與範本相同，可改完再上傳） */
export async function exportPriceWorkbook(company: Company, data: PriceList) {
  const XLSX = await import("xlsx");
  const label = company.short_name ?? company.name;
  const catName = new Map(data.categories.map((c) => [c.id, c.name]));
  const wb = XLSX.utils.book_new();
  const add = (name: string, aoa: (string | number | null)[][], widths: number[]) => {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = widths.map((w) => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws, name);
  };
  add(
    "說明",
    [
      ["報價價目表（" + label + "）"],
      [""],
      ["改完後在系統「價目設定」頁按「上傳 Excel」，會整份取代這家公司目前的價目。"],
      ["計價方式：" + Object.values(MODE_LABEL).join("、")],
      ["加價方式：" + Object.values(ADDON_MODE_LABEL).join("、")],
      ["金額一律填未稅；數量到空白＝不限；總價加成填 0.3＝加 30%。"],
    ],
    [100],
  );
  add(
    "品項大類",
    [
      ["公司", "大類", "計價方式", "計價單位", "最低收費（未稅）", "備註"],
      ...data.categories.map((c) => [
        label,
        c.name,
        MODE_LABEL[c.pricing_mode],
        c.unit,
        c.min_charge === null ? null : num(c.min_charge),
        c.note,
      ]),
    ],
    [10, 14, 14, 16, 16, 34],
  );
  add(
    "價目表",
    [
      ["公司", "大類", "品項", "價格選項", "數量從", "數量到", "單價（未稅）", "單位", "備註"],
      ...data.items.map((i) => [
        label,
        catName.get(i.category_id) ?? "",
        i.item,
        i.option,
        num(i.qty_from),
        i.qty_to === null ? null : num(i.qty_to),
        num(i.unit_price),
        i.unit,
        i.note,
      ]),
    ],
    [10, 12, 12, 18, 9, 9, 13, 8, 24],
  );
  add(
    "加工加價",
    [
      ["公司", "加工名稱", "適用大類", "加價方式", "金額或比例（未稅）", "備註"],
      ...data.addons.map((a) => [
        label,
        a.name,
        a.category_id ? (catName.get(a.category_id) ?? "") : "",
        ADDON_MODE_LABEL[a.mode],
        num(a.amount),
        a.note,
      ]),
    ],
    [10, 18, 12, 14, 16, 30],
  );
  XLSX.writeFile(wb, `報價價目表_${label}.xlsx`);
}

/** 加工的金額說明（例：每盒 $60、總價 +30%） */
export function addonRateText(
  a: Pick<PriceAddon, "mode" | "amount">,
  unit?: string | null,
): string {
  const v = num(a.amount);
  switch (a.mode) {
    case "percent":
      return `總價 +${Math.round(v * 1000) / 10}%`;
    case "per_unit":
      return `每${unit || "單位"} $${v}`;
    case "per_cai":
      return `每才 $${v}`;
    case "per_piece":
      return `每個 $${v}`;
    default:
      return `$${v}`;
  }
}
