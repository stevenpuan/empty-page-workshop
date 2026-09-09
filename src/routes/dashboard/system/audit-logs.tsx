import { createFileRoute } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { LogTable } from "@/components/LogTable";

export const Route = createFileRoute("/dashboard/system/audit-logs")({ component: Page });

const ACTION_LABEL: Record<string, string> = {
  insert: "新增",
  update: "修改",
  delete: "刪除",
  create_account: "建立帳號",
  link_account: "綁定帳號",
  reset_password: "重設密碼",
};

function Page() {
  return (
    <LogTable
      table="audit_logs"
      module="audit_logs"
      title="稽核日誌"
      description="敏感異動紀錄：員工、角色、權限、公司設定、參數、通知規則、帳號建立與密碼重設（最新 200 筆）。由後端 trigger 與 Edge Function 寫入，前端不可寫。"
      columns={[
        {
          key: "action",
          label: "動作",
          render: (r) => (
            <Badge variant="outline">
              {ACTION_LABEL[String(r["action"])] ?? String(r["action"])}
            </Badge>
          ),
        },
        { key: "target_table", label: "目標表", className: "font-mono text-xs" },
        { key: "target_id", label: "目標 ID", className: "font-mono text-xs" },
        {
          key: "after_data",
          label: "摘要",
          className: "text-xs text-muted-foreground max-w-md truncate",
          render: (r) => summarize(r),
        },
      ]}
    />
  );
}

function summarize(r: Record<string, unknown>) {
  const a = (r["after_data"] ?? r["before_data"]) as Record<string, unknown> | null;
  if (!a) return "—";
  const keys = [
    "name",
    "emp_no",
    "email",
    "code",
    "key",
    "module_key",
    "rule_code",
    "revoked_sessions",
  ];
  const parts = keys
    .filter((k) => a[k] !== undefined && a[k] !== null)
    .map((k) => `${k}=${String(a[k])}`);
  return parts.length ? parts.join(" ") : JSON.stringify(a).slice(0, 120);
}
