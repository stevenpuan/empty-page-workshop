import { Outlet, createFileRoute } from "@tanstack/react-router";

// 打卡版面（/clock 打卡頁與 /clock/amendment 補卡申請的共同父層）。
export const Route = createFileRoute("/clock")({
  component: () => <Outlet />,
});
