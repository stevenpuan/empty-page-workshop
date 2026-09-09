import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Copy, KeyRound, UserPlus, ShieldCheck } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { useLookup } from "@/lib/lookups";
import { humanizeError, functionErrorMessage } from "@/lib/app-error";
import { fmtDate } from "@/lib/dates";
import { RequirePerm } from "@/components/RequirePerm";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

export const Route = createFileRoute("/dashboard/settings/employees")({
  component: () => (
    <RequirePerm module="employees">
      <Page />
    </RequirePerm>
  ),
});

interface Role {
  id: string;
  code: string;
  name: string;
  tier: "owner" | "manager" | "staff";
  is_active: boolean;
}
interface Shift {
  id: string;
  name: string;
}
interface Emp {
  id: string;
  company_id: string;
  user_id: string | null;
  emp_no: string;
  name: string;
  role_id: string;
  position: string | null;
  phone: string | null;
  line_user_id: string | null;
  shift_id: string | null;
  hire_date: string | null;
  can_switch_company: boolean;
  is_active: boolean;
  note: string | null;
  roles: { code: string; name: string; tier: string } | null;
}
type Draft = Partial<Emp>;

const blank = (): Draft => ({
  emp_no: "",
  name: "",
  role_id: "",
  position: "",
  phone: "",
  line_user_id: "",
  shift_id: null,
  hire_date: null,
  can_switch_company: false,
  is_active: true,
  note: "",
});

