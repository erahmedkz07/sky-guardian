import { createFileRoute } from "@tanstack/react-router";
import { HudPanel, PageHeader, ThreatBadge } from "@/components/HudPanel";
import {
  Bell,
  BellOff,
  Check,
  ChevronDown,
  Filter,
  Mail,
  MessageSquare,
  Smartphone,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useStore, acknowledgeAllAlerts, acknowledgeAlert } from "@/lib/store";
import type { AlertEvent } from "@/lib/mockData";
import { RelativeTime } from "@/components/RelativeTime";
import { useT } from "@/lib/i18n";
import { telegramApi } from "@/lib/api";

export const Route = createFileRoute("/notifications")({
  component: Notifications,
  head: () => ({ meta: [{ title: "Notifications // DDS" }] }),
});

const CHANNELS_KEY = "dds_channels";

function getDefaultChannels(email: string, tgLinked: boolean) {
  return [
    { id: "email",    label: "Email",        icon: Mail,          enabled: true,     address: email || "—" },
    { id: "sms",      label: "SMS",          icon: Smartphone,    enabled: false,    address: t_("Not configured") },
    { id: "telegram", label: "Telegram",     icon: MessageSquare, enabled: tgLinked, address: "@SkyGuardianDDS_Bot" },
    { id: "push",     label: "Browser Push", icon: Bell,          enabled: true,     address: t_("this device") },
  ];
}

// Simple passthrough for static strings — t() called inside component
function t_(s: string) { return s; }

