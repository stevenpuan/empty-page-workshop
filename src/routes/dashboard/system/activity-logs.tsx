import { createFileRoute } from "@tanstack/react-router";
import { LogTable } from "@/components/LogTable";

export const Route = createFileRoute("/dashboard/system/activity-logs")({ component: Page });

const ACTION_LABEL: Record<string, string> = {
  login: "登入",
  logout: "登出",
  switch_company: "切換公司",
  export: "匯出",
};

function Page() {
  return (
    <LogTable
      table="activity_logs"
      module="activity_logs"
      title="操作日誌"
      description="登入、登出、切換公司、匯出等一般操作（最新 200 筆）。保留 90 天。"
      columns={[
        {
          key: "action",
          label: "動作",
          render: (r) => ACTION_LABEL[String(r["action"])] ?? String(r["action"]),
        },
        { key: "route", label: "路徑", className: "font-mono text-xs" },
        {
          key: "user_agent",
          label: "裝置",
          className: "text-xs text-muted-foreground max-w-xs truncate",
        },
      ]}
    />
  );
}
