import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";

export interface LookupRow {
  id: string;
  company_id: string | null;
  category: string;
  code: string;
  label: string;
  sort_order: number;
  is_active: boolean;
  meta: Record<string, unknown> | null;
}

/**
 * 代碼字典：共用列（company_id null）＋本公司列；同 code 以本公司列覆蓋。
 * RLS 已限制只回共用與當前公司的列，前端只需合併。
 * 下拉選單一律用 useLookup(category)（只含 is_active）；顯示歷史資料的標籤請用 includeInactive。
 */
export function useLookup(category: string, opts: { includeInactive?: boolean } = {}) {
  const q = useQuery({
    queryKey: ["lookups", category],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lookups")
        .select("id, company_id, category, code, label, sort_order, is_active, meta")
        .eq("category", category)
        .order("sort_order");
      if (error) throw error;
      const rows = (data ?? []) as LookupRow[];
      const merged = new Map<string, LookupRow>();
      rows.filter((r) => r.company_id === null).forEach((r) => merged.set(r.code, r));
      rows.filter((r) => r.company_id !== null).forEach((r) => merged.set(r.code, r));
      return Array.from(merged.values()).sort(
        (a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label, "zh-Hant"),
      );
    },
  });
  const options = (q.data ?? []).filter((r) => opts.includeInactive || r.is_active);
  const labelOf = (code: string | null | undefined) =>
    code ? ((q.data ?? []).find((r) => r.code === code)?.label ?? code) : "—";
  return { ...q, options, labelOf };
}
