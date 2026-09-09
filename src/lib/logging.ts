import { supabase } from "./supabase";

// 操作日誌：登入／登出／切換公司／匯出等一般行為。
// 三張 log 表的 INSERT 政策要求 user_id = 自己，沒有身分就不寫。
export async function logActivity(action: string, route?: string, companyId?: string | null) {
  try {
    const { data } = await supabase.auth.getUser();
    if (!data.user?.id) return;
    await supabase.from("activity_logs").insert({
      user_id: data.user.id,
      company_id: companyId ?? null,
      action,
      route: route ?? (typeof window !== "undefined" ? window.location.pathname : null),
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
    });
  } catch {
    /* 日誌寫入失敗不影響主流程 */
  }
}

// 錯誤日誌：前端例外
export async function logError(message: string, context?: unknown, companyId?: string | null) {
  try {
    const { data } = await supabase.auth.getUser();
    if (!data.user?.id) return;
    await supabase.from("error_logs").insert({
      level: "error",
      message,
      context: context ? (context as Record<string, unknown>) : null,
      route: typeof window !== "undefined" ? window.location.pathname : null,
      user_id: data.user.id,
      company_id: companyId ?? null,
    });
  } catch {
    /* 忽略 */
  }
}
