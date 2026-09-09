// 共用：建立 caller（帶 JWT、受 RLS）與 admin（service_role）兩個 client，
// 並提供呼叫者身分／權限驗證。每支需要 service_role 的 Edge Function 第一件事都是驗證呼叫者。
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });

export const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface Caller {
  userId: string;
  companyId: string;
  isPlatformAdmin: boolean;
  tier: string | null;
  user: SupabaseClient;
  admin: SupabaseClient;
}

/** 驗證 Authorization header 的 JWT，回傳呼叫者的 company context 與兩個 client */
export async function authenticate(req: Request): Promise<Caller> {
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) throw new HttpError(401, "未登入");

  const user = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: u, error } = await user.auth.getUser();
  if (error || !u?.user) throw new HttpError(401, "登入已逾時，請重新登入");

  const [{ data: companyId }, { data: isAdmin }, { data: tier }] = await Promise.all([
    user.rpc("current_company_id"),
    user.rpc("is_platform_admin"),
    user.rpc("current_role_code"),
  ]);
  if (!companyId) throw new HttpError(403, "尚未選擇公司");

  const admin = createClient(url, service, { auth: { persistSession: false } });
  return { userId: u.user.id, companyId, isPlatformAdmin: !!isAdmin, tier: tier ?? null, user, admin };
}

/** 呼叫者是否具備某模組動作權限（與前端 can() 同源） */
export async function requirePerm(c: Caller, module: string, action: string) {
  const { data, error } = await c.user.rpc("has_perm", { p_module: module, p_action: action });
  if (error) throw new HttpError(500, `權限檢查失敗：${error.message}`);
  if (!data) throw new HttpError(403, `沒有「${module}」的${action === "edit" ? "編輯" : action}權限`);
}

/** 隨機 12 碼密碼（去掉 0/O/1/l/I 等易混淆字元） */
export function randomPassword(len = 12) {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => chars[b % chars.length]).join("");
}

export function handleError(e: unknown) {
  if (e instanceof HttpError) return json({ error: e.message }, e.status);
  console.error(e);
  return json({ error: (e as Error).message ?? "unknown error" }, 500);
}
