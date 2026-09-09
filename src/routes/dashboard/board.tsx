import { Outlet, createFileRoute } from "@tanstack/react-router";

// 看板版面（/dashboard/board 與 /dashboard/board/tv 的共同父層）。
// 電視模式不需要 RequirePerm，所以權限守門放在各自的葉子路由。
export const Route = createFileRoute("/dashboard/board")({
  component: () => <Outlet />,
});
