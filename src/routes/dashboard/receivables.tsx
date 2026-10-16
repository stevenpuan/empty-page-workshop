import { createFileRoute } from "@tanstack/react-router";
import { RequirePerm } from "@/components/RequirePerm";
import { LedgerPage } from "@/components/finance/LedgerPage";
import { AR } from "@/components/finance/ledger-config";

export const Route = createFileRoute("/dashboard/receivables")({
  head: () => ({
    meta: [
      { title: "應收與收款" },
      { name: "description", content: "應收帳款管理與收款沖帳：到期追蹤、預收款、沖銷、收款作廢" },
      { property: "og:title", content: "應收與收款" },
      {
        property: "og:description",
        content: "應收帳款管理與收款沖帳：到期追蹤、預收款、沖銷、收款作廢",
      },
    ],
  }),
  component: () => (
    <RequirePerm module="receivables">
      <LedgerPage cfg={AR} />
    </RequirePerm>
  ),
});
