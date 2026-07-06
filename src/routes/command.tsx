import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useState, useEffect, useRef, useMemo } from "react";
import {
  useStore,
  selectDrone,
  selectIncident,
  isApiConnected,
  patchDrone,
  removeDrone,
  acknowledgeAlert,
  patchIncident,
} from "@/lib/store";
import { useT } from "@/lib/i18n";
import { HudPanel, PageHeader, ThreatBadge } from "@/components/HudPanel";
import { RadarScope } from "@/components/RadarScope";
import {
  AlertTriangle,
  BrainCircuit,
  Crosshair,
  Plane,
  Radio,
  Target,
  Loader2,
  ShieldAlert,
  ShieldOff,
  CheckCircle2,
  BookOpen,
  X,
  LockOpen,
  Lock,
  BellOff,
  Trash2,
  ShieldCheck,
  WifiOff,
  RefreshCw,
  FileWarning,
  ChevronRight,
  Zap,
  Radar,
} from "lucide-react";
import { RelativeTime } from "@/components/RelativeTime";
import { auditApi, playbooksApi, incidentsApi, type ApiPlaybook } from "@/lib/api";
import { format } from "date-fns";
import { generateRecommendations, type Recommendation } from "@/lib/aiRecommendations";
import type { AlertEvent } from "@/lib/mockData";

type DroneStatus = "tracked" | "intercepted" | "lost" | "neutralized";

const TacticalMap = lazy(() =>
  import("@/components/TacticalMap").then((m) => ({ default: m.TacticalMap })),
);

export const Route = createFileRoute("/command")({
  component: CommandCenter,
  head: () => ({ meta: [{ title: "Command Center // DDS" }] }),
});

// ─── Types ────────────────────────────────────────────────────
type ARStatus = "idle" | "engaging" | "active";

interface ARResult {
  incidentCode: string;
  incidentTitle: string;
  threat: string;
  playbookName: string;
  executedAt: string;
}

interface ARSession {
  engagedAt: string;
  results: ARResult[];
  noThreats: boolean;
}

