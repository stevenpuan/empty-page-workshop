import { createFileRoute, redirect } from "@tanstack/react-router";

// 補卡申請已改成在打卡頁直接展開；舊連結（通知、書籤）導回打卡頁並自動打開補卡區
export const Route = createFileRoute("/clock/amendment")({
  beforeLoad: () => {
    throw redirect({ to: "/clock", search: { amend: "1" } });
  },
});
