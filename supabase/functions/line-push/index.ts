import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * line-push — 把系統通知推播到員工的 LINE
 *
 * 呼叫來源：DB trigger trg_line_push_immediate、send_line_digests()（經 call_edge_function）
 * 認證：Bearer = service_role key，或 vault 中的 INTERNAL_PUSH_KEY（以 verify_internal_push_key 比對）
 *
 * LINE 金鑰（單一官方帳號，祥興＋沂融共用）：
 *   LINE_CHANNEL_TOKEN — Channel Access Token
 *   （相容舊設定：若有 LINE_CHANNEL_TOKEN_{XX|YR} 會優先使用）
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ENV_INTERNAL_PUSH_KEY = Deno.env.get("INTERNAL_PUSH_KEY") || "";

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

async function isAuthorized(req: Request): Promise<boolean> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return false;
  if (token === SUPABASE_SERVICE_ROLE_KEY) return true;
  if (ENV_INTERNAL_PUSH_KEY && token === ENV_INTERNAL_PUSH_KEY) return true;
  const { data, error } = await admin.rpc("verify_internal_push_key", { p_key: token });
  if (error) {
    console.error("verify_internal_push_key error:", error.message);
    return false;
  }
  return data === true;
}

function channelToken(channelKey: string | undefined): string | undefined {
  if (channelKey) {
    const perCompany = Deno.env.get(`LINE_CHANNEL_TOKEN_${channelKey.toUpperCase()}`);
    if (perCompany) return perCompany;
  }
  return Deno.env.get("LINE_CHANNEL_TOKEN");
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method Not Allowed" }, 405);
  if (!(await isAuthorized(req))) return json({ error: "Unauthorized" }, 401);

  let ids: string[] = [];
  try {
    const body = await req.json();
    const { notification_id, notification_ids, line_user_id, channel_key, title, body: messageBody } = body;
    ids = notification_id ? [notification_id] : notification_ids || [];

    if (!line_user_id) return json({ error: "Missing line_user_id" }, 400);

    const token = channelToken(channel_key);
    if (!token) {
      console.error("LINE_CHANNEL_TOKEN not configured");
      await updateLineStatus(ids, "failed", "LINE_CHANNEL_TOKEN not configured");
      return json({ error: "Channel token not configured" }, 500);
    }

    const text = title ? `【${title}】\n${messageBody ?? ""}` : String(messageBody ?? "");
    const lineRes = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ to: line_user_id, messages: [{ type: "text", text: text.slice(0, 4900) }] }),
    });

    if (lineRes.ok) {
      await updateLineStatus(ids, "sent", null);
      return json({ success: true, sent_count: ids.length });
    }

    const errText = await lineRes.text();
    console.error(`LINE API error: ${lineRes.status} ${errText}`);
    await updateLineStatus(ids, "failed", `LINE ${lineRes.status}: ${errText.substring(0, 200)}`);
    return json({ error: "LINE API failed", status: lineRes.status, detail: errText.substring(0, 200) }, 502);
  } catch (err) {
    console.error("line-push error:", err);
    await updateLineStatus(ids, "failed", String(err).substring(0, 200));
    return json({ error: String(err) }, 500);
  }
});

async function updateLineStatus(ids: string[], status: string, error: string | null) {
  if (!ids || ids.length === 0) return;
  const update: Record<string, unknown> = { line_status: status, line_attempts: 1 };
  if (status === "sent") update.line_sent_at = new Date().toISOString();
  if (error) update.line_error = error;
  const { error: dbErr } = await admin.from("notifications").update(update).in("id", ids);
  if (dbErr) console.error("updateLineStatus error:", dbErr.message);
}
