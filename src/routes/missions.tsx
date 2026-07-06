import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useT } from "@/lib/i18n";
import { useStore } from "@/lib/store";
import { HudPanel, PageHeader, ThreatBadge } from "@/components/HudPanel";
import {
  Filter,
  Search,
  RefreshCw,
  ChevronRight,
  ChevronDown,
  MapPin,
  Cpu,
  Clock,
  FileWarning,
  Radio,
  Target,
  Crosshair,
  LockOpen,
  BellOff,
  Trash2,
  ShieldAlert,
  ShieldOff,
  AlertTriangle,
  Zap,
  Plus,
  Lock,
} from "lucide-react";
import { format } from "date-fns";
import { missionsApi, auditApi, type ApiMission, type ApiAuditLog } from "@/lib/api";

export const Route = createFileRoute("/missions")({
  component: MissionLogs,
  head: () => ({ meta: [{ title: "Mission Logs // DDS" }] }),
});

type Tab = "events" | "missions" | "incidents";

// FSM: planned ⇄ active ⇄ completed (reopenable)
//              planned ⇄ aborted (can be replanned)
const STATUS_TRANSITIONS: Record<string, Array<{ next: string; label: string; danger?: boolean }>> = {
  planned:   [{ next: "active",    label: "Активировать →" }],
  active:    [{ next: "completed", label: "Архивировать →" }, { next: "aborted", label: "Прервать", danger: true }],
  completed: [{ next: "active",    label: "Переоткрыть →" }],
  aborted:   [{ next: "planned",   label: "Перепланировать →" }],
};

const STATUS_COLOR: Record<string, string> = {
  planned:   "border-info/50 bg-info/10 text-info",
  active:    "border-hud/50 bg-hud/10 text-hud",
  completed: "border-border/60 bg-muted/20 text-muted-foreground",
  aborted:   "border-threat/50 bg-threat/10 text-threat",
};

const STATUS_LABEL_RU: Record<string, string> = {
  planned:   "Запланирована",
  active:    "Активна",
  completed: "Завершена",
  aborted:   "Прервана",
};

const PRIORITY_COLOR: Record<string, string> = {
  low: "text-muted-foreground",
  medium: "text-info",
  high: "text-warning",
  critical: "text-threat",
};

