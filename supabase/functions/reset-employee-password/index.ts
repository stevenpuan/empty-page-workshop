// reset-employee-password
// 產生臨時密碼、踢掉該帳號所有裝置的 session、強制下次登入改密碼、寫 audit。
// 權限：has_perm('employees','edit')；非 owner／平台管理員不得重設 owner 層級帳號（防橫向提權，EIP 資安第 8 項教訓）。
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { authenticate, requirePerm, randomPassword, json, CORS, HttpError, handleError } from "./admin.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  try {
    const c = await authenticate(req);
    await requirePerm(c, "employees", "edit");

    const body = await req.json().catch(() => ({}));
    const employeeId = String(body.employee_id ?? "");
    if (!employeeId) throw new HttpError(400, "缺少 employee_id");

    const { data: emp, error: e1 } = await c.admin
      .from("employees")
      .select("id, company_id, user_id, emp_no, name, roles(tier)")
      .eq("id", employeeId)
      .maybeSingle();
    if (e1) throw new HttpError(500, e1.message);
    if (!emp || emp.company_id !== c.companyId) throw new HttpError(404, "找不到這位員工");
    if (!emp.user_id) throw new HttpError(409, "這位員工尚未建立系統帳號");

    const targetTier = (emp as any).roles?.tier as string | undefined;
    if (targetTier === "owner" && !(c.tier === "owner" || c.isPlatformAdmin)) {
      throw new HttpError(403, "只有老闆可以重設老闆層級帳號的密碼");
    }
    // 平台管理員帳號不可被客戶端重設
    const { data: targetProfile } = await c.admin.from("profiles").select("is_platform_admin").eq("id", emp.user_id).maybeSingle();
    if (targetProfile?.is_platform_admin && !c.isPlatformAdmin) throw new HttpError(403, "不可重設系統維護帳號的密碼");

    const password = randomPassword();
    const { error: e2 } = await c.admin.auth.admin.updateUserById(emp.user_id, { password });
    if (e2) throw new HttpError(500, `重設密碼失敗：${e2.message}`);

    const { data: revoked } = await c.admin.rpc("revoke_user_sessions", { p_user_id: emp.user_id });
    await c.admin.from("profiles").update({ must_change_password: true }).eq("id", emp.user_id);

    await c.admin.rpc("write_audit", {
      p_company_id: emp.company_id,
      p_user_id: c.userId,
      p_action: "reset_password",
      p_target_table: "employees",
      p_target_id: emp.id,
      p_after: { emp_no: emp.emp_no, name: emp.name, revoked_sessions: revoked ?? 0 },
    });

    return json({ ok: true, name: emp.name, emp_no: emp.emp_no, password, revoked_sessions: revoked ?? 0 });
  } catch (e) {
    return handleError(e);
  }
});
