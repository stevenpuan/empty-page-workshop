import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { humanizeError } from "@/lib/app-error";
import { RequirePerm } from "@/components/RequirePerm";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

export const Route = createFileRoute("/dashboard/settings/stations")({
  head: () => ({
    meta: [
      { title: "工序站別與範本設定" },
      { name: "description", content: "設定工序站別與工序範本步驟" },
      { property: "og:title", content: "工序站別與範本設定" },
      { property: "og:description", content: "設定工序站別與工序範本步驟" },
    ],
  }),
  component: () => (
    <RequirePerm module="work_stations">
      <Page />
    </RequirePerm>
  ),
});

const NONE = "__none__";

const PRODUCT_CATEGORIES: ReadonlyArray<string> = [
  "名片",
  "布條帆布",
  "明信片DM",
  "純代印",
  "紙盒",
  "貼紙",
  "其他",
];

interface Station {
  id: string;
  code: string;
  name: string;
  sort_order: number;
  is_outsource_capable: boolean;
  default_owner_id: string | null;
  color: string | null;
  is_active: boolean;
  employees?: { name: string } | null;
}
type StationDraft = Partial<Station>;

interface Template {
  id: string;
  product_category: string;
  name: string;
  is_default: boolean;
  is_active: boolean;
  routing_template_steps: { id: string }[] | null;
}
type TemplateDraft = Partial<Template>;

interface Step {
  id: string;
  step_no: number;
  station_id: string | null;
  offset_days: number;
  is_optional: boolean;
  work_stations?: { code: string; name: string } | null;
}
type StepDraft = Partial<Step>;

const blankStation = (): StationDraft => ({
  code: "",
  name: "",
  sort_order: 10,
  is_outsource_capable: false,
  default_owner_id: null,
  color: "",
  is_active: true,
});

const blankTemplate = (): TemplateDraft => ({
  product_category: "其他",
  name: "",
  is_default: false,
  is_active: true,
});

const blankStep = (nextNo: number): StepDraft => ({
  step_no: nextNo,
  station_id: null,
  offset_days: 0,
  is_optional: false,
});

