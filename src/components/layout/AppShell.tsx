import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  FilePlus2,
  List,
  Truck,
  Building2,
  BarChart3,
  ScrollText,
  Trash2,
  Settings as SettingsIcon,
  Moon,
  Sun,
  Bell,
  Users,
  ClipboardList,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { getSettings, updateSettings, getMemos, type Settings, type Memo } from "@/lib/dataStore";
import { useStoreData } from "@/lib/useStore";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { LogOut, ChevronDown } from "lucide-react";
import { useAuth, isSuperAdmin } from "@/lib/AuthContext";
import { toast } from "sonner";
import { formatMoney } from "@/lib/format";
import { useCompanyLogo } from "@/lib/useCompanyLogo";

const allNav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/new-memo", label: "New Memo", icon: FilePlus2, adminOnly: true },
  { to: "/register", label: "Register List", icon: List },
  { to: "/transport-list", label: "Transport List", icon: ClipboardList },
  { to: "/fleet", label: "Fleet Management", icon: Truck },
  { to: "/consignees", label: "Consignor Management", icon: Building2 },
  { to: "/reports", label: "Reports", icon: BarChart3 },
  { to: "/audit", label: "Audit Log", icon: ScrollText },
  { to: "/trash", label: "Trash", icon: Trash2 },
  { to: "/settings", label: "Settings", icon: SettingsIcon, adminOnly: true },
  { to: "/user-management", label: "User Management", icon: Users, adminOnly: true },
];

export function AppShell({
  title,
  breadcrumb,
  actions,
  children,
}: {
  title: string;
  breadcrumb?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  useCompanyLogo(); // keeps the browser tab favicon in sync with the company logo
  const { logout, profile } = useAuth();
  const userName = profile?.name ?? "User";
  const userRole = profile?.role ?? "";
  const admin = isSuperAdmin(profile);
  const nav = allNav.filter((n) => !n.adminOnly || admin);
  const initials = userName.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "U";
  const handleLogout = async () => {
    try { await logout(); toast.success("Logged out"); }
    catch { toast.error("Logout failed"); }
  };
  const { data: settings } = useStoreData<Settings>(() => getSettings(), []);
  const { data: memos } = useStoreData<Memo[]>(() => getMemos(), []);
  const [dark, setDark] = useState(false);

  const pendingPaymentMemos = (memos ?? []).filter((m) => m.status === "Payment Pending");
  const runningMemos = (memos ?? []).filter((m) => m.status === "Dispatched");
  const pendingOutstanding = pendingPaymentMemos.reduce((s, m) => s + m.balance, 0);
  const notifCount = pendingPaymentMemos.length + runningMemos.length;

  useEffect(() => {
    const on = settings?.darkMode ?? false;
    setDark(on);
    document.documentElement.classList.toggle("dark", on);
  }, [settings?.darkMode]);

  const toggleDark = async () => {
    if (!admin) return;
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    setDark(next);
    await updateSettings({ darkMode: next });
  };

  const isActive = (to: string, exact?: boolean) =>
    exact ? pathname === to : pathname === to || pathname.startsWith(to + "/");

  return (
    <div className="flex min-h-screen w-full" style={{ backgroundColor: "var(--color-page)" }}>
      {/* Sidebar */}
      <aside
        className="fixed inset-y-0 left-0 z-20 flex w-60 flex-col text-white"
        style={{ backgroundColor: "var(--color-navy)" }}
      >
        <div className="flex items-center gap-3 px-5 py-5">
          {settings?.logoUrl ? (
            <img src={settings.logoUrl} className="h-9 w-9 rounded" alt="logo" />
          ) : (
            <div className="flex h-9 w-9 rotate-45 items-center justify-center bg-white/95">
              <div className="h-4 w-4 rotate-45 bg-[color:var(--color-navy)]" />
            </div>
          )}
          <div className="leading-tight">
            <div className="text-[14px] font-bold tracking-wide">
              {settings?.companyName ?? "SAHIL ROAD LINES"}
            </div>
            <div className="text-[10px] uppercase tracking-[0.14em] text-white/60">
              Transport ERP
            </div>
          </div>
        </div>
        <nav className="mt-2 flex-1 space-y-1 px-3">
          {nav.map((n) => {
            const Icon = n.icon;
            const active = isActive(n.to, n.exact);
            return (
              <Link
                key={n.to}
                to={n.to}
                className={`flex items-center gap-3 rounded-md px-3 py-2.5 text-[15px] transition-colors duration-150 ${
                  active
                    ? "bg-[color:var(--color-navy-active)] font-semibold text-white"
                    : "text-white/85 hover:bg-[color:var(--color-navy-hover)]"
                }`}
              >
                <Icon className="h-[18px] w-[18px]" />
                <span>{n.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="px-5 py-4 text-[11px] text-white/50">v1.0 · Live</div>
      </aside>

      {/* Content */}
      <div className="ml-60 flex min-h-screen flex-1 flex-col">
        {/* Topbar */}
        <header className="sticky top-0 z-10 flex h-14 items-center justify-end gap-3 border-b border-border bg-background px-6">
          {admin && (
            <button
              onClick={toggleDark}
              className="rounded-full p-2 text-muted-foreground hover:bg-muted"
              aria-label="Toggle dark mode"
            >
              {dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </button>
          )}
          <Popover>
            <PopoverTrigger asChild>
              <button className="relative rounded-full p-2 text-muted-foreground hover:bg-muted" aria-label="Notifications">
                <Bell className="h-5 w-5" />
                {notifCount > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                    {notifCount}
                  </span>
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-0">
              <div className="border-b px-4 py-3 text-sm font-semibold">Notifications</div>
              {notifCount === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">All clear — nothing needs attention.</div>
              ) : (
                <div className="divide-y">
                  {pendingPaymentMemos.length > 0 && (
                    <button
                      className="block w-full px-4 py-3 text-left hover:bg-muted"
                      onClick={() => navigate({ to: "/register", search: { f: "payment_pending" } })}
                    >
                      <div className="text-sm font-semibold">{pendingPaymentMemos.length} dispatch(es) with pending payment</div>
                      <div className="text-xs text-orange-600">{formatMoney(pendingOutstanding)} outstanding</div>
                    </button>
                  )}
                  {runningMemos.length > 0 && (
                    <button
                      className="block w-full px-4 py-3 text-left hover:bg-muted"
                      onClick={() => navigate({ to: "/register", search: { f: "running" } })}
                    >
                      <div className="text-sm font-semibold">{runningMemos.length} trip(s) running</div>
                      <div className="text-xs text-blue-600">Awaiting delivery</div>
                    </button>
                  )}
                </div>
              )}
            </PopoverContent>
          </Popover>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="ml-2 flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-muted" aria-label="Account menu">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-500 text-sm font-semibold text-white">{initials}</div>
                <div className="text-left leading-tight">
                  <div className="text-sm font-medium text-foreground">{userName}</div>
                  {userRole ? <div className="text-[11px] text-muted-foreground">{userRole}</div> : null}
                </div>
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <div className="px-2 py-1.5 text-xs text-muted-foreground">
                Signed in as <span className="font-semibold text-foreground">{userName}</span>{userRole ? ` · ${userRole}` : ""}
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout} className="text-red-600 focus:text-red-700">
                <LogOut className="mr-2 h-4 w-4" />Logout
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        <main className="flex-1 px-8 py-6">
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <div className="text-xs text-muted-foreground">
                {breadcrumb ?? `Home / ${title}`}
              </div>
              <h1 className="mt-1">{title}</h1>
            </div>
            {actions ? <div className="flex gap-2">{actions}</div> : null}
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
