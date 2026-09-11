import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * line-webhook — 接收 LINE Messaging API Webhook 事件
 *
 * 用途：
 *   1. 員工在 LINE 傳送「綁定碼」→ 自動綁定帳號
 *   2. 傳送「解綁」→ 解除綁定
 *   3. 傳送「狀態」→ 查看綁定狀態
 *   4. follow 事件 → 歡迎訊息引導綁定
 *
 * Webhook URL 設定：
 *   https://<project>.supabase.co/functions/v1/line-webhook?key=XX
 *   https://<project>.supabase.co/functions/v1/line-webhook?key=YR
 *
 * 需要的 Secrets：
 *   LINE_CHANNEL_SECRET_XX / LINE_CHANNEL_SECRET_YR  — 驗證簽章
 *   LINE_CHANNEL_TOKEN_XX  / LINE_CHANNEL_TOKEN_YR   — 回覆訊息
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req: Request) => {
  // Only accept POST
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const url = new URL(req.url);
  const channelKey = (url.searchParams.get("key") || "").toUpperCase();

  if (!channelKey) {
    return new Response(
      JSON.stringify({ error: "Missing ?key= parameter" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Get channel secret & token from env
  const channelSecret = Deno.env.get(`LINE_CHANNEL_SECRET_${channelKey}`);
  const channelToken = Deno.env.get(`LINE_CHANNEL_TOKEN_${channelKey}`);

  if (!channelSecret || !channelToken) {
    console.error(`Missing LINE secrets for key: ${channelKey}`);
    return new Response(
      JSON.stringify({ error: "Channel not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  // Read body
  const bodyText = await req.text();

  // Verify LINE signature
  const signature = req.headers.get("x-line-signature") || "";
  const valid = await verifySignature(channelSecret, bodyText, signature);
  if (!valid) {
    console.error("Invalid LINE signature");
    return new Response(
      JSON.stringify({ error: "Invalid signature" }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }

  // Parse events
  let events: LineEvent[];
  try {
    const parsed = JSON.parse(bodyText);
    events = parsed.events || [];
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Process each event
  const results: unknown[] = [];
  for (const event of events) {
    try {
      const result = await handleEvent(event, channelKey, channelToken);
      results.push(result);
    } catch (err) {
      console.error("Event handling error:", err);
      results.push({ error: String(err) });
    }
  }

  // LINE requires 200 OK
  return new Response(JSON.stringify({ ok: true, results }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

// ── Event Handler ────────────────────────────────────────────

interface LineEvent {
  type: string;
  replyToken?: string;
  source?: { type: string; userId?: string };
  message?: { type: string; text?: string };
}

async function handleEvent(
  event: LineEvent,
  channelKey: string,
  channelToken: string
): Promise<unknown> {
  const lineUserId = event.source?.userId;
  if (!lineUserId) return { skipped: "no userId" };

  // ── follow 事件：用戶加好友 ──
  if (event.type === "follow") {
    await replyMessage(channelToken, event.replyToken!, [
      {
        type: "text",
        text:
          "歡迎加入！\n\n" +
          "請輸入你的【6碼綁定碼】完成帳號綁定。\n" +
          "綁定碼可在系統的「員工管理」頁面查看。\n\n" +
          "綁定完成後，系統通知將即時推播到此。",
      },
    ]);
    return { type: "follow", replied: true };
  }

  // ── message 事件 ──
  if (event.type === "message" && event.message?.type === "text") {
    const text = (event.message.text || "").trim();

    // 指令：解綁
    if (text === "解綁") {
      return await handleUnbind(lineUserId, channelToken, event.replyToken!);
    }

    // 指令：狀態 / 查詢
    if (text === "狀態" || text === "查詢") {
      return await handleStatus(lineUserId, channelToken, event.replyToken!);
    }

    // 指令：幫助 / help
    if (text === "幫助" || text === "help" || text === "?") {
      await replyMessage(channelToken, event.replyToken!, [
        {
          type: "text",
          text:
            "📌 可用指令：\n\n" +
            "• 輸入【6碼綁定碼】→ 綁定帳號\n" +
            "• 輸入「狀態」→ 查看綁定狀態\n" +
            "• 輸入「解綁」→ 解除LINE綁定\n" +
            "• 輸入「幫助」→ 顯示此說明",
        },
      ]);
      return { type: "help", replied: true };
    }

    // 嘗試當作綁定碼（6 碼英數）
    const codePattern = /^[A-Za-z0-9]{6}$/;
    if (codePattern.test(text)) {
      return await handleBind(
        text.toUpperCase(),
        lineUserId,
        channelKey,
        channelToken,
        event.replyToken!
      );
    }

    // 其他訊息 → 提示
    await replyMessage(channelToken, event.replyToken!, [
      {
        type: "text",
        text: "我不太理解你的訊息。\n輸入「幫助」查看可用指令。",
      },
    ]);
    return { type: "unknown_text", text };
  }

  return { skipped: event.type };
}

// ── 綁定 ─────────────────────────────────────────────────────

async function handleBind(
  code: string,
  lineUserId: string,
  channelKey: string,
  channelToken: string,
  replyToken: string
): Promise<unknown> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data, error } = await supabase.rpc("bind_line_account", {
    p_code: code,
    p_line_user_id: lineUserId,
  });

  if (error) {
    console.error("bind_line_account RPC error:", error);
    await replyMessage(channelToken, replyToken, [
      { type: "text", text: "系統錯誤，請稍後重試或聯繫主管。" },
    ]);
    return { type: "bind", error: error.message };
  }

  const result = data as {
    ok: boolean;
    error?: string;
    message: string;
    employee_name?: string;
  };

  if (result.ok) {
    await replyMessage(channelToken, replyToken, [
      {
        type: "text",
        text:
          `✅ ${result.message}\n\n` +
          "之後系統的通知會即時推播到你的 LINE。\n" +
          "輸入「狀態」可隨時查看綁定資訊。",
      },
    ]);
  } else {
    await replyMessage(channelToken, replyToken, [
      { type: "text", text: `❌ ${result.message}` },
    ]);
  }

  return { type: "bind", ...result };
}

// ── 解綁 ─────────────────────────────────────────────────────

async function handleUnbind(
  lineUserId: string,
  channelToken: string,
  replyToken: string
): Promise<unknown> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // 找到此 LINE 綁定的員工
  const { data: emp } = await supabase
    .from("employees")
    .select("id, name")
    .eq("line_user_id", lineUserId)
    .maybeSingle();

  if (!emp) {
    await replyMessage(channelToken, replyToken, [
      { type: "text", text: "你目前沒有綁定任何帳號。" },
    ]);
    return { type: "unbind", found: false };
  }

  await supabase.rpc("unbind_line_account", { p_employee_id: emp.id });

  await replyMessage(channelToken, replyToken, [
    {
      type: "text",
      text:
        `已解除 ${emp.name} 的 LINE 綁定。\n` +
        "如需重新綁定，請向主管索取新的綁定碼。",
    },
  ]);

  return { type: "unbind", employee: emp.name };
}

// ── 查詢狀態 ─────────────────────────────────────────────────

async function handleStatus(
  lineUserId: string,
  channelToken: string,
  replyToken: string
): Promise<unknown> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: emp } = await supabase
    .from("employees")
    .select("name, line_bind_at, company_id")
    .eq("line_user_id", lineUserId)
    .maybeSingle();

  if (!emp) {
    await replyMessage(channelToken, replyToken, [
      {
        type: "text",
        text: "你目前尚未綁定。\n請輸入你的【6碼綁定碼】完成綁定。",
      },
    ]);
    return { type: "status", bound: false };
  }

  // Get company name
  const { data: company } = await supabase
    .from("companies")
    .select("name")
    .eq("id", emp.company_id)
    .single();

  const bindDate = emp.line_bind_at
    ? new Date(emp.line_bind_at).toLocaleDateString("zh-TW")
    : "未知";

  await replyMessage(channelToken, replyToken, [
    {
      type: "text",
      text:
        `📋 綁定狀態\n\n` +
        `姓名：${emp.name}\n` +
        `公司：${company?.name || "未知"}\n` +
        `綁定日期：${bindDate}\n\n` +
        "輸入「解綁」可解除綁定。",
    },
  ]);

  return { type: "status", bound: true, employee: emp.name };
}

// ── LINE Reply API ───────────────────────────────────────────

async function replyMessage(
  channelToken: string,
  replyToken: string,
  messages: Array<{ type: string; text: string }>
): Promise<void> {
  const res = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${channelToken}`,
    },
    body: JSON.stringify({ replyToken, messages }),
  });
  if (!res.ok) {
    const errText = await res.text();
    console.error(`LINE reply error: ${res.status} ${errText}`);
  }
}

// ── 簽章驗證 ─────────────────────────────────────────────────

async function verifySignature(
  secret: string,
  body: string,
  signature: string
): Promise<boolean> {
  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
    const computed = btoa(
      String.fromCharCode(...new Uint8Array(sig))
    );
    return computed === signature;
  } catch (err) {
    console.error("Signature verification error:", err);
    return false;
  }
}