function loadEnabled(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(CHANNELS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function Notifications() {
  const alerts = useStore((s) => s.alerts);
  const [markingAll, setMarkingAll] = useState(false);
  const [selected, setSelected] = useState<(typeof alerts)[number] | null>(null);
  const [filterKey, setFilterKey] = useState<"all" | "unread" | "critical" | "high">("all");
  const [showFilters, setShowFilters] = useState(false);
  const { t } = useT();

  const storedUser = (() => {
    try { return JSON.parse(localStorage.getItem("dds_user") ?? "null"); } catch { return null; }
  })();
  const userEmail: string = storedUser?.email ?? "";

  const [tgLinked, setTgLinked] = useState(false);
  useEffect(() => {
    telegramApi.status().then((d) => setTgLinked(d.linked)).catch(() => {});
  }, []);

  const [enabledMap, setEnabledMap] = useState<Record<string, boolean>>(loadEnabled);

  const channels = useMemo(() => {
    const base = getDefaultChannels(userEmail, tgLinked);
    return base.map((c) => ({
      ...c,
      enabled: enabledMap[c.id] ?? c.enabled,
      address: t(c.address),
    }));
  }, [userEmail, tgLinked, enabledMap, t]);

  const unread = alerts.filter((a) => !a.acknowledged).length;

  const filteredAlerts = useMemo(() => {
    if (filterKey === "unread") return alerts.filter((a) => !a.acknowledged);
    if (filterKey === "critical") return alerts.filter((a) => a.level === "critical");
    if (filterKey === "high")
      return alerts.filter((a) => a.level === "high" || a.level === "critical");
    return alerts;
  }, [alerts, filterKey]);

  const filterCounts = useMemo(
    () => ({
      all: alerts.length,
      unread: alerts.filter((a) => !a.acknowledged).length,
      critical: alerts.filter((a) => a.level === "critical").length,
      high: alerts.filter((a) => a.level === "high" || a.level === "critical").length,
    }),
    [alerts],
  );

  function toggleChannel(id: string) {
    setEnabledMap((prev) => {
      const currentEnabled = channels.find((c) => c.id === id)?.enabled ?? false;
      const next = { ...prev, [id]: !currentEnabled };
      localStorage.setItem(CHANNELS_KEY, JSON.stringify(next));
      return next;
    });
  }

  async function handleMarkAll() {
    setMarkingAll(true);
    await acknowledgeAllAlerts();
    setMarkingAll(false);
  }

  return (
    <div>
      <PageHeader
        title={t("Notifications")}
        subtitle={t("Inbox · channels · escalation rules")}
        actions={
          <button
            onClick={handleMarkAll}
            disabled={markingAll}
            className="flex items-center gap-2 border border-hud bg-hud/10 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.25em] text-hud hover:bg-hud/20 disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" />
            {markingAll ? t("Marking…") : t("Mark all read")}
          </button>
        }
      />

      <div className="grid gap-3 px-4 py-4 sm:px-6 lg:grid-cols-[2fr_1fr]">
        <HudPanel
          title={t("Inbox")}
          subtitle={
            filterKey === "all"
              ? `${unread} ${t("unread")} · ${alerts.length} ${t("total")}`
              : `${filteredAlerts.length} / ${alerts.length} ${t("shown")}`
          }
          bodyClassName="p-0"
          actions={
            alerts.length > 0 ? (
              <div className="flex items-center gap-2">
                {filterKey !== "all" && (
                  <span className="border border-hud/50 bg-hud/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.15em] text-hud">
                    {t(filterKey)}
                  </span>
                )}
                <button
                  onClick={() => setShowFilters((v) => !v)}
                  className={`flex items-center gap-1 border px-2 py-1 text-[9px] uppercase tracking-[0.15em] transition-colors ${
                    showFilters
                      ? "border-hud bg-hud/10 text-hud"
                      : "border-border/60 text-muted-foreground hover:border-hud hover:text-hud"
                  }`}
                >
                  <Filter className="h-2.5 w-2.5" />
                  {t("Filter")}
                  <ChevronDown
                    className={`h-2.5 w-2.5 transition-transform duration-200 ${showFilters ? "rotate-180" : ""}`}
                  />
                </button>
              </div>
            ) : undefined
          }
        >
          {/* Collapsible filter bar */}
          <div
            className={`grid transition-[grid-template-rows] duration-200 ease-in-out ${showFilters ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
          >
            <div className="overflow-hidden">
              <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-panel/20 px-4 py-2.5">
                {(["all", "unread", "high", "critical"] as const).map((k) => (
                  <button
                    key={k}
                    onClick={() => setFilterKey(k)}
                    className={`border px-2.5 py-1 text-[9px] uppercase tracking-[0.15em] transition-colors ${
                      filterKey === k
                        ? k === "critical"
                          ? "border-threat bg-threat/20 text-threat"
                          : k === "high"
                            ? "border-orange-500/70 bg-orange-500/10 text-orange-400"
                            : "border-hud bg-hud/10 text-hud"
                        : "border-border text-muted-foreground hover:border-hud hover:text-hud"
                    }`}
                  >
                    {t(k)}
                    <span
                      className={`ml-1 border px-1 text-[8px] font-bold ${
                        filterKey === k
                          ? "border-hud/40 text-hud"
                          : "border-border/50 text-muted-foreground"
                      }`}
                    >
                      {filterCounts[k]}
                    </span>
                  </button>
                ))}
                <span className="ml-auto text-[9px] uppercase tracking-[0.15em] text-muted-foreground">
                  {t("Showing")}{" "}
                  <span className="font-bold text-foreground">{filteredAlerts.length}</span> /{" "}
                  {alerts.length}
                </span>
                {filterKey !== "all" && (
                  <button
                    onClick={() => setFilterKey("all")}
                    className="text-[9px] uppercase tracking-[0.15em] text-muted-foreground hover:text-threat"
                  >
                    {t("✕ Clear")}
                  </button>
                )}
              </div>
            </div>
          </div>

          {filteredAlerts.length === 0 && (
            <div className="px-4 py-8 text-center text-xs text-muted-foreground uppercase tracking-[0.2em]">
              {alerts.length === 0
                ? t("No alerts")
                : `${t("No alerts match filter")} "${t(filterKey)}"`}
            </div>
          )}
          {filteredAlerts.map((a) => {
            const read = a.acknowledged;
            return (
              <button
                key={a.id}
                onClick={() => setSelected(a)}
                className={`flex w-full items-start gap-3 border-b border-border/40 px-4 py-3 text-left hover:bg-hud/5 cursor-pointer ${
                  !read ? "bg-hud/[0.03]" : ""
                }`}
              >
                <span
                  className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${!read ? "bg-hud blink-pulse" : "bg-muted"}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <ThreatBadge level={a.level} />
                    <h4 className="truncate text-xs font-bold uppercase tracking-wider">
                      {a.title}
                    </h4>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">{a.message}</p>
                  <div className="mt-1 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                    src: {a.source}
                  </div>
                </div>
                <span className="hud-stat shrink-0 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  <RelativeTime date={a.timestamp} />
                </span>
              </button>
            );
          })}
        </HudPanel>

        <div className="space-y-3">
          <HudPanel title={t("Delivery Channels")} bodyClassName="p-0">
            {channels.map((c) => {
              const Icon = c.icon;
              return (
                <div
                  key={c.id}
                  className="flex items-center justify-between border-b border-border/40 px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <Icon
                      className={`h-4 w-4 ${c.enabled ? "text-hud" : "text-muted-foreground"}`}
                    />
                    <div>
                      <div className="text-xs font-bold uppercase tracking-wider">{c.label}</div>
                      <div className="hud-stat text-[10px] text-muted-foreground">{c.address}</div>
                    </div>
                  </div>
                  <ToggleBtn on={c.enabled} onChange={() => toggleChannel(c.id)} />
                </div>
              );
            })}
          </HudPanel>

          <HudPanel title={t("Escalation Rules")} bodyClassName="p-3 space-y-2 text-[11px]">
            {[
              { sev: "Critical", action: "All channels + on-call pager", tone: "threat" },
              { sev: "High", action: "Email + Push + SMS", tone: "warning" },
              { sev: "Medium", action: "Email + Push", tone: "info" },
              { sev: "Low", action: "Inbox only", tone: "muted" },
            ].map((r) => (
              <div
                key={r.sev}
                className="flex items-center justify-between border border-border/50 px-3 py-2"
              >
                <span
                  className={`text-[10px] font-bold uppercase tracking-[0.2em] ${
                    r.tone === "threat"
                      ? "text-threat"
                      : r.tone === "warning"
                        ? "text-warning"
                        : r.tone === "info"
                          ? "text-info"
                          : "text-muted-foreground"
                  }`}
                >
                  {t(r.sev)}
                </span>
                <span className="text-muted-foreground">{t(r.action)}</span>
              </div>
            ))}
          </HudPanel>
        </div>
      </div>

      {selected && <AlertDetailModal alert={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function AlertDetailModal({ alert: a, onClose }: { alert: AlertEvent; onClose: () => void }) {
  const { t } = useT();
  async function handleAck() {
    await acknowledgeAlert(a.id);
    onClose();
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="w-full max-w-md border border-hud/40 bg-background shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="flex items-center gap-3">
            <ThreatBadge level={a.level} />
            <span className="font-bold tracking-widest text-foreground uppercase text-xs">
              {a.title}
            </span>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-4 p-5">
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              {t("Message")}
            </div>
            <p className="text-sm leading-relaxed">{a.message}</p>
          </div>
          <div className="grid grid-cols-2 gap-4 text-xs">
            <div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                {t("Source")}
              </div>
              <div className="font-bold hud-stat text-hud">{a.source}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                {t("Alert ID")}
              </div>
              <div className="font-bold hud-stat">{a.id}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                {t("Time")}
              </div>
              <div className="hud-stat">
                {new Date(a.timestamp).toLocaleString("ru-KZ", { timeZone: "Asia/Almaty" })}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                {t("Status")}
              </div>
              <div className={`font-bold ${a.acknowledged ? "text-muted-foreground" : "text-hud"}`}>
                {a.acknowledged ? t("READ") : t("UNREAD")}
              </div>
            </div>
          </div>
          <div className="flex gap-2 border-t border-border pt-4">
            <button
              onClick={onClose}
              className="flex-1 border border-border py-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:border-hud hover:text-hud"
            >
              {t("Close")}
            </button>
            {!a.acknowledged && (
              <button
                onClick={handleAck}
                className="flex-1 border border-hud bg-hud/10 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-hud hover:bg-hud/20"
              >
                {t("Mark as Read")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ToggleBtn({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className={`flex h-5 w-10 items-center border px-0.5 transition-colors ${
        on ? "border-hud bg-hud/30" : "border-border bg-muted"
      }`}
    >
      <span
        className={`h-3.5 w-3.5 transition-transform ${on ? "translate-x-5 bg-hud" : "bg-muted-foreground"}`}
      />
      <BellOff className="hidden" />
    </button>
  );
}
