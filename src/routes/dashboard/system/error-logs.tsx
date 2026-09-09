import { createFileRoute } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { LogTable } from "@/components/LogTable";

export const Route = createFileRoute("/dashboard/system/error-logs")({ component: Page });

function Page() {
  return (
    <LogTable
      table="error_logs"
      module="error_logs"
      title="錯誤日誌"
      description="前端例外與排程失敗（最新 200 筆）。保留 90 天。route 為 cron 的是排程守衛寫入。"
      columns={[
        {
          key: "level",
          label: "等級",
          render: (r) => (
            <Badge
              variant={r["level"] === "error" || r["level"] === "fatal" ? "destructive" : "outline"}
            >
              {String(r["level"])}
            </Badge>
          ),
        },
        { key: "message", label: "訊息", className: "max-w-md truncate" },
        { key: "route", label: "路徑", className: "font-mono text-xs" },
      ]}
    />
  );
}
