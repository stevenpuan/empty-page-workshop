import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { humanizeError } from "@/lib/app-error";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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

export const Route = createFileRoute("/dashboard/settings/roles")({
  component: () => (
    <RequirePerm module="roles">
      <Page />
    </RequirePerm>
  ),
});

const ACTIONS: [string, string][] = [
  ["can_view", "檢視"],
  ["can_create", "新增"],
  ["can_edit", "編輯"],
  ["can_delete", "刪除"],
  ["can_export", "匯出"],
];
const CATEGORY_LABEL: Record<string, string> = {
  ops: "營運",
  finance: "財務",
  hr: "出勤",
  settings: "設定",
  system: "系統",
};
const TIER_LABEL: Record<string, string> = {
  owner: "老闆（全部資料）",
  manager: "管理者（全公司業務資料）",
  staff: "員工（僅自己的）",
};

interface Role {
  id: string;
  code: string;
  name: string;
  tier: "owner" | "manager" | "staff";
  is_system: boolean;
  is_active: boolean;
}
interface Mod {
  module_key: string;
  name: string;
  category: string;
  sort_order: number;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const EMPTY_ROWS: any[] = [];

function Page() {
  const { can, company, isOwner } = useAuth();
  const qc = useQueryClient();
  const editable = can("roles", "edit");

  const { data: roles = [] } = useQuery({
    queryKey: ["roles", company?.id],
    enabled: !!company?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("roles")
        .select("id, code, name, tier, is_system, is_active")
        .order("sort_order")
        .order("created_at");
      if (error) throw error;
      return data as Role[];
    },
  });
  // 可授權模組 = module_registry（不從 menus 反查，因為一個模組可能有多個選單或沒有選單）
  const { data: mods = [] } = useQuery({
    queryKey: ["module_registry"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("module_registry")
        .select("module_key, name, category, sort_order")
        .eq("is_active", true)
        .order("sort_order");
      if (error) throw error;
      return data as Mod[];
    },
  });
  const { data: enabled = [] } = useQuery({
    queryKey: ["company_modules", company?.id],
    enabled: !!company?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("company_modules")
        .select("module_key, is_enabled")
        .eq("company_id", company!.id);
      if (error) throw error;
      return data as { module_key: string; is_enabled: boolean }[];
    },
  });
  const disabledModules = new Set(enabled.filter((m) => !m.is_enabled).map((m) => m.module_key));

  const [roleId, setRoleId] = useState("");
  useEffect(() => {
    if (roles.length && !roles.some((r) => r.id === roleId)) setRoleId(roles[0]!.id);
  }, [roles, roleId]);
  const role = roles.find((r) => r.id === roleId);
  const isOwnerRole = role?.tier === "owner";

  const { data: permsData } = useQuery({
    queryKey: ["rmp", roleId],
    enabled: !!roleId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("role_module_permissions")
        .select("*")
        .eq("role_id", roleId);
      if (error) throw error;
      return data as Record<string, unknown>[];
    },
  });
  const perms = permsData ?? EMPTY_ROWS; // 穩定參考，避免 useEffect 無限重跑
  const [draft, setDraft] = useState<Record<string, Record<string, unknown>>>({});
  useEffect(() => {
    const m: Record<string, Record<string, unknown>> = {};
    perms.forEach((p) => (m[p.module_key as string] = p));
    setDraft(m);
  }, [perms]);

  const flag = (k: string, a: string) => (isOwnerRole ? true : !!draft[k]?.[a]);
  const toggle = (k: string, a: string) => {
    if (!editable || isOwnerRole) return;
    setDraft((d) => ({ ...d, [k]: { ...(d[k] ?? { module_key: k }), [a]: !d[k]?.[a] } }));
  };
  const save = async () => {
    // 全量 upsert，避免半套
    const rows = mods.map((m) => ({
      role_id: roleId,
      module_key: m.module_key,
      can_view: !!draft[m.module_key]?.["can_view"],
      can_create: !!draft[m.module_key]?.["can_create"],
      can_edit: !!draft[m.module_key]?.["can_edit"],
      can_delete: !!draft[m.module_key]?.["can_delete"],
      can_export: !!draft[m.module_key]?.["can_export"],
    }));
    const { data, error } = await supabase
      .from("role_module_permissions")
      .upsert(rows, { onConflict: "role_id,module_key" })
      .select("id");
    if (error) {
      toast.error(humanizeError(error, "儲存權限"));
      return;
    }
    if (!data?.length) {
      toast.error("沒有寫入任何資料（可能沒有權限），請重新整理後再試");
      return;
    }
    toast.success("權限已儲存；相關人員重新整理頁面後生效");
    qc.invalidateQueries({ queryKey: ["rmp", roleId] });
  };

  // ---- 新增／編輯角色 ----
  const [form, setForm] = useState<Partial<Role> | null>(null);
  const saveRole = async () => {
    if (!form || !company) return;
    if (!form.code?.trim() || !form.name?.trim() || !form.tier) {
      toast.error("代碼、名稱、層級為必填");
      return;
    }
    if (!/^[a-z][a-z0-9_]*$/.test(form.code.trim())) {
      toast.error("代碼請用小寫英文與底線，例：accountant");
      return;
    }
    const payload = {
      company_id: company.id,
      code: form.code.trim(),
      name: form.name.trim(),
      tier: form.tier,
      is_active: form.is_active ?? true,
    };
    const res = form.id
      ? await supabase
          .from("roles")
          .update({ name: payload.name, tier: payload.tier, is_active: payload.is_active })
          .eq("id", form.id)
          .select("id")
      : await supabase.from("roles").insert(payload).select("id");
    if (res.error) {
      toast.error(humanizeError(res.error, "儲存角色"));
      return;
    }
    if (!res.data?.length) {
      toast.error("沒有寫入任何資料（可能沒有權限）");
      return;
    }
    toast.success("角色已儲存");
    setForm(null);
    qc.invalidateQueries({ queryKey: ["roles", company.id] });
  };
  const deleteRole = async (r: Role) => {
    if (!confirm(`確定刪除角色「${r.name}」？若仍有員工使用此角色會被擋下。`)) return;
    const { data, error } = await supabase.from("roles").delete().eq("id", r.id).select("id");
    if (error) {
      toast.error(humanizeError(error, "刪除角色"));
      return;
    }
    if (!data?.length) {
      toast.error("沒有刪除任何資料（可能沒有權限）");
      return;
    }
    toast.success("已刪除");
    qc.invalidateQueries({ queryKey: ["roles", company?.id] });
  };

  const categories = Array.from(new Set(mods.map((m) => m.category)));

  return (
    <div className="space-y-6">
      <PageHeader
        title="角色與權限"
        description="角色的「層級」決定看得到哪些資料（老闆全部／管理者全公司／員工只有自己的）；下方矩陣決定每個功能能不能看、能不能改。老闆層級恆為全開。"
        actions={
          editable ? (
            <Button
              variant="outline"
              onClick={() => setForm({ code: "", name: "", tier: "manager", is_active: true })}
            >
              新增角色
            </Button>
          ) : undefined
        }
      />
      <div className="flex flex-wrap gap-2">
        {roles.map((r) => (
          <button
            key={r.id}
            onClick={() => setRoleId(r.id)}
            className={
              "rounded-md border px-3 py-1.5 text-sm transition-colors " +
              (r.id === roleId
                ? "bg-primary text-primary-foreground border-primary"
                : "hover:bg-accent") +
              (r.is_active ? "" : " opacity-50")
            }
          >
            {r.name}
            <span className="ml-1.5 text-[11px] opacity-70">{r.tier}</span>
            {r.is_system && <span className="ml-1 text-[11px] opacity-70">內建</span>}
          </button>
        ))}
      </div>
      {role && (
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <span>層級：{TIER_LABEL[role.tier]}</span>
          {editable && !role.is_system && (
            <Button size="sm" variant="ghost" onClick={() => setForm({ ...role })}>
              編輯角色
            </Button>
          )}
          {editable && !role.is_system && isOwner && (
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              onClick={() => deleteRole(role)}
            >
              刪除角色
            </Button>
          )}
        </div>
      )}
      {isOwnerRole && (
        <p className="text-sm text-muted-foreground">
          老闆層級擁有全部權限，無法調整（後端 has_perm 對 owner 恆真）。
        </p>
      )}
      {editable && !isOwnerRole && (
        <div className="flex justify-end">
          <Button onClick={save}>儲存權限</Button>
        </div>
      )}

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>模組</TableHead>
                {ACTIONS.map(([k, l]) => (
                  <TableHead key={k} className="text-center w-20">
                    {l}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {categories.map((cat) => (
                <Fragment key={cat}>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableCell
                      colSpan={6}
                      className="text-xs font-semibold text-muted-foreground py-1.5"
                    >
                      {CATEGORY_LABEL[cat] ?? cat}
                    </TableCell>
                  </TableRow>
                  {mods
                    .filter((m) => m.category === cat)
                    .map((m) => (
                      <TableRow
                        key={m.module_key}
                        className={disabledModules.has(m.module_key) ? "opacity-50" : ""}
                      >
                        <TableCell className="font-medium">
                          {m.name}
                          <span className="ml-2 text-xs font-mono text-muted-foreground">
                            {m.module_key}
                          </span>
                          {disabledModules.has(m.module_key) && (
                            <Badge variant="outline" className="ml-2 text-[10.5px]">
                              本公司未啟用
                            </Badge>
                          )}
                        </TableCell>
                        {ACTIONS.map(([a]) => (
                          <TableCell key={a} className="text-center">
                            <Checkbox
                              checked={flag(m.module_key, a)}
                              disabled={!editable || isOwnerRole}
                              onCheckedChange={() => toggle(m.module_key, a)}
                            />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form?.id ? "編輯角色" : "新增角色"}</DialogTitle>
            <DialogDescription>
              層級一經指派給員工就影響其資料範圍；內建三個角色不可改層級。
            </DialogDescription>
          </DialogHeader>
          {form && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>代碼（英文，建立後不可改）</Label>
                <Input
                  value={form.code ?? ""}
                  disabled={!!form.id}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  placeholder="accountant"
                />
              </div>
              <div className="space-y-1">
                <Label>名稱</Label>
                <Input
                  value={form.name ?? ""}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="會計"
                />
              </div>
              <div className="space-y-1">
                <Label>層級</Label>
                <Select
                  value={form.tier ?? "manager"}
                  onValueChange={(v) => setForm({ ...form, tier: v as Role["tier"] })}
                  disabled={!!form.is_system}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manager">{TIER_LABEL["manager"]}</SelectItem>
                    <SelectItem value="staff">{TIER_LABEL["staff"]}</SelectItem>
                    {isOwner && <SelectItem value="owner">{TIER_LABEL["owner"]}</SelectItem>}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={saveRole}>儲存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
