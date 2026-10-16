/**
 * 快單：老闆／員工在 LINE 開單、派工、開始、完成、取件收款、查清單、傳照片。
 * 資料庫動作全部走 line_quick_job_* RPC（只有 service role 能呼叫；身分以 LINE 綁定判斷）。
 */
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

// deno-lint-ignore no-explicit-any
export type LineMessage = Record<string, any>;
export type Reply = (replyToken: string, messages: LineMessage[]) => Promise<void>;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LINE_CHANNEL_TOKEN = Deno.env.get("LINE_CHANNEL_TOKEN")!;
const BUCKET = "quick-job-files";

function db(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

/** 資料庫錯誤訊息去掉「P0001: 」這類代碼 */
function errText(e: { message?: string } | null | undefined): string {
  const m = e?.message ?? "系統錯誤，請稍後再試";
  return m.replace(/^P\d{4}:\s*/, "");
}

const STATUS_LABEL: Record<string, string> = {
  new: "待派工",
  assigned: "已派工",
  in_progress: "製作中",
  ready: "待取件",
  closed: "已結案",
  cancelled: "已取消",
};
const STATUS_ICON: Record<string, string> = {
  new: "🆕",
  assigned: "👉",
  in_progress: "🔧",
  ready: "📦",
  closed: "✅",
  cancelled: "✖️",
};
const METHOD_LABEL: Record<string, string> = {
  cash: "現金",
  transfer: "轉帳",
  other: "其他",
  unpaid: "未收（記應收）",
};

interface QuickJob {
  id: string;
  job_no: string;
  title: string;
  status: string;
  company_name: string;
  customer_name: string | null;
  customer_phone: string | null;
  pickup_at: string | null;
  amount_total: number | null;
  pay_method: string | null;
  assignee_name: string | null;
  summary: string;
  is_manager?: boolean;
  staff?: { id: string; name: string }[];
  files?: number;
}

/* ───────────────────────── 文字解析 ───────────────────────── */

export interface ParsedQuick {
  company: string | null;
  assignee: string | null;
  phone: string | null;
  customer: string | null;
  pickupAt: string | null; // ISO（台北時間 +08:00）
  note: string | null;
  title: string;
}

function taipeiParts(d = new Date()) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => Number(f.find((p) => p.type === t)?.value);
  return { y: get("year"), m: get("month"), d: get("day") };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 「快單 名片2盒 王先生 0912345678 600元 今天5點 給阿明」→ 欄位 */
export function parseQuickText(input: string): ParsedQuick {
  let s = ` ${input.replace(/\s+/g, " ")} `;
  const take = (re: RegExp): RegExpMatchArray | null => {
    const m = s.match(re);
    if (m) s = s.replace(m[0], " ");
    return m;
  };

  const company = take(/(祥興|沂融)/)?.[1] ?? null;
  const assignee = take(/(?:派給|交給|給)\s*([一-鿿A-Za-z0-9]{1,10})\s*$/)?.[1] ?? null;

  let phone: string | null = null;
  const mobile = take(/(09\d{2})[-\s]?(\d{3})[-\s]?(\d{3})/);
  if (mobile) phone = `${mobile[1]}${mobile[2]}${mobile[3]}`;
  else {
    const land = take(/(0\d{1,2})[-\s](\d{6,8})/);
    if (land) phone = `${land[1]}-${land[2]}`;
  }

  const price = take(/(\d+(?:\.\d+)?)\s*(?:元|塊)/);
  const note = price ? `預估 ${price[1]} 元` : null;

  // 先找前面有空白分隔的稱呼（王先生、林小姐），沒有空白時只取一個字的姓
  const customer =
    take(/(?<=^|[\s，,、])([一-鿿]{1,3}(?:先生|小姐|太太|老師|老闆|經理|阿姨|伯伯|大哥|大姐))/)?.[1] ??
    take(/([一-鿿](?:先生|小姐|太太|老師|老闆|經理|阿姨|伯伯|大哥|大姐))/)?.[1] ??
    take(/客人\s*[:：]?\s*([一-鿿A-Za-z]{1,10})/)?.[1] ??
    null;

  // 取件時間
  const now = taipeiParts();
  let dayOffset: number | null = null;
  let md: { m: number; d: number } | null = null;
  const dw = take(/(今天|今日|明天|明日|後天)/);
  if (dw) dayOffset = dw[1] === "後天" ? 2 : dw[1] === "明天" || dw[1] === "明日" ? 1 : 0;
  const mdm = take(/(\d{1,2})\s*[/月]\s*(\d{1,2})\s*日?/);
  if (mdm) md = { m: Number(mdm[1]), d: Number(mdm[2]) };
  const tm = take(/(上午|早上|中午|下午|晚上)?\s*(\d{1,2})\s*(?:[:：]\s*(\d{2})|點\s*(半|(\d{1,2})\s*分?)?)/);
  let pickupAt: string | null = null;
  if (dayOffset !== null || md || tm) {
    let hh = 18;
    let mm = 0;
    if (tm) {
      hh = Number(tm[2]);
      mm = tm[3] ? Number(tm[3]) : tm[4] === "半" ? 30 : tm[5] ? Number(tm[5]) : 0;
      const q = tm[1];
      if ((q === "下午" || q === "晚上") && hh < 12) hh += 12;
      else if (q === "中午" && hh < 6) hh += 12;
      else if (!q && hh >= 1 && hh <= 7) hh += 12; // 沒講上午下午、1～7 點視為下午
    }
    let y = now.y;
    let m = now.m;
    let d = now.d;
    if (md) {
      m = md.m;
      d = md.d;
      if (m < now.m - 6) y += 1; // 跨年
    } else if (dayOffset) {
      const t = new Date(Date.UTC(now.y, now.m - 1, now.d + dayOffset));
      y = t.getUTCFullYear();
      m = t.getUTCMonth() + 1;
      d = t.getUTCDate();
    }
    if (hh <= 23 && mm <= 59 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      pickupAt = `${y}-${pad(m)}-${pad(d)}T${pad(hh)}:${pad(mm)}:00+08:00`;
    }
  }

  const title = s
    .replace(/[，,、；;]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { company, assignee, phone, customer, pickupAt, note, title };
}

function fmtPickup(iso: string | null): string {
  if (!iso) return "未定";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function money(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  return `$${new Intl.NumberFormat("zh-TW").format(v)}`;
}

function jobCard(j: QuickJob): string {
  const lines = [`${j.job_no}（${j.company_name}）`, j.title];
  const cust = [j.customer_name, j.customer_phone].filter(Boolean).join(" ");
  if (cust) lines.push(`客人：${cust}`);
  lines.push(`取件：${fmtPickup(j.pickup_at)}`);
  if (j.assignee_name) lines.push(`負責：${j.assignee_name}`);
  return lines.join("\n");
}

function assignQuickReply(j: QuickJob) {
  const staff = (j.staff ?? []).slice(0, 13);
  return {
    items: staff.map((e) => ({
      type: "action",
      action: {
        type: "postback",
        label: e.name.slice(0, 20),
        data: `qj:assign:${j.id}:${e.id}`,
        displayText: `派給 ${e.name}`,
      },
    })),
  };
}

/* ───────────────────────── 文字指令 ───────────────────────── */

/** 處理快單相關文字；不是快單指令回傳 null（交給原本的流程） */
export async function handleQuickText(
  text: string,
  lineUserId: string,
  replyToken: string,
  reply: Reply,
): Promise<unknown | null> {
  const t = text.trim();

  // 清單
  if (/^(快單|快單清單|快單列表|今日快單|今天快單)$/.test(t)) {
    const { data, error } = await db().rpc("line_quick_job_list", { p_line_user_id: lineUserId });
    if (error) {
      await reply(replyToken, [{ type: "text", text: `❌ ${errText(error)}` }]);
      return { type: "quick_list", error: error.message };
    }
    const res = data as { open: QuickJob[]; today_closed: number; today_amount: number };
    const lines = res.open.length
      ? res.open.map(
          (j) =>
            `${STATUS_ICON[j.status] ?? ""}${STATUS_LABEL[j.status] ?? j.status}｜${j.job_no.slice(-7)} ${j.title}` +
            `${j.assignee_name ? `（${j.assignee_name}）` : ""}${j.pickup_at ? `｜${fmtPickup(j.pickup_at)}` : ""}`,
        )
      : ["目前沒有未結案的快單"];
    await reply(replyToken, [
      {
        type: "text",
        text:
          `📋 未結案快單 ${res.open.length} 張\n\n${lines.join("\n")}\n\n` +
          `今日結案 ${res.today_closed} 張，${money(res.today_amount)}`,
      },
    ]);
    return { type: "quick_list", count: res.open.length };
  }

  // 開單
  const create = t.match(/^快單[\s:：]+([\s\S]+)$/);
  if (create) {
    const p = parseQuickText(create[1]);
    if (!p.title) {
      await reply(replyToken, [
        {
          type: "text",
          text: "請說明要做什麼，例如：\n快單 名片2盒 王先生 0912345678 今天5點",
        },
      ]);
      return { type: "quick_create", error: "empty" };
    }
    const { data, error } = await db().rpc("line_quick_job_create", {
      p_line_user_id: lineUserId,
      p_company_hint: p.company,
      p_title: p.title,
      p_customer_name: p.customer,
      p_customer_phone: p.phone,
      p_pickup_at: p.pickupAt,
      p_note: p.note,
      p_raw: text,
      p_assignee_name: p.assignee,
    });
    if (error) {
      await reply(replyToken, [{ type: "text", text: `❌ ${errText(error)}` }]);
      return { type: "quick_create", error: error.message };
    }
    const j = data as QuickJob;
    let tail = "";
    if (j.files) tail += `\n📷 已附 ${j.files} 張照片`;
    if (j.status === "assigned") tail += `\n\n已派給 ${j.assignee_name}，會通知他。`;
    else if (!j.is_manager) tail += "\n\n已通知老闆派工。";
    const msg: LineMessage = { type: "text", text: `✅ 已建立快單\n${jobCard(j)}${tail}` };
    if (j.status === "new" && j.is_manager && (j.staff ?? []).length) {
      msg.text += "\n\n要派給誰？（點下方名字）";
      msg.quickReply = assignQuickReply(j);
    }
    await reply(replyToken, [msg]);
    return { type: "quick_create", job_no: j.job_no };
  }

  // 收款 單號 金額 [現金|轉帳|其他|未收] [統編]
  const pay = t.match(/^(?:收款|取件)\s+(\S+)\s+(\d+(?:\.\d+)?)\s*(現金|轉帳|匯款|其他|未收)?\s*(\d{8})?\s*$/);
  if (pay) {
    const method =
      pay[3] === "轉帳" || pay[3] === "匯款"
        ? "transfer"
        : pay[3] === "其他"
          ? "other"
          : pay[3] === "未收"
            ? "unpaid"
            : "cash";
    const { data, error } = await db().rpc("line_quick_job_pickup", {
      p_line_user_id: lineUserId,
      p_job_ref: pay[1],
      p_amount: Number(pay[2]),
      p_method: method,
      p_tax_id: pay[4] ?? null,
    });
    if (error) {
      await reply(replyToken, [{ type: "text", text: `❌ ${errText(error)}` }]);
      return { type: "quick_pickup", error: error.message };
    }
    const j = data as QuickJob;
    await reply(replyToken, [
      {
        type: "text",
        text:
          `💰 已結案 ${j.job_no}\n${j.title}\n` +
          `金額 ${money(j.amount_total)}｜${METHOD_LABEL[j.pay_method ?? ""] ?? "免收費"}\n` +
          (j.pay_method === "unpaid" ? "已記到應收，之後收到錢再到系統收款。" : "已列入營收。"),
      },
    ]);
    return { type: "quick_pickup", job_no: j.job_no };
  }
  if (/^(收款|取件)(\s|$)/.test(t)) {
    await reply(replyToken, [
      { type: "text", text: "格式：收款 單號 金額 [現金/轉帳/未收]\n例如：收款 2610001 600" },
    ]);
    return { type: "quick_pickup", error: "format" };
  }

  // 開始／完成／取消 單號 [原因]
  const act = t.match(/^(開始|完成|做好了|取消)\s+(\S+)(?:\s+([\s\S]+))?$/);
  if (act) {
    const action = act[1] === "開始" ? "start" : act[1] === "取消" ? "cancel" : "done";
    if (action === "cancel" && !act[3]) {
      await reply(replyToken, [{ type: "text", text: "取消請附原因，例如：取消 2610001 客人不要了" }]);
      return { type: "quick_action", error: "reason" };
    }
    return await runAction(action, act[2], null, act[3] ?? null, lineUserId, replyToken, reply);
  }

  return null;
}

async function runAction(
  action: string,
  jobRef: string,
  assigneeId: string | null,
  reason: string | null,
  lineUserId: string,
  replyToken: string,
  reply: Reply,
): Promise<unknown> {
  const { data, error } = await db().rpc("line_quick_job_action", {
    p_line_user_id: lineUserId,
    p_action: action,
    p_job_ref: jobRef,
    p_assignee_id: assigneeId,
    p_reason: reason,
  });
  if (error) {
    await reply(replyToken, [{ type: "text", text: `❌ ${errText(error)}` }]);
    return { type: "quick_action", action, error: error.message };
  }
  const j = data as QuickJob;
  const head: Record<string, string> = {
    assign: `✅ 已派給 ${j.assignee_name}`,
    start: "🔧 已開始製作",
    done: "📦 已完成，等客人取件",
    cancel: "✖️ 已取消",
  };
  const msg: LineMessage = { type: "text", text: `${head[action] ?? "已更新"}\n${jobCard(j)}` };
  if (action === "done") {
    msg.text += `\n\n客人取件時傳：收款 ${j.job_no.slice(-7)} 金額`;
    msg.quickReply = {
      items: [
        {
          type: "action",
          action: {
            type: "postback",
            label: "取件收款",
            data: "qj:noop",
            inputOption: "openKeyboard",
            fillInText: `收款 ${j.job_no.slice(-7)} `,
          },
        },
      ],
    };
  }
  if (action === "assign") {
    msg.quickReply = {
      items: [
        {
          type: "action",
          action: { type: "postback", label: "改派別人", data: `qj:reassign:${j.id}`, displayText: "改派別人" },
        },
      ],
    };
  }
  await reply(replyToken, [msg]);
  return { type: "quick_action", action, job_no: j.job_no };
}

/* ───────────────────────── 按鈕（postback） ───────────────────────── */

export async function handleQuickPostback(
  data: string,
  lineUserId: string,
  replyToken: string,
  reply: Reply,
): Promise<unknown> {
  const [ns, action, jobId, arg] = data.split(":");
  if (ns !== "qj" || action === "noop") return { type: "postback", skipped: true };
  if (action === "reassign") {
    // 重新列出員工按鈕
    const { data: list, error } = await db().rpc("line_quick_job_list", { p_line_user_id: lineUserId });
    if (error) {
      await reply(replyToken, [{ type: "text", text: `❌ ${errText(error)}` }]);
      return { type: "postback", error: error.message };
    }
    const job = (list as { open: QuickJob[] }).open.find((j) => j.id === jobId);
    if (!job) {
      await reply(replyToken, [{ type: "text", text: "這張快單已經結案或取消。" }]);
      return { type: "postback", action };
    }
    const staff = await companyStaffForJob(jobId);
    await reply(replyToken, [
      { type: "text", text: `要把 ${job.job_no.slice(-7)} 改派給誰？`, quickReply: assignQuickReply({ ...job, staff }) },
    ]);
    return { type: "postback", action };
  }
  if (!["assign", "start", "done"].includes(action ?? "")) return { type: "postback", skipped: true };
  return await runAction(action!, jobId ?? "", arg ?? null, null, lineUserId, replyToken, reply);
}

async function companyStaffForJob(jobId: string): Promise<{ id: string; name: string }[]> {
  const sb = db();
  const { data: job } = await sb.from("quick_jobs").select("company_id").eq("id", jobId).maybeSingle();
  if (!job) return [];
  const { data } = await sb
    .from("employees")
    .select("id, name, emp_no")
    .eq("company_id", job.company_id)
    .eq("is_active", true)
    .order("emp_no");
  return (data ?? []).map((e: { id: string; name: string }) => ({ id: e.id, name: e.name }));
}

/* ───────────────────────── 照片 ───────────────────────── */

export async function handleQuickImage(
  messageId: string,
  lineUserId: string,
  replyToken: string,
  reply: Reply,
): Promise<unknown> {
  const sb = db();
  const { data: emp } = await sb.from("employees").select("id").eq("line_user_id", lineUserId).maybeSingle();
  if (!emp) {
    await reply(replyToken, [{ type: "text", text: "請先輸入 6 碼綁定碼完成綁定。" }]);
    return { type: "quick_image", bound: false };
  }
  const res = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
    headers: { Authorization: `Bearer ${LINE_CHANNEL_TOKEN}` },
  });
  if (!res.ok) {
    await reply(replyToken, [{ type: "text", text: "照片下載失敗，請再傳一次。" }]);
    return { type: "quick_image", error: res.status };
  }
  const type = res.headers.get("content-type") ?? "image/jpeg";
  const ext = type.includes("png") ? "png" : "jpg";
  const now = taipeiParts();
  const path = `line/${now.y}${pad(now.m)}/${crypto.randomUUID()}.${ext}`;
  const bytes = new Uint8Array(await res.arrayBuffer());
  const up = await sb.storage.from(BUCKET).upload(path, bytes, { contentType: type, upsert: false });
  if (up.error) {
    console.error("upload error", up.error);
    await reply(replyToken, [{ type: "text", text: "照片儲存失敗，請再傳一次。" }]);
    return { type: "quick_image", error: up.error.message };
  }
  const { data, error } = await sb.rpc("line_quick_job_add_file", {
    p_line_user_id: lineUserId,
    p_storage_path: path,
    p_content_type: type,
  });
  if (error) {
    await reply(replyToken, [{ type: "text", text: `❌ ${errText(error)}` }]);
    return { type: "quick_image", error: error.message };
  }
  const r = data as { job_no: string | null; attached: boolean };
  await reply(replyToken, [
    {
      type: "text",
      text: r.attached
        ? `📷 照片已附到快單 ${r.job_no}`
        : "📷 照片收到了。\n10 分鐘內傳「快單 …」開單，照片會自動附上。",
    },
  ]);
  return { type: "quick_image", attached: r.attached };
}

export const QUICK_HELP =
  "⚡ 快單指令：\n" +
  "• 快單 名片2盒 王先生 0912345678 今天5點\n" +
  "　（句尾加「給阿明」直接派工；要開沂融的單加「沂融」）\n" +
  "• 先傳照片再開單，照片會附在快單上\n" +
  "• 快單 → 看未結案清單\n" +
  "• 開始 單號／完成 單號\n" +
  "• 收款 單號 金額 [現金/轉帳/未收]\n" +
  "• 取消 單號 原因";
