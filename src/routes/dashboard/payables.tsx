import { createFileRoute } from "@tanstack/react-router";
import { RequirePerm } from "@/components/RequirePerm";
import { LedgerPage } from "@/components/finance/LedgerPage";
import { AP } from "@/components/finance/ledger-config";

export const Route = createFileRoute("/dashboard/payables")({
  head: () => ({
    meta: [
      { title: "應付與付款" },
      { name: "description", content: "應付帳款管理與付款沖帳：到期追蹤、預付款、沖銷、付款作廢" },
      { property: "og:title", content: "應付與付款" },
      {
        property: "og:description",
        content: "應付帳款管理與付款沖帳：到期追蹤、預付款、沖銷、付款作廢",
      },
    ],
  }),
  component: () => (
    <RequirePerm module="payables">
      <LedgerPage cfg={AP} />
    </RequirePerm>
  ),
});
