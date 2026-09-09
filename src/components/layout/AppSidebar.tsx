import { Link, useLocation } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import * as Icons from "lucide-react";
import { LogOut, Menu, ChevronDown, Building2, Check } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth, type Tier } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { humanizeError } from "@/lib/app-error";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { NotificationBell } from "@/components/NotificationBell";
import { themeHex } from "@/lib/theme";

export interface MenuRow {
  id: string;
  menu_key: string;
  parent_id: string | null;
  title: string;
  icon: string | null;
  route: string | null;
  module_key: string | null;
  min_tier: Tier | null;
  sort_order: number;
  is_active: boolean;
}

const OPEN_KEY = "xxops.sidebar.open";
const TIER_RANK: Record<Tier, number> = { staff: 1, manager: 2, owner: 3 };

function loadOpen(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(OPEN_KEY) || "{}");
  } catch {
    return {};
  }
}

export function Icon({ name, className }: { name: string | null; className?: string }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Cmp = ((Icons as any)[name ?? "Circle"] ?? Icons.Circle) as React.ComponentType<{
    className?: string;
  }>;
  return <Cmp className={className ?? ""} />;
}

function CompanySwitcher({ compact }: { compact?: boolean }) {
  const { company, companies, employee, isPlatformAdmin, switchCompany } = useAuth();
  const canSwitch = isPlatformAdmin || (employee?.can_switch_company && companies.length > 1);
  const [busy, setBusy] = useState(false);

  const label = company?.short_name ?? company?.name ?? "—";
  const dot = (
    <span
      className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
      style={{ background: themeHex(company?.theme_color) }}
    />
  );

  if (!canSwitch) {
    return (
      <div className={cn("flex items-center gap-2 text-sm font-semibold", compact && "text-xs")}>
        {dot}
        <span className="truncate">{label}</span>
      </div>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={busy}
          className={cn(
            "flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm font-semibold hover:bg-accent disabled:opacity-60",
            compact && "text-xs",
          )}
        >
          {dot}
          <span className="truncate">{busy ? "切換中…" : label}</span>
          <ChevronDown className="w-3.5 h-3.5 opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          切換公司（資料範圍隨之切換）
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {companies.map((c) => (
          <DropdownMenuItem
            key={c.id}
            onClick={async () => {
              if (c.id === company?.id) return;
              setBusy(true);
              try {
                await switchCompany(c.id);
                toast.success(`已切換至 ${c.short_name ?? c.name}`);
              } catch (e) {
                toast.error(humanizeError(e, "切換公司"));
              } finally {
                setBusy(false);
              }
            }}
          >
            <span
              className="inline-block w-2.5 h-2.5 rounded-full mr-2"
              style={{ background: themeHex(c.theme_color) }}
            />
            <span className="flex-1 truncate">{c.name}</span>
            {c.id === company?.id && <Check className="w-4 h-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SidebarInner({ onNavigate }: { onNavigate?: () => void }) {
  const { pathname } = useLocation();
  const { profile, employee, tier, isPlatformAdmin, signOut, can, moduleEnabled } = useAuth();

  const [openMap, setOpenMap] = useState<Record<string, boolean>>(loadOpen);
  useEffect(() => {
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify(openMap));
    } catch {
      /* ignore */
    }
  }, [openMap]);

  const { data: menus = [] } = useQuery({
    queryKey: ["menus"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("menus")
        .select("*")
        .eq("is_active", true)
        .order("sort_order");
      if (error) throw error;
      return data as MenuRow[];
    },
  });

  const groups = menus.filter((m) => !m.parent_id);
  const childrenOf = (id: string) => menus.filter((m) => m.parent_id === id);
  // 三層過濾：模組是否啟用 → 權限 → tier 下限（平台管理員忽略模組開關）
  const visible = (m: MenuRow) => {
    if (m.module_key && !moduleEnabled(m.module_key) && !isPlatformAdmin) return false;
    if (m.module_key && !can(m.module_key, "view")) return false;
    if (m.min_tier && tier && TIER_RANK[tier] < TIER_RANK[m.min_tier]) return false;
    return true;
  };

  // 補充選單（menus 表尚未收錄的新頁面）：外包追蹤、集團總覽
  const canOutsource = moduleEnabled("outsource") && can("outsource", "view");
  const canGroup = moduleEnabled("group_overview") && can("group_overview", "view");
  const knownRoutes = new Set(menus.map((m) => m.route));

  const { data: mismatchCount = 0 } = useQuery({
    queryKey: ["group_mismatch_count"],
    enabled: canGroup,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("group_reconciliation")
        .select("*", { count: "exact", head: true })
        .eq("amount_mismatch", true);
      if (error) return 0; // view 尚未建立或權限不足時靜默
      return count ?? 0;
    },
  });

  const extraItems = [
    canOutsource && !knownRoutes.has("/dashboard/outsource")
      ? { title: "外包追蹤", route: "/dashboard/outsource", icon: "ExternalLink", badge: 0 }
      : null,
    canGroup && !knownRoutes.has("/dashboard/group")
      ? { title: "集團總覽", route: "/dashboard/group", icon: "Building2", badge: mismatchCount }
      : null,
  ].filter((x): x is { title: string; route: string; icon: string; badge: number } => !!x);

  // 插入位置：「設定」群組之前；找不到則附加在最後
  const settingsIdx = groups.findIndex(
    (g) => g.menu_key.includes("setting") || g.title === "設定",
  );
  const groupsBefore = settingsIdx >= 0 ? groups.slice(0, settingsIdx) : groups;
  const groupsAfter = settingsIdx >= 0 ? groups.slice(settingsIdx) : [];

  const isOpen = (key: string, kids: MenuRow[]) =>
    key in openMap ? openMap[key] : kids.some((k) => k.route === pathname);
  const toggle = (key: string, kids: MenuRow[]) =>
    setOpenMap((prev) => ({ ...prev, [key]: !isOpen(key, kids) }));

  const displayName = employee?.name ?? profile?.display_name ?? "—";
  const roleLabel = isPlatformAdmin && !employee ? "系統維護" : (employee?.role?.name ?? "—");

  return (
    <div className="flex flex-col h-full bg-card">
      <div className="px-4 py-3 border-b space-y-2">
        <CompanySwitcher />
        <p className="text-[12px] text-muted-foreground">營運系統</p>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
        {groups.map((g) => {
          if (g.route) {
            if (!visible(g)) return null;
            return (
              <SideLink
                key={g.id}
                to={g.route}
                icon={g.icon}
                title={g.title}
                active={pathname === g.route}
                onNavigate={onNavigate}
              />
            );
          }
          const kids = childrenOf(g.id).filter(visible);
          if (!kids.length) return null;
          const open = isOpen(g.menu_key, kids);
          return (
            <div key={g.id} className="pt-1">
              <button
                type="button"
                onClick={() => toggle(g.menu_key, kids)}
                aria-expanded={open}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-base font-semibold text-foreground/80 hover:bg-accent/50 transition-colors"
              >
                <Icon name={g.icon} className="w-5 h-5 shrink-0" />
                <span className="flex-1 text-left truncate">{g.title}</span>
                <ChevronDown
                  className={cn(
                    "w-4 h-4 shrink-0 transition-transform",
                    open ? "rotate-0" : "-rotate-90",
                  )}
                />
              </button>
              {open && (
                <div className="mt-0.5 space-y-0.5">
                  {kids.map((k) => (
                    <SideLink
                      key={k.id}
                      to={k.route!}
                      icon={k.icon}
                      title={k.title}
                      active={pathname === k.route}
                      onNavigate={onNavigate}
                      indent
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>
      <div className="border-t p-3">
        <div className="flex items-center gap-2 px-2 py-1.5">
          <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-semibold shrink-0">
            {displayName.slice(0, 1).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{displayName}</div>
            <div className="text-xs text-muted-foreground truncate">{roleLabel}</div>
          </div>
          <NotificationBell />
          <button
            onClick={signOut}
            className="p-2 rounded-md hover:bg-accent text-muted-foreground"
            title="登出"
            aria-label="登出"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

export function AppSidebar() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const { company } = useAuth();
  useEffect(() => setOpen(false), [pathname]);

  return (
    <>
      <header className="lg:hidden sticky top-1 z-40 flex items-center justify-between h-12 px-3 border-b bg-card">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <button className="p-2 -ml-2 rounded-md hover:bg-accent" aria-label="開啟選單">
              <Menu className="w-5 h-5" />
            </button>
          </SheetTrigger>
          <SheetContent side="left" className="p-0 w-72 max-w-[85vw]">
            <SheetTitle className="sr-only">主選單</SheetTitle>
            <SidebarInner onNavigate={() => setOpen(false)} />
          </SheetContent>
        </Sheet>
        <div className="flex items-center gap-2 min-w-0">
          <Building2
            className="w-4 h-4 shrink-0"
            style={{ color: themeHex(company?.theme_color) }}
          />
          <h1 className="text-sm font-bold truncate">
            {company?.short_name ?? company?.name ?? "營運系統"}
          </h1>
        </div>
        <NotificationBell />
      </header>
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-64 border-r bg-card flex-col pt-1">
        <SidebarInner />
      </aside>
    </>
  );
}

function SideLink({
  to,
  icon,
  title,
  active,
  onNavigate,
  indent,
}: {
  to: string;
  icon: string | null;
  title: string;
  active: boolean;
  onNavigate?: (() => void) | undefined;
  indent?: boolean | undefined;
}) {
  return (
    <Link
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      to={to as any}
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-3 px-3 py-2 rounded-md text-base transition-colors",
        indent && "ml-2",
        active
          ? "bg-accent text-accent-foreground font-medium"
          : "text-foreground/80 hover:bg-accent/50",
      )}
    >
      <Icon name={icon} className="w-5 h-5 shrink-0" />
      <span className="truncate">{title}</span>
    </Link>
  );
}
