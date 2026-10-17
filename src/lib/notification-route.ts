/**
 * 通知點下去要去哪一頁（鈴鐺與通知中心共用）。
 * ref_type／rule_code 對應資料庫 emit_notification 與各觸發器寫入的值。
 */
import type { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/lib/supabase";

type Navigate = ReturnType<typeof useNavigate>;

export interface NotificationRef {
  ref_type: string | null;
  ref_id: string | null;
  rule_code?: string | null;
}

/** 通知種類的中文名稱（與 notification_rules.name 一致） */
export const RULE_LABEL: Record<string, string> = {
  abnormal_location: "異地打卡",
  account_created: "帳號建立",
  approval_pending: "簽核逾時",
  clock_in_missing: "未打上班卡",
  leave_decided: "請假審核結果",
  leave_requested: "請假待核准",
  outsource_amount_adjusted: "外包金額調整",
  outsource_completed: "外包完成",
  outsource_dispatched: "收到外包",
  outsource_overdue: "外包逾期",
  outsource_rejected: "外包被拒接",
  payable_due_soon: "應付快到期",
  payable_overdue: "應付逾期",
  payroll_published: "薪資條",
  quick_job_assigned: "快單派給你",
  quick_job_cancelled: "快單取消",
  quick_job_new: "新快單",
  quick_job_ready: "快單待取件",
  quotation_sent: "報價單送出",
  receivable_due_soon: "請款提醒",
  receivable_overdue: "逾期未收",
  system_alert: "系統通知",
  task_available: "有工作可接",
  task_blocked: "工序卡關",
  task_overdue: "工序逾期",
  task_waiting_customer: "校稿久候",
};

const SIMPLE: Record<string, string> = {
  attendance: "/attendance",
  attendance_amendment: "/attendance",
  payable: "/dashboard/payables",
  receivable: "/dashboard/receivables",
  quotation: "/dashboard/quotations",
  quick_job: "/dashboard/quick",
  cross_company_link: "/dashboard/outsource",
};

/** 依通知導頁；沒有對應頁面時回傳 false */
export async function goToNotification(n: NotificationRef, navigate: Navigate): Promise<boolean> {
  const t = n.ref_type;
  if (!t) return false;

  if ((t === "order_task" || t === "task") && n.ref_id) {
    // ref_id 是工序 id，要先查出所屬訂單
    const { data } = await supabase
      .from("order_tasks")
      .select("order_id")
      .eq("id", n.ref_id)
      .maybeSingle();
    const orderId = (data as { order_id?: string } | null)?.order_id;
    if (orderId) {
      void navigate({ to: "/dashboard/orders/$orderId", params: { orderId } });
    } else if ((n.rule_code ?? "").startsWith("outsource_")) {
      void navigate({ to: "/dashboard/outsource" });
    } else {
      void navigate({ to: "/dashboard/board" });
    }
    return true;
  }
  if (t === "leave_request") {
    if (n.rule_code === "leave_requested") void navigate({ to: "/attendance" });
    else void navigate({ to: "/clock", search: { leave: "1" } });
    return true;
  }
  if (t === "payroll") {
    void navigate({ to: "/clock", search: { pay: "1" } });
    return true;
  }
  if (t === "employee") {
    if (n.rule_code === "clock_in_missing") void navigate({ to: "/attendance" });
    else void navigate({ to: "/dashboard/settings/employees" });
    return true;
  }
  const to = SIMPLE[t];
  if (to) {
    void navigate({ to });
    return true;
  }
  return false;
}