// ─── Component ────────────────────────────────────────────────
function CommandCenter() {
  const { t } = useT();
  const drones    = useStore((s) => s.drones);
  const sensors   = useStore((s) => s.sensors);
  const incidents = useStore((s) => s.incidents);
  const rawAlerts = useStore((s) => s.alerts);
  const selectedId = useStore((s) => s.selectedDroneId);
  const selectedIncId = useStore((s) => s.selectedIncidentId);
  const connected = isApiConnected();
  const selected = drones.find((d) => d.id === selectedId) ?? null;
  const selectedInc = incidents.find((i) => i.id === selectedIncId) ?? null;

  // Deduplicate by id, then sort: threat (critical→low) → status (tracked first) → id
  const THREAT_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const STATUS_RANK: Record<string, number> = { tracked: 0, intercepted: 1, lost: 2, neutralized: 3 };
  const sortedDrones = useMemo(() => {
    const seen = new Set<string>();
    const unique = drones.filter((d) => {
      if (seen.has(d.id)) return false;
      seen.add(d.id);
      return true;
    });
    return unique.slice().sort((a, b) => {
      const t = (THREAT_RANK[a.threat] ?? 9) - (THREAT_RANK[b.threat] ?? 9);
      if (t !== 0) return t;
      const s = (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9);
      if (s !== 0) return s;
      return a.id.localeCompare(b.id);
    });
  }, [drones]);

  const [arStatus, setArStatus] = useState<ARStatus>("idle");
  const [arSession, setArSession] = useState<ARSession | null>(null);

  // AI recommendations — re-computed whenever store state changes
  const { recommendations, aiUpdatedAt } = useMemo(() => ({
    recommendations: generateRecommendations({ drones, sensors, incidents, alerts: rawAlerts }),
    aiUpdatedAt: new Date(),
  }), [drones, sensors, incidents, rawAlerts]);

  // ── Target Lock state ────────────────────────────────────────
  const [lockStatus, setLockStatus] = useState<"idle" | "acquired" | "releasing">("idle");
  const [lockSnap, setLockSnap] = useState<{
    id: string;
    callsign: string;
    model: string;
    threat: string;
  } | null>(null);

  // ── Drone management state ───────────────────────────────────
  const [droneActionPending, setDroneActionPending] = useState<string | null>(null);
  const [removeConfirm, setRemoveConfirm] = useState(false);
  const removeConfirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Note field for status change: null = hidden, DroneStatus = which status is pending confirm
  const [pendingStatus, setPendingStatus] = useState<DroneStatus | null>(null);
  const [statusNote, setStatusNote] = useState("");

  // ── Target Lock handlers ─────────────────────────────────────
  function handleAcquire(id: string) {
    selectDrone(id);
    setLockStatus("acquired");
    setRemoveConfirm(false);
    setPendingStatus(null);
    setStatusNote("");
    setTimeout(() => setLockStatus("idle"), 1400);
    const d = drones.find((x) => x.id === id);
    if (d) {
      auditApi
        .log({ action: "TARGET_LOCK_ACQUIRED", resource: "drone", resourceId: id, details: { callsign: d.callsign, threat: d.threat } })
        .catch(() => {});
    }
  }

  async function handleReleaseLock() {
    if (!selected || lockStatus === "releasing") return;
    setLockSnap({
      id: selected.id,
      callsign: selected.callsign,
      model: selected.model,
      threat: selected.threat,
    });
    setLockStatus("releasing");
    setRemoveConfirm(false);
    auditApi
      .log({
        action: "TARGET_LOCK_RELEASED",
        resource: "drone",
        resourceId: selected.id,
        details: { callsign: selected.callsign, model: selected.model, threat: selected.threat },
      })
      .catch(() => {});
    setTimeout(() => {
      selectDrone(null);
      setLockStatus("idle");
      setLockSnap(null);
    }, 900);
  }

  // ── Drone action handlers ─────────────────────────────────────

  // Step 1: show note input for this status
  function handleStatusClick(status: DroneStatus) {
    if (!selected || !!droneActionPending) return;
    if (selected.status === status) return;
    setPendingStatus(status);
    setStatusNote("");
  }

  // Step 2: confirm — apply status + append note to related incident
  async function handleStatusConfirm() {
    if (!selected || !pendingStatus || droneActionPending) return;
    const status = pendingStatus;
    const note = statusNote.trim();
    const prevStatus = selected.status;
    setPendingStatus(null);
    setStatusNote("");
    setDroneActionPending(status);
    try {
      await patchDrone(selected.id, { status });

      // Append note to the most relevant open incident
      const relatedInc =
        incidents.find(
          (inc) =>
            ["open", "investigating"].includes(inc.status) &&
            inc.title.toLowerCase().includes(selected.callsign.toLowerCase()),
        ) ?? (selectedInc && ["open", "investigating"].includes(selectedInc.status) ? selectedInc : null);

      if (relatedInc) {
        const ts = new Date().toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "medium" });
        const append = note
          ? `\n[${ts}] Статус: ${prevStatus} → ${status}. Примечание: ${note}`
          : `\n[${ts}] Статус изменён: ${prevStatus} → ${status}`;
        await patchIncident(relatedInc.id, {
          description: (relatedInc.description ?? "") + append,
        }).catch(() => {});
      }

      auditApi
        .log({
          action: "DRONE_STATUS_CHANGED",
          resource: "drone",
          resourceId: selected.id,
          details: { callsign: selected.callsign, from: prevStatus, to: status, note: note || undefined },
        })
        .catch(() => {});
    } finally {
      setDroneActionPending(null);
    }
  }

  async function handleSilenceAlarms() {
    if (!selected || droneActionPending) return;
    setDroneActionPending("silence");
    try {
      const related = rawAlerts.filter((a) => !a.acknowledged && a.source === selected.callsign);
      const toAck = related.length > 0 ? related : rawAlerts.filter((a) => !a.acknowledged);
      await Promise.allSettled(toAck.map((a) => acknowledgeAlert(a.id)));
      auditApi
        .log({
          action: "ALARMS_SILENCED",
          resource: "drone",
          resourceId: selected.id,
          details: { callsign: selected.callsign, count: toAck.length },
        })
        .catch(() => {});
    } finally {
      setDroneActionPending(null);
    }
  }

  async function handleRemoveDrone() {
    if (!selected || droneActionPending) return;
    if (!removeConfirm) {
      setRemoveConfirm(true);
      if (removeConfirmTimer.current) clearTimeout(removeConfirmTimer.current);
      removeConfirmTimer.current = setTimeout(() => setRemoveConfirm(false), 5000);
      return;
    }
    if (removeConfirmTimer.current) clearTimeout(removeConfirmTimer.current);
    setRemoveConfirm(false);
    setDroneActionPending("remove");
    const snap = {
      id: selected.id,
      callsign: selected.callsign,
      model: selected.model,
      threat: selected.threat,
    };
    selectDrone(null);
    setLockStatus("idle");
    setLockSnap(null);
    try {
      await removeDrone(snap.id);
      auditApi
        .log({
          action: "DRONE_REMOVED_FROM_MAP",
          resource: "drone",
          resourceId: snap.id,
          details: { callsign: snap.callsign, model: snap.model, threat: snap.threat },
        })
        .catch(() => {});
    } finally {
      setDroneActionPending(null);
    }
  }

  useEffect(
    () => () => {
      if (removeConfirmTimer.current) clearTimeout(removeConfirmTimer.current);
    },
    [],
  );

  // ── Auto-Response handler ────────────────────────────────────
  async function handleAutoResponse() {
    if (arStatus === "active") {
      // Disengage
      auditApi
        .log({
          action: "AUTO_RESPONSE_DISENGAGED",
          resource: "command",
          details: { triggeredCount: arSession?.results.length ?? 0 },
        })
        .catch(() => {});
      setArStatus("idle");
      setArSession(null);
      return;
    }

    setArStatus("engaging");

    try {
      // 1. Collect urgent incidents from store (open or investigating, high or critical)
      const urgent = incidents
        .filter(
          (inc) =>
            ["open", "investigating"].includes(inc.status) &&
            ["high", "critical"].includes(inc.threat),
        )
        .sort((a, b) => {
          const rank: Record<string, number> = { critical: 0, high: 1 };
          return (rank[a.threat] ?? 9) - (rank[b.threat] ?? 9);
        });

      // 2. Fetch active playbooks from server
      let playbooks: ApiPlaybook[] = [];
      try {
        playbooks = (await playbooksApi.list()).filter((p) => p.active);
      } catch {
        /* ignore */
      }

      // 3. Match incidents → playbooks and execute
      const results: ARResult[] = [];
      const usedPbIds = new Set<string>();

      for (const inc of urgent) {
        // Best match: same threat level; fallback: any unused active playbook
        const pb =
          playbooks.find((p) => p.threatLevel === inc.threat && !usedPbIds.has(p.id)) ??
          playbooks.find((p) => !usedPbIds.has(p.id));

        if (!pb) continue;
        usedPbIds.add(pb.id);

        // Execute playbook (fire-and-forget errors)
        try {
          await playbooksApi.execute(pb.id);
        } catch {
          /* ignore */
        }

        // Escalate incident to "investigating" if still open
        if (inc.status === "open") {
          try {
            await incidentsApi.patch(inc.id, { status: "investigating" });
          } catch {
            /* ignore */
          }
        }

        results.push({
          incidentCode: inc.code,
          incidentTitle: inc.title,
          threat: inc.threat,
          playbookName: pb.name,
          executedAt: new Date().toISOString(),
        });
      }

      // 4. Audit trail
      await auditApi
        .log({
          action: "AUTO_RESPONSE_ENGAGED",
          resource: "command",
          details: {
            urgentIncidents: urgent.length,
            playbooksTriggered: results.length,
            incidents: results.map((r) => r.incidentCode),
          },
        })
        .catch(() => {});

      setArSession({
        engagedAt: new Date().toISOString(),
        results,
        noThreats: urgent.length === 0,
      });
      setArStatus("active");
    } catch {
      setArStatus("idle");
    }
  }

  const avgConfidence =
    drones.length > 0
      ? ((drones.reduce((sum, d) => sum + d.confidence, 0) / drones.length) * 100).toFixed(1)
      : "—";

  const stats = [
    { label: t("Active tracks"), value: sortedDrones.length, icon: Plane, tone: "hud" as const },
    {
      label: t("Critical"),
      value: sortedDrones.filter((d) => d.threat === "critical").length,
      icon: AlertTriangle,
      tone: "threat" as const,
    },
    {
      label: t("Sensors online"),
      value: `${sensors.filter((s) => s.status === "online").length}/${sensors.length}`,
      icon: Radio,
      tone: "hud" as const,
    },
    {
      label: t("AI confidence"),
      value: avgConfidence === "—" ? "—" : `${avgConfidence}%`,
      icon: BrainCircuit,
      tone: "hud" as const,
    },
  ];

  return (
    <div className="flex flex-col">
      <PageHeader
        title={t("Command Center")}
        subtitle={t("Real-time tactical overview · perimeter integrity monitor")}
        actions={
          <div className="flex items-center gap-3">
            <span
              className={`text-[10px] uppercase tracking-[0.2em] ${connected ? "text-hud" : "text-muted-foreground"}`}
            >
              {connected ? t("● LIVE") : t("○ MOCK")}
            </span>

            {/* ── Auto-Response Button ── */}
            <button
              onClick={handleAutoResponse}
              disabled={arStatus === "engaging"}
              className={`flex items-center gap-2 border px-4 py-2 text-[10px] font-bold uppercase tracking-[0.25em] transition-colors disabled:opacity-60 ${
                arStatus === "active"
                  ? "border-threat bg-threat/30 text-threat blink-pulse hover:bg-threat/40"
                  : "border-threat bg-threat/15 text-threat hover:bg-threat/25"
              }`}
            >
              {arStatus === "engaging" && <Loader2 className="h-3 w-3 animate-spin" />}
              {arStatus === "active" && <ShieldAlert className="h-3 w-3" />}
              {arStatus === "idle" && <span>⚠</span>}
              {arStatus === "engaging"
                ? t("Engaging…")
                : arStatus === "active"
                  ? t("ACTIVE · Disengage")
                  : t("Engage Auto-Response")}
            </button>
          </div>
        }
      />

      {/* ── Stats row ─────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2 px-4 py-3 sm:gap-3 sm:px-6 sm:py-4 lg:grid-cols-4">
        {stats.map((s) => {
          const Icon = s.icon;
          const tone = s.tone === "threat" ? "text-threat" : "text-hud";
          return (
            <div key={s.label} className="hud-panel flex items-center gap-3 px-4 py-3">
              <Icon className={`h-5 w-5 ${tone}`} />
              <div>
                <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
                  {s.label}
                </div>
                <div className={`hud-stat text-2xl font-bold ${tone}`}>{s.value}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Auto-Response results panel (animated) ──────────── */}
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-in-out px-6 ${arSession ? "grid-rows-[1fr] mb-3" : "grid-rows-[0fr]"}`}
      >
        <div className="overflow-hidden">
          <ARPanel
            session={arSession}
            onDismiss={() => {
              setArStatus("idle");
              setArSession(null);
            }}
          />
        </div>
      </div>

      {/* ── Map + right column ───────────────────────────────── */}
      <div className="grid flex-1 gap-3 px-4 pb-4 sm:px-6 sm:pb-6 lg:grid-cols-[2fr_1fr]">
        <HudPanel
          title={t("Tactical Overview")}
          subtitle={t("OSM ↦ encrypted tile relay")}
          actions={
            <div className="flex gap-1 text-[10px] uppercase tracking-[0.2em]">
              <Tag color="hud">{t("Drones")}</Tag>
              <Tag color="warning">{t("Zones")}</Tag>
              <Tag color="muted">{t("Sensors")}</Tag>
              <Tag color="threat">{t("Incidents")}</Tag>
            </div>
          }
          className="min-h-[260px] sm:min-h-[380px] lg:min-h-[520px]"
          bodyClassName="relative p-0"
        >
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                {t("› Loading tactical grid...")}
              </div>
            }
          >
            <TacticalMap />
          </Suspense>
          <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-1">
            <div className="border border-hud/40 bg-background/60 px-2 py-1 text-[10px] uppercase tracking-[0.25em] text-hud">
              LIVE · {sortedDrones.length} {t("CONTACTS")}
            </div>
            {incidents.filter((i) => i.status === "open" || i.status === "investigating").length >
              0 && (
              <div className="border border-threat/50 bg-background/60 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-threat">
                {
                  incidents.filter((i) => i.status === "open" || i.status === "investigating")
                    .length
                }{" "}
                {t("ACTIVE INCIDENTS")}
              </div>
            )}
          </div>
          {arStatus === "active" && (
            <div className="pointer-events-none absolute right-3 top-3 blink-pulse border border-threat/60 bg-threat/15 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-threat">
              {t("⚠ AUTO-RESPONSE ACTIVE")}
            </div>
          )}
        </HudPanel>

        <div className="flex flex-col gap-3">
          <HudPanel title={t("Radar Scope")} subtitle={t("360° AESA sweep · 4s")}>
            <RadarScope />
          </HudPanel>

          <HudPanel
            title={
              lockStatus === "releasing" && lockSnap
                ? `${t("Target Lock")} · ${lockSnap.callsign}`
                : selected
                  ? `${t("Target Lock")} · ${selected.callsign}`
                  : t("Target Lock")
            }
            actions={
              lockStatus === "releasing" ? (
                <LockOpen className="h-3.5 w-3.5 text-threat blink-pulse" />
              ) : selected ? (
                <Lock
                  className={`h-3.5 w-3.5 ${lockStatus === "acquired" ? "text-hud blink-pulse" : "text-hud"}`}
                />
              ) : (
                <Crosshair className="h-3.5 w-3.5 text-muted-foreground" />
              )
            }
          >
            {/* ── Releasing animation ── */}
            {lockStatus === "releasing" && lockSnap && (
              <div className="space-y-3">
                <div className="flex items-center justify-center gap-2 border border-threat/40 bg-threat/5 py-3">
                  <LockOpen className="h-4 w-4 text-threat blink-pulse" />
                  <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-threat">
                    {t("Releasing Target Lock…")}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs opacity-40">
                  <Stat label={t("Callsign")} value={lockSnap.callsign} />
                  <Stat label={t("Model")} value={lockSnap.model} />
                </div>
              </div>
            )}

            {/* ── Locked — target active ── */}
            {lockStatus !== "releasing" && selected && (
              <div className="space-y-2 text-xs">
                {lockStatus === "acquired" && (
                  <div className="flex items-center justify-center gap-2 border border-hud/40 bg-hud/5 py-1.5 blink-pulse">
                    <Lock className="h-3 w-3 text-hud" />
                    <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-hud">
                      {t("Target Acquired")}
                    </span>
                  </div>
                )}

                {/* Telemetry grid */}
                <div className="grid grid-cols-2 gap-2">
                  <Stat label={t("Model")} value={selected.model} />
                  <Stat label={t("Altitude")} value={`${selected.altitude} m`} />
                  <Stat label={t("Speed")} value={`${Math.round(selected.speed)} km/h`} />
                  <Stat label={t("Heading")} value={`${Math.round(selected.heading)}°`} />
                  <Stat
                    label={t("Confidence")}
                    value={`${(selected.confidence * 100).toFixed(1)}%`}
                  />
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                      {t("Threat")}
                    </div>
                    <ThreatBadge level={selected.threat} />
                  </div>
                </div>

                {/* ── Status control ── */}
                <div className="border-t border-border pt-2">
                  <div className="mb-1.5 text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
                    {t("Change Status")}
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    {(
                      [
                        {
                          s: "tracked",
                          label: "Track",
                          icon: RefreshCw,
                          active: "border-info bg-info/20 text-info",
                          inactive:
                            "border-border text-muted-foreground hover:border-info hover:text-info",
                          pending: "border-info/70 bg-info/15 text-info blink-pulse",
                        },
                        {
                          s: "intercepted",
                          label: "Intercept",
                          icon: Target,
                          active: "border-warning bg-warning/20 text-warning",
                          inactive:
                            "border-border text-muted-foreground hover:border-warning hover:text-warning",
                          pending: "border-warning/70 bg-warning/15 text-warning blink-pulse",
                        },
                        {
                          s: "neutralized",
                          label: "Neutralize",
                          icon: ShieldCheck,
                          active: "border-hud bg-hud/20 text-hud",
                          inactive:
                            "border-border text-muted-foreground hover:border-hud hover:text-hud",
                          pending: "border-hud/70 bg-hud/15 text-hud blink-pulse",
                        },
                        {
                          s: "lost",
                          label: "Lost",
                          icon: WifiOff,
                          active: "border-border bg-muted/30 text-muted-foreground",
                          inactive:
                            "border-border text-muted-foreground hover:border-border hover:text-foreground",
                          pending: "border-border/70 bg-muted/20 text-foreground blink-pulse",
                        },
                      ] as {
                        s: DroneStatus;
                        label: string;
                        icon: React.ElementType;
                        active: string;
                        inactive: string;
                        pending: string;
                      }[]
                    ).map(({ s, label, icon: Icon, active, inactive, pending: pendingCls }) => {
                      const isCurrent = selected.status === s;
                      const isApplying = droneActionPending === s;
                      const isAwaitingNote = pendingStatus === s;
                      return (
                        <button
                          key={s}
                          onClick={() => handleStatusClick(s)}
                          disabled={isCurrent || !!droneActionPending}
                          className={`flex items-center justify-center gap-1 border py-1.5 text-[9px] uppercase tracking-[0.1em] transition-colors disabled:opacity-40 ${
                            isCurrent ? active : isAwaitingNote ? pendingCls : inactive
                          }`}
                        >
                          {isApplying ? (
                            <Loader2 className="h-2.5 w-2.5 animate-spin" />
                          ) : (
                            <Icon className="h-2.5 w-2.5" />
                          )}
                          {label}
                        </button>
                      );
                    })}
                  </div>

                  {/* ── Note input (shown after a status button is clicked) ── */}
                  {pendingStatus && (
                    <div className="mt-2 space-y-1.5 border border-hud/30 bg-hud/5 p-2">
                      <div className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
                        {t("Note")} ({t("optional")}) · {pendingStatus.toUpperCase()}
                      </div>
                      <textarea
                        value={statusNote}
                        onChange={(e) => setStatusNote(e.target.value)}
                        placeholder={t("Add operator note…")}
                        rows={2}
                        className="w-full resize-none border border-border bg-background/60 px-2 py-1 text-[11px] text-foreground placeholder:text-muted-foreground outline-none focus:border-hud"
                      />
                      <div className="flex gap-1">
                        <button
                          onClick={handleStatusConfirm}
                          disabled={!!droneActionPending}
                          className="flex flex-1 items-center justify-center gap-1 border border-hud/50 py-1 text-[9px] uppercase tracking-[0.15em] text-hud hover:bg-hud/15 disabled:opacity-40"
                        >
                          <CheckCircle2 className="h-2.5 w-2.5" />
                          {t("Confirm")}
                        </button>
                        <button
                          onClick={() => { setPendingStatus(null); setStatusNote(""); }}
                          className="border border-border px-3 py-1 text-[9px] text-muted-foreground hover:text-foreground"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* ── Alarm + remove ── */}
                <div className="grid grid-cols-2 gap-1">
                  <button
                    onClick={handleSilenceAlarms}
                    disabled={!!droneActionPending}
                    className="flex items-center justify-center gap-1 border border-info/40 py-1.5 text-[9px] uppercase tracking-[0.1em] text-info transition-colors hover:bg-info/10 disabled:opacity-40"
                  >
                    {droneActionPending === "silence" ? (
                      <Loader2 className="h-2.5 w-2.5 animate-spin" />
                    ) : (
                      <BellOff className="h-2.5 w-2.5" />
                    )}
                    {t("Silence")}
                  </button>
                  <button
                    onClick={handleRemoveDrone}
                    disabled={droneActionPending === "remove"}
                    className={`flex items-center justify-center gap-1 border py-1.5 text-[9px] uppercase tracking-[0.1em] transition-colors disabled:opacity-40 ${
                      removeConfirm
                        ? "border-threat bg-threat/20 text-threat blink-pulse"
                        : "border-threat/40 text-threat hover:bg-threat/10"
                    }`}
                  >
                    {droneActionPending === "remove" ? (
                      <Loader2 className="h-2.5 w-2.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-2.5 w-2.5" />
                    )}
                    {removeConfirm ? t("Confirm?") : t("Remove")}
                  </button>
                </div>

                {/* ── Release lock ── */}
                <div className="border-t border-border pt-1.5">
                  <button
                    onClick={handleReleaseLock}
                    className="flex w-full items-center justify-center gap-1.5 border border-border py-1.5 text-[9px] uppercase tracking-[0.2em] text-muted-foreground hover:border-threat hover:text-threat"
                  >
                    <LockOpen className="h-3 w-3" />
                    {t("Release lock")}
                  </button>
                </div>
              </div>
            )}

            {/* ── No target ── */}
            {lockStatus !== "releasing" && !selected && (
              <div className="flex flex-col items-center gap-2 py-4 text-center">
                <Crosshair className="h-6 w-6 text-muted-foreground/40" />
                <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  {t("No target selected")}
                </span>
                <span className="text-[9px] text-muted-foreground/60 uppercase tracking-[0.15em]">
                  {t("Click a track in the table below")}
                </span>
              </div>
            )}
          </HudPanel>

          {/* Incident Detail Panel — shown when incident marker is clicked on map */}
          {selectedInc ? (
            <IncidentPanel incident={selectedInc} t={t} />
          ) : (
            <AiRecommendationsPanel
              recommendations={recommendations}
              updatedAt={aiUpdatedAt}
              t={t}
            />
          )}
        </div>
      </div>

      {/* ── Active tracks + live alerts ──────────────────────── */}
      <div className="grid gap-3 px-4 pb-6 sm:px-6 sm:pb-8 lg:grid-cols-[1.2fr_1fr]">
        <HudPanel
          title={t("Active Tracks")}
          subtitle={`${sortedDrones.length} ${t("contacts")} · ${t("sorted by threat")}`}
          bodyClassName="p-0"
        >
          <div className="max-h-[360px] overflow-x-auto overflow-y-auto">
            <table className="w-full min-w-[560px] text-xs">
              <thead className="sticky top-0 z-10 bg-panel-elevated text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">{t("ID")}</th>
                  <th className="px-3 py-2 text-left">{t("Callsign")}</th>
                  <th className="px-3 py-2 text-left">{t("Model")}</th>
                  <th className="px-3 py-2 text-right">{t("Alt")}</th>
                  <th className="px-3 py-2 text-right">{t("Spd")}</th>
                  <th className="px-3 py-2 text-left">{t("Threat")}</th>
                  <th className="px-3 py-2 text-left">{t("Status")}</th>
                </tr>
              </thead>
              <tbody>
                {sortedDrones.map((d) => {
                  const isNeutralized = d.status === "neutralized";
                  const isLost = d.status === "lost";
                  const isIntercepted = d.status === "intercepted";
                  return (
                    <tr
                      key={d.id}
                      onClick={() => handleAcquire(d.id)}
                      className={`cursor-pointer border-t border-border/50 transition-colors hover:bg-hud/5 ${
                        selectedId === d.id
                          ? "bg-hud/10 text-hud"
                          : isNeutralized
                            ? "opacity-35"
                            : isLost
                              ? "opacity-45 text-muted-foreground"
                              : isIntercepted
                                ? "bg-warning/5"
                                : ""
                      }`}
                    >
                      <td className="hud-stat px-3 py-1.5 text-[10px]">{d.id}</td>
                      <td className={`px-3 py-1.5 font-bold ${isNeutralized ? "line-through" : ""}`}>
                        {d.callsign}
                      </td>
                      <td className="px-3 py-1.5 text-muted-foreground">{d.model}</td>
                      <td className="hud-stat px-3 py-1.5 text-right">{d.altitude}m</td>
                      <td className="hud-stat px-3 py-1.5 text-right">{Math.round(d.speed)}</td>
                      <td className="px-3 py-1.5">
                        <ThreatBadge level={d.threat} />
                      </td>
                      <td className="px-3 py-1.5">
                        <StatusBadge status={d.status} />
                      </td>
                    </tr>
                  );
                })}
                {sortedDrones.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-6 text-center text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                      {t("No contacts")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </HudPanel>

        <LiveAlertsPanel alerts={rawAlerts} t={t} />
      </div>
    </div>
  );
}

// ─── Auto-Response Results Panel ──────────────────────────────
function ARPanel({ session, onDismiss }: { session: ARSession | null; onDismiss: () => void }) {
  const { t } = useT();
  if (!session) return null;

  return (
    <div className="border border-threat/40 bg-threat/5">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-threat/30 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-threat blink-pulse" />
          <span className="text-[10px] font-bold uppercase tracking-[0.25em] text-threat">
            {t("Auto-Response Active")}
          </span>
          <span className="border border-threat/40 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.15em] text-threat">
            {session.results.length} {t("playbooks triggered")}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            {t("Engaged")} {format(new Date(session.engagedAt), "HH:mm:ss")}
          </span>
          <button
            onClick={onDismiss}
            className="flex items-center gap-1.5 border border-border px-2.5 py-1 text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:border-threat hover:text-threat"
          >
            <ShieldOff className="h-3 w-3" />
            {t("Disengage")}
          </button>
          <button onClick={onDismiss} className="text-muted-foreground hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Body */}
      {session.noThreats ? (
        <div className="flex items-center gap-2 px-4 py-3 text-[11px] text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-hud" />
          {t("No open high/critical incidents detected — system on standby. All playbooks ready.")}
        </div>
      ) : (
        <div className="divide-y divide-border/30">
          {session.results.map((r, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-2">
              <ThreatBadge level={r.threat as "low" | "medium" | "high" | "critical"} />
              <div className="min-w-0 flex-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-foreground">
                  {r.incidentCode}
                </span>
                <span className="mx-2 text-muted-foreground">·</span>
                <span className="text-[11px] text-foreground/80">{r.incidentTitle}</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <BookOpen className="h-3 w-3 text-info" />
                <span className="text-[10px] uppercase tracking-[0.15em] text-info">
                  {r.playbookName}
                </span>
              </div>
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-hud" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Live Alerts Panel ───────────────────────────────────────

const ALERT_LEVEL_RU: Record<string, string> = {
  critical: "КРИТ",
  high:     "ВЫСОК",
  medium:   "СРЕДН",
  low:      "НИЗК",
};

const ALERT_TONE = {
  critical: {
    border: "border-l-threat",
    title:  "text-threat",
    badge:  "border-threat/50 bg-threat/10 text-threat",
    dot:    "bg-threat",
  },
  high: {
    border: "border-l-orange-500",
    title:  "text-orange-400",
    badge:  "border-orange-500/40 bg-orange-500/10 text-orange-400",
    dot:    "bg-orange-400",
  },
  medium: {
    border: "border-l-warning",
    title:  "text-warning",
    badge:  "border-warning/40 bg-warning/10 text-warning",
    dot:    "bg-warning",
  },
  low: {
    border: "border-l-info",
    title:  "text-info",
    badge:  "border-info/30 bg-info/5 text-info",
    dot:    "bg-info",
  },
};

function LiveAlertsPanel({
  alerts,
  t,
}: {
  alerts: AlertEvent[];
  t: (s: string) => string;
}) {
  const unackedCount = alerts.filter((a) => !a.acknowledged).length;

  return (
    <HudPanel
      title={t("Live Alerts")}
      subtitle={unackedCount > 0 ? `${unackedCount} непрочитано` : t("Real-time feed")}
      actions={
        <div className="flex items-center gap-1.5">
          {unackedCount > 0 && (
            <span className="border border-threat/50 bg-threat/10 px-1.5 py-0.5 text-[9px] font-bold text-threat blink-pulse">
              {unackedCount}
            </span>
          )}
          <Target className="h-3.5 w-3.5 text-threat blink-pulse" />
        </div>
      }
      bodyClassName="p-0 max-h-[360px] overflow-y-auto"
    >
      {alerts.length === 0 && (
        <div className="py-8 text-center text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          {t("No alerts")}
        </div>
      )}
      {alerts.map((a) => {
        const tc = ALERT_TONE[a.level as keyof typeof ALERT_TONE] ?? ALERT_TONE.low;
        return (
          <div
            key={a.id}
            className={`border-l-2 border-b border-border/40 px-4 py-2.5 transition-opacity ${tc.border} ${
              a.acknowledged ? "opacity-40" : ""
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`shrink-0 border px-1.5 py-0.5 text-[8px] font-bold tracking-[0.1em] ${tc.badge}`}>
                  {ALERT_LEVEL_RU[a.level] ?? a.level.toUpperCase()}
                </span>
                {!a.acknowledged && (
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tc.dot} blink-pulse`} />
                )}
                <span className={`truncate text-[10px] font-bold uppercase tracking-[0.15em] ${tc.title}`}>
                  {a.title}
                </span>
              </div>
              <RelativeTime
                date={a.timestamp}
                className="shrink-0 text-[9px] uppercase tracking-[0.15em] text-muted-foreground"
              />
            </div>
            <p className="mt-1 text-[11px] leading-snug text-foreground/80">{a.message}</p>
            <div className="mt-1 flex items-center gap-2 text-[9px] uppercase tracking-[0.15em] text-muted-foreground">
              <span>{t("ист.")} {a.source}</span>
              {a.acknowledged && (
                <span className="border border-border/50 px-1 py-0.5 text-[8px]">{t("прочитано")}</span>
              )}
            </div>
          </div>
        );
      })}
    </HudPanel>
  );
}

// ─── AI Recommendations Panel ────────────────────────────────

const TONE_DOT: Record<string, string> = {
  threat:  "bg-threat",
  warning: "bg-warning",
  hud:     "bg-hud",
  muted:   "bg-muted-foreground",
};
const TONE_TEXT: Record<string, string> = {
  threat:  "text-threat",
  warning: "text-warning",
  hud:     "text-hud",
  muted:   "text-muted-foreground",
};

function AiRecommendationsPanel({
  recommendations,
  updatedAt,
  t,
}: {
  recommendations: Recommendation[];
  updatedAt: Date;
  t: (s: string) => string;
}) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [cleared, setCleared] = useState(false);

  const timeStr = updatedAt.toLocaleTimeString("ru-RU", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });

  const visible = cleared ? [] : recommendations.filter((r) => !dismissed.has(r.id));

  return (
    <HudPanel
      title={t("AI Recommendations")}
      subtitle={`${t("Updated")} ${timeStr}`}
      actions={
        <div className="flex items-center gap-2">
          {visible.length > 0 && (
            <button
              onClick={() => setCleared(true)}
              className="text-[9px] uppercase tracking-[0.15em] text-muted-foreground hover:text-threat border border-border/50 px-2 py-0.5 hover:border-threat/50 transition-colors"
            >
              {t("Clear all")}
            </button>
          )}
          <BrainCircuit className="h-3.5 w-3.5 text-hud blink-pulse" />
        </div>
      }
      bodyClassName="p-0"
    >
      {visible.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <CheckCircle2 className="h-5 w-5 text-hud/40" />
          <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            {t("No active recommendations")}
          </span>
          {cleared && (
            <button
              onClick={() => { setCleared(false); setDismissed(new Set()); }}
              className="mt-1 text-[9px] uppercase tracking-[0.15em] text-muted-foreground/50 hover:text-hud"
            >
              {t("Restore")}
            </button>
          )}
        </div>
      ) : (
        <div className="divide-y divide-border/20">
          {visible.map((rec, idx) => (
            <div key={rec.id} className="group flex items-start gap-3 px-3 py-2.5 hover:bg-white/[0.02] transition-colors">
              {/* Index + dot */}
              <div className="flex shrink-0 flex-col items-center gap-1 pt-0.5">
                <span className="text-[9px] font-bold tabular-nums text-muted-foreground/50">
                  {String(idx + 1).padStart(2, "0")}
                </span>
                <span className={`h-1 w-1 rounded-full ${TONE_DOT[rec.tone]}`} />
              </div>

              {/* Content */}
              <div className="min-w-0 flex-1">
                <div className="mb-0.5 flex items-center gap-1.5">
                  <span className={`text-[9px] font-bold uppercase tracking-[0.2em] ${TONE_TEXT[rec.tone]}`}>
                    {rec.badge}
                  </span>
                </div>
                <p className="text-[11px] leading-snug text-foreground/75">{rec.text}</p>
              </div>

              {/* Dismiss */}
              <button
                onClick={() => setDismissed((prev) => new Set([...prev, rec.id]))}
                className="shrink-0 pt-0.5 text-muted-foreground/30 opacity-0 group-hover:opacity-100 hover:text-muted-foreground transition-all"
                title="Dismiss"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </HudPanel>
  );
}

// ─── Incident Detail Panel ────────────────────────────────────
const INC_STATUS_CYCLE: Record<string, string> = {
  open: "investigating",
  investigating: "resolved",
  resolved: "dismissed",
  dismissed: "open",
};
const INC_STATUS_ACTION: Record<string, string> = {
  open: "Investigate →",
  investigating: "Resolve →",
  resolved: "Dismiss →",
  dismissed: "Reopen →",
};
const INC_STATUS_COLOR: Record<string, string> = {
  open: "border-threat/50 bg-threat/10 text-threat",
  investigating: "border-warning/50 bg-warning/10 text-warning",
  resolved: "border-hud/50 bg-hud/10 text-hud",
  dismissed: "border-border text-muted-foreground",
};

function IncidentPanel({
  incident,
  t,
}: {
  incident: import("@/lib/mockData").Incident;
  t: (s: string) => string;
}) {
  const [busy, setBusy] = useState(false);

  async function handleAdvance() {
    setBusy(true);
    try {
      const next = INC_STATUS_CYCLE[incident.status] as
        | "open"
        | "investigating"
        | "resolved"
        | "dismissed";
      await patchIncident(incident.id, { status: next });
    } catch {
      /* ignore */
    }
    setBusy(false);
  }

  return (
    <HudPanel
      title={t("Incident Detail")}
      subtitle={incident.code}
      actions={
        <button
          onClick={() => selectIncident(null)}
          className="text-muted-foreground hover:text-threat"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      }
      bodyClassName="p-4 space-y-3"
    >
      <div className="flex items-start gap-2">
        <FileWarning
          className={`mt-0.5 h-4 w-4 shrink-0 ${
            incident.threat === "critical"
              ? "text-threat"
              : incident.threat === "high"
                ? "text-orange-400"
                : incident.threat === "medium"
                  ? "text-warning"
                  : "text-hud"
          }`}
        />
        <div>
          <div className="text-xs font-bold leading-snug">{incident.title}</div>
          {incident.description && (
            <div className="mt-1 text-[10px] leading-relaxed text-muted-foreground line-clamp-3">
              {incident.description}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="text-[9px] uppercase tracking-[0.15em] text-muted-foreground">
            {t("Threat")}
          </div>
          <ThreatBadge level={incident.threat} />
        </div>
        <div>
          <div className="text-[9px] uppercase tracking-[0.15em] text-muted-foreground">
            {t("Status")}
          </div>
          <span
            className={`mt-0.5 inline-block border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] ${INC_STATUS_COLOR[incident.status]}`}
          >
            {t(incident.status)}
          </span>
        </div>
        {incident.assignee && (
          <div className="col-span-2">
            <div className="text-[9px] uppercase tracking-[0.15em] text-muted-foreground">
              {t("Assignee")}
            </div>
            <div className="text-[10px]">{incident.assignee}</div>
          </div>
        )}
        {incident.lat != null && (
          <div className="col-span-2">
            <div className="text-[9px] uppercase tracking-[0.15em] text-muted-foreground">
              {t("Coordinates")}
            </div>
            <div className="font-mono text-[10px] text-hud">
              {incident.lat.toFixed(4)}, {incident.lng!.toFixed(4)}
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-1.5 border-t border-border/40 pt-2">
        <button
          onClick={handleAdvance}
          disabled={busy}
          className="flex items-center justify-center gap-1 border border-hud/40 py-1.5 text-[9px] uppercase tracking-[0.1em] text-hud transition-colors hover:bg-hud/10 disabled:opacity-40"
        >
          <ChevronRight className="h-3 w-3" />
          {t(INC_STATUS_ACTION[incident.status])}
        </button>
        <button
          onClick={() => selectIncident(null)}
          className="flex items-center justify-center gap-1 border border-border/50 py-1.5 text-[9px] uppercase tracking-[0.1em] text-muted-foreground transition-colors hover:border-border"
        >
          <X className="h-3 w-3" /> {t("Close")}
        </button>
      </div>
    </HudPanel>
  );
}

// ─── Small helpers ────────────────────────────────────────────
function Tag({
  children,
  color,
}: {
  children: React.ReactNode;
  color: "hud" | "warning" | "muted" | "threat";
}) {
  const map = {
    hud: "border-hud/50 text-hud",
    warning: "border-warning/50 text-warning",
    muted: "border-border text-muted-foreground",
    threat: "border-threat/50 text-threat",
  };
  return <span className={`border px-1.5 py-0.5 ${map[color]}`}>{children}</span>;
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{label}</div>
      <div className="hud-stat font-bold text-foreground">{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "tracked") {
    return (
      <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.1em] text-info">
        <span className="h-1.5 w-1.5 rounded-full bg-info blink-pulse" />
        TRK
      </span>
    );
  }
  if (status === "intercepted") {
    return (
      <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-warning">
        ↯ INTCPT
      </span>
    );
  }
  if (status === "neutralized") {
    return (
      <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-hud">
        ✓ NEUTR
      </span>
    );
  }
  return (
    <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
      ✗ LOST
    </span>
  );
}
