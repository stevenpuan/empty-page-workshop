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
    // deno-lint-ignore no-explicit-any
    const message: Record<string, any> = { type: "text", text: text.slice(0, 4900) };
    if (ids.length === 1) {
      const quickReply = await quickJobButtons(ids[0]);
      if (quickReply) message.quickReply = quickReply;
    }
    const lineRes = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ to: line_user_id, messages: [message] }),
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

/**
 * 快單通知附上按鈕：待派工 → 員工名字（派工）；派給你 → 開始做／做好了；待取件 → 取件收款
 */
async function quickJobButtons(notificationId: string) {
  const { data: n } = await admin
    .from("notifications")
    .select("rule_code, ref_type, ref_id")
    .eq("id", notificationId)
    .maybeSingle();
  if (n?.ref_type === "order_task" && n.ref_id && n.rule_code === "task_available") {
    const { data: task } = await admin.from("order_tasks").select("id, status").eq("id", n.ref_id).maybeSingle();
    if (!task || !["pending", "assigned"].includes(task.status)) return null;
    return {
      items: [
        { type: "action", action: { type: "postback", label: "我來做", data: `ot:claim:${task.id}`, displayText: "我來做" } },
      ],
    };
  }
  if (!n || n.ref_type !== "quick_job" || !n.ref_id) return null;
  const { data: job } = await admin
    .from("quick_jobs")
    .select("id, job_no, company_id, status")
    .eq("id", n.ref_id)
    .maybeSingle();
  if (!job) return null;
  const short = String(job.job_no).slice(-7);

  if (n.rule_code === "quick_job_new" && job.status === "new") {
    const { data: staff } = await admin
      .from("employees")
      .select("id, name, emp_no")
      .eq("company_id", job.company_id)
      .eq("is_active", true)
      .order("emp_no")
      .limit(13);
    if (!staff?.length) return null;
    return {
      items: staff.map((e: { id: string; name: string }) => ({
        type: "action",
        action: {
          type: "postback",
          label: e.name.slice(0, 20),
          data: `qj:assign:${job.id}:${e.id}`,
          displayText: `派給 ${e.name}`,
        },
      })),
    };
  }
  if (n.rule_code === "quick_job_assigned" && ["assigned", "in_progress"].includes(job.status)) {
    return {
      items: [
        { type: "action", action: { type: "postback", label: "開始做", data: `qj:start:${job.id}`, displayText: `開始 ${short}` } },
        { type: "action", action: { type: "postback", label: "做好了", data: `qj:done:${job.id}`, displayText: `完成 ${short}` } },
      ],
    };
  }
  if (n.rule_code === "quick_job_ready" && job.status === "ready") {
    return {
      items: [
        {
          type: "action",
          action: {
            type: "postback",
            label: "取件收款",
            data: "qj:noop",
            inputOption: "openKeyboard",
            fillInText: `收款 ${short} `,
          },
        },
      ],
    };
  }
  return null;
}
