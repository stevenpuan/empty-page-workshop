import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { humanizeError } from "@/lib/app-error";
import { RequirePerm } from "@/components/RequirePerm";
import { PageHeader } from "@/components/layout/PageHeader";
import { Icon, type MenuRow } from "@/components/layout/AppSidebar";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

export const Route = createFileRoute("/dashboard/system/menus")({
  component: () => (
    <RequirePerm module="menus">
      <Page />
    </RequirePerm>
  ),
});

interface Mod {
  module_key: string;
  name: string;
}
const blank = (): Partial<MenuRow> => ({
  menu_key: "",
  title: "",
  parent_id: null,
  route: "",
  icon: "",
  module_key: null,
  min_tier: null,
  sort_order: 10,
  is_active: true,
});

function Page() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const canEdit = can("menus", "edit");

  const { data: menus = [] } = useQuery({
    queryKey: ["menus_all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("menus").select("*").order("sort_order");
      if (error) throw error;
      return data as MenuRow[];
    },
  });
  const { data: mods = [] } = useQuery({
    queryKey: ["module_registry"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("module_registry")
        .select("module_key, name")
        .eq("is_active", true)
        .order("sort_order");
      if (error) throw error;
      return data as Mod[];
    },
  });
  const reload = () => {
    qc.invalidateQueries({ queryKey: ["menus_all"] });
    qc.invalidateQueries({ queryKey: ["menus"] }); // 側欄的 key，改完立即反映
  };

  const groups = menus.filter((m) => !m.parent_id);
  const childrenOf = (id: string) => menus.filter((m) => m.parent_id === id);
  const parentOptions = menus.filter((m) => !m.parent_id && !m.route);

  const [form, setForm] = useState<Partial<MenuRow> | null>(null);
  const isNew = !!form && !form.id;

  const save = async () => {
    if (!form) return;
    if (!form.menu_key?.trim() || !form.title?.trim()) {
      toast.error("請填寫鍵值與名稱");
      return;
    }
    const payload = {
      menu_key: form.menu_key.trim(),
      title: form.title.trim(),
      parent_id: form.parent_id || null,
      route: form.route?.trim() || null,
      icon: form.icon?.trim() || null,
      module_key: form.module_key || null,
      min_tier: form.min_tier || null,
      sort_order: form.sort_order ?? 10,
      is_active: form.is_active ?? true,
    };
    const res = form.id
      ? await supabase.from("menus").update(payload).eq("id", form.id).select("id")
      : await supabase.from("menus").insert(payload).select("id");
    if (res.error) {
      toast.error(humanizeError(res.error, "儲存選單"));
      return;
    }
    if (!res.data?.length) {
      toast.error("沒有寫入任何資料（可能沒有權限）");
      return;
    }
    toast.success("已儲存");
    setForm(null);
    reload();
  };
  const del = async (m: MenuRow) => {
    const isGroup = !m.route && childrenOf(m.id).length > 0;
    if (
      !confirm(
        isGroup
          ? `「${m.title}」是群組，刪除會一併移除其子選單，確定？`
          : `確定刪除「${m.title}」？`,
      )
    )
      return;
    const { data, error } = await supabase.from("menus").delete().eq("id", m.id).select("id");
    if (error) {
      toast.error(humanizeError(error, "刪除選單"));
      return;
    }
    if (!data?.length) {
      toast.error("沒有刪除任何資料（可能沒有權限）");
      return;
    }
    toast.success("已刪除");
    reload();
  };
  const toggleActive = async (m: MenuRow) => {
    const { data, error } = await supabase
      .from("menus")
      .update({ is_active: !m.is_active })
      .eq("id", m.id)
      .select("id");
    if (error) {
      toast.error(humanizeError(error, "切換啟用狀態"));
      return;
    }
    if (!data?.length) {
      toast.error("沒有寫入任何資料（可能沒有權限）");
      return;
    }
    reload();
  };

  const Row = ({ m, child }: { m: MenuRow; child?: boolean }) => (
    <div
      className={
        "flex items-center justify-between gap-2 rounded-md border px-3 py-2 " +
        (child ? "ml-6" : "") +
        (m.is_active ? "" : " opacity-60")
      }
    >
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-xs text-muted-foreground w-8">{m.sort_order}</span>
        <Icon name={m.icon} className="w-4 h-4 text-muted-foreground shrink-0" />
        <span className="font-medium truncate">{m.title}</span>
        {m.route && (
          <span className="text-xs font-mono text-muted-foreground truncate">{m.route}</span>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {m.module_key && (
          <Badge variant="outline" className="text-[11.5px] font-mono">
            {m.module_key}
          </Badge>
        )}
        {m.min_tier && (
          <Badge variant="secondary" className="text-[11.5px]">
            ≥ {m.min_tier}
          </Badge>
        )}
        <Badge variant={m.is_active ? "default" : "outline"}>{m.is_active ? "啟用" : "停用"}</Badge>
        {canEdit && (
          <Button size="sm" variant="outline" onClick={() => toggleActive(m)}>
            {m.is_active ? "停用" : "啟用"}
          </Button>
        )}
        {canEdit && (
          <Button size="sm" variant="outline" onClick={() => setForm({ ...m })}>
            編輯
          </Button>
        )}
        {canEdit && (
          <Button size="sm" variant="outline" onClick={() => del(m)}>
            刪除
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="選單管理"
        description="側欄由這張表驅動（全公司共用同一份選單）。誰看得到由「模組是否啟用 → 角色權限 → 層級下限」三層決定。圖示填 lucide-react 名稱，例：KanbanSquare。"
        actions={canEdit ? <Button onClick={() => setForm(blank())}>新增選單</Button> : undefined}
      />
      <Card>
        <CardContent className="space-y-2 py-4">
          {groups.map((g) => (
            <div key={g.id} className="space-y-2">
              <Row m={g} />
              {childrenOf(g.id).map((c) => (
                <Row key={c.id} m={c} child />
              ))}
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isNew ? "新增選單" : "編輯選單"}</DialogTitle>
            <DialogDescription>
              群組請留空路由；有路由的頂層項目會直接顯示為連結。
            </DialogDescription>
          </DialogHeader>
          {form && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>鍵值 menu_key（唯一）</Label>
                <Input
                  value={form.menu_key ?? ""}
                  disabled={!isNew}
                  onChange={(e) => setForm({ ...form, menu_key: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>名稱</Label>
                <Input
                  value={form.title ?? ""}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>上層</Label>
                <Select
                  value={form.parent_id ?? "none"}
                  onValueChange={(v) => setForm({ ...form, parent_id: v === "none" ? null : v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">（頂層）</SelectItem>
                    {parentOptions
                      .filter((g) => g.id !== form.id)
                      .map((g) => (
                        <SelectItem key={g.id} value={g.id}>
                          {g.title}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>路由 route（群組可空）</Label>
                <Input
                  value={form.route ?? ""}
                  onChange={(e) => setForm({ ...form, route: e.target.value })}
                  placeholder="/dashboard/xxx"
                />
              </div>
              <div className="space-y-1">
                <Label>圖示 icon（lucide 名）</Label>
                <div className="flex items-center gap-2">
                  <Input
                    value={form.icon ?? ""}
                    onChange={(e) => setForm({ ...form, icon: e.target.value })}
                    placeholder="Home"
                  />
                  <Icon name={form.icon || null} className="w-5 h-5 text-muted-foreground" />
                </div>
              </div>
              <div className="space-y-1">
                <Label>權限模組 module_key（空＝人人可見）</Label>
                <Select
                  value={form.module_key ?? "none"}
                  onValueChange={(v) => setForm({ ...form, module_key: v === "none" ? null : v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">（不綁權限）</SelectItem>
                    {mods.map((m) => (
                      <SelectItem key={m.module_key} value={m.module_key}>
                        {m.name}
                        <span className="ml-2 text-xs text-muted-foreground font-mono">
                          {m.module_key}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>層級下限 min_tier（選填）</Label>
                <Select
                  value={form.min_tier ?? "none"}
                  onValueChange={(v) =>
                    setForm({ ...form, min_tier: v === "none" ? null : (v as MenuRow["min_tier"]) })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">（不限）</SelectItem>
                    <SelectItem value="manager">manager 以上</SelectItem>
                    <SelectItem value="owner">owner</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>排序</Label>
                <Input
                  type="number"
                  value={form.sort_order ?? 10}
                  onChange={(e) =>
                    setForm({ ...form, sort_order: parseInt(e.target.value || "0", 10) })
                  }
                />
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={form.is_active ?? true}
                  onCheckedChange={(v) => setForm({ ...form, is_active: v })}
                />
                <Label>啟用</Label>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={save}>儲存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
