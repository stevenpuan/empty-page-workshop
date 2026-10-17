/**
 * 請假與薪資共用：假別、薪資明細欄位與格式（033_leave_payroll）。
 * 金額一律由資料庫 _payroll_compute 計算，前端只顯示。
 */

export type LeaveType =
  | "annual"
  | "personal"
  | "family_care"
  | "sick"
  | "marriage"
  | "funeral"
  | "occupational"
  | "maternity"
  | "menstrual"
  | "other_paid";

export const LEAVE_LABEL: Record<LeaveType, string> = {
  annual: "特休",
  personal: "事假",
  family_care: "家庭照顧假",
  sick: "病假",
  marriage: "婚假",
  funeral: "喪假",
  occupational: "公傷病假",
  maternity: "產假",
  menstrual: "生理假",
  other_paid: "其他有薪假",
};

/** 每種假對薪水的影響（顯示給員工看） */
export const LEAVE_HINT: Record<LeaveType, string> = {
  annual: "照常給薪，不影響全勤",
  personal: "不給薪，當月沒有全勤獎金",
  family_care: "不給薪（併入事假天數），可以小時請，不影響全勤",
  sick: "給半薪；全勤獎金只按天數比例扣",
  marriage: "照常給薪，不影響全勤",
  funeral: "照常給薪，不影響全勤",
  occupational: "照常給薪，不影響全勤",
  maternity: "依規定給薪，不影響全勤",
  menstrual: "依規定給薪，不影響全勤",
  other_paid: "照常給薪（請在原因寫清楚是什麼假）",
};

/** 打卡頁常用的放前面 */
export const LEAVE_MAIN: LeaveType[] = ["annual", "personal", "sick", "family_care"];
export const LEAVE_MORE: LeaveType[] = [
  "marriage",
  "funeral",
  "occupational",
  "menstrual",
  "maternity",
  "other_paid",
];

export const LEAVE_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "待核准", cls: "bg-yellow-100 text-yellow-800 border-yellow-200" },
  approved: { label: "已核准", cls: "bg-green-100 text-green-800 border-green-200" },
  rejected: { label: "已駁回", cls: "bg-red-100 text-red-800 border-red-200" },
  cancelled: { label: "已取消", cls: "bg-gray-100 text-gray-600 border-gray-200" },
};

export interface LeaveRow {
  id: string;
  employee_id: string;
  leave_type: LeaveType;
  date_from: string;
  date_to: string;
  hours: number | string;
  reason: string | null;
  status: string;
  approver_note: string | null;
  created_at: string;
  employee?: { name: string; emp_no: string } | null;
}

export const LEAVE_COLUMNS =
  "id, employee_id, leave_type, date_from, date_to, hours, reason, status, approver_note, created_at";

export const num = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};

/** MM/DD 或 MM/DD～MM/DD */
export function leaveRange(from: string, to: string): string {
  const f = from.slice(5).replace("-", "/");
  const t = to.slice(5).replace("-", "/");
  return from === to ? f : `${f}～${t}`;
}

/** 兩個日期（含頭尾）的天數 */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return 0;
  return Math.round((b - a) / 86400000) + 1;
}

/** 時數顯示：8 小時＝1 天 */
export function hoursText(h: number): string {
  const n = Math.round(h * 10) / 10;
  if (n >= 8 && n % 8 === 0) return `${n / 8} 天`;
  if (n > 8) return `${Math.floor(n / 8)} 天 ${Math.round((n % 8) * 10) / 10} 小時`;
  return `${n} 小時`;
}

/* ---------------- 薪資 ---------------- */

export interface PayAtt {
  pay_days: number;
  work_days: number;
  late_count: number;
  late_min: number;
  early_count: number;
  early_min: number;
  absent_days: number;
  missing_days: number;
  ot134_h: number;
  ot167_h: number;
  hol_h: number;
  normal_h: number;
  personal_h: number;
  family_h: number;
  sick_h: number;
  annual_h: number;
  paid_h: number;
  pending_leaves: number;
}

