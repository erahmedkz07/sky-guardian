import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, useCallback } from "react";
import { useT } from "@/lib/i18n";
import { HudPanel, PageHeader, ThreatBadge } from "@/components/HudPanel";
import {
  Activity,
  WifiOff,
  ChevronDown,
  Filter,
  Pause,
  Play,
  Trash2,
  Radio,
  AlertTriangle,
  Info,
  Zap,
  ShieldAlert,
} from "lucide-react";
import { getSocket } from "@/lib/socket";
import { auditApi, detectionsApi, type ApiDetection } from "@/lib/api";
import { useStore, acknowledgeAlert } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { AlertEvent } from "@/lib/mockData";

export const Route = createFileRoute("/live-feed")({
  component: LiveFeed,
  head: () => ({ meta: [{ title: "Live Feed // DDS" }] }),
});

// ─── Types ────────────────────────────────────────────────────
type Level = "info" | "warn" | "alert";
type LevelFilter = "all" | Level;

interface FeedEvent {
  id: number;
  time: string;
  source: string;
  level: Level;
  text: string;
}

let _evId = 0;

// ─── Sub-components ───────────────────────────────────────────

function StatBox({
  label,
  value,
  tone,
  blink,
}: {
  label: string;
  value: string | number;
  tone?: "hud" | "warn" | "threat";
  blink?: boolean;
}) {
  const color = tone === "threat" ? "text-threat" : tone === "warn" ? "text-warning" : "text-hud";
  return (
    <div className="border border-border bg-panel/40 px-4 py-3">
      <div className={cn("hud-stat text-2xl font-bold", color, blink && "blink-pulse")}>
        {value}
      </div>
      <div className="mt-0.5 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

function LevelIcon({ level }: { level: Level }) {
  if (level === "alert") return <AlertTriangle className="h-3 w-3 shrink-0 text-threat" />;
  if (level === "warn") return <Zap className="h-3 w-3 shrink-0 text-warning" />;
  return <Info className="h-3 w-3 shrink-0 text-hud/60" />;
}

function EventRow({ e }: { e: FeedEvent }) {
  const row =
    e.level === "alert"
      ? "border-l-threat bg-threat/5 text-threat"
      : e.level === "warn"
        ? "border-l-warning bg-warning/5 text-warning"
        : "border-l-hud/40 text-foreground";
  return (
    <div
      className={cn(
        "flex items-start gap-3 border-l-2 border-b border-border/30 px-4 py-2 text-xs font-mono",
        row,
      )}
    >
      <LevelIcon level={e.level} />
      <span className="w-14 shrink-0 text-[10px] text-muted-foreground sm:w-[72px]">{e.time}</span>
      <span className="w-16 shrink-0 truncate text-[10px] uppercase tracking-[0.12em] opacity-80 sm:w-20">
        {e.source}
      </span>
      <span className="flex-1 leading-relaxed">{e.text}</span>
      <span
        className={cn(
          "shrink-0 border px-1.5 py-0.5 text-[9px] uppercase tracking-widest",
          e.level === "alert"
            ? "border-threat/50 text-threat"
            : e.level === "warn"
              ? "border-warning/50 text-warning"
              : "border-hud/30 text-hud/60",
        )}
      >
        {e.level}
      </span>
    </div>
  );
}

function DetectionRow({ d }: { d: ApiDetection }) {
  const pct = Math.round(d.confidence * 100);
  return (
    <div className="border-b border-border/30 px-4 py-2.5 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold tracking-widest text-foreground">{d.callsign}</span>
        <ThreatBadge level={d.threat} />
      </div>
      <div className="mt-1 flex items-center gap-2">
        <div className="h-1 flex-1 bg-muted/40">
          <div
            className={cn(
              "h-full",
              d.threat === "critical" ? "bg-threat" : d.threat === "high" ? "bg-warning" : "bg-hud",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="w-9 shrink-0 text-right text-[10px] text-muted-foreground">{pct}%</span>
      </div>
      <div className="mt-0.5 text-[10px] text-muted-foreground">
        {d.sensorName} ·{" "}
        {new Date(d.timestamp).toLocaleTimeString("ru-KZ", {
          timeZone: "Asia/Almaty",
          hour12: false,
        })}
      </div>
    </div>
  );
}

function AlertRow({ a, onAck }: { a: AlertEvent; onAck: (id: string) => void }) {
  const { t } = useT();
  const color =
    a.level === "critical" || a.level === "high"
      ? "text-threat border-threat/40 bg-threat/5"
      : a.level === "medium"
        ? "text-warning border-warning/40 bg-warning/5"
        : "text-hud/80 border-border";
  return (
    <div
      className={cn(
        "border-b border-border/30 px-4 py-2.5 text-xs",
        a.acknowledged && "opacity-40",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <span className={cn("font-bold tracking-wide", color.split(" ")[0])}>{a.title}</span>
          <p className="mt-0.5 text-[10px] text-muted-foreground leading-snug line-clamp-2">
            {a.message}
          </p>
        </div>
        {!a.acknowledged && (
          <button
            onClick={() => onAck(a.id)}
            className="shrink-0 border border-border px-2 py-0.5 text-[9px] uppercase tracking-widest text-muted-foreground hover:border-hud hover:text-hud"
          >
            {t("ACK")}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────
function LiveFeed() {
  const { t } = useT();
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [paused, setPaused] = useState(false);
  const [levelFilter, setLevelFilter] = useState<LevelFilter>("all");
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [detections, setDetections] = useState<ApiDetection[]>([]);
  const alerts = useStore((s) => s.alerts);
  const [evPerMin, setEvPerMin] = useState(0);

  const bottomRef = useRef<HTMLDivElement>(null);
  const pauseRef = useRef(false);
  const minuteQueue = useRef<number[]>([]);

  const drones = useStore((s) => s.drones);
  const activeTracks = drones.filter((d) => d.status === "tracked").length;
  const criticalCount = drones.filter((d) => d.threat === "critical").length;
  const warnCount = events.filter((e) => e.level === "warn").length;
  const alertCount = events.filter((e) => e.level === "alert").length;

  // ── Load initial data ─────────────────────────────────────
  useEffect(() => {
    auditApi
      .list(50)
      .then((rows) => {
        const historic: FeedEvent[] = rows.map((r) => ({
          id: --_evId,
          time: new Date(r.timestamp).toLocaleTimeString("ru-KZ", {
            timeZone: "Asia/Almaty",
            hour12: false,
          }),
          source: r.resource?.toUpperCase().slice(0, 10) ?? "SYS",
          level:
            r.action.includes("FAIL") || r.action.includes("DENY")
              ? "alert"
              : r.action.includes("WARN") || r.action.includes("DISABLE")
                ? "warn"
                : "info",
          text: `${r.action}${r.resourceId ? ` · ${r.resourceId}` : ""}${r.operatorName ? ` [${r.operatorName}]` : ""}`,
        }));
        setEvents(historic);
      })
      .catch(() => {});

    detectionsApi
      .list(10)
      .then(setDetections)
      .catch(() => {});
  }, []);

  // ── Events/min counter ────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      minuteQueue.current = minuteQueue.current.filter((t) => now - t < 60_000);
      setEvPerMin(minuteQueue.current.length);
    }, 3000);
    return () => clearInterval(id);
  }, []);

  // ── WebSocket ─────────────────────────────────────────────
  useEffect(() => {
    const socket = getSocket();

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onEvent = (ev: FeedEvent) => {
      minuteQueue.current.push(Date.now());
      if (pauseRef.current) return;
      setEvents((prev) => [ev, ...prev].slice(0, 200));
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("feed:event", onEvent);
    if (socket.connected) setConnected(true);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("feed:event", onEvent);
    };
  }, []);

  // keep pauseRef in sync without re-registering socket listeners
  useEffect(() => {
    pauseRef.current = paused;
  }, [paused]);

  const handleAck = useCallback((id: string) => {
    acknowledgeAlert(id).catch(() => {});
  }, []);

  const clearFeed = () => setEvents([]);

  // ── Filtered events ───────────────────────────────────────
  const filtered = events.filter((e) => {
    if (levelFilter !== "all" && e.level !== levelFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return e.source.toLowerCase().includes(q) || e.text.toLowerCase().includes(q);
    }
    return true;
  });

  const unackedAlerts = alerts.filter((a) => !a.acknowledged);

  return (
    <div>
      <PageHeader
        title={t("Live Operations Feed")}
        subtitle={t("Real-time event stream · detections · active alerts")}
        actions={
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em]">
            {connected ? (
              <>
                <Radio className="h-3.5 w-3.5 blink-pulse text-hud" />
                <span className="text-hud">{t("Streaming")}</span>
              </>
            ) : (
              <>
                <WifiOff className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">{t("Offline")}</span>
              </>
            )}
          </div>
        }
      />

      <div className="space-y-4 px-4 py-4 sm:px-6">
        {/* ── Stats row ─────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatBox label={t("Active Tracks")} value={activeTracks} tone="hud" />
          <StatBox
            label={t("Critical Threats")}
            value={criticalCount}
            tone="threat"
            blink={criticalCount > 0}
          />
          <StatBox
            label={t("Alerts / Warnings")}
            value={`${alertCount} / ${warnCount}`}
            tone="warn"
          />
          <StatBox label={t("Events / Min")} value={evPerMin} tone="hud" />
        </div>

        {/* ── Main two-column layout ─────────────────────── */}
        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          {/* ── Event stream ──────────────────────────────── */}
          <HudPanel
            title={t("Event Stream")}
            subtitle={`${filtered.length} ${t("events shown")}`}
            actions={
              <div className="flex items-center gap-1.5">
                {(levelFilter !== "all" || search) && (
                  <span className="border border-hud/50 bg-hud/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.15em] text-hud">
                    {levelFilter !== "all" ? levelFilter : "search"}
                  </span>
                )}
                <button
                  onClick={() => setShowFilters((v) => !v)}
                  className={cn(
                    "flex items-center gap-1 border px-2 py-1 text-[9px] uppercase tracking-[0.15em] transition-colors",
                    showFilters
                      ? "border-hud bg-hud/10 text-hud"
                      : "border-border/60 text-muted-foreground hover:border-hud hover:text-hud",
                  )}
                >
                  <Filter className="h-2.5 w-2.5" />
                  {t("Filter")}
                  <ChevronDown
                    className={cn(
                      "h-2.5 w-2.5 transition-transform duration-200",
                      showFilters && "rotate-180",
                    )}
                  />
                </button>
                <button
                  onClick={() => setPaused((p) => !p)}
                  title={paused ? "Resume" : "Pause"}
                  className={cn(
                    "border px-2 py-1 text-[9px] uppercase tracking-widest",
                    paused
                      ? "border-warning text-warning hover:bg-warning/10"
                      : "border-border text-muted-foreground hover:border-hud hover:text-hud",
                  )}
                >
                  {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
                </button>
                <button
                  onClick={clearFeed}
                  title="Clear"
                  className="border border-border px-2 py-1 text-[9px] text-muted-foreground hover:border-threat hover:text-threat"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            }
            bodyClassName="p-0 flex flex-col"
          >
            {/* Collapsible filter bar */}
            <div
              className={`grid transition-[grid-template-rows] duration-200 ease-in-out ${showFilters ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
            >
              <div className="overflow-hidden">
                <div className="flex flex-wrap items-center gap-2 border-b border-border bg-panel/20 px-4 py-2.5">
                  {(["all", "info", "warn", "alert"] as LevelFilter[]).map((lv) => (
                    <button
                      key={lv}
                      onClick={() => setLevelFilter(lv)}
                      className={cn(
                        "border px-2.5 py-1 text-[9px] uppercase tracking-[0.15em] transition-colors",
                        levelFilter === lv
                          ? lv === "alert"
                            ? "border-threat bg-threat/20 text-threat"
                            : lv === "warn"
                              ? "border-warning bg-warning/10 text-warning"
                              : "border-hud bg-hud/10 text-hud"
                          : "border-border text-muted-foreground hover:border-hud hover:text-hud",
                      )}
                    >
                      {t(lv)}
                      <span
                        className={cn(
                          "ml-1 border px-1 text-[8px] font-bold",
                          levelFilter === lv
                            ? "border-hud/40 text-hud"
                            : "border-border/50 text-muted-foreground",
                        )}
                      >
                        {lv === "all"
                          ? events.length
                          : lv === "alert"
                            ? alertCount
                            : lv === "warn"
                              ? warnCount
                              : events.filter((e) => e.level === lv).length}
                      </span>
                    </button>
                  ))}
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t("Search source / text…")}
                    className="ml-2 w-44 border border-border bg-transparent px-2 py-1 text-[11px] text-foreground placeholder:text-muted-foreground focus:border-hud focus:outline-none"
                  />
                  <span className="ml-auto text-[9px] uppercase tracking-[0.15em] text-muted-foreground">
                    {t("Showing")}{" "}
                    <span className="font-bold text-foreground">{filtered.length}</span> /{" "}
                    {events.length}
                  </span>
                  {(levelFilter !== "all" || search) && (
                    <button
                      onClick={() => {
                        setLevelFilter("all");
                        setSearch("");
                      }}
                      className="text-[9px] uppercase tracking-[0.15em] text-muted-foreground hover:text-threat"
                    >
                      {t("✕ Clear")}
                    </button>
                  )}
                  {paused && (
                    <span className="border border-warning/50 bg-warning/10 px-2 py-0.5 text-[9px] uppercase tracking-widest text-warning">
                      {t("Paused")}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Events list */}
            <div className="max-h-[58vh] overflow-auto font-mono">
              {filtered.length === 0 && (
                <div className="px-4 py-10 text-center text-xs text-muted-foreground">
                  {connected ? t("Waiting for events…") : t("Not connected to server")}
                </div>
              )}
              {filtered.map((e) => (
                <EventRow key={e.id} e={e} />
              ))}
              <div ref={bottomRef} />
            </div>
          </HudPanel>

          {/* ── Right column ───────────────────────────────── */}
          <div className="flex flex-col gap-4">
            {/* Recent Detections */}
            <HudPanel
              title={t("Recent Detections")}
              subtitle={`${detections.length} ${t("latest contacts")}`}
              actions={<ShieldAlert className="h-4 w-4 text-hud" />}
              bodyClassName="p-0 max-h-64 overflow-auto"
            >
              {detections.length === 0 ? (
                <div className="px-4 py-6 text-center text-xs text-muted-foreground">
                  {t("No detections")}
                </div>
              ) : (
                detections.slice(0, 8).map((d) => <DetectionRow key={d.id} d={d} />)
              )}
            </HudPanel>

            {/* Active Alerts */}
            <HudPanel
              title={t("Active Alerts")}
              subtitle={`${unackedAlerts.length} ${t("unacknowledged")}`}
              actions={
                unackedAlerts.length > 0 ? (
                  <span className="border border-threat/50 bg-threat/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-threat blink-pulse">
                    {unackedAlerts.length}
                  </span>
                ) : (
                  <Activity className="h-4 w-4 text-hud" />
                )
              }
              bodyClassName="p-0 max-h-72 overflow-auto"
            >
              {alerts.length === 0 ? (
                <div className="px-4 py-6 text-center text-xs text-muted-foreground">
                  {t("No active alerts")}
                </div>
              ) : (
                alerts.map((a) => <AlertRow key={a.id} a={a} onAck={handleAck} />)
              )}
            </HudPanel>
          </div>
        </div>
      </div>
    </div>
  );
}
