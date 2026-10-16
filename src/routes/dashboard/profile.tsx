import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Copy } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { humanizeError } from "@/lib/app-error";
import { fmtDate } from "@/lib/dates";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/dashboard/profile")({ component: Page });

const MIN_LENGTH = 8;

interface LineBind {
  employee_id: string;
  line_bind_code: string | null;
  is_bound: boolean;
  line_bind_at: string | null;
}

/** 個人設定：人人可用（選單 module_key 為 null）。姓名由老闆在「員工與帳號」維護。 */
function Page() {
  const { session, employee, company, isPlatformAdmin } = useAuth();
  const qc = useQueryClient();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);

  // 自己的 LINE 綁定狀態（get_line_bind_status 只回傳本人那一筆，主管則回傳全公司）
  const { data: myLine, isLoading: lineLoading } = useQuery({
    queryKey: ["my_line_bind", company?.id, employee?.id],
    enabled: !!company?.id && !!employee?.id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_line_bind_status");
      if (error) throw error;
      return ((data ?? []) as LineBind[]).find((b) => b.employee_id === employee?.id) ?? null;
    },
  });

  const changePw = async () => {
    if (pw.length < MIN_LENGTH) {
      toast.error(`密碼至少 ${MIN_LENGTH} 碼`);
      return;
    }
    if (pw !== pw2) {
      toast.error("兩次輸入的密碼不一樣");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) {
      toast.error(humanizeError(error, "修改密碼"));
      return;
    }
    toast.success("密碼已更新");
    setPw("");
    setPw2("");
  };

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      toast.success("已複製綁定碼");
    } catch {
      toast.error("無法複製，請手動輸入");
    }
  };

  const unbind = async () => {
    if (!employee?.id) return;
    if (!confirm("要解除 LINE 綁定嗎？解除後不會再收到 LINE 推播，重新綁定需請主管產生新的綁定碼。"))
      return;
    const { error } = await supabase.rpc("unbind_line_account", { p_employee_id: employee.id });
    if (error) {
      toast.error(humanizeError(error, "解除 LINE 綁定"));
      return;
    }
    toast.success("已解除 LINE 綁定");
    void qc.invalidateQueries({ queryKey: ["my_line_bind"] });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="個人設定"
        description="帳號資訊、LINE 通知綁定與密碼。姓名、電話若需修改請洽老闆。"
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">帳號資訊</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label>登入帳號</Label>
              <Input value={session?.user?.email ?? ""} disabled className="font-mono" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>姓名</Label>
                <Input value={employee?.name ?? "—"} disabled />
              </div>
              <div className="space-y-1">
                <Label>員工編號</Label>
                <Input value={employee?.emp_no ?? "—"} disabled />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>公司</Label>
                <Input value={company?.name ?? "—"} disabled />
              </div>
              <div className="space-y-1">
                <Label>角色</Label>
                <div className="pt-1">
                  <Badge>
                    {isPlatformAdmin && !employee ? "系統維護" : (employee?.role?.name ?? "—")}
                  </Badge>
                  {employee?.role?.tier && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      層級 {employee.role.tier}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">LINE 通知</CardTitle>
            <CardDescription>綁定後，派工、外包、打卡異常等通知會推播到你的 LINE。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!employee ? (
              <p className="text-sm text-muted-foreground">此帳號沒有員工資料，無法綁定 LINE。</p>
            ) : lineLoading ? (
              <p className="text-sm text-muted-foreground">載入中…</p>
            ) : myLine?.is_bound ? (
              <>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-green-700 border-green-300">
                    已綁定
                  </Badge>
                  {myLine.line_bind_at && (
                    <span className="text-xs text-muted-foreground">
                      綁定於 {fmtDate(myLine.line_bind_at)}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  換手機或換 LINE 帳號時，請先解除綁定，再請主管產生新的綁定碼。
                </p>
                <Button variant="outline" size="sm" onClick={unbind}>
                  解除綁定
                </Button>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">尚未綁定</span>
                </div>
                {myLine?.line_bind_code ? (
                  <>
                    <div className="space-y-1">
                      <Label>我的綁定碼</Label>
                      <div className="flex gap-2">
                        <Input
                          readOnly
                          value={myLine.line_bind_code}
                          className="font-mono text-lg tracking-[0.3em]"
                        />
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => copyCode(myLine.line_bind_code!)}
                        >
                          <Copy className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                    <ol className="list-decimal pl-5 text-sm text-muted-foreground space-y-1">
                      <li>用 LINE 加入公司官方帳號好友</li>
                      <li>在聊天室傳送上面的 6 碼綁定碼</li>
                      <li>收到「綁定成功」後重新整理此頁</li>
                    </ol>
                    <p className="text-xs text-muted-foreground">
                      綁定碼請勿給別人；在 LINE 傳「狀態」可查詢目前綁定、傳「幫助」看可用指令。
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    目前沒有綁定碼，請洽主管在「員工與帳號」產生。
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">修改密碼</CardTitle>
            <CardDescription>至少 {MIN_LENGTH} 碼。改完後其他裝置不會被登出。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label>新密碼</Label>
              <Input
                type="password"
                autoComplete="new-password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>再輸入一次</Label>
              <Input
                type="password"
                autoComplete="new-password"
                value={pw2}
                onChange={(e) => setPw2(e.target.value)}
              />
            </div>
            <Button onClick={changePw} disabled={busy || pw.length < MIN_LENGTH || pw !== pw2}>
              {busy ? "更新中…" : "更新密碼"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
