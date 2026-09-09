/**
 * 全站錯誤訊息轉譯層（沿用 EIP eip-error.ts 的五層判斷）。
 *
 * 各頁面只負責提供「動作名稱」當 ctx：toast.error(humanizeError(e, "儲存員工"))。
 * 判斷順序（由可靠到不可靠）：
 *   1. code（SQLSTATE / PostgREST / Auth code）
 *   2. constraint 名稱（藏在 message／details 裡）
 *   3. 已經是人寫給人看的中文（P0001、前端自己 throw 的 Error）—— 原樣透出
 *   4. 網路層
 *   5. 其他 —— 保留代碼，讓維護者事後查得到
 */

type ErrShape = {
  code?: string | undefined;
  message?: string | undefined;
  details?: string | undefined;
  hint?: string | undefined;
  status?: number | undefined;
  plainError: boolean;
};

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function shapeOf(err: unknown, depth = 0): ErrShape {
  if (!err || typeof err !== "object") {
    return { message: typeof err === "string" ? err : undefined, plainError: false };
  }
  const o = err as Record<string, unknown>;
  // `{ error: PostgrestError }`（rpc 包裝、functions.invoke）要往內鑽
  if (
    depth < 2 &&
    o["error"] &&
    typeof o["error"] === "object" &&
    !str(o["code"]) &&
    !str(o["message"])
  ) {
    return shapeOf(o["error"], depth + 1);
  }
  const code = str(o["code"]);
  return {
    code,
    message: str(o["message"]),
    details: str(o["details"]),
    hint: str(o["hint"]),
    status: num(o["status"]) ?? num(o["statusCode"]),
    plainError: err instanceof Error && !code,
  };
}

/** constraint 名稱 → 具體訊息（本案 001–004 的 constraint） */
const CONSTRAINT_MESSAGES: ReadonlyArray<readonly [RegExp, string]> = [
  [/employees_empno_uk/, "這個員工編號在本公司已經存在"],
  [/employees_user_uk/, "這個登入帳號已綁定本公司的另一位員工"],
  [/roles_code_uk/, "這個角色代碼已經存在"],
  [/roles_tier_chk/, "角色層級只能是 owner／manager／staff"],
  [/rmp_role_module_uk/, "這個角色對此模組的權限已存在，請重新整理後再操作"],
  [/companies_code_chk/, "公司代碼必須是兩個大寫英文字母"],
  [/companies_login_domain_uk/, "這個登入網域已被另一家公司使用"],
  [/menus_menu_key_key/, "這個選單鍵值已經存在"],
  [/ux_system_configs/, "這個參數鍵已經存在"],
  [/ux_lookups/, "這個代碼在此類別已經存在"],
  [/notification_rules_uk/, "這個通知規則代碼已經存在"],
  [/ux_notifications_dedupe/, "同一則通知今天已經送過"],
  [/doc_no_uk/, "單號序號衝突，請重試一次"],
  [/purge_policy_days_check/, "保留天數必須大於 0"],
];

const CODE_MESSAGES: Readonly<Record<string, string>> = {
  "42501": "沒有權限執行這個動作",
  "23503": "關聯的資料已被刪除或不存在，請重新載入頁面",
  "23502": "有必填欄位沒有填",
  "22P02": "輸入的格式不正確",
  "22007": "輸入的格式不正確",
  PGRST116: "找不到資料，可能已被刪除，請重新載入",
  PGRST301: "登入已逾時，請重新登入後再操作",
  "40001": "同時有人在改這筆資料，請重試一次",
  "40P01": "同時有人在改這筆資料，請重試一次",
  "57014": "查詢時間過長，請縮小範圍或稍後再試",
};

const AUTH_CODE_MESSAGES: Readonly<Record<string, string>> = {
  invalid_credentials: "帳號或密碼不正確，請重新輸入",
  invalid_grant: "帳號或密碼不正確，請重新輸入",
  email_not_confirmed: "這個帳號尚未啟用，請聯絡老闆",
  user_already_exists: "這個帳號已經存在",
  email_exists: "這個帳號已經存在",
  weak_password: "密碼強度不足，請改用較長且混合字母數字的密碼",
  over_request_rate_limit: "嘗試次數太多，請等幾分鐘後再試",
  same_password: "新密碼不能和舊密碼相同",
  session_expired: "登入已逾時，請重新登入",
  session_not_found: "登入已逾時，請重新登入",
};

const NETWORK_HINT =
  /Failed to fetch|NetworkError|network ?error|ERR_NETWORK|ERR_INTERNET_DISCONNECTED|Load failed|fetch failed/i;
const HAS_CJK = /[㐀-䶿一-鿿豈-﫿]/;
const LOOKS_LIKE_CONSTRAINT = /constraint|violat/i;

function constraintMessage(haystack: string): string | undefined {
  for (const [re, msg] of CONSTRAINT_MESSAGES) if (re.test(haystack)) return msg;
  return undefined;
}

function withCtx(body: string, ctx?: string): string {
  const c = ctx?.trim();
  return c ? `${c}失敗：${body}` : body;
}

export function humanizeError(err: unknown, ctx?: string): string {
  const e = shapeOf(err);
  const haystack = [e.message, e.details, e.hint].filter(Boolean).join(" ");

  // 後端 raise exception 的中文（例：「內建角色不可刪除」）原樣透出，連前綴都不加
  if (e.code === "P0001" && e.message) return e.message;
  if (e.plainError && e.message && HAS_CJK.test(e.message)) return e.message;
  // Edge Function 回傳的 { error: "中文" } 也視為人寫的訊息
  if (!e.code && e.message && HAS_CJK.test(e.message)) return withCtx(e.message, ctx);

  if (e.code === "23505")
    return withCtx(
      constraintMessage(haystack) ?? "這筆資料已經存在，請重新整理頁面確認後再操作",
      ctx,
    );
  if (e.code === "23514")
    return withCtx(constraintMessage(haystack) ?? "填寫的內容不符合規則，請檢查後重新填寫", ctx);
  if (e.code && CODE_MESSAGES[e.code]) return withCtx(CODE_MESSAGES[e.code]!, ctx);
  if (e.code && AUTH_CODE_MESSAGES[e.code]) return withCtx(AUTH_CODE_MESSAGES[e.code]!, ctx);

  if (LOOKS_LIKE_CONSTRAINT.test(haystack)) {
    const byConstraint = constraintMessage(haystack);
    if (byConstraint) return withCtx(byConstraint, ctx);
  }
  if (!e.code && haystack && NETWORK_HINT.test(haystack))
    return withCtx("連線中斷，請確認網路後重試", ctx);

  const label = e.code ?? (e.status !== undefined ? `HTTP ${e.status}` : undefined);
  return withCtx(
    label
      ? `操作失敗（代碼 ${label}）。若持續發生請把這個代碼提供給系統維護者`
      : "操作失敗，請稍後再試。若持續發生請聯絡系統維護者",
    ctx,
  );
}

/** functions.invoke 的錯誤物件常把真正訊息放在 context 的 body 裡，這裡統一取出 */
export async function functionErrorMessage(error: unknown, ctx?: string): Promise<string> {
  const anyErr = error as { context?: Response; message?: string } | null;
  try {
    if (anyErr?.context && typeof anyErr.context.json === "function") {
      const body = await anyErr.context.clone().json();
      if (body?.error) return withCtx(String(body.error), ctx);
    }
  } catch {
    /* ignore */
  }
  return humanizeError(error, ctx);
}
