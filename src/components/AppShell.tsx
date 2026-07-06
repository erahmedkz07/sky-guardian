import { Link, useLocation, type LinkProps } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useStore } from "@/lib/store";
import { authApi } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { isMuted, toggleMute, playByLevel } from "@/lib/sounds";
import { requestNotifPermission, pushNotif } from "@/lib/notifications";
import { GlobalSearch } from "@/components/GlobalSearch";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  BrainCircuit,
  Camera,
  ClipboardList,
  Cog,
  CloudSun,
  FileText,
  GitBranch,
  Globe2,
  Map,
  Menu,
  Radar,
  Radio,
  ScrollText,
  Search,
  ShieldAlert,
  Sliders,
  Target,
  UserCog,
  Users,
  Volume2,
  VolumeX,
  Workflow,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  to: LinkProps["to"];
  icon: typeof Map;
  group: "OPERATIONS" | "INTELLIGENCE" | "SYSTEM";
}

const NAV: NavItem[] = [
  { label: "Command Center", to: "/command", icon: Map, group: "OPERATIONS" },
  { label: "Live Feed", to: "/live-feed", icon: Activity, group: "OPERATIONS" },
  { label: "Cameras", to: "/cameras", icon: Camera, group: "OPERATIONS" },
  { label: "Mission Logs", to: "/missions", icon: ClipboardList, group: "OPERATIONS" },
  { label: "Incidents", to: "/incidents", icon: AlertTriangle, group: "OPERATIONS" },
  { label: "Playbooks", to: "/playbooks", icon: Workflow, group: "OPERATIONS" },

  { label: "Analytics", to: "/analytics", icon: BarChart3, group: "INTELLIGENCE" },
  { label: "Threat Intel", to: "/threat-intel", icon: ShieldAlert, group: "INTELLIGENCE" },
  { label: "RF Spectrum", to: "/spectrum", icon: Radio, group: "INTELLIGENCE" },
  { label: "Weather", to: "/weather", icon: CloudSun, group: "INTELLIGENCE" },
  { label: "Geo Zones", to: "/geo-zones", icon: Globe2, group: "INTELLIGENCE" },
  { label: "AI Control", to: "/ai-control", icon: BrainCircuit, group: "INTELLIGENCE" },
  { label: "Simulation", to: "/simulation", icon: Target, group: "INTELLIGENCE" },

  { label: "Sensor Network", to: "/sensors", icon: Radar, group: "SYSTEM" },
  { label: "Calibration", to: "/calibration", icon: Sliders, group: "SYSTEM" },
  { label: "Notifications", to: "/notifications", icon: Bell, group: "SYSTEM" },
  { label: "Team", to: "/team", icon: Users, group: "SYSTEM" },
  { label: "Integrations", to: "/integrations", icon: GitBranch, group: "SYSTEM" },
  { label: "Reports", to: "/reports", icon: FileText, group: "SYSTEM" },
  { label: "Audit Log", to: "/audit", icon: ScrollText, group: "SYSTEM" },
  { label: "Profile", to: "/profile", icon: UserCog, group: "SYSTEM" },
];

const GROUPS: Array<NavItem["group"]> = ["OPERATIONS", "INTELLIGENCE", "SYSTEM"];