function Page() {
  const { can, company } = useAuth();
  const qc = useQueryClient();
  const canCreate = can("work_stations", "create");
  const canEdit = can("work_stations", "edit");
  const canDelete = can("work_stations", "delete");

  // ---------- 站別 ----------
  const {
    data: stations = [],
    isLoading: loadingStations,
    error: stationErr,
  } = useQuery({
    queryKey: ["work_stations", company?.id],
    enabled: !!company?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_stations")
        .select(
          "id, code, name, sort_order, is_outsource_capable, default_owner_id, color, is_active, employees:default_owner_id(name)",
        )
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as unknown as Station[];
    },
  });

  const { data: employees = [] } = useQuery({
    queryKey: ["employees-active", company?.id],
    enabled: !!company?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employees")
        .select("id, name")
        .eq("is_active", true)
        .order("emp_no");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  const [stationForm, setStationForm] = useState<StationDraft | null>(null);
  const isNewStation = !!stationForm && !stationForm.id;

  const saveStation = async () => {
    if (!stationForm || !company) return;
    if (!stationForm.code?.trim() || !stationForm.name?.trim()) {
      toast.error("代碼、名稱為必填");
      return;
    }
    const payload = {
      company_id: company.id,
      code: stationForm.code.trim(),
      name: stationForm.name.trim(),
      sort_order: Number(stationForm.sort_order ?? 10),
      is_outsource_capable: !!stationForm.is_outsource_capable,
      default_owner_id: stationForm.default_owner_id || null,
      color: stationForm.color?.trim() || null,
      is_active: stationForm.is_active ?? true,
    };
    const res = stationForm.id
      ? await supabase
          .from("work_stations")
          .update(payload)
          .eq("id", stationForm.id)
          .select("id")
      : await supabase.from("work_stations").insert(payload).select("id");
    if (res.error) {
      toast.error(humanizeError(res.error, isNewStation ? "新增站別" : "更新站別"));
      return;
    }
    if (!res.data?.length) {
      toast.error("沒有寫入任何資料（可能沒有權限），請重新整理後再試");
      return;
    }
    toast.success(isNewStation ? "已新增站別" : "已更新");
    setStationForm(null);
    qc.invalidateQueries({ queryKey: ["work_stations", company.id] });
  };

  // ---------- 範本 ----------
  const {
    data: templates = [],
    isLoading: loadingTemplates,
    error: templateErr,
  } = useQuery({
    queryKey: ["routing_templates", company?.id],
    enabled: !!company?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("routing_templates")
        .select("id, product_category, name, is_default, is_active, routing_template_steps(id)")
        .order("product_category")
        .order("name");
      if (error) throw error;
      return (data ?? []) as unknown as Template[];
    },
  });

  const [templateForm, setTemplateForm] = useState<TemplateDraft | null>(null);
  const isNewTemplate = !!templateForm && !templateForm.id;

  const saveTemplate = async () => {
    if (!templateForm || !company) return;
    if (!templateForm.name?.trim()) {
      toast.error("範本名稱為必填");
      return;
    }
    const payload = {
      company_id: company.id,
      product_category: templateForm.product_category || "其他",
      name: templateForm.name.trim(),
      is_default: !!templateForm.is_default,
      is_active: templateForm.is_active ?? true,
    };
    const res = templateForm.id
      ? await supabase
          .from("routing_templates")
          .update(payload)
          .eq("id", templateForm.id)
          .select("id")
      : await supabase.from("routing_templates").insert(payload).select("id");
    if (res.error) {
      toast.error(humanizeError(res.error, isNewTemplate ? "新增範本" : "更新範本"));
      return;
    }
    if (!res.data?.length) {
      toast.error("沒有寫入任何資料（可能沒有權限），請重新整理後再試");
      return;
    }
    toast.success(isNewTemplate ? "已新增範本" : "已更新");
    setTemplateForm(null);
    qc.invalidateQueries({ queryKey: ["routing_templates", company.id] });
  };

  // ---------- 步驟 ----------
  const [openTemplate, setOpenTemplate] = useState<Template | null>(null);
  const {
    data: steps = [],
    isLoading: loadingSteps,
    error: stepErr,
  } = useQuery({
    queryKey: ["routing_template_steps", openTemplate?.id],
    enabled: !!openTemplate?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("routing_template_steps")
        .select(
          "id, step_no, station_id, offset_days, is_optional, work_stations:station_id(code, name)",
        )
        .eq("template_id", openTemplate!.id)
        .order("step_no");
      if (error) throw error;
      return (data ?? []) as unknown as Step[];
    },
  });

  const reloadSteps = () => {
    qc.invalidateQueries({ queryKey: ["routing_template_steps", openTemplate?.id] });
    qc.invalidateQueries({ queryKey: ["routing_templates", company?.id] });
  };

  const [stepForm, setStepForm] = useState<StepDraft | null>(null);
  const isNewStep = !!stepForm && !stepForm.id;

  const saveStep = async () => {
    if (!stepForm || !company || !openTemplate) return;
    if (stepForm.step_no === undefined || stepForm.step_no === null || Number.isNaN(Number(stepForm.step_no))) {
      toast.error("步驟序號為必填");
      return;
    }
    if (!stepForm.station_id) {
      toast.error("請選擇站別");
      return;
    }
    const payload = {
      company_id: company.id,
      template_id: openTemplate.id,
      step_no: Number(stepForm.step_no),
      station_id: stepForm.station_id,
      offset_days: Number(stepForm.offset_days ?? 0),
      is_optional: !!stepForm.is_optional,
    };
    const res = stepForm.id
      ? await supabase
          .from("routing_template_steps")
          .update(payload)
          .eq("id", stepForm.id)
          .select("id")
      : await supabase.from("routing_template_steps").insert(payload).select("id");
    if (res.error) {
      toast.error(humanizeError(res.error, isNewStep ? "新增步驟" : "更新步驟"));
      return;
    }
    if (!res.data?.length) {
      toast.error("沒有寫入任何資料（可能沒有權限），請重新整理後再試");
      return;
    }
    toast.success(isNewStep ? "已新增步驟" : "已更新步驟");
    setStepForm(null);
    reloadSteps();
  };

  const deleteStep = async (id: string) => {
    const res = await supabase.from("routing_template_steps").delete().eq("id", id).select("id");
    if (res.error) {
      toast.error(humanizeError(res.error, "刪除步驟"));
      return;
    }
    if (!res.data?.length) {
      toast.error("沒有刪除任何資料（可能沒有權限），請重新整理後再試");
      return;
    }
    toast.success("已刪除步驟");
    reloadSteps();
  };

  const nextStepNo = steps.length ? Math.max(...steps.map((s) => s.step_no)) + 1 : 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="工序站別與範本"
        description="設定生產工序站別，以及各品項類別的工序範本與步驟。點擊列可編輯。"
      />

      {/* ===== 站別管理 ===== */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>工序站別</CardTitle>
          {canCreate && (
            <Button size="sm" onClick={() => setStationForm(blankStation())}>
              <Plus className="w-4 h-4 mr-1" />
              新增站別
            </Button>
          )}
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {stationErr && (
            <p className="text-sm text-destructive px-6 pb-3">
              {humanizeError(stationErr, "載入站別")}
            </p>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>代碼</TableHead>
                <TableHead>名稱</TableHead>
                <TableHead>排序</TableHead>
                <TableHead>可外包</TableHead>
                <TableHead>預設負責人</TableHead>
                <TableHead>顏色</TableHead>
                <TableHead>狀態</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingStations && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    載入中…
                  </TableCell>
                </TableRow>
              )}
              {!loadingStations && stations.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    尚無站別，請按「新增站別」
                  </TableCell>
                </TableRow>
              )}
              {stations.map((s) => (
                <TableRow
                  key={s.id}
                  className={`${canEdit ? "cursor-pointer" : ""} ${!s.is_active ? "opacity-60" : ""}`}
                  onClick={() =>
                    canEdit &&
                    setStationForm({
                      id: s.id,
                      code: s.code,
                      name: s.name,
                      sort_order: s.sort_order,
                      is_outsource_capable: s.is_outsource_capable,
                      default_owner_id: s.default_owner_id,
                      color: s.color,
                      is_active: s.is_active,
                    })
                  }
                >
                  <TableCell className="font-mono text-sm">{s.code}</TableCell>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell className="text-sm">{s.sort_order}</TableCell>
                  <TableCell className="text-sm">{s.is_outsource_capable ? "是" : "—"}</TableCell>
                  <TableCell className="text-sm">{s.employees?.name ?? "—"}</TableCell>
                  <TableCell>
                    {s.color ? (
                      <span className="flex items-center gap-2 text-sm">
                        <span
                          className="inline-block w-3 h-3 rounded-full border border-border"
                          style={{ backgroundColor: s.color }}
                        />
                        <span className="font-mono text-xs">{s.color}</span>
                      </span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={s.is_active ? "default" : "outline"}>
                      {s.is_active ? "啟用" : "停用"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ===== 範本管理 ===== */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>工序範本</CardTitle>
          {canCreate && (
            <Button size="sm" onClick={() => setTemplateForm(blankTemplate())}>
              <Plus className="w-4 h-4 mr-1" />
              新增範本
            </Button>
          )}
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {templateErr && (
            <p className="text-sm text-destructive px-6 pb-3">
              {humanizeError(templateErr, "載入範本")}
            </p>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>品項類別</TableHead>
                <TableHead>範本名稱</TableHead>
                <TableHead>預設</TableHead>
                <TableHead>步驟數</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingTemplates && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                    載入中…
                  </TableCell>
                </TableRow>
              )}
              {!loadingTemplates && templates.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                    尚無範本，請按「新增範本」
                  </TableCell>
                </TableRow>
              )}
              {templates.map((t) => (
                <TableRow
                  key={t.id}
                  className={`cursor-pointer ${!t.is_active ? "opacity-60" : ""}`}
                  onClick={() => setOpenTemplate(t)}
                >
                  <TableCell className="text-sm">{t.product_category}</TableCell>
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell>
                    {t.is_default ? <Badge variant="outline">預設</Badge> : "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {t.routing_template_steps?.length ?? 0}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* 站別表單 */}
      <Dialog open={!!stationForm} onOpenChange={(o) => !o && setStationForm(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isNewStation ? "新增站別" : "編輯站別"}</DialogTitle>
            <DialogDescription>站別不提供刪除；不再使用時請關閉「啟用」。</DialogDescription>
          </DialogHeader>
          {stationForm && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>代碼 *</Label>
                  <Input
                    placeholder="DESIGN"
                    value={stationForm.code ?? ""}
                    onChange={(e) => setStationForm({ ...stationForm, code: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>名稱 *</Label>
                  <Input
                    placeholder="設計"
                    value={stationForm.name ?? ""}
                    onChange={(e) => setStationForm({ ...stationForm, name: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>排序 *</Label>
                  <Input
                    type="number"
                    value={stationForm.sort_order ?? 10}
                    onChange={(e) =>
                      setStationForm({ ...stationForm, sort_order: Number(e.target.value) })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label>預設負責人</Label>
                  <Select
                    value={stationForm.default_owner_id ?? NONE}
                    onValueChange={(v) =>
                      setStationForm({ ...stationForm, default_owner_id: v === NONE ? null : v })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="未指定" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>未指定</SelectItem>
                      {employees.map((e) => (
                        <SelectItem key={e.id} value={e.id}>
                          {e.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1">
                <Label>顏色</Label>
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="#3B82F6"
                    value={stationForm.color ?? ""}
                    onChange={(e) => setStationForm({ ...stationForm, color: e.target.value })}
                  />
                  <span
                    className="w-9 h-9 shrink-0 rounded-md border border-border"
                    style={{ backgroundColor: stationForm.color || "transparent" }}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                <Label>可外包</Label>
                <Switch
                  checked={!!stationForm.is_outsource_capable}
                  onCheckedChange={(v) =>
                    setStationForm({ ...stationForm, is_outsource_capable: v })
                  }
                />
              </div>
              <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                <Label>啟用</Label>
                <Switch
                  checked={stationForm.is_active ?? true}
                  onCheckedChange={(v) => setStationForm({ ...stationForm, is_active: v })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setStationForm(null)}>
              取消
            </Button>
            <Button onClick={saveStation}>{isNewStation ? "新增" : "儲存"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 範本表單 */}
      <Dialog open={!!templateForm} onOpenChange={(o) => !o && setTemplateForm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isNewTemplate ? "新增範本" : "編輯範本"}</DialogTitle>
            <DialogDescription>建立後點擊範本列可管理步驟。</DialogDescription>
          </DialogHeader>
          {templateForm && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>品項類別</Label>
                <Select
                  value={templateForm.product_category ?? "其他"}
                  onValueChange={(v) => setTemplateForm({ ...templateForm, product_category: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRODUCT_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>範本名稱 *</Label>
                <Input
                  value={templateForm.name ?? ""}
                  onChange={(e) => setTemplateForm({ ...templateForm, name: e.target.value })}
                />
              </div>
              <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                <Label>設為預設</Label>
                <Switch
                  checked={!!templateForm.is_default}
                  onCheckedChange={(v) => setTemplateForm({ ...templateForm, is_default: v })}
                />
              </div>
              <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                <Label>啟用</Label>
                <Switch
                  checked={templateForm.is_active ?? true}
                  onCheckedChange={(v) => setTemplateForm({ ...templateForm, is_active: v })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setTemplateForm(null)}>
              取消
            </Button>
            <Button onClick={saveTemplate}>{isNewTemplate ? "新增" : "儲存"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 步驟清單 */}
      <Dialog
        open={!!openTemplate}
        onOpenChange={(o) => {
          if (!o) {
            setOpenTemplate(null);
            setStepForm(null);
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {openTemplate ? `${openTemplate.product_category}／${openTemplate.name}` : "工序步驟"}
            </DialogTitle>
            <DialogDescription>維護此範本的工序步驟；步驟可編輯與刪除。</DialogDescription>
          </DialogHeader>

          {stepErr && (
            <p className="text-sm text-destructive">{humanizeError(stepErr, "載入步驟")}</p>
          )}

          <div className="rounded-md border border-border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>步驟序號</TableHead>
                  <TableHead>站別</TableHead>
                  <TableHead>交期倒推天數</TableHead>
                  <TableHead>可選</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingSteps && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                      載入中…
                    </TableCell>
                  </TableRow>
                )}
                {!loadingSteps && steps.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                      尚無步驟
                    </TableCell>
                  </TableRow>
                )}
                {steps.map((s) => (
                  <TableRow
                    key={s.id}
                    className={canEdit ? "cursor-pointer" : ""}
                    onClick={() =>
                      canEdit &&
                      setStepForm({
                        id: s.id,
                        step_no: s.step_no,
                        station_id: s.station_id,
                        offset_days: s.offset_days,
                        is_optional: s.is_optional,
                      })
                    }
                  >
                    <TableCell className="text-sm">{s.step_no}</TableCell>
                    <TableCell className="text-sm">
                      {s.work_stations ? `${s.work_stations.code} ${s.work_stations.name}` : "—"}
                    </TableCell>
                    <TableCell className="text-sm">{s.offset_days}</TableCell>
                    <TableCell className="text-sm">{s.is_optional ? "是" : "—"}</TableCell>
                    <TableCell>
                      {canDelete && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => {
                            e.stopPropagation();
                            void deleteStep(s.id);
                          }}
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {canCreate && !stepForm && (
            <Button variant="outline" onClick={() => setStepForm(blankStep(nextStepNo))}>
              <Plus className="w-4 h-4 mr-1" />
              新增步驟
            </Button>
          )}

          {stepForm && (
            <div className="space-y-3 rounded-md border border-border p-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>步驟序號 *</Label>
                  <Input
                    type="number"
                    value={stepForm.step_no ?? 1}
                    onChange={(e) => setStepForm({ ...stepForm, step_no: Number(e.target.value) })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>交期倒推天數 *</Label>
                  <Input
                    type="number"
                    value={stepForm.offset_days ?? 0}
                    onChange={(e) =>
                      setStepForm({ ...stepForm, offset_days: Number(e.target.value) })
                    }
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label>站別 *</Label>
                <Select
                  value={stepForm.station_id ?? ""}
                  onValueChange={(v) => setStepForm({ ...stepForm, station_id: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="請選擇站別" />
                  </SelectTrigger>
                  <SelectContent>
                    {stations.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.code} {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                <Label>可選步驟</Label>
                <Switch
                  checked={!!stepForm.is_optional}
                  onCheckedChange={(v) => setStepForm({ ...stepForm, is_optional: v })}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setStepForm(null)}>
                  取消
                </Button>
                <Button onClick={saveStep}>{isNewStep ? "新增步驟" : "儲存步驟"}</Button>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenTemplate(null)}>
              關閉
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
