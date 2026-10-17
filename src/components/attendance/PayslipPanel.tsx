/** 我的薪資條：老闆鎖定發放後才看得到 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { humanizeError } from "@/lib/app-error";
import { formatTWD } from "@/lib/dates";
import { num, periodLabel, type PayItem } from "@/lib/payroll";
import { PayslipView } from "@/components/payroll/PayslipView";

const EMPTY: PayItem[] = [];

export function PayslipPanel() {
  const { employee } = useAuth();
  const [open, setOpen] = useState<string | null>(null);
  const {
    data = EMPTY,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["my_payslips", employee?.id],
    enabled: !!employee?.id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("my_payslips");
      if (error) throw error;
      return (data ?? []) as PayItem[];
    },
  });

  if (isLoading) return <p className="py-4 text-center text-sm text-muted-foreground">載入中…</p>;
  if (error)
    return (
      <p className="py-4 text-center text-sm text-destructive">
        {humanizeError(error, "讀取薪資條")}
      </p>
    );
  if (data.length === 0)
    return (
      <p className="py-4 text-center text-sm text-muted-foreground">
        還沒有發布的薪資條。老闆結算完成後，這裡會出現，LINE 也會通知你。
      </p>
    );

  return (
    <div className="space-y-2">
      {data.map((p) => {
        const isOpen = open === p.id || (open === null && p === data[0]);
        return (
          <div key={p.id} className="rounded-lg border">
            <button
              type="button"
              className="flex min-h-14 w-full items-center justify-between gap-2 px-3 text-left"
              onClick={() => setOpen(isOpen ? "" : p.id)}
              aria-expanded={isOpen}
            >
              <span className="text-base font-medium">{p.period ? periodLabel(p.period) : ""}</span>
              <span className="flex items-center gap-2">
                <span className="text-base font-semibold tabular-nums">
                  實發 {formatTWD(num(p.net_pay))}
                </span>
                <ChevronDown
                  className={`h-5 w-5 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`}
                />
              </span>
            </button>
            {isOpen && (
              <div className="border-t px-3 py-3">
                <PayslipView item={p} />
              </div>
            )}
          </div>
        );
      })}
      <p className="text-xs text-muted-foreground">對薪資有疑問，請直接問老闆。</p>
    </div>
  );
}