function useClock() {
  // Start with null on the server to prevent hydration mismatch.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function getStoredUser(): {
  name: string;
  operatorId: string;
  role: string;
  avatarUrl?: string | null;
} | null {
  try {
    const raw = localStorage.getItem("dds_user");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function initials(name: string): string {
  return name
    .split(/[\s.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join("");
}

export function AppShell({ children }: { children: ReactNode }) {
  const { t, lang, setLang } = useT();
  const loc = useLocation();
  const now = useClock();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [storedUser, setStoredUser] = useState<{
    name: string;
    operatorId: string;
    role: string;
    avatarUrl?: string | null;
  } | null>(null);
  const alerts = useStore((s) => s.alerts);
  const unreadCount = alerts.filter((a) => !a.acknowledged).length;
  const pendingAiCount = useStore((s) => s.pendingAiActions.length);

  // Close mobile drawer on navigation
  useEffect(() => {
    setMobileOpen(false);
  }, [loc.pathname]);

  // Ctrl+K opens global search
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const seenAlertIds = useRef<Set<string>>(new Set());
  const [muted, setMuted] = useState(() => isMuted());

  useEffect(() => {
    const newAlerts = alerts.filter((a) => !a.acknowledged && !seenAlertIds.current.has(a.id));
    alerts.forEach((a) => seenAlertIds.current.add(a.id));
    if (newAlerts.length === 0) return;

    const priority = ["critical", "high", "medium", "low"] as const;
    for (const lvl of priority) {
      if (newAlerts.some((a) => a.level === lvl)) {
        playByLevel(lvl);
        break;
      }
    }

    // Push browser notification for each new alert (visible only when tab is hidden)
    newAlerts.forEach((a) => pushNotif(a.title, a.message, a.level));
  }, [alerts]);
  const activeDrones = useStore((s) => s.drones.filter((d) => d.status === "tracked"));
  const activeThreats = activeDrones.filter(
    (d) => d.threat === "high" || d.threat === "critical",
  ).length;

  const defcon = (() => {
    const hasCritical = activeDrones.some((d) => d.threat === "critical");
    const hasHigh = activeDrones.some((d) => d.threat === "high");
    const hasMedium = activeDrones.some((d) => d.threat === "medium");
    if (hasCritical) return { level: 2, label: "HIGH ALERT", color: "text-threat" };
    if (hasHigh) return { level: 3, label: "ELEVATED", color: "text-warning" };
    if (hasMedium) return { level: 4, label: "GUARDED", color: "text-info" };
    return { level: 5, label: "NORMAL", color: "text-hud" };
  })();

  useEffect(() => {
    // Seed from localStorage immediately (zero-delay render)
    setStoredUser(getStoredUser());

    // Then fetch fresh user data from the server (picks up avatarUrl and any
    // profile changes made in another tab / session)
    if (sessionStorage.getItem("dds_token")) {
      authApi
        .me()
        .then((user) => {
          const merged = { ...getStoredUser(), ...user };
          localStorage.setItem("dds_user", JSON.stringify(merged));
          setStoredUser(merged);
        })
        .catch(() => {
          /* server unreachable — keep cached data */
        });
    }

    const refresh = () => setStoredUser(getStoredUser());
    window.addEventListener("dds_user_updated", refresh);

    // Request notification permission after a short delay so it feels intentional
    const permTimer = setTimeout(() => {
      requestNotifPermission();
    }, 3000);

    return () => {
      window.removeEventListener("dds_user_updated", refresh);
      clearTimeout(permTimer);
    };
  }, []);

  const astanaDate = now
    ? now.toLocaleDateString("en-GB", {
        timeZone: "Asia/Almaty",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      })
    : "——/——/————";

  const astanaTime = now
    ? now.toLocaleTimeString("en-GB", {
        timeZone: "Asia/Almaty",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      })
    : "——:——:——";

  const displayName = storedUser?.name ?? "Operator";
  const displayInitials = storedUser ? initials(storedUser.name) : "OP";
  const displayRole = storedUser?.role
    ? storedUser.role.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase())
    : "Operator";
  const displayAvatar = storedUser?.avatarUrl ?? null;

  return (
    <div className="flex min-h-screen w-full text-foreground">
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={cn(
          "flex flex-col border-r border-border bg-sidebar/95 backdrop-blur duration-200",
          // Mobile: fixed overlay drawer
          "fixed inset-y-0 left-0 z-50 w-64 transition-transform",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
          // Desktop: static sidebar in flow with width transition
          "md:static md:inset-y-auto md:z-auto md:translate-x-0 md:transition-[width]",
          collapsed ? "md:w-16" : "md:w-64",
        )}
      >
        <div className="flex h-16 items-center gap-3 border-b border-border px-4">
          {/* Mobile close button */}
          <button
            onClick={() => setMobileOpen(false)}
            className="md:hidden mr-1 shrink-0 text-muted-foreground hover:text-hud"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="relative flex h-9 w-9 shrink-0 items-center justify-center text-hud hud-text-glow">
            <svg
              viewBox="0 0 36 36"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="h-9 w-9"
            >
              {/* targeting brackets */}
              <path
                d="M3 9 L3 3 L9 3"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="square"
              />
              <path
                d="M27 3 L33 3 L33 9"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="square"
              />
              <path
                d="M3 27 L3 33 L9 33"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="square"
              />
              <path
                d="M27 33 L33 33 L33 27"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="square"
              />
              {/* crosshair — gap in centre where drone sits */}
              <line
                x1="3"
                y1="18"
                x2="13"
                y2="18"
                stroke="currentColor"
                strokeWidth="0.8"
                strokeDasharray="2 1.5"
                opacity="0.55"
              />
              <line
                x1="23"
                y1="18"
                x2="33"
                y2="18"
                stroke="currentColor"
                strokeWidth="0.8"
                strokeDasharray="2 1.5"
                opacity="0.55"
              />
              <line
                x1="18"
                y1="3"
                x2="18"
                y2="13"
                stroke="currentColor"
                strokeWidth="0.8"
                strokeDasharray="2 1.5"
                opacity="0.55"
              />
              <line
                x1="18"
                y1="23"
                x2="18"
                y2="33"
                stroke="currentColor"
                strokeWidth="0.8"
                strokeDasharray="2 1.5"
                opacity="0.55"
              />
              {/* drone arms */}
              <line
                x1="15.5"
                y1="15.5"
                x2="11"
                y2="11"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
              <line
                x1="20.5"
                y1="15.5"
                x2="25"
                y2="11"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
              <line
                x1="15.5"
                y1="20.5"
                x2="11"
                y2="25"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
              <line
                x1="20.5"
                y1="20.5"
                x2="25"
                y2="25"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
              {/* drone body */}
              <rect x="14.5" y="14.5" width="7" height="7" fill="currentColor" rx="0.5" />
              {/* rotors */}
              <circle cx="10" cy="10" r="2.8" stroke="currentColor" strokeWidth="1.1" fill="none" />
              <circle cx="26" cy="10" r="2.8" stroke="currentColor" strokeWidth="1.1" fill="none" />
              <circle cx="10" cy="26" r="2.8" stroke="currentColor" strokeWidth="1.1" fill="none" />
              <circle cx="26" cy="26" r="2.8" stroke="currentColor" strokeWidth="1.1" fill="none" />
              {/* rotor centre dots */}
              <circle cx="10" cy="10" r="0.8" fill="currentColor" />
              <circle cx="26" cy="10" r="0.8" fill="currentColor" />
              <circle cx="10" cy="26" r="0.8" fill="currentColor" />
              <circle cx="26" cy="26" r="0.8" fill="currentColor" />
            </svg>
            <span className="absolute -bottom-px -right-px h-1.5 w-1.5 bg-hud blink-pulse" />
          </div>
          {!collapsed && (
            <div className="leading-tight">
              <div className="text-sm font-bold tracking-[0.2em] text-hud hud-text-glow">
                SKY GUARDIAN
              </div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Drone Defense
              </div>
            </div>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {GROUPS.map((g) => (
            <div key={g} className="mb-4">
              {!collapsed && (
                <div className="mb-1 px-2 text-[10px] font-bold uppercase tracking-[0.25em] text-muted-foreground">
                  {t(g)}
                </div>
              )}
              {NAV.filter((n) => n.group === g).map((item) => {
                const active = loc.pathname === item.to;
                const Icon = item.icon;
                return (
                  <Link
                    key={item.to as string}
                    to={item.to}
                    className={cn(
                      "group relative flex items-center gap-3 rounded-sm px-2 py-2 text-xs uppercase tracking-wider transition-colors",
                      active
                        ? "bg-hud/10 text-hud hud-text-glow border-l-2 border-hud"
                        : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-hud",
                    )}
                    title={item.label}
                  >
                    <div className="relative shrink-0">
                      <Icon className="h-4 w-4" />
                      {item.to === "/ai-control" && pendingAiCount > 0 && (
                        <span className="absolute -top-1.5 -right-1.5 flex h-3.5 w-3.5 items-center justify-center bg-warning text-[8px] font-bold text-black">
                          {pendingAiCount > 9 ? "9+" : pendingAiCount}
                        </span>
                      )}
                    </div>
                    {!collapsed && <span className="truncate">{t(item.label)}</span>}
                    {!collapsed && item.to === "/ai-control" && pendingAiCount > 0 && (
                      <span className="ml-auto shrink-0 bg-warning px-1 text-[8px] font-bold text-black">
                        {pendingAiCount}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Desktop collapse toggle — hidden on mobile (drawer handles close) */}
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="hidden md:block border-t border-border px-3 py-2 text-left text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:bg-sidebar-accent hover:text-hud"
        >
          {collapsed ? t("›› Expand") : t("‹‹ Collapse")}
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-border bg-panel/80 px-4 md:px-6 backdrop-blur">
          <div className="flex items-center gap-4 md:gap-6">
            {/* Hamburger — mobile only */}
            <button
              onClick={() => setMobileOpen(true)}
              className="md:hidden border border-border p-2 text-muted-foreground hover:text-hud hover:border-hud"
              aria-label="Open navigation"
            >
              <Menu className="h-4 w-4" />
            </button>
            <div>
              <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
                {t("System Status")}
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="h-2 w-2 rounded-full bg-hud blink-pulse" />
                <span className="text-hud hud-text-glow font-bold tracking-widest">
                  {t("OPERATIONAL")}
                </span>
              </div>
            </div>
            <div className="hidden md:block">
              <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
                {t("DEFCON")}
              </div>
              <div className={`hud-stat text-sm font-bold ${defcon.color}`}>
                {defcon.level} — {t(defcon.label)}
              </div>
            </div>
            <div className="hidden lg:block">
              <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
                {t("Active Threats")}
              </div>
              <div
                className={`hud-stat text-sm font-bold ${activeThreats > 0 ? "text-threat" : "text-hud"}`}
              >
                {String(activeThreats).padStart(2, "0")}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-4 md:gap-6">
            {/* Global Search button */}
            <button
              onClick={() => setSearchOpen(true)}
              className="hidden sm:flex items-center gap-2 border border-border/60 bg-panel/40 px-3 py-1.5 text-[10px] uppercase tracking-[0.15em] text-muted-foreground hover:border-hud hover:text-hud"
              title="Search (Ctrl+K)"
            >
              <Search className="h-3 w-3" />
              <span className="hidden md:inline">{t("Search")}</span>
              <kbd className="hidden md:inline border border-border/50 px-1 text-[8px]">Ctrl K</kbd>
            </button>
            <div className="hidden sm:flex items-center gap-1 text-[10px] uppercase tracking-[0.15em]">
              <button
                onClick={() => setLang("en")}
                className={cn(
                  "px-1.5 py-0.5 border",
                  lang === "en"
                    ? "border-hud/50 text-hud"
                    : "border-transparent text-muted-foreground hover:text-hud",
                )}
              >
                EN
              </button>
              <span className="text-muted-foreground/40">|</span>
              <button
                onClick={() => setLang("ru")}
                className={cn(
                  "px-1.5 py-0.5 border",
                  lang === "ru"
                    ? "border-hud/50 text-hud"
                    : "border-transparent text-muted-foreground hover:text-hud",
                )}
              >
                RU
              </button>
            </div>
            {/* Clock — time only on sm, date+time on md+ */}
            <div className="text-right hidden sm:flex sm:flex-col sm:items-end gap-0.5">
              <div className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground leading-none">
                {t("Astana")}
                <span className="hidden md:inline"> (UTC+6)</span>
              </div>
              <div className="hud-stat font-mono text-sm leading-none text-hud tabular-nums">
                {astanaTime}
              </div>
              <div className="hidden md:block text-[9px] font-mono tabular-nums text-muted-foreground leading-none">
                {astanaDate}
              </div>
            </div>
            <button
              onClick={() => {
                const next = toggleMute();
                setMuted(next);
              }}
              className="border border-border p-2 text-muted-foreground hover:text-hud hover:border-hud"
              title={muted ? "Unmute alerts" : "Mute alerts"}
            >
              {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
            <Link
              to="/notifications"
              className="relative border border-border p-2 text-muted-foreground hover:text-hud hover:border-hud"
              title="Notifications"
            >
              <Bell className="h-4 w-4" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center bg-threat text-[9px] font-bold text-destructive-foreground">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </Link>
            <Link
              to="/profile"
              className="flex items-center gap-2 border border-border px-2 py-1 hover:border-hud"
            >
              <div className="relative h-7 w-7 shrink-0 overflow-hidden border border-hud/40 bg-hud/20">
                {displayAvatar ? (
                  <img
                    src={displayAvatar}
                    alt={displayName}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-xs font-bold text-hud">
                    {displayInitials}
                  </span>
                )}
              </div>
              <div className="hidden md:block text-left leading-tight">
                <div className="text-xs">{displayName}</div>
                <div className="text-[9px] uppercase tracking-widest text-muted-foreground">
                  {displayRole}
                </div>
              </div>
            </Link>
            <Link
              to="/profile"
              className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:text-hud"
              title={t("Profile & Logout")}
            >
              <Cog className="inline h-3.5 w-3.5" />
            </Link>
          </div>
        </header>

        <main className="flex-1 overflow-auto">{children}</main>
      </div>

      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
