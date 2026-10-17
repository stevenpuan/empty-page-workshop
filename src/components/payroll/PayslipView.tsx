/** 薪資條內容（員工打卡頁與老闆薪資頁共用） */
import { formatTWD } from "@/lib/dates";
import { PAY_ADD, PAY_DED, PAY_ER, PAY_SUB, attLines, num, type PayItem } from "@/lib/payroll";

function Rows({
  item,
  rows,
  negative,
}: {
  item: PayItem;
  rows: [keyof PayItem, string][];
  negative?: boolean;
}) {
  const shown = rows.filter(([k]) => num(item[k]) !== 0);
  if (shown.length === 0) return <p className="text-sm text-muted-foreground">無</p>;
  return (
    <div className="space-y-1">
      {shown.map(([k, label]) => (
        <div key={k} className="flex justify-between gap-3 text-sm">
          <span className="text-muted-foreground">{label}</span>
          <span className="tabular-nums">
            {negative ? "−" : ""}
            {formatTWD(num(item[k]))}
          </span>
        </div>
      ))}
    </div>
  );
}

export function PayslipView({ item, showEmployer }: { item: PayItem; showEmployer?: boolean }) {
  const att = attLines(item.att, item.pay_type);
  return (
    <div className="space-y-4">
      <section className="space-y-1.5">
        <h4 className="text-sm font-semibold text-blue-700 dark:text-blue-400">加項</h4>
        <Rows item={item} rows={PAY_ADD} />
      </section>
      <section className="space-y-1.5">
        <h4 className="text-sm font-semibold text-orange-700 dark:text-orange-400">
          減項（請假、曠職、遲到）
        </h4>
        <Rows item={item} rows={PAY_SUB} negative />
      </section>
      <div className="flex justify-between border-t pt-2 font-semibold">
        <span>應發薪資</span>
        <span className="tabular-nums">{formatTWD(num(item.gross_pay))}</span>
      </div>
      <section className="space-y-1.5">
        <h4 className="text-sm font-semibold text-purple-700 dark:text-purple-400">代扣</h4>
        <Rows item={item} rows={PAY_DED} negative />
      </section>
      <div className="flex justify-between rounded-lg bg-primary/10 px-3 py-2 text-lg font-bold">
        <span>實發金額</span>
        <span className="tabular-nums">{formatTWD(num(item.net_pay))}</span>
      </div>
      {att.length > 0 && (
        <section className="space-y-1.5">
          <h4 className="text-sm font-semibold">本月出勤</h4>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            {att.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2">
                <span className="text-muted-foreground">{k}</span>
                <span className="tabular-nums">{v}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      <section className="space-y-1.5">
        <h4 className="text-sm font-semibold text-muted-foreground">公司另外負擔（不從薪水扣）</h4>
        <Rows item={item} rows={PAY_ER} />
        <p className="text-xs text-muted-foreground">
          投保薪資 {formatTWD(num(item.insured_salary))}
          {showEmployer ? ` 公司總成本 ${formatTWD(num(item.total_cost))}` : ""}
        </p>
      </section>
      {item.note && <p className="text-sm text-muted-foreground">備註：{item.note}</p>}
    </div>
  );
}
