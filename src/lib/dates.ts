/**
 * 日期工具：全站一律用台北時區（UTC+8）。
 * 禁止 `new Date().toISOString().slice(0,10)` —— 那是 UTC，清晨或月初／月底會退回前一天。
 * （ESLint no-restricted-syntax 會擋）
 */
const TZ = "Asia/Taipei";

const ymd = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** 今天（台北）YYYY-MM-DD */
export function taipeiToday(): string {
  return ymd.format(new Date());
}

/** 任意 Date → 台北日期字串 YYYY-MM-DD */
export function toDateStr(d: Date): string {
  return ymd.format(d);
}

/** timestamptz → 台北顯示 yyyy/MM/dd HH:mm */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

/** date → 台北顯示 yyyy/MM/dd */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/** 金額顯示：資料庫存 numeric，前端不做浮點運算，只格式化 */
export function formatTWD(
  v: number | string | null | undefined,
  opts: { withSymbol?: boolean } = {},
): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return String(v);
  const s = new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 2 }).format(n);
  return opts.withSymbol === false ? s : `$${s}`;
}