function Page() {
  const { can, isOwner, company, employee: me } = useAuth();
  const qc = useQueryClient();
  const canEdit = can("employees", "edit");
  const positions = useLookup("position", { includeInactive: true });

  const {
    data: rows = [],
    isLoading,
    error: loadErr,
  } = useQuery({
    queryKey: ["employees", company?.id],
    enabled: !!company?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employees")
        .select("*, roles(code, name, tier)")
        .order("is_active", { ascending: false })
        .order("emp_no");
      if (error) throw error;
      return data as Emp[];
    },
  });
  const { data: roles = [] } = useQuery({
    queryKey: ["roles", company?.id],
    enabled: !!company?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("roles")
        .select("id, code, name, tier, is_active")
        .order("sort_order");
      if (error) throw error;
      return data as Role[];
    },
  });
  const { data: shifts = [] } = useQuery({
    queryKey: ["shifts", company?.id],
    enabled: !!company?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shifts")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data as Shift[];
    },
  });
  const reload = () => qc.invalidateQueries({ queryKey: ["employees", company?.id] });

  // ---- 新增／編輯 ----
  const [form, setForm] = useState<Draft | null>(null);
  const isNew = !!form && !form.id;
  const save = async () => {
    if (!form || !company) return;
    if (!form.emp_no?.trim() || !form.name?.trim() || !form.role_id) {
      toast.error("員工編號、姓名、角色為必填");
      return;
    }
    if (!/^[A-Za-z0-9._-]+$/.test(form.emp_no.trim())) {
      toast.error("員工編號只能用英數字與 . _ -（會成為登入帳號）");
      return;
    }
    const payload = {
      company_id: company.id,
      emp_no: form.emp_no.trim(),
      name: form.name.trim(),
      role_id: form.role_id,
      position: form.position || null,
      phone: form.phone || null,
      line_user_id: form.line_user_id?.trim() || null,
      shift_id: form.shift_id || null,
      hire_date: form.hire_date || null,
      can_switch_company: !!form.can_switch_company,
      is_active: form.is_active ?? true,
      note: form.note || null,
    };
    const res = form.id
      ? await supabase.from("employees").update(payload).eq("id", form.id).select("id")
      : await supabase.from("employees").insert(payload).select("id");
    if (res.error) {
      toast.error(humanizeError(res.error, isNew ? "新增員工" : "更新員工"));
      return;
    }
    if (!res.data?.length) {
      toast.error("沒有寫入任何資料（可能沒有權限），請重新整理後再試");
      return;
    }
    toast.success(isNew ? "已新增員工" : "已更新");
    setForm(null);
    reload();
  };

  // ---- 建立帳號 / 重設密碼 ----
  const [cred, setCred] = useState<{
    title: string;
    email?: string;
    password?: string | null;
    note?: string;
  } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const createAccount = async (e: Emp) => {
    if (
      !confirm(`要為「${e.name}」建立登入帳號嗎？\n帳號將是 ${e.emp_no}@${company?.login_domain}`)
    )
      return;
    setBusyId(e.id);
    const { data, error } = await supabase.functions.invoke("create-employee-account", {
      body: { employee_id: e.id },
    });
    setBusyId(null);
    if (error) {
      toast.error(await functionErrorMessage(error, "建立帳號"));
      return;
    }
    if (data?.error) {
      toast.error(`建立帳號失敗：${data.error}`);
      return;
    }
    setCred({
      title: data.linked_existing ? "已綁定既有帳號" : "帳號建立成功",
      email: data.email,
      password: data.password,
      note: data.linked_existing
        ? "這個人已經在另一家公司有登入帳號，已直接綁定，密碼不變。"
        : "初始密碼只顯示這一次，請複製後口頭轉交；對方首次登入會被要求改密碼。",
    });
    reload();
  };
  const resetPassword = async (e: Emp) => {
    if (!confirm(`要重設「${e.name}」的密碼嗎？\n原密碼立即失效，該帳號在所有裝置上都會被登出。`))
      return;
    setBusyId(e.id);
    const { data, error } = await supabase.functions.invoke("reset-employee-password", {
      body: { employee_id: e.id },
    });
    setBusyId(null);
    if (error) {
      toast.error(await functionErrorMessage(error, "重設密碼"));
      return;
    }
    if (data?.error) {
      toast.error(`重設密碼失敗：${data.error}`);
      return;
    }
    setCred({
      title: "密碼已重設",
      email: `${e.emp_no}@${company?.login_domain}`,
      password: data.password,
      note: `已登出 ${data.revoked_sessions ?? 0} 個裝置。臨時密碼只顯示這一次。`,
    });
  };
  const copy = async (s: string) => {
    try {
      await navigator.clipboard.writeText(s);
      toast.success("已複製");
    } catch {
      toast.error("無法複製，請手動選取");
    }
  };

  const roleOptions = roles.filter((r) => r.is_active && (isOwner || r.tier !== "owner"));

  return (
    <div className="space-y-6">
      <PageHeader
        title="員工與帳號"
        description={`${company?.name ?? ""}的員工名冊、角色、LINE 綁定與登入帳號。角色決定功能權限；帳號由老闆建立，員工不能自行註冊。`}
        actions={
          canEdit ? (
            <Button onClick={() => setForm(blank())}>
              <UserPlus className="w-4 h-4 mr-1" />
              新增員工
            </Button>
          ) : undefined
        }
      />
      {loadErr && <p className="text-sm text-destructive">{humanizeError(loadErr, "載入員工")}</p>}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>編號</TableHead>
                <TableHead>姓名</TableHead>
                <TableHead>角色</TableHead>
                <TableHead>職稱</TableHead>
                <TableHead>電話</TableHead>
                <TableHead>LINE</TableHead>
                <TableHead>帳號</TableHead>
                <TableHead>狀態</TableHead>
                <TableHead>到職</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                    載入中…
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                    尚無員工，請按「新增員工」
                  </TableCell>
                </TableRow>
              )}
              {rows.map((e) => (
                <TableRow key={e.id} className={!e.is_active ? "opacity-60" : ""}>
                  <TableCell className="font-mono text-sm">{e.emp_no}</TableCell>
                  <TableCell className="font-medium">
                    {e.name}
                    {e.id === me?.id && (
                      <span className="ml-1 text-xs text-muted-foreground">（我）</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={e.roles?.tier === "owner" ? "default" : "outline"}>
                      {e.roles?.name ?? "—"}
                    </Badge>
                    {e.can_switch_company && (
                      <ShieldCheck
                        className="inline w-3.5 h-3.5 ml-1 text-muted-foreground"
                        aria-label="可切換公司"
                      />
                    )}
                  </TableCell>
                  <TableCell>{positions.labelOf(e.position)}</TableCell>
                  <TableCell className="text-sm">{e.phone ?? "—"}</TableCell>
                  <TableCell>
                    {e.line_user_id ? (
                      <Badge variant="outline" className="text-green-700 border-green-300">
                        已綁
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">未綁</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {e.user_id ? (
                      <Badge variant="outline">已開通</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">未開通</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={e.is_active ? "default" : "outline"}>
                      {e.is_active ? "在職" : "停用"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {fmtDate(e.hire_date)}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap space-x-1">
                    {canEdit && (
                      <Button size="sm" variant="outline" onClick={() => setForm({ ...e })}>
                        編輯
                      </Button>
                    )}
                    {canEdit && e.is_active && !e.user_id && (
                      <Button size="sm" disabled={busyId === e.id} onClick={() => createAccount(e)}>
                        {busyId === e.id ? "處理中…" : "建立帳號"}
                      </Button>
                    )}
                    {canEdit && e.user_id && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyId === e.id}
                        onClick={() => resetPassword(e)}
                      >
                        <KeyRound className="w-3.5 h-3.5 mr-1" />
                        重設密碼
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* 新增／編輯 */}
      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isNew ? "新增員工" : "編輯員工"}</DialogTitle>
            <DialogDescription>
              {isNew
                ? "先建立員工資料，再按「建立帳號」開通登入。"
                : "角色與帳號變更會寫入稽核日誌。"}
            </DialogDescription>
          </DialogHeader>
          {form && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>員工編號 *</Label>
                  <Input
                    value={form.emp_no ?? ""}
                    disabled={!isNew && !!form.user_id}
                    onChange={(e) => setForm({ ...form, emp_no: e.target.value })}
                    placeholder="A01"
                  />
                  {isNew && (
                    <p className="text-[11px] text-muted-foreground">
                      將成為登入帳號：{(form.emp_no || "編號").toLowerCase()}@
                      {company?.login_domain}
                    </p>
                  )}
                </div>
                <div className="space-y-1">
                  <Label>姓名 *</Label>
                  <Input
                    value={form.name ?? ""}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>角色 *</Label>
                  <Select
                    value={form.role_id ?? ""}
                    onValueChange={(v) => setForm({ ...form, role_id: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="選擇角色" />
                    </SelectTrigger>
                    <SelectContent>
                      {roleOptions.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.name}
                          <span className="ml-2 text-xs text-muted-foreground">{r.tier}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>職稱</Label>
                  <Select
                    value={form.position ?? "none"}
                    onValueChange={(v) => setForm({ ...form, position: v === "none" ? "" : v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="—" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">—</SelectItem>
                      {positions.options.map((p) => (
                        <SelectItem key={p.code} value={p.code}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>電話</Label>
                  <Input
                    value={form.phone ?? ""}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>到職日</Label>
                  <Input
                    type="date"
                    value={form.hire_date ?? ""}
                    onChange={(e) => setForm({ ...form, hire_date: e.target.value || null })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>班別</Label>
                  <Select
                    value={form.shift_id ?? "none"}
                    onValueChange={(v) => setForm({ ...form, shift_id: v === "none" ? null : v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="—" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">—</SelectItem>
                      {shifts.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>LINE User ID</Label>
                  <Input
                    value={form.line_user_id ?? ""}
                    onChange={(e) => setForm({ ...form, line_user_id: e.target.value })}
                    placeholder="U 開頭 33 碼"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label>備註</Label>
                <Input
                  value={form.note ?? ""}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                />
              </div>
              <div className="flex flex-wrap items-center gap-6 pt-1">
                <label className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={form.is_active ?? true}
                    onCheckedChange={(v) => setForm({ ...form, is_active: v })}
                  />
                  在職
                </label>
                {isOwner && (
                  <label className="flex items-center gap-2 text-sm">
                    <Switch
                      checked={!!form.can_switch_company}
                      onCheckedChange={(v) => setForm({ ...form, can_switch_company: v })}
                    />
                    可切換公司（僅老闆本人）
                  </label>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={save}>儲存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 帳號／密碼一次性顯示 */}
      <Dialog open={!!cred} onOpenChange={(o) => !o && setCred(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{cred?.title}</DialogTitle>
            {cred?.note && <DialogDescription>{cred.note}</DialogDescription>}
          </DialogHeader>
          {cred && (
            <div className="space-y-3">
              {cred.email && (
                <div className="space-y-1">
                  <Label>登入帳號</Label>
                  <div className="flex gap-2">
                    <Input readOnly value={cred.email} className="font-mono" />
                    <Button variant="outline" size="icon" onClick={() => copy(cred.email!)}>
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}
              {cred.password && (
                <div className="space-y-1">
                  <Label>臨時密碼</Label>
                  <div className="flex gap-2">
                    <Input
                      readOnly
                      value={cred.password}
                      className="font-mono text-lg tracking-wider"
                    />
                    <Button variant="outline" size="icon" onClick={() => copy(cred.password!)}>
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setCred(null)}>我已記下</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