export interface PayItem {
  id: string;
  run_id: string;
  employee_id: string;
  emp_no: string | null;
  employee_name: string | null;
  pay_type: "monthly" | "hourly" | null;
  perf_bonus: number | string;
  other_add: number | string;
  income_tax: number | string;
  other_deduct: number | string;
  pay_days_override: number | string | null;
  note: string | null;
  att: PayAtt | null;
  pay_days: number | string | null;
  hourly_base: number | string | null;
  daily_base: number | string | null;
  base_pay: number | string | null;
  position_pay: number | string | null;
  meal_pay: number | string | null;
  attendance_bonus: number | string | null;
  ot_pay: number | string | null;
  holiday_pay: number | string | null;
  personal_deduct: number | string | null;
  sick_deduct: number | string | null;
  absent_deduct: number | string | null;
  late_deduct: number | string | null;
  gross_pay: number | string | null;
  insured_salary: number | string | null;
  li_emp: number | string | null;
  nhi_emp: number | string | null;
  pension_self: number | string | null;
  deduct_total: number | string | null;
  net_pay: number | string | null;
  er_li: number | string | null;
  er_nhi: number | string | null;
  er_pension: number | string | null;
  total_cost: number | string | null;
  warnings?: string[];
  period?: string;
}

export const PAY_ITEM_COLUMNS =
  "id, run_id, employee_id, emp_no, employee_name, pay_type, perf_bonus, other_add, income_tax, other_deduct, " +
  "pay_days_override, note, att, pay_days, hourly_base, daily_base, base_pay, position_pay, meal_pay, " +
  "attendance_bonus, ot_pay, holiday_pay, personal_deduct, sick_deduct, absent_deduct, late_deduct, gross_pay, " +
  "insured_salary, li_emp, nhi_emp, pension_self, deduct_total, net_pay, er_li, er_nhi, er_pension, total_cost, warnings";

type K = keyof PayItem;
export const PAY_ADD: [K, string][] = [
  ["base_pay", "本薪"],
  ["position_pay", "職務加給"],
  ["meal_pay", "伙食津貼"],
  ["attendance_bonus", "全勤獎金"],
  ["ot_pay", "加班費"],
  ["holiday_pay", "國定假日出勤"],
  ["perf_bonus", "績效獎金"],
  ["other_add", "其他加項"],
];
export const PAY_SUB: [K, string][] = [
  ["personal_deduct", "事假／家庭照顧假"],
  ["sick_deduct", "病假（半薪）"],
  ["absent_deduct", "曠職"],
  ["late_deduct", "遲到早退"],
];
export const PAY_DED: [K, string][] = [
  ["li_emp", "勞保＋就保（自付）"],
  ["nhi_emp", "健保（自付）"],
  ["pension_self", "勞退自提"],
  ["income_tax", "所得稅"],
  ["other_deduct", "其他扣款"],
];
export const PAY_ER: [K, string][] = [
  ["er_li", "勞保＋就保＋職災"],
  ["er_nhi", "健保"],
  ["er_pension", "勞退提繳 6%"],
];

export function periodLabel(period: string): string {
  const [y, m] = period.split("-");
  return `${y} 年 ${Number(m)} 月`;
}

/** 出勤摘要（給薪資條用） */
export function attLines(a: PayAtt | null, payType: string | null): [string, string][] {
  if (!a) return [];
  const out: [string, string][] = [["出勤天數", `${num(a.work_days)} 天`]];
  if (payType === "hourly") out.push(["正常工時", `${num(a.normal_h)} 小時`]);
  if (num(a.pay_days) !== 30 && payType !== "hourly")
    out.push(["計薪天數", `${num(a.pay_days)} 天`]);
  const opt: [number, string, string][] = [
    [num(a.ot134_h), "加班（1.34 倍）", "小時"],
    [num(a.ot167_h), "加班（1.67 倍）", "小時"],
    [num(a.hol_h), "國定假日出勤", "小時"],
    [num(a.annual_h), "特休", "小時"],
    [num(a.personal_h), "事假", "小時"],
    [num(a.family_h), "家庭照顧假", "小時"],
    [num(a.sick_h), "病假", "小時"],
    [num(a.paid_h), "其他有薪假", "小時"],
    [num(a.absent_days), "曠職", "天"],
  ];
  for (const [v, label, unit] of opt) if (v) out.push([label, `${v} ${unit}`]);
  if (num(a.late_count)) out.push(["遲到", `${num(a.late_count)} 次，共 ${num(a.late_min)} 分鐘`]);
  if (num(a.early_count))
    out.push(["早退", `${num(a.early_count)} 次，共 ${num(a.early_min)} 分鐘`]);
  return out;
}
