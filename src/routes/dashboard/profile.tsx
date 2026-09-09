import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { humanizeError } from "@/lib/app-error";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/dashboard/profile")({ component: Page });

const MIN_LENGTH = 8;

/** 個人設定：人人可用（選單 module_key 為 null）。姓名／LINE 由老闆在「員工與帳號」維護。 */
function Page() {
  const { session, employee, company, isPlatformAdmin } = useAuth();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);

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

  return (
    <div className="space-y-6">
      <PageHeader
        title="個人設定"
        description="帳號資訊與密碼。姓名、電話、LINE 綁定若需修改請洽老闆。"
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
