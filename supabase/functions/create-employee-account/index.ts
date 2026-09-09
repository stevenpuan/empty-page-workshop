// create-employee-account
// 老闆／有 employees:edit 權限者，為某位員工建立登入帳號。
// 流程（分析文件 §4.6）：
//   ① 驗證呼叫者：has_perm('employees','edit') 且該員工屬於呼叫者當前公司
//   ② email = `${emp_no}@${company.login_domain}`
//   ③ 若 email 已存在（例：老闆已在另一家有帳號）→ 直接綁定既有 user，不重建
//      否則 auth.admin.createUser（email_confirm: true，不寄信）
//   ④ 回填 employees.user_id、profiles.must_change_password=true、寫 audit、發 account_created 通知
//   ⑤ 回傳 { email, password }（僅新建時有 password；前端只顯示一次）
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
    const customPassword = body.initial_password ? String(body.initial_password) : null;
    if (!employeeId) throw new HttpError(400, "缺少 employee_id");
    if (customPassword && customPassword.length < 8) throw new HttpError(400, "初始密碼至少 8 碼");

    // 員工必須屬於呼叫者當前公司（用 admin 查，再手動比對，避免 RLS 靜默回空）
    const { data: emp, error: e1 } = await c.admin
      .from("employees")
      .select("id, company_id, user_id, emp_no, name, role_id, roles(tier), companies(login_domain, code)")
      .eq("id", employeeId)
      .maybeSingle();
    if (e1) throw new HttpError(500, e1.message);
    if (!emp || emp.company_id !== c.companyId) throw new HttpError(404, "找不到這位員工");
    if (emp.user_id) throw new HttpError(409, "這位員工已有系統帳號");

    // 只有 owner／平台管理員能為 owner 層級員工建帳
    const targetTier = (emp as any).roles?.tier as string | undefined;
    if (targetTier === "owner" && !(c.tier === "owner" || c.isPlatformAdmin)) {
      throw new HttpError(403, "只有老闆可以為老闆層級的員工建立帳號");
    }

    const domain = (emp as any).companies?.login_domain as string;
    const email = `${emp.emp_no}`.toLowerCase().replace(/\s+/g, "") + "@" + domain;

    // 既有 user？
    const { data: existingId } = await c.admin.rpc("find_user_id_by_email", { p_email: email });
    let userId: string;
    let password: string | null = null;
    let linkedExisting = false;

    if (existingId) {
      userId = existingId as string;
      linkedExisting = true;
    } else {
      password = customPassword ?? randomPassword();
      const { data: created, error: e2 } = await c.admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: emp.name, emp_no: emp.emp_no, company_code: (emp as any).companies?.code },
      });
      if (e2 || !created.user) throw new HttpError(500, `建立帳號失敗：${e2?.message ?? "unknown"}`);
      userId = created.user.id;
    }

    // 回填 employees.user_id
    const { error: e3, data: upd } = await c.admin
      .from("employees")
      .update({ user_id: userId })
      .eq("id", emp.id)
      .select("id");
    if (e3 || !upd?.length) throw new HttpError(500, `綁定員工失敗：${e3?.message ?? "0 rows"}`);

    // profiles：新建帳號一律強制首次改密碼；綁定既有帳號不動旗標
    if (!linkedExisting) {
      await c.admin.from("profiles").upsert({ id: userId, display_name: emp.name, must_change_password: true }, { onConflict: "id" });
    }
    // 尚無 context 則指到本公司
    const { data: ctx } = await c.admin.from("user_company_context").select("user_id").eq("user_id", userId).maybeSingle();
    if (!ctx) await c.admin.from("user_company_context").insert({ user_id: userId, current_company_id: emp.company_id });

    await c.admin.rpc("write_audit", {
      p_company_id: emp.company_id,
      p_user_id: c.userId,
      p_action: linkedExisting ? "link_account" : "create_account",
      p_target_table: "employees",
      p_target_id: emp.id,
      p_after: { email, emp_no: emp.emp_no, name: emp.name, linked_existing: linkedExisting },
    });
    await c.admin.rpc("emit_notification", {
      p_company_id: emp.company_id,
      p_rule_code: "account_created",
      p_ref_type: "employee",
      p_ref_id: emp.id,
      p_owner_employee_id: null,
      p_title: "【系統帳號建立】",
      p_body: `${emp.name}（${emp.emp_no}）的登入帳號已建立：${email}`,
      p_dedupe_suffix: "",
    });

    return json({ ok: true, email, password, linked_existing: linkedExisting, user_id: userId });
  } catch (e) {
    return handleError(e);
  }
});
