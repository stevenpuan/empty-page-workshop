import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { themeHex } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { logActivity } from "@/lib/logging";
import { humanizeError } from "@/lib/app-error";

export const Route = createFileRoute("/login")({ component: LoginPage });

interface LoginCompany {
  code: string;
  name: string;
  login_domain: string;
  theme_color: string;
}

const LAST_COMPANY_KEY = "xxops.login.company";

/** 員工編號 + 公司網域 → 內部 email；輸入含 @ 則視為完整帳號（平台管理員用） */
function toLoginEmail(input: string, domain: string) {
  const v = input.trim().toLowerCase().replace(/\s+/g, "");
  if (!v) return v;
  return v.includes("@") ? v : `${v}@${domain}`;
}

function LoginPage() {
  const navigate = useNavigate();
  const { session, loading } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [companyCode, setCompanyCode] = useState<string>(() => {
    try {
      return localStorage.getItem(LAST_COMPANY_KEY) ?? "";
    } catch {
      return "";
    }
  });

  useEffect(() => {
    if (!loading && session) navigate({ to: "/dashboard" });
  }, [loading, session, navigate]);

  // anon 可呼叫的 login_companies()：只露 code / name / login_domain / theme_color
  const { data: companies = [], isError } = useQuery({
    queryKey: ["login_companies"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("login_companies");
      if (error) throw error;
      return (data ?? []) as LoginCompany[];
    },
  });
  useEffect(() => {
    if (!companyCode && companies.length) setCompanyCode(companies[0]!.code);
  }, [companies, companyCode]);
  const company = companies.find((c) => c.code === companyCode);

  const onLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    const account = String(f.get("account"));
    const password = String(f.get("password"));
    const domain = company?.login_domain ?? "";
    if (!account.includes("@") && !domain) {
      setBusy(false);
      setError("請先選擇公司");
      return;
    }
    const { error } = await supabase.auth.signInWithPassword({
      email: toLoginEmail(account, domain),
      password,
    });
    setBusy(false);
    if (error) {
      // 只有真的憑證不符才報帳密錯；rate limit／服務中斷走 humanizeError，否則沒人會回報系統故障
      const code = (error as { code?: string }).code;
      setError(
        code === "invalid_credentials" || code === "invalid_grant"
          ? "員工編號或密碼錯誤"
          : humanizeError(error, "登入"),
      );
      return;
    }
    try {
      localStorage.setItem(LAST_COMPANY_KEY, companyCode);
    } catch {
      /* ignore */
    }
    await logActivity("login");
    navigate({ to: "/dashboard" });
  };

  return (
    <div className="min-h-screen grid place-items-center bg-muted/30 px-4">
      <Card className="w-full max-w-sm">
        <div
          className="h-1.5 rounded-t-xl"
          style={{ background: themeHex(company?.theme_color) }}
        />
        <CardHeader className="text-center">
          <CardTitle className="text-xl">{company?.name ?? "營運系統"}</CardTitle>
          <CardDescription>祥興印刷／沂融企業社 營運系統</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onLogin} className="space-y-3">
            <div className="space-y-1">
              <Label>公司</Label>
              <Select value={companyCode} onValueChange={setCompanyCode}>
                <SelectTrigger>
                  <SelectValue placeholder={isError ? "公司清單載入失敗" : "選擇公司"} />
                </SelectTrigger>
                <SelectContent>
                  {companies.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      <span
                        className="inline-block w-2 h-2 rounded-full mr-2 align-middle"
                        style={{ background: themeHex(c.theme_color) }}
                      />
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>員工編號</Label>
              <Input
                name="account"
                type="text"
                autoComplete="username"
                required
                placeholder="例：A01"
              />
            </div>
            <div className="space-y-1">
              <Label>密碼</Label>
              <Input name="password" type="password" autoComplete="current-password" required />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button className="w-full" disabled={busy || !companyCode}>
              {busy ? "登入中…" : "登入"}
            </Button>
            <p className="text-xs text-muted-foreground text-center leading-relaxed">
              帳號由老闆建立；首次登入請使用老闆給的臨時密碼，登入後系統會要求你先改密碼。
            </p>
            <p className="text-xs text-muted-foreground text-center leading-relaxed">
              忘記密碼請洽老闆，於「員工與帳號」為你重設。
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