function MissionLogs() {
  const { t } = useT();
  const [tab, setTab] = useState<Tab>("events");

  return (
    <div>
      <PageHeader
        title={t("Mission Logs")}
        subtitle={t("Detection ledger · active missions · field operations")}
      />

      {/* Tab switcher */}
      <div className="flex gap-0.5 overflow-x-auto border-b border-border px-3 sm:gap-1 sm:px-6">
        {(
          [
            { key: "events",    label: t("Event Log") },
            { key: "missions",  label: t("Active Missions") },
            { key: "incidents", label: t("Incident Log") },
          ] as const
        ).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`shrink-0 border-b-2 px-3 py-2 text-[9px] uppercase tracking-[0.2em] transition-colors sm:px-4 sm:text-[10px] sm:tracking-[0.25em] ${
              tab === key
                ? "border-hud text-hud"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "events" ? (
        <EventLog />
      ) : tab === "missions" ? (
        <MissionsTable />
      ) : (
        <IncidentLog />
      )}
    </div>
  );
}

// ─── Event type metadata ──────────────────────────────────────
type EventMeta = { label: string; icon: React.ElementType; color: string; badge: string };

const EVENT_META: Record<string, EventMeta> = {
  DETECTION_RECEIVED:       { label: "Обнаружение",       icon: Radio,       color: "text-threat",            badge: "border-threat/50 bg-threat/10 text-threat" },
  DRONE_STATUS_CHANGED:     { label: "Статус дрона",      icon: Target,      color: "text-warning",           badge: "border-warning/40 bg-warning/10 text-warning" },
  TARGET_LOCK_ACQUIRED:     { label: "Захват цели",       icon: Crosshair,   color: "text-hud",               badge: "border-hud/50 bg-hud/10 text-hud" },
  TARGET_LOCK_RELEASED:     { label: "Снятие захвата",    icon: LockOpen,    color: "text-muted-foreground",  badge: "border-border text-muted-foreground" },
  ALARMS_SILENCED:          { label: "Тревога отключена", icon: BellOff,     color: "text-info",              badge: "border-info/40 bg-info/10 text-info" },
  DRONE_REMOVED_FROM_MAP:   { label: "Удаление дрона",   icon: Trash2,      color: "text-threat",            badge: "border-threat/50 bg-threat/10 text-threat" },
  AUTO_RESPONSE_ENGAGED:    { label: "Авто-ответ ВКЛ",   icon: ShieldAlert, color: "text-threat",            badge: "border-threat bg-threat/20 text-threat" },
  AUTO_RESPONSE_DISENGAGED: { label: "Авто-ответ ВЫКЛ",  icon: ShieldOff,   color: "text-muted-foreground",  badge: "border-border text-muted-foreground" },
  MISSION_UPDATE:           { label: "Статус миссии",    icon: RefreshCw,   color: "text-hud",               badge: "border-hud/40 bg-hud/10 text-hud" },
  MISSION_CREATED:          { label: "Миссия создана",   icon: Plus,        color: "text-hud",               badge: "border-hud/40 bg-hud/10 text-hud" },
  INCIDENT_CREATED:         { label: "Инцидент создан",  icon: AlertTriangle, color: "text-threat",          badge: "border-threat/50 bg-threat/10 text-threat" },
  INCIDENT_UPDATED:         { label: "Инцидент обновлён",icon: FileWarning, color: "text-warning",           badge: "border-warning/40 bg-warning/10 text-warning" },
};
const EVENT_META_DEFAULT: EventMeta = {
  label: "Событие", icon: Zap, color: "text-muted-foreground", badge: "border-border text-muted-foreground",
};

// Quick-filter presets shown in the filter bar
const EVENT_FILTER_PRESETS = [
  "all",
  "DETECTION_RECEIVED",
  "DRONE_STATUS_CHANGED",
  "INCIDENT_CREATED",
  "AUTO_RESPONSE_ENGAGED",
] as const;

const DETAIL_LABELS: Record<string, string> = {
  callsign:          "Позывной",
  model:             "Модель",
  threat:            "Угроза",
  confidence:        "Уверенность",
  sensorName:        "Сенсор",
  sensorId:          "ИД сенсора",
  note:              "Примечание",
  playbooksTriggered:"Плейбуков",
  name:              "Название",
  from:              "Из",
  to:                "В",
  status:            "Статус",
  assignee:          "Исполнитель",
  priority:          "Приоритет",
  scenario:          "Сценарий",
  threats:           "Угроз",
  difficulty:        "Сложность",
  elapsed:           "Время",
  score:             "Счёт",
  neutralized:       "Нейтрализовано",
  msg:               "Сообщение",
  lat:               "Широта",
  lng:               "Долгота",
  altitude:          "Высота",
  speed:             "Скорость",
  heading:           "Курс",
  freq:              "Частота",
};

const THREAT_LABELS: Record<string, string> = {
  low: "низкая", medium: "средняя", high: "высокая", critical: "критическая"
};

function humanizeValue(key: string, val: unknown): string {
  if (key === "confidence") return `${(Number(val) * 100).toFixed(0)}%`;
  if (key === "threat") return THREAT_LABELS[String(val)] ?? String(val);
  if (key === "elapsed") return typeof val === "number" ? `${Math.floor(Number(val)/60)}м ${Number(val)%60}с` : String(val);
  if (key === "lat" || key === "lng") return Number(val).toFixed(5);
  return String(val);
}

function formatDetails(d: Record<string, unknown>): string {
  const parts: string[] = [];
  if (d.callsign)   parts.push(String(d.callsign));
  if (d.model)      parts.push(String(d.model));
  if (d.from && d.to) parts.push(`${d.from} → ${d.to}`);
  else if (d.status) parts.push(`статус: ${THREAT_LABELS[String(d.status)] ?? String(d.status)}`);
  if (d.threat)     parts.push(`угроза: ${humanizeValue("threat", d.threat)}`);
  if (d.confidence != null) parts.push(`уверен.: ${humanizeValue("confidence", d.confidence)}`);
  if (d.sensorName) parts.push(`сенсор: ${d.sensorName}`);
  if (d.name)       parts.push(String(d.name));
  if (d.scenario)   parts.push(String(d.scenario));
  if (d.msg)        parts.push(String(d.msg).slice(0, 80));
  if (d.note)       parts.push(`прим.: ${d.note}`);
  if (d.playbooksTriggered != null) parts.push(`плейбуков запущено: ${d.playbooksTriggered}`);
  if (d.score != null) parts.push(`счёт: ${d.score}`);
  if (parts.length) return parts.join(" · ");
  // fallback: readable key=value pairs instead of raw JSON
  return Object.entries(d)
    .slice(0, 5)
    .map(([k, v]) => `${DETAIL_LABELS[k] ?? k}: ${humanizeValue(k, v)}`)
    .join(" · ");
}

// ─── Tab 1: Event Log ─────────────────────────────────────────
function EventLog() {
  const { t } = useT();
  const [events, setEvents] = useState<ApiAuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [showFilters, setShowFilters] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      setEvents(await auditApi.list(300));
    } catch { /* ignore */ }
    setLoading(false);
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, []);

  const filtered = useMemo(
    () =>
      events.filter((ev) => {
        if (typeFilter !== "all" && ev.action !== typeFilter) return false;
        if (q) {
          const search = `${ev.action} ${ev.operatorName ?? ""} ${ev.resource ?? ""} ${ev.resourceId ?? ""} ${JSON.stringify(ev.details ?? {})}`.toLowerCase();
          if (!search.includes(q.toLowerCase())) return false;
        }
        return true;
      }),
    [events, q, typeFilter],
  );

  return (
    <div className="px-4 py-3 sm:px-6 sm:py-4">
      <HudPanel
        title={t("Event Log")}
        subtitle={
          loading && !events.length
            ? t("Loading…")
            : `${filtered.length} ${t("of")} ${events.length} ${t("events")}`
        }
        bodyClassName="p-0"
        actions={
          <div className="flex items-center gap-2">
            {typeFilter !== "all" && (
              <span className="border border-hud/50 bg-hud/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.15em] text-hud">
                {(EVENT_META[typeFilter] ?? EVENT_META_DEFAULT).label}
              </span>
            )}
            <button
              onClick={() => setShowFilters((v) => !v)}
              className={`flex items-center gap-1.5 border px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] transition-colors ${
                showFilters
                  ? "border-hud bg-hud/10 text-hud"
                  : "border-border text-muted-foreground hover:border-hud hover:text-hud"
              }`}
            >
              <Filter className="h-3 w-3" />
              {t("Filter")}
              <ChevronDown className={`h-3 w-3 transition-transform duration-200 ${showFilters ? "rotate-180" : ""}`} />
            </button>
            <button
              onClick={load}
              disabled={loading}
              className="flex items-center gap-1 border border-border px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:border-hud hover:text-hud disabled:opacity-40"
            >
              <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        }
      >
        {/* ── Collapsible filter panel ──────────────────── */}
        <div className={`grid transition-[grid-template-rows] duration-200 ease-in-out ${showFilters ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
          <div className="overflow-hidden">
            <div className="space-y-2.5 border-b border-border bg-panel/20 px-4 py-3">
              {/* Search */}
              <div className="flex items-center gap-2 border border-border bg-input/20 px-3 py-1.5 focus-within:border-hud w-full max-w-sm">
                <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={t("Search events…")}
                  className="flex-1 bg-transparent text-[11px] text-foreground placeholder:text-muted-foreground outline-none"
                />
                {q && (
                  <button onClick={() => setQ("")} className="text-[10px] text-muted-foreground hover:text-foreground">
                    ✕
                  </button>
                )}
              </div>
              {/* Type filter */}
              <div className="flex flex-wrap items-center gap-1.5">
                <Filter className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                {EVENT_FILTER_PRESETS.map((type) => {
                  const meta = EVENT_META[type] ?? EVENT_META_DEFAULT;
                  const count = type === "all" ? events.length : events.filter((e) => e.action === type).length;
                  return (
                    <button
                      key={type}
                      onClick={() => { setTypeFilter(type); setShowFilters(false); }}
                      className={`flex items-center gap-1.5 border px-2.5 py-1 text-[10px] uppercase tracking-[0.15em] transition-colors ${
                        typeFilter === type
                          ? "border-hud bg-hud/10 text-hud"
                          : "border-border text-muted-foreground hover:border-hud/60 hover:text-hud"
                      }`}
                    >
                      {type === "all" ? t("All") : meta.label}
                      <span className={`border px-1 py-0.5 text-[9px] font-bold ${typeFilter === type ? "border-hud/40 text-hud" : "border-border text-muted-foreground"}`}>
                        {count}
                      </span>
                    </button>
                  );
                })}
                {typeFilter !== "all" && (
                  <button
                    onClick={() => { setTypeFilter("all"); setShowFilters(false); }}
                    className="ml-auto text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:text-threat"
                  >
                    ✕ Clear
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Event feed */}
        <div className="divide-y divide-border/30 max-h-[600px] overflow-y-auto">
          {loading && !events.length && (
            <div className="py-10 text-center text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
              {t("Loading…")}
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="py-10 text-center text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
              {t("No events")}
            </div>
          )}
          {filtered.map((ev) => {
            const meta = EVENT_META[ev.action] ?? EVENT_META_DEFAULT;
            const Icon = meta.icon;
            const isOpen = expanded === ev.id;
            const details = ev.details as Record<string, unknown> | null;
            return (
              <div key={ev.id}>
                <div
                  onClick={() => setExpanded((p) => (p === ev.id ? null : ev.id))}
                  className={`flex cursor-pointer items-start gap-3 px-4 py-2.5 transition-colors hover:bg-hud/5 ${isOpen ? "bg-hud/[0.04]" : ""}`}
                >
                  <div className="mt-0.5 shrink-0">
                    <Icon className={`h-3.5 w-3.5 ${meta.color}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={`border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.1em] ${meta.badge}`}>
                        {meta.label}
                      </span>
                      {ev.resourceId && (
                        <span className="font-mono text-[9px] text-hud">{ev.resourceId}</span>
                      )}
                      {ev.operatorName && (
                        <span className="text-[9px] text-muted-foreground">· {ev.operatorName}</span>
                      )}
                    </div>
                    {details && (
                      <p className="mt-0.5 truncate text-[11px] leading-snug text-foreground/70">
                        {formatDetails(details)}
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
                    {format(new Date(ev.timestamp), "MM-dd HH:mm:ss")}
                  </span>
                </div>
                {isOpen && details && (
                  <div className="border-t border-border/20 bg-hud/[0.02] px-6 py-3">
                    <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3">
                      {Object.entries(details)
                        .filter(([, v]) => v !== null && v !== undefined && String(v).length < 120)
                        .map(([k, v]) => (
                          <div key={k} className="flex justify-between gap-2">
                            <span className="shrink-0 text-[9px] uppercase tracking-[0.15em] text-muted-foreground">
                              {DETAIL_LABELS[k] ?? k}
                            </span>
                            <span className="text-right font-mono text-[10px] text-foreground/85 truncate">
                              {humanizeValue(k, v)}
                            </span>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </HudPanel>
    </div>
  );
}

// ─── Tab 2: Active Missions ───────────────────────────────────
function MissionsTable() {
  const { t } = useT();
  const [missions, setMissions] = useState<ApiMission[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string | null>(null);
  const [confirmAbort, setConfirmAbort] = useState<string | null>(null);
  const [transitionError, setTransitionError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setMissions(await missionsApi.list());
    } catch {
      /* ignore */
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleTransition(m: ApiMission, nextStatus: string) {
    if (pending) return;
    setPending(m.id + nextStatus);
    setTransitionError(null);
    try {
      const updated = await missionsApi.patch(m.id, { status: nextStatus });
      setMissions((prev) => prev.map((x) => (x.id === m.id ? updated : x)));
    } catch (err) {
      setTransitionError(err instanceof Error ? err.message : "Ошибка при изменении статуса миссии");
      setTimeout(() => setTransitionError(null), 5000);
    }
    setPending(null);
  }

  const counts = {
    active: missions.filter((m) => m.status === "active").length,
    planned: missions.filter((m) => m.status === "planned").length,
    completed: missions.filter((m) => m.status === "completed").length,
    aborted: missions.filter((m) => m.status === "aborted").length,
  };

  const filtered =
    statusFilter === "all" ? missions : missions.filter((m) => m.status === statusFilter);

  const FILTER_OPTIONS = [
    { value: "all", label: "All", count: missions.length },
    { value: "active", label: "Active", count: counts.active },
    { value: "planned", label: "Planned", count: counts.planned },
    { value: "completed", label: "Completed", count: counts.completed },
    { value: "aborted", label: "Aborted", count: counts.aborted },
  ] as const;

  const activeLabel = FILTER_OPTIONS.find((o) => o.value === statusFilter)?.label ?? "All";

  return (
    <div className="px-4 py-3 sm:px-6 sm:py-4">
      <HudPanel
        title={t("Field Missions")}
        subtitle={loading ? t("Loading…") : `${filtered.length} ${t("of")} ${missions.length} ${t("missions")}`}
        bodyClassName="p-0"
        actions={
          <div className="flex items-center gap-2">
            {/* Active filter badge — always visible */}
            {statusFilter !== "all" && (
              <span className="border border-hud/50 bg-hud/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.15em] text-hud">
                {activeLabel}
              </span>
            )}

            {/* Filter toggle */}
            <button
              onClick={() => setShowFilters((v) => !v)}
              className={`flex items-center gap-1.5 border px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] transition-colors ${
                showFilters
                  ? "border-hud bg-hud/10 text-hud"
                  : "border-border text-muted-foreground hover:border-hud hover:text-hud"
              }`}
            >
              <Filter className="h-3 w-3" />
              {t("Filter")}
              <ChevronDown
                className={`h-3 w-3 transition-transform duration-200 ${showFilters ? "rotate-180" : ""}`}
              />
            </button>

            {/* Refresh */}
            <button
              onClick={load}
              disabled={loading}
              className="flex items-center gap-1 border border-border px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:border-hud hover:text-hud disabled:opacity-40"
            >
              <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        }
      >
        {/* ── Transition error banner ───────────────────── */}
        {transitionError && (
          <div className="flex items-center justify-between gap-3 border-b border-threat/40 bg-threat/10 px-4 py-2 text-xs text-threat">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {transitionError}
            </div>
            <button onClick={() => setTransitionError(null)} className="text-threat/60 hover:text-threat">✕</button>
          </div>
        )}

        {/* ── Collapsible filter panel ──────────────────── */}
        <div
          className={`grid transition-[grid-template-rows] duration-200 ease-in-out ${showFilters ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
        >
          <div className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 border-b border-border bg-panel/20 px-4 py-3">
              {FILTER_OPTIONS.map(({ value, label, count }) => (
                <button
                  key={value}
                  onClick={() => {
                    setStatusFilter(value);
                    setShowFilters(false);
                  }}
                  className={`flex items-center gap-1.5 border px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] transition-colors ${
                    statusFilter === value
                      ? "border-hud bg-hud/10 text-hud"
                      : "border-border text-muted-foreground hover:border-hud hover:text-hud"
                  }`}
                >
                  {label}
                  <span
                    className={`border px-1 py-0.5 text-[9px] font-bold ${
                      statusFilter === value
                        ? "border-hud/40 text-hud"
                        : "border-border text-muted-foreground"
                    }`}
                  >
                    {count}
                  </span>
                </button>
              ))}
              {statusFilter !== "all" && (
                <button
                  onClick={() => {
                    setStatusFilter("all");
                    setShowFilters(false);
                  }}
                  className="ml-auto text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:text-threat"
                >
                  ✕ Clear
                </button>
              )}
            </div>
          </div>
        </div>
        {/* ── Mobile card view (hidden on sm+) ─────────── */}
        <div className="sm:hidden divide-y divide-border/30">
          {loading && (
            <div className="py-10 text-center text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
              {t("Loading…")}
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="py-10 text-center text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
              {t("No missions match filter")}
            </div>
          )}
          {!loading && filtered.map((m) => (
            <div key={m.id} className="px-4 py-3">
              {/* Row 1: Code + Priority + Status */}
              <div className="flex items-center justify-between gap-2">
                <span className="hud-stat font-mono text-[11px] text-hud">{m.code}</span>
                <div className="flex items-center gap-1.5">
                  <span className={`text-[9px] font-bold uppercase tracking-[0.1em] ${PRIORITY_COLOR[m.priority] ?? ""}`}>
                    {m.priority}
                  </span>
                  <span className={`inline-block border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] ${STATUS_COLOR[m.status] ?? ""}`}>
                    {STATUS_LABEL_RU[m.status] ?? m.status}
                  </span>
                </div>
              </div>
              {/* Row 2: Mission name */}
              <div className="mt-1 font-bold text-xs leading-snug">{m.name}</div>
              {/* Row 3: Assignee + Date */}
              <div className="mt-0.5 flex items-center justify-between text-[10px] text-muted-foreground">
                <span>{m.assignee ?? "—"}</span>
                <span>{m.createdAt ? format(new Date(m.createdAt), "MM-dd HH:mm") : "—"}</span>
              </div>
              {/* Row 4: Action buttons */}
              {confirmAbort === m.id ? (
                <div className="mt-2 flex items-center gap-2 border border-threat/40 bg-threat/5 px-3 py-2">
                  <span className="text-[9px] text-threat uppercase tracking-[0.1em]">Подтвердить?</span>
                  <button
                    onClick={() => { handleTransition(m, "aborted"); setConfirmAbort(null); }}
                    className="border border-threat bg-threat/15 px-2 py-0.5 text-[9px] text-threat hover:bg-threat/25"
                  >Да</button>
                  <button
                    onClick={() => setConfirmAbort(null)}
                    className="border border-border px-2 py-0.5 text-[9px] text-muted-foreground"
                  >Нет</button>
                </div>
              ) : (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(STATUS_TRANSITIONS[m.status] ?? []).map((tr) => (
                    <button
                      key={tr.next}
                      disabled={!!pending}
                      onClick={() => tr.danger ? setConfirmAbort(m.id) : handleTransition(m, tr.next)}
                      className={`flex items-center gap-1 border px-2.5 py-1.5 text-[10px] uppercase tracking-[0.12em] disabled:opacity-30 ${
                        tr.danger
                          ? "border-threat/50 text-threat hover:bg-threat/10"
                          : "border-border text-muted-foreground hover:border-hud hover:text-hud"
                      }`}
                    >
                      <ChevronRight className="h-3 w-3" />
                      {pending?.startsWith(m.id + tr.next) ? "…" : tr.label}
                    </button>
                  ))}
                </div>
              )}
              {/* Expand briefing */}
              {m.description && (
                <>
                  <button
                    onClick={() => setExpanded((p) => (p === m.id ? null : m.id))}
                    className="mt-2 flex items-center gap-1 text-[9px] uppercase tracking-[0.15em] text-muted-foreground hover:text-hud"
                  >
                    <ChevronDown className={`h-3 w-3 transition-transform duration-200 ${expanded === m.id ? "rotate-180" : ""}`} />
                    {expanded === m.id ? "Скрыть описание" : "Описание миссии"}
                  </button>
                  {expanded === m.id && (
                    <p className="mt-1.5 border-l-2 border-hud/30 pl-3 text-[11px] leading-relaxed text-foreground/75">
                      {m.description}
                    </p>
                  )}
                </>
              )}
            </div>
          ))}
        </div>

        {/* ── Desktop table (hidden on mobile) ─────────── */}
        <div className="hidden sm:block overflow-x-auto">
        <table className="w-full min-w-[640px] text-xs">
          <thead className="bg-panel-elevated text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">{t("Code")}</th>
              <th className="px-3 py-2 text-left">{t("Mission")}</th>
              <th className="px-3 py-2 text-left">{t("Assignee")}</th>
              <th className="px-3 py-2 text-left">{t("Priority")}</th>
              <th className="px-3 py-2 text-left">{t("Status")}</th>
              <th className="px-3 py-2 text-left">{t("Created")}</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                  {t("Loading…")}
                </td>
              </tr>
            )}
            {!loading &&
              filtered.map((m) => (
                <>
                  <tr
                    key={m.id}
                    onClick={() => setExpanded((p) => (p === m.id ? null : m.id))}
                    className="cursor-pointer border-t border-border/40 hover:bg-hud/5"
                  >
                    <td className="hud-stat px-3 py-2 text-hud">{m.code}</td>
                    <td className="px-3 py-2 font-bold max-w-[200px] truncate">{m.name}</td>
                    <td className="px-3 py-2 text-muted-foreground">{m.assignee ?? "—"}</td>
                    <td
                      className={`hud-stat px-3 py-2 font-bold uppercase ${PRIORITY_COLOR[m.priority] ?? ""}`}
                    >
                      {m.priority}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-block border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.15em] ${STATUS_COLOR[m.status] ?? ""}`}
                      >
                        {STATUS_LABEL_RU[m.status] ?? m.status}
                      </span>
                    </td>
                    <td className="hud-stat px-3 py-2 text-muted-foreground">
                      {m.createdAt ? format(new Date(m.createdAt), "MM-dd HH:mm") : "—"}
                    </td>
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      {confirmAbort === m.id ? (
                        <div className="flex items-center gap-1">
                          <span className="text-[9px] text-threat uppercase tracking-[0.1em]">Подтвердить?</span>
                          <button
                            onClick={() => { handleTransition(m, "aborted"); setConfirmAbort(null); }}
                            className="border border-threat bg-threat/15 px-1.5 py-0.5 text-[9px] text-threat hover:bg-threat/25"
                          >Да</button>
                          <button
                            onClick={() => setConfirmAbort(null)}
                            className="border border-border px-1.5 py-0.5 text-[9px] text-muted-foreground hover:text-foreground"
                          >Нет</button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1">
                          {(STATUS_TRANSITIONS[m.status] ?? []).map((tr) => (
                            <button
                              key={tr.next}
                              disabled={!!pending}
                              onClick={() => tr.danger ? setConfirmAbort(m.id) : handleTransition(m, tr.next)}
                              className={`flex items-center gap-1 border px-2 py-1 text-[10px] uppercase tracking-[0.12em] disabled:opacity-30 ${
                                tr.danger
                                  ? "border-threat/50 text-threat hover:bg-threat/10"
                                  : "border-border text-muted-foreground hover:border-hud hover:text-hud"
                              }`}
                            >
                              <ChevronRight className="h-3 w-3" />
                              {pending?.startsWith(m.id + tr.next) ? "…" : tr.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                  {expanded === m.id && (
                    <tr key={`${m.id}-desc`} className="border-t border-border/20 bg-hud/[0.03]">
                      <td colSpan={7} className="px-6 py-3">
                        <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-1">
                          {t("Mission briefing")}
                        </div>
                        <p className="text-xs leading-relaxed text-foreground/80">
                          {m.description ?? t("No description provided.")}
                        </p>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            {!loading && filtered.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-3 py-8 text-center text-muted-foreground uppercase tracking-[0.2em] text-[10px]"
                >
                  {t("No missions match filter")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </HudPanel>
    </div>
  );
}

// ─── Tab 3: Incident Log (with operator notes) ────────────────
const INC_STATUS_COLOR: Record<string, string> = {
  open:          "border-threat/50 bg-threat/10 text-threat",
  investigating: "border-warning/50 bg-warning/10 text-warning",
  resolved:      "border-hud/50 bg-hud/10 text-hud",
  dismissed:     "border-border text-muted-foreground",
};

function IncidentLog() {
  const { t } = useT();
  const incidents = useStore((s) => s.incidents);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showFilters, setShowFilters] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const incCounts = {
    open:          incidents.filter((i) => i.status === "open").length,
    investigating: incidents.filter((i) => i.status === "investigating").length,
    resolved:      incidents.filter((i) => i.status === "resolved").length,
    dismissed:     incidents.filter((i) => i.status === "dismissed").length,
  };

  const INC_FILTER_OPTIONS = [
    { value: "all",           label: "All",           count: incidents.length },
    { value: "open",          label: "Open",          count: incCounts.open },
    { value: "investigating", label: "Investigating", count: incCounts.investigating },
    { value: "resolved",      label: "Resolved",      count: incCounts.resolved },
    { value: "dismissed",     label: "Dismissed",     count: incCounts.dismissed },
  ] as const;

  const filtered = useMemo(
    () =>
      incidents.filter((inc) => {
        if (statusFilter !== "all" && inc.status !== statusFilter) return false;
        if (
          q &&
          !`${inc.code} ${inc.title} ${inc.description ?? ""}`.toLowerCase().includes(q.toLowerCase())
        )
          return false;
        return true;
      }),
    [incidents, q, statusFilter],
  );

  return (
    <div className="px-4 py-3 sm:px-6 sm:py-4">
      <HudPanel
        title={t("Incident Log")}
        subtitle={`${filtered.length} ${t("of")} ${incidents.length} ${t("records")}`}
        bodyClassName="p-0"
        actions={
        <div className="flex items-center gap-2">
          {statusFilter !== "all" && (
            <span className="border border-hud/50 bg-hud/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.15em] text-hud">
              {INC_FILTER_OPTIONS.find((o) => o.value === statusFilter)?.label ?? statusFilter}
            </span>
          )}
          <button
            onClick={() => setShowFilters((v) => !v)}
            className={`flex items-center gap-1.5 border px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] transition-colors ${
              showFilters
                ? "border-hud bg-hud/10 text-hud"
                : "border-border text-muted-foreground hover:border-hud hover:text-hud"
            }`}
          >
            <Filter className="h-3 w-3" />
            {t("Filter")}
            <ChevronDown className={`h-3 w-3 transition-transform duration-200 ${showFilters ? "rotate-180" : ""}`} />
          </button>
        </div>
      }
      >
        {/* ── Collapsible filter panel ──────────────────── */}
        <div className={`grid transition-[grid-template-rows] duration-200 ease-in-out ${showFilters ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
          <div className="overflow-hidden">
            <div className="space-y-2.5 border-b border-border bg-panel/20 px-4 py-3">
              {/* Search */}
              <div className="flex items-center gap-2 border border-border bg-input/20 px-3 py-1.5 focus-within:border-hud w-full max-w-sm">
                <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={t("Search code, title, notes…")}
                  className="flex-1 bg-transparent text-[11px] text-foreground placeholder:text-muted-foreground outline-none"
                />
                {q && (
                  <button onClick={() => setQ("")} className="text-[10px] text-muted-foreground hover:text-foreground">✕</button>
                )}
              </div>
              {/* Status filter */}
              <div className="flex flex-wrap items-center gap-1.5">
                <Filter className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                {INC_FILTER_OPTIONS.map(({ value, label, count }) => (
                  <button
                    key={value}
                    onClick={() => { setStatusFilter(value); setShowFilters(false); }}
                    className={`flex items-center gap-1.5 border px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] transition-colors ${
                      statusFilter === value
                        ? "border-hud bg-hud/10 text-hud"
                        : "border-border text-muted-foreground hover:border-hud/60 hover:text-hud"
                    }`}
                  >
                    {label}
                    <span className={`border px-1 py-0.5 text-[9px] font-bold ${statusFilter === value ? "border-hud/40 text-hud" : "border-border text-muted-foreground"}`}>
                      {count}
                    </span>
                  </button>
                ))}
                {statusFilter !== "all" && (
                  <button
                    onClick={() => { setStatusFilter("all"); setShowFilters(false); }}
                    className="ml-auto text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:text-threat"
                  >
                    ✕ Clear
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Mobile card view (hidden on sm+) ─────────── */}
        <div className="sm:hidden divide-y divide-border/30">
          {filtered.length === 0 && (
            <div className="py-10 text-center text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
              {t("No incidents")}
            </div>
          )}
          {filtered.map((inc) => {
            const isOpen = expanded === inc.id;
            const lines = (inc.description ?? "").split("\n");
            const notesLines = lines.filter((l) => l.startsWith("["));
            const hasNotes = notesLines.length > 0;
            return (
              <div key={inc.id} className="px-4 py-3">
                {/* Row 1: Code + Threat + Status */}
                <div className="flex items-center justify-between gap-2">
                  <span className="hud-stat font-mono text-[11px] text-hud">{inc.code}</span>
                  <div className="flex items-center gap-1.5">
                    <ThreatBadge level={inc.threat} />
                    <span className={`inline-block border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] ${INC_STATUS_COLOR[inc.status] ?? ""}`}>
                      {inc.status}
                    </span>
                  </div>
                </div>
                {/* Row 2: Title + notes badge */}
                <div className="mt-1 text-xs font-bold leading-snug">
                  {inc.title}
                  {hasNotes && (
                    <span className="ml-2 border border-hud/40 bg-hud/5 px-1 py-0.5 text-[8px] font-bold text-hud">
                      {notesLines.length} {t("notes")}
                    </span>
                  )}
                </div>
                {/* Row 3: Assignee + Updated */}
                <div className="mt-0.5 flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>{inc.assignee || "—"}</span>
                  <span>{inc.updatedAt ? format(new Date(inc.updatedAt), "MM-dd HH:mm") : "—"}</span>
                </div>
                {/* Expand button */}
                <button
                  onClick={() => setExpanded((p) => (p === inc.id ? null : inc.id))}
                  className="mt-2 flex items-center gap-1 text-[9px] uppercase tracking-[0.15em] text-muted-foreground hover:text-hud"
                >
                  <ChevronDown className={`h-3 w-3 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
                  {isOpen ? "Скрыть" : "Детали"}
                </button>
                {isOpen && (
                  <div className="mt-2 space-y-3">
                    <div>
                      <div className="mb-1 flex items-center gap-1 text-[9px] uppercase tracking-[0.2em] text-hud">
                        <FileWarning className="h-2.5 w-2.5" /> {t("Description")}
                      </div>
                      <p className="text-[11px] leading-relaxed text-foreground/75">
                        {lines.filter((l) => !l.startsWith("[")).join("\n").trim() || t("No description.")}
                      </p>
                    </div>
                    {hasNotes && (
                      <div>
                        <div className="mb-1 flex items-center gap-1 text-[9px] uppercase tracking-[0.2em] text-hud">
                          <Clock className="h-2.5 w-2.5" /> {t("Operator Notes")}
                        </div>
                        <div className="space-y-1">
                          {notesLines.map((line, i) => (
                            <div key={i} className="border-l-2 border-hud/40 bg-hud/5 pl-2.5 py-1 text-[11px] leading-relaxed text-foreground/85">
                              {line}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ── Desktop table (hidden on mobile) ─────────── */}
        <div className="hidden sm:block overflow-x-auto">
        <table className="w-full min-w-[640px] text-xs">
          <thead className="bg-panel/60 text-[10px] uppercase tracking-[0.2em] text-muted-foreground border-b border-border">
            <tr>
              <th className="w-6 px-3 py-2" />
              <th className="px-3 py-2 text-left">{t("Code")}</th>
              <th className="px-3 py-2 text-left">{t("Title")}</th>
              <th className="px-3 py-2 text-left">{t("Threat")}</th>
              <th className="px-3 py-2 text-left">{t("Status")}</th>
              <th className="px-3 py-2 text-left">{t("Assignee")}</th>
              <th className="px-3 py-2 text-left">{t("Updated")}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
                  {t("No incidents")}
                </td>
              </tr>
            )}
            {filtered.map((inc) => {
              const isOpen = expanded === inc.id;
              // Split description into original body and operator notes (lines starting with "[")
              const lines = (inc.description ?? "").split("\n");
              const notesLines = lines.filter((l) => l.startsWith("["));
              const hasNotes = notesLines.length > 0;
              return (
                <>
                  <tr
                    key={inc.id}
                    onClick={() => setExpanded((p) => (p === inc.id ? null : inc.id))}
                    className={`cursor-pointer border-t border-border/40 transition-colors hover:bg-hud/5 ${isOpen ? "bg-hud/[0.06]" : ""}`}
                  >
                    <td className="px-3 py-2 text-muted-foreground">
                      {isOpen ? (
                        <ChevronDown className="h-3.5 w-3.5 text-hud" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5" />
                      )}
                    </td>
                    <td className="hud-stat px-3 py-2 text-hud">{inc.code}</td>
                    <td className="px-3 py-2 font-bold max-w-[220px] truncate">
                      <span>{inc.title}</span>
                      {hasNotes && (
                        <span className="ml-2 border border-hud/40 bg-hud/5 px-1 py-0.5 text-[8px] font-bold text-hud">
                          {notesLines.length} {t("notes")}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2"><ThreatBadge level={inc.threat} /></td>
                    <td className="px-3 py-2">
                      <span className={`inline-block border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] ${INC_STATUS_COLOR[inc.status] ?? ""}`}>
                        {inc.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{inc.assignee || "—"}</td>
                    <td className="hud-stat px-3 py-2 text-muted-foreground">
                      {inc.updatedAt ? format(new Date(inc.updatedAt), "MM-dd HH:mm") : "—"}
                    </td>
                  </tr>

                  {isOpen && (
                    <tr key={`${inc.id}-detail`} className="border-t border-border/20">
                      <td colSpan={7} className="bg-hud/[0.03] px-6 py-4">
                        <div className="grid gap-4 sm:grid-cols-2">
                          {/* Description */}
                          <div>
                            <div className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.25em] text-hud">
                              <FileWarning className="h-3 w-3" /> {t("Description")}
                            </div>
                            <p className="text-[11px] leading-relaxed text-foreground/75 whitespace-pre-wrap">
                              {lines.filter((l) => !l.startsWith("[")).join("\n").trim() || t("No description.")}
                            </p>
                          </div>

                          {/* Operator notes */}
                          <div>
                            <div className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.25em] text-hud">
                              <Clock className="h-3 w-3" /> {t("Operator Notes")}
                            </div>
                            {notesLines.length === 0 ? (
                              <p className="text-[11px] text-muted-foreground">{t("No operator notes.")}</p>
                            ) : (
                              <div className="space-y-1.5">
                                {notesLines.map((line, i) => (
                                  <div
                                    key={i}
                                    className="border-l-2 border-hud/40 bg-hud/5 pl-2.5 py-1 text-[11px] leading-relaxed text-foreground/85"
                                  >
                                    {line}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
        </div>
      </HudPanel>
    </div>
  );
}

// ─── Shared helper ────────────────────────────────────────────
function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="shrink-0 text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </span>
      <span
        className={`text-right text-[11px] font-bold text-foreground/90 ${mono ? "font-mono" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}
