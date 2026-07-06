import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback, useRef } from "react";
import { useT } from "@/lib/i18n";
import { HudPanel, PageHeader } from "@/components/HudPanel";
import {
  BrainCircuit,
  Cpu,
  Layers,
  RefreshCw,
  Power,
  ShieldCheck,
  AlertTriangle,
  Check,
  X,
  Zap,
  Play,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Circle,
  Clock,
  TrendingUp,
  Activity,
} from "lucide-react";
import {
  auditApi,
  aiEngineApi,
  type ApiAuditLog,
  type AiEngineSettings,
  type AiAnalysisResult,
} from "@/lib/api";
import { useStore, approveAiAction, rejectAiAction } from "@/lib/store";
import { format } from "date-fns";

export const Route = createFileRoute("/ai-control")({
  component: AIControl,
  head: () => ({ meta: [{ title: "AI Control // DDS" }] }),
});

// ─── Model registry ───────────────────────────────────────────
const MODEL_REGISTRY = [
  { id: "threatnet",   name: "ThreatNet v3.2",  task: "Threat classification",         acc: 94.7, defaultThreshold: 72 },
  { id: "trajpredict", name: "TrajPredict v2.1", task: "Trajectory forecasting",        acc: 88.2, defaultThreshold: 68 },
  { id: "rfsig",       name: "RFSig-XL",         task: "RF signature matching",         acc: 96.4, defaultThreshold: 80 },
  { id: "birdfilter",  name: "BirdFilter v1.8",  task: "False-positive suppression",    acc: 99.1, defaultThreshold: 85 },
  { id: "swarmdetect", name: "SwarmDetect β",    task: "Coordinated swarm detection",   acc: 81.3, defaultThreshold: 60 },
];

type OpMode = "passive" | "advisory" | "autonomous";

interface ModelConfig { enabled: boolean; threshold: number }

function defaultModels(): Record<string, ModelConfig> {
  const m: Record<string, ModelConfig> = {};
  for (const model of MODEL_REGISTRY)
    m[model.id] = { enabled: true, threshold: model.defaultThreshold };
  return m;
}

function apiToLocal(s: AiEngineSettings): AiEngineSettings & { models: Record<string, ModelConfig> } {
  const models = Object.keys(s.modelSettings ?? {}).length
    ? (s.modelSettings as Record<string, ModelConfig>)
    : defaultModels();
  return { ...s, models };
}

const SETTINGS_KEY = "dds_ai_settings_v2";

function loadLocalSettings(): (AiEngineSettings & { models: Record<string, ModelConfig> }) | null {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveLocalSettings(s: AiEngineSettings & { models: Record<string, ModelConfig> }) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

// ─── Evaluation pipeline phases ───────────────────────────────
interface EvalPhase {
  id: string;
  label: string;
  sublabel: string;
  durationMs: number;
  status: "pending" | "running" | "done" | "error";
  progress: number;
  result?: string;
}

const EVAL_PHASES_TEMPLATE: Omit<EvalPhase, "status" | "progress">[] = [
  { id: "sensor",  label: "Sensor initialization",         sublabel: "Collecting data from all nodes",          durationMs: 600  },
  { id: "preproc", label: "Signal preprocessing",          sublabel: "Normalization · noise filtering",         durationMs: 700  },
  { id: "infer1",  label: "ThreatNet v3.2 · RFSig-XL",    sublabel: "Threat classification · RF signatures",   durationMs: 1100 },
  { id: "infer2",  label: "TrajPredict · BirdFilter · β", sublabel: "Trajectories · filtering · swarms",       durationMs: 900  },
  { id: "dispatch",label: "AI-CORE dispatcher",            sublabel: "Forming decisions and action queues",     durationMs: 0    },
];

function initPhases(): EvalPhase[] {
  return EVAL_PHASES_TEMPLATE.map((p) => ({ ...p, status: "pending" as const, progress: 0 }));
}

// ─── Audit action labels ──────────────────────────────────────
const ACTION_LABELS: Record<string, string> = {
  PLAYBOOK_EXECUTE:    "Playbook executed",
  MISSION_UPDATE:      "Mission status changed",
  SENSOR_REBOOT:       "Sensor reboot triggered",
  SENSOR_DISABLE:      "Sensor disabled",
  ALERT_ACKNOWLEDGE:   "Alert acknowledged",
  INCIDENT_CREATE:     "Incident opened",
  INCIDENT_UPDATE:     "Incident updated",
  DETECTION_CREATE:    "Detection logged",
  PROFILE_UPDATE:      "Operator profile updated",
  PASSWORD_CHANGE:     "Password changed",
  LOGIN:               "Operator login",
  AI_ACTION_QUEUED:    "AI action queued",
  AI_ACTION_APPROVED:  "AI action approved",
  AI_ACTION_REJECTED:  "AI action rejected",
  AI_AUTO_ACTION:      "AI auto-action",
};

const AI_ACTIONS = new Set(["PLAYBOOK_EXECUTE", "SENSOR_REBOOT", "SENSOR_DISABLE", "DETECTION_CREATE"]);

const OP_MODE_META: Record<OpMode, { label: string; color: string; dot: string; desc: string }> = {
  passive:    { label: "Passive mode",    color: "text-muted-foreground", dot: "bg-muted-foreground", desc: "Monitor only. No autonomous actions." },
  advisory:   { label: "Advisory mode",   color: "text-warning",          dot: "bg-warning",          desc: "Suggest responses. Operator approval required for all." },
  autonomous: { label: "Autonomous mode", color: "text-threat",           dot: "bg-threat",           desc: "Executes high-confidence actions autonomously." },
};

const THREAT_LEVEL_META: Record<string, { label: string; color: string; bg: string; border: string }> = {
  low:      { label: "LOW",      color: "text-hud",              bg: "bg-hud/10",        border: "border-hud/50" },
  medium:   { label: "MEDIUM",   color: "text-warning",          bg: "bg-warning/10",    border: "border-warning/50" },
  high:     { label: "HIGH",     color: "text-orange-400",       bg: "bg-orange-400/10", border: "border-orange-400/50" },
  critical: { label: "CRITICAL", color: "text-threat",           bg: "bg-threat/10",     border: "border-threat/50" },
};

// ─── Main component ───────────────────────────────────────────
function AIControl() {
  const { t } = useT();
  const detections  = useStore((s) => s.detections);
  const incidents   = useStore((s) => s.incidents);
  const pendingActions = useStore((s) => s.pendingAiActions);

  const defaultLocalSettings = {
    opMode: "advisory" as OpMode,
    autoIncident: true,
    autoAck: false,
    autoPlaybook: false,
    globalMinConfidence: 60,
    modelSettings: {},
    models: defaultModels(),
  };

  const [settings, setSettings] = useState<AiEngineSettings & { models: Record<string, ModelConfig> }>(
    () => loadLocalSettings() ?? defaultLocalSettings,
  );
  const [decisions, setDecisions]   = useState<ApiAuditLog[]>([]);
  const [loading, setLoading]       = useState(true);
  const [savePending, setSavePending] = useState(false);
  const [logFilter, setLogFilter]   = useState<"all" | "ai" | "operator">("all");
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  // Evaluation state
  const [evalPhases, setEvalPhases]   = useState<EvalPhase[] | null>(null);
  const [evalRunning, setEvalRunning] = useState(false);
  const [evalResult, setEvalResult]   = useState<{ queued: number } | null>(null);
  const evalTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Claude analysis state
  const [analysisLoading, setAnalysisLoading]   = useState(false);
  const [analysisResult, setAnalysisResult]     = useState<AiAnalysisResult | null>(null);
  const [analysisError, setAnalysisError]       = useState<string | null>(null);
  const [analysisExpanded, setAnalysisExpanded] = useState(true);
  const [typedSummary, setTypedSummary]         = useState("");
  const typingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [logs, remote] = await Promise.all([auditApi.list(200), aiEngineApi.getSettings()]);
      setDecisions(logs.slice(0, 40));
      const s = apiToLocal(remote);
      setSettings(s);
      saveLocalSettings(s);
    } catch { /* ignore */ }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const patch = useCallback((update: Partial<typeof settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...update };
      saveLocalSettings(next);
      setSavePending(true);
      aiEngineApi.patchSettings({
        opMode: next.opMode,
        autoIncident: next.autoIncident,
        autoAck: next.autoAck,
        autoPlaybook: next.autoPlaybook,
        globalMinConfidence: next.globalMinConfidence,
        modelSettings: next.models,
      }).catch(() => {}).finally(() => setSavePending(false));
      return next;
    });
  }, []);

  const patchModel = useCallback((id: string, update: Partial<ModelConfig>) => {
    setSettings((prev) => {
      const next = { ...prev, models: { ...prev.models, [id]: { ...prev.models[id], ...update } } };
      saveLocalSettings(next);
      aiEngineApi.patchSettings({ modelSettings: next.models }).catch(() => {});
      return next;
    });
  }, []);

  async function handleApprove(id: string) {
    setActionBusy(id);
    try { await approveAiAction(id); } catch { /* ignore */ }
    setActionBusy(null);
  }

  async function handleReject(id: string) {
    setActionBusy(id);
    try { await rejectAiAction(id); } catch { /* ignore */ }
    setActionBusy(null);
  }

  // ── Evaluate with animated pipeline ──
  function handleEvaluate() {
    if (evalRunning) return;
    evalTimers.current.forEach(clearTimeout);
    evalTimers.current = [];
    setEvalResult(null);
    setEvalRunning(true);
    setEvalPhases(initPhases());

    const phases = EVAL_PHASES_TEMPLATE;
    let offset = 0;

    phases.forEach((phase, idx) => {
      const startAt = offset;
      offset += phase.durationMs + 200;

      // Start phase
      const t1 = setTimeout(() => {
        setEvalPhases((prev) => prev
          ? prev.map((p, i) => i === idx ? { ...p, status: "running", progress: 0 } : p)
          : null
        );

        // Animate progress bar
        const isLast = idx === phases.length - 1;
        const targetPct = isLast ? 50 : 88; // last phase waits for API
        const steps = 20;
        const stepMs = (phase.durationMs || 1500) / steps;

        for (let s = 1; s <= steps; s++) {
          const t = setTimeout(() => {
            setEvalPhases((prev) => prev
              ? prev.map((p, i) => i === idx && p.status === "running"
                  ? { ...p, progress: Math.round((s / steps) * targetPct) }
                  : p)
              : null
            );
          }, s * stepMs);
          evalTimers.current.push(t);
        }
      }, startAt);
      evalTimers.current.push(t1);

      // Complete non-last phases
      if (idx < phases.length - 1) {
        const t2 = setTimeout(() => {
          setEvalPhases((prev) => prev
            ? prev.map((p, i) => i === idx ? { ...p, status: "done", progress: 100 } : p)
            : null
          );
        }, startAt + phase.durationMs);
        evalTimers.current.push(t2);
      }
    });

    // Last phase: fire actual API call
    const lastIdx = phases.length - 1;
    const apiStart = offset - 200;

    const tApi = setTimeout(async () => {
      try {
        const prevPending = pendingActions.length;
        await aiEngineApi.evaluate();
        // Short pause then complete
        await new Promise((r) => setTimeout(r, 600));
        setEvalPhases((prev) => prev
          ? prev.map((p, i) => i === lastIdx ? { ...p, status: "done", progress: 100 } : p)
          : null
        );
        setEvalResult({ queued: Math.max(0, pendingActions.length - prevPending) });
        // Refresh log
        auditApi.list(200).then((logs) => setDecisions(logs.slice(0, 40))).catch(() => {});
      } catch {
        setEvalPhases((prev) => prev
          ? prev.map((p, i) => i === lastIdx ? { ...p, status: "error", progress: 0, result: "API Error" } : p)
          : null
        );
      } finally {
        setEvalRunning(false);
      }
    }, apiStart);
    evalTimers.current.push(tApi);
  }

  // ── Claude analysis ──
  async function handleAnalyze() {
    if (analysisLoading) return;
    setAnalysisLoading(true);
    setAnalysisResult(null);
    setAnalysisError(null);
    setTypedSummary("");
    setAnalysisExpanded(true);

    if (typingRef.current) { clearInterval(typingRef.current); typingRef.current = null; }

    try {
      const result = await aiEngineApi.analyze();
      setAnalysisResult(result);
      // Type out summary
      let i = 0;
      const full = result.summary;
      typingRef.current = setInterval(() => {
        i += 2;
        setTypedSummary(full.slice(0, i));
        if (i >= full.length) {
          clearInterval(typingRef.current!);
          typingRef.current = null;
          setTypedSummary(full);
        }
      }, 25);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Analysis error";
      if (msg.includes("ANTHROPIC_API_KEY not configured") || msg.includes("503")) {
        setAnalysisError("ANTHROPIC_API_KEY not configured. Add the key to server/.env and restart.");
      } else {
        setAnalysisError(msg);
      }
    } finally {
      setAnalysisLoading(false);
    }
  }

  async function queueAnalysisAction(action: AiAnalysisResult["actions"][0]) {
    try {
      await aiEngineApi.createPending({
        actionType: action.type,
        payload: { description: action.description },
        reason: `[Claude AI] ${action.description}`,
        confidence: action.confidence ?? 80,
      });
    } catch { /* ignore */ }
  }

  useEffect(() => () => {
    evalTimers.current.forEach(clearTimeout);
    if (typingRef.current) clearInterval(typingRef.current);
  }, []);

  // KPI
  const activeModels   = MODEL_REGISTRY.filter((m) => settings.models[m.id]?.enabled).length;
  const criticalCount  = detections.filter((d) => d.threat === "critical").length;
  const avgConf        = detections.length
    ? Math.round(detections.reduce((s, d) => s + d.confidence, 0) / detections.length)
    : 0;
  const openIncidents  = incidents.filter((i) => i.status === "open" || i.status === "investigating").length;

  const opMeta = OP_MODE_META[settings.opMode];
  const filteredLog = decisions.filter((d) => {
    if (logFilter === "ai")       return AI_ACTIONS.has(d.action);
    if (logFilter === "operator") return !AI_ACTIONS.has(d.action);
    return true;
  });

  return (
    <div>
      <PageHeader
        title={t("AI Control")}
        subtitle={t("Inference orchestration · autonomous decision audit")}
        actions={
          <div className="flex items-center gap-2">
            {savePending && (
              <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">{t("Saving...")}</span>
            )}
            <button
              onClick={handleAnalyze}
              disabled={analysisLoading}
              className="flex items-center gap-1.5 border border-purple-500/40 bg-purple-500/5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-purple-400 transition-colors hover:bg-purple-500/10 disabled:opacity-40"
            >
              <Sparkles className={`h-3 w-3 ${analysisLoading ? "animate-pulse" : ""}`} />
              {analysisLoading ? t("Analyzing…") : t("Analyze (Claude AI)")}
            </button>
            <button
              onClick={handleEvaluate}
              disabled={evalRunning}
              className="flex items-center gap-1.5 border border-hud/40 bg-hud/5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-hud transition-colors hover:bg-hud/10 disabled:opacity-40"
            >
              <Play className={`h-3 w-3 ${evalRunning ? "animate-pulse" : ""}`} />
              {evalRunning ? t("Evaluating…") : t("Run Evaluation")}
            </button>
            <span className={`flex items-center gap-1.5 border px-2 py-1 text-[10px] font-bold uppercase tracking-[0.2em] ${
              settings.opMode === "autonomous"
                ? "border-threat/60 bg-threat/10 text-threat"
                : settings.opMode === "advisory"
                  ? "border-warning/60 bg-warning/10 text-warning"
                  : "border-border text-muted-foreground"
            }`}>
              <span className={`h-1.5 w-1.5 rounded-full ${opMeta.dot} ${settings.opMode !== "passive" ? "blink-pulse" : ""}`} />
              {t(opMeta.label)}
            </span>
          </div>
        }
      />

      {/* ── Claude Analysis Panel ── */}
      {(analysisResult || analysisError || analysisLoading) && (
        <div className="mx-6 mb-3">
          <HudPanel
            title={t("Threat Assessment · Claude AI")}
            subtitle={analysisResult ? `${t("Evaluation complete")} · ${format(new Date(analysisResult.timestamp), "HH:mm:ss")}` : analysisLoading ? t("Querying model…") : "Error"}
            bodyClassName="p-0"
            actions={
              <div className="flex items-center gap-2">
                {analysisResult && (
                  <ThreatBadge level={analysisResult.threatLevel} />
                )}
                <button
                  onClick={() => setAnalysisExpanded((v) => !v)}
                  className="text-muted-foreground hover:text-hud"
                >
                  {analysisExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
                <button
                  onClick={() => { setAnalysisResult(null); setAnalysisError(null); }}
                  className="text-muted-foreground hover:text-threat"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            }
          >
            {analysisExpanded && (
              <div className="p-4">
                {analysisLoading && (
                  <div className="flex items-center gap-3 py-6">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-purple-400 border-t-transparent" />
                    <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Claude analyzing tactical situation…</span>
                  </div>
                )}
                {analysisError && (
                  <div className="rounded border border-threat/30 bg-threat/8 p-3 text-xs text-threat">
                    {analysisError}
                  </div>
                )}
                {analysisResult && (
                  <div className="space-y-4">
                    {/* Summary with typing effect */}
                    <div>
                      <div className="mb-1.5 text-[9px] uppercase tracking-[0.2em] text-muted-foreground">{t("Situational assessment")}</div>
                      <p className="text-sm leading-relaxed text-foreground">
                        {typedSummary}
                        {typedSummary.length < analysisResult.summary.length && (
                          <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-purple-400" />
                        )}
                      </p>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      {/* Observations */}
                      <div>
                        <div className="mb-2 text-[9px] uppercase tracking-[0.2em] text-muted-foreground">{t("Observations")}</div>
                        <ul className="space-y-1.5">
                          {analysisResult.observations.map((obs, i) => (
                            <li key={i} className="flex items-start gap-2 text-[11px] text-foreground/80">
                              <Circle className="mt-0.5 h-2 w-2 shrink-0 fill-purple-400 text-purple-400" />
                              {obs}
                            </li>
                          ))}
                        </ul>
                      </div>
                      {/* Recommendations */}
                      <div>
                        <div className="mb-2 text-[9px] uppercase tracking-[0.2em] text-muted-foreground">{t("Recommendations")}</div>
                        <ul className="space-y-1.5">
                          {analysisResult.recommendations.map((rec, i) => (
                            <li key={i} className="flex items-start gap-2 text-[11px] text-foreground/80">
                              <TrendingUp className="mt-0.5 h-2 w-2 shrink-0 text-hud" />
                              {rec}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    {/* Suggested actions */}
                    {analysisResult.actions.length > 0 && (
                      <div>
                        <div className="mb-2 text-[9px] uppercase tracking-[0.2em] text-muted-foreground">Suggested actions</div>
                        <div className="space-y-2">
                          {analysisResult.actions.map((action, i) => {
                            const prioColor = action.priority === "high" ? "text-threat border-threat/40 bg-threat/8" : action.priority === "medium" ? "text-warning border-warning/40 bg-warning/8" : "text-hud border-hud/40 bg-hud/8";
                            return (
                              <div key={i} className={`flex items-center justify-between gap-3 border p-2.5 ${prioColor}`}>
                                <div className="min-w-0 flex-1">
                                  <div className="text-[9px] font-bold uppercase tracking-[0.15em]">{action.type}</div>
                                  <div className="mt-0.5 text-[10px] text-foreground/70">{action.description}</div>
                                </div>
                                <div className="flex shrink-0 items-center gap-2">
                                  <span className="font-mono text-[10px]">{action.confidence ?? 80}%</span>
                                  <button
                                    onClick={() => queueAnalysisAction(action)}
                                    className="border border-current/50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] hover:bg-current/10 transition-colors"
                                  >
                                    {t("Queue action")}
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </HudPanel>
        </div>
      )}

      {/* ── Evaluation Progress Panel ── */}
      {evalPhases && (
        <div className="mx-6 mb-3">
          <HudPanel
            title="AI-CORE Evaluation"
            subtitle={evalRunning ? "Running analysis…" : evalResult ? `${t("Evaluation complete")} · ${evalResult.queued} ${t("actions queued")}` : "Done"}
            bodyClassName="p-4"
          >
            <div className="space-y-3">
              {evalPhases.map((phase, i) => (
                <div key={phase.id}>
                  <div className="mb-1.5 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <PhaseStatusIcon status={phase.status} />
                      <div>
                        <div className={`text-[10px] font-bold uppercase tracking-[0.15em] ${
                          phase.status === "done"    ? "text-hud" :
                          phase.status === "running" ? "text-foreground" :
                          phase.status === "error"   ? "text-threat" :
                          "text-muted-foreground"
                        }`}>{phase.label}</div>
                        <div className="text-[9px] text-muted-foreground/70">{phase.sublabel}</div>
                      </div>
                    </div>
                    <span className={`font-mono text-[10px] ${phase.status === "running" ? "text-hud" : "text-muted-foreground"}`}>
                      {phase.status === "done" ? "100%" : phase.status === "error" ? "ERR" : phase.status === "running" ? `${phase.progress}%` : "—"}
                    </span>
                  </div>
                  <div className="h-1 w-full bg-muted/40">
                    <div
                      className={`h-full transition-all duration-200 ease-out ${
                        phase.status === "done"    ? "bg-hud" :
                        phase.status === "running" ? "bg-hud/70" :
                        phase.status === "error"   ? "bg-threat" :
                        "bg-transparent"
                      }`}
                      style={{ width: phase.status === "done" ? "100%" : `${phase.progress}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
            {evalResult && (
              <div className="mt-4 border-t border-border/40 pt-3 flex items-center justify-between text-[10px]">
                <span className="text-muted-foreground">{t("Evaluation complete")}</span>
                <button
                  onClick={() => { setEvalPhases(null); setEvalResult(null); }}
                  className="text-muted-foreground hover:text-hud"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </HudPanel>
        </div>
      )}

      {/* ── KPI row ── */}
      <div className="grid gap-3 px-4 py-4 sm:px-6 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={BrainCircuit}  label={t("Active models")}    value={`${activeModels} / ${MODEL_REGISTRY.length}`} tone="hud" />
        <KpiCard icon={Layers}        label={t("Detections (all)")} value={String(detections.length)}                    tone="hud" />
        <KpiCard icon={AlertTriangle} label={t("Critical events")}  value={String(criticalCount)}                        tone={criticalCount > 0 ? "threat" : "hud"} />
        <KpiCard icon={Activity}      label={t("Avg confidence")}   value={`${avgConf}%`}                                tone={avgConf < 70 ? "warning" : "hud"} />
      </div>

      {/* ── Pending Actions ── */}
      {(pendingActions.length > 0 || settings.opMode === "advisory") && (
        <div className="mx-6 mb-3">
          <HudPanel
            title={t("Pending AI Actions")}
            subtitle={pendingActions.length > 0
              ? `${pendingActions.length} ${t("actions awaiting approval")}`
              : t("No pending actions")}
            bodyClassName="p-0"
            actions={
              <span className={`border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.15em] ${
                settings.opMode === "advisory"
                  ? "border-warning/50 bg-warning/10 text-warning"
                  : "border-border text-muted-foreground"
              }`}>{t("Human-in-the-loop")}</span>
            }
          >
            {pendingActions.length === 0 ? (
              <div className="px-4 py-5 text-center text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                {t("All clear — no pending AI actions")}
              </div>
            ) : (
              <div className="divide-y divide-border/40">
                {pendingActions.map((action) => (
                  <PendingActionCard
                    key={action.id}
                    action={action}
                    busy={actionBusy === action.id}
                    onApprove={() => handleApprove(action.id)}
                    onReject={() => handleReject(action.id)}
                  />
                ))}
              </div>
            )}
          </HudPanel>
        </div>
      )}

      <div className="grid gap-3 px-4 pb-4 sm:px-6 lg:grid-cols-[2fr_1fr]">
        {/* Model Roster */}
        <HudPanel
          title={t("Deployed Models")}
          subtitle={`${activeModels} ${t("active")} · ${MODEL_REGISTRY.length - activeModels} ${t("offline")}`}
          bodyClassName="p-0"
        >
          <div className="divide-y divide-border/40">
            {MODEL_REGISTRY.map((m) => {
              const cfg = settings.models[m.id] ?? { enabled: true, threshold: m.defaultThreshold };
              const isBeta = m.name.includes("β");
              return (
                <div key={m.id} className={`px-4 py-3 transition-colors ${cfg.enabled ? "" : "opacity-50"}`}>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => patchModel(m.id, { enabled: !cfg.enabled })}
                      className={`shrink-0 border px-2 py-1 text-[9px] font-bold uppercase tracking-[0.15em] transition-colors ${
                        cfg.enabled
                          ? "border-hud/50 bg-hud/10 text-hud hover:bg-threat/10 hover:border-threat/50 hover:text-threat"
                          : "border-border text-muted-foreground hover:border-hud hover:text-hud"
                      }`}
                      title={cfg.enabled ? t("Click to disable") : t("Click to enable")}
                    >
                      <Power className="h-3 w-3" />
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold uppercase tracking-wider text-foreground">{m.name}</span>
                        {isBeta && (
                          <span className="border border-warning/50 bg-warning/10 px-1 text-[8px] font-bold uppercase tracking-[0.1em] text-warning">β</span>
                        )}
                        {!cfg.enabled && (
                          <span className="text-[9px] uppercase tracking-[0.15em] text-muted-foreground">{t("Disabled")}</span>
                        )}
                      </div>
                      <div className="mt-0.5 text-[10px] uppercase tracking-[0.15em] text-muted-foreground">{t(m.task)}</div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="hud-stat text-sm font-bold text-hud">{m.acc}%</div>
                      <div className="text-[9px] uppercase tracking-[0.15em] text-muted-foreground">{t("accuracy")}</div>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center gap-3">
                    <span className="w-32 shrink-0 text-[9px] uppercase tracking-[0.15em] text-muted-foreground">{t("Confidence min")}</span>
                    <input
                      type="range" min={50} max={99}
                      value={cfg.threshold} disabled={!cfg.enabled}
                      onChange={(e) => patchModel(m.id, { threshold: Number(e.target.value) })}
                      className="flex-1 accent-[var(--hud)] disabled:opacity-30"
                    />
                    <span className="w-10 shrink-0 text-right font-mono text-xs text-hud">{cfg.threshold}%</span>
                    <div className="w-20 shrink-0">
                      <div className="h-1 w-full bg-muted">
                        <div
                          className={`h-full transition-all duration-300 ${m.acc >= cfg.threshold ? "bg-hud" : "bg-warning"}`}
                          style={{ width: `${m.acc}%` }}
                        />
                      </div>
                      <div className={`mt-0.5 text-[8px] uppercase tracking-[0.1em] ${m.acc >= cfg.threshold ? "text-hud" : "text-warning"}`}>
                        {m.acc >= cfg.threshold ? t("above threshold") : t("below threshold")}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </HudPanel>

        {/* Settings */}
        <div className="space-y-3">
          {/* Op mode */}
          <HudPanel title={t("Operational Mode")} bodyClassName="p-4">
            <div className="space-y-2">
              {(["passive", "advisory", "autonomous"] as const).map((mode) => {
                const meta = OP_MODE_META[mode];
                const active = settings.opMode === mode;
                return (
                  <button
                    key={mode}
                    onClick={() => patch({ opMode: mode })}
                    className={`flex w-full items-start gap-3 border p-2.5 text-left transition-colors ${
                      active
                        ? mode === "autonomous" ? "border-threat/60 bg-threat/8"
                        : mode === "advisory" ? "border-warning/60 bg-warning/8"
                        : "border-border bg-muted/10"
                        : "border-border/40 hover:border-border"
                    }`}
                  >
                    <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${active ? meta.dot : "bg-border"} ${active && mode !== "passive" ? "blink-pulse" : ""}`} />
                    <div>
                      <div className={`text-[10px] font-bold uppercase tracking-[0.2em] ${active ? meta.color : "text-muted-foreground"}`}>
                        {t(meta.label)}
                      </div>
                      <div className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">{t(meta.desc)}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </HudPanel>

          {/* Auto-actions */}
          <HudPanel title={t("Autonomous Actions")} bodyClassName="p-4 space-y-3">
            <Toggle
              label={t("Auto-create incident")}
              sub={t("Open incident on critical detection")}
              checked={settings.autoIncident}
              onChange={(v) => patch({ autoIncident: v })}
            />
            <Toggle
              label={t("Auto-acknowledge alerts")}
              sub={t("Dismiss low-threat alerts automatically")}
              checked={settings.autoAck}
              onChange={(v) => patch({ autoAck: v })}
            />
            <Toggle
              label={t("Auto-execute playbooks")}
              sub={t("Run matching playbook on confirmed threat")}
              checked={settings.autoPlaybook}
              onChange={(v) => patch({ autoPlaybook: v })}
              disabled={settings.opMode !== "autonomous"}
              disabledNote={t("Requires Autonomous mode")}
            />
            <div className="border-t border-border/40 pt-3">
              <div className="mb-1.5 flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                <span>{t("Global confidence minimum")}</span>
                <span className="font-mono font-bold text-hud">{settings.globalMinConfidence}%</span>
              </div>
              <input
                type="range" min={40} max={95}
                value={settings.globalMinConfidence}
                onChange={(e) => patch({ globalMinConfidence: Number(e.target.value) })}
                className="w-full accent-[var(--hud)]"
              />
              <div className="mt-1 text-[9px] uppercase tracking-[0.15em] text-muted-foreground">
                {t("Detections below this threshold are flagged low-confidence")}
              </div>
            </div>
          </HudPanel>

          {/* Pipeline health */}
          <HudPanel title={t("Inference Pipeline")} bodyClassName="p-4">
            <div className="space-y-2">
              {[
                { stage: t("Sensor Input"),      ms: 4,  ok: true },
                { stage: t("Preprocessing"),      ms: 11, ok: true },
                { stage: t("Model Inference"),    ms: 47, ok: true },
                { stage: t("Post-processing"),    ms: 8,  ok: true },
                { stage: t("Alert Dispatch"),     ms: 3,  ok: openIncidents < 10 },
              ].map((p) => (
                <div key={p.stage} className="flex items-center gap-2 text-[10px]">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${p.ok ? "bg-hud" : "bg-warning"}`} />
                  <span className="flex-1 text-muted-foreground">{p.stage}</span>
                  <span className="hud-stat font-mono text-hud">{p.ms} ms</span>
                </div>
              ))}
              <div className="mt-2 border-t border-border/40 pt-2 flex justify-between text-[10px]">
                <span className="text-muted-foreground">{t("Total latency")}</span>
                <span className="hud-stat font-bold text-hud">73 ms</span>
              </div>
            </div>
          </HudPanel>
        </div>
      </div>

      {/* Decision Log */}
      <HudPanel
        title={t("Autonomous Decision Log")}
        subtitle={loading ? t("Loading…") : `${filteredLog.length} ${t("events")}`}
        className="mx-6 mb-6"
        bodyClassName="p-0"
        actions={
          <div className="flex items-center gap-1.5">
            {(["all", "ai", "operator"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setLogFilter(f)}
                className={`border px-2 py-0.5 text-[9px] uppercase tracking-[0.15em] transition-colors ${
                  logFilter === f
                    ? "border-hud bg-hud/10 text-hud"
                    : "border-border/60 text-muted-foreground hover:border-hud hover:text-hud"
                }`}
              >
                {f === "all" ? t("All") : f === "ai" ? "AI" : t("operator")}
              </button>
            ))}
            <button onClick={load} disabled={loading} className="ml-1 text-muted-foreground hover:text-hud disabled:opacity-40">
              <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        }
      >
        <div className="max-h-72 divide-y divide-border/40 overflow-y-auto">
          {loading && (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">{t("Loading…")}</div>
          )}
          {!loading && filteredLog.length === 0 && (
            <div className="px-4 py-6 text-center text-xs uppercase tracking-[0.2em] text-muted-foreground">{t("No events")}</div>
          )}
          {filteredLog.map((d) => {
            const isAi = AI_ACTIONS.has(d.action);
            return (
              <div key={d.id} className="flex items-start gap-4 px-4 py-2.5 hover:bg-hud/3">
                <span className="hud-stat w-16 shrink-0 text-[10px] text-muted-foreground">
                  {d.timestamp ? format(new Date(d.timestamp), "HH:mm:ss") : "—"}
                </span>
                <span className={`w-20 shrink-0 border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] ${
                  isAi ? "border-hud/40 bg-hud/8 text-hud" : "border-border/50 text-muted-foreground"
                }`}>
                  {isAi ? "AI-CORE" : (d.operatorName ?? "SYSTEM")}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium">{t(ACTION_LABELS[d.action] ?? d.action)}</div>
                  {d.resourceId && (
                    <div className="mt-0.5 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{d.resourceId}</div>
                  )}
                </div>
                <span className="shrink-0 flex items-center gap-1 text-[9px] uppercase tracking-[0.12em] text-hud">
                  <ShieldCheck className="h-3 w-3" /> {t("Detection logged")}
                </span>
              </div>
            );
          })}
        </div>
      </HudPanel>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────

function ThreatBadge({ level }: { level: string }) {
  const meta = THREAT_LEVEL_META[level] ?? THREAT_LEVEL_META.low;
  return (
    <span className={`border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.15em] ${meta.color} ${meta.bg} ${meta.border}`}>
      {meta.label}
    </span>
  );
}

function PhaseStatusIcon({ status }: { status: EvalPhase["status"] }) {
  if (status === "done")    return <Check className="h-3.5 w-3.5 shrink-0 text-hud" />;
  if (status === "error")   return <X className="h-3.5 w-3.5 shrink-0 text-threat" />;
  if (status === "running") return <div className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-hud border-t-transparent" />;
  return <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />;
}

function KpiCard({ icon: Icon, label, value, tone }: {
  icon: typeof BrainCircuit; label: string; value: string; tone: "hud" | "warning" | "threat";
}) {
  const color = tone === "threat" ? "text-threat" : tone === "warning" ? "text-warning" : "text-hud";
  return (
    <HudPanel bodyClassName="px-4 py-3 flex items-center gap-3">
      <Icon className={`h-5 w-5 shrink-0 ${color}`} />
      <div>
        <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">{label}</div>
        <div className={`hud-stat text-2xl font-bold ${color}`}>{value}</div>
      </div>
    </HudPanel>
  );
}

function Toggle({ label, sub, checked, onChange, disabled, disabledNote }: {
  label: string; sub: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; disabledNote?: string;
}) {
  return (
    <label className={`flex cursor-pointer items-start gap-2.5 ${disabled ? "opacity-40" : ""}`}>
      <input
        type="checkbox" checked={checked} disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 accent-[var(--hud)]"
      />
      <div>
        <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-foreground">{label}</div>
        <div className="text-[10px] text-muted-foreground">{disabled && disabledNote ? disabledNote : sub}</div>
      </div>
    </label>
  );
}

const ACTION_TYPE_META: Record<string, { label: string; icon: typeof Zap; color: string }> = {
  CREATE_INCIDENT:       { label: "Open Incident",          icon: AlertTriangle, color: "text-threat" },
  ACK_ALERT:             { label: "Acknowledge Alert",       icon: Check,         color: "text-hud" },
  RUN_PLAYBOOK:          { label: "Execute Playbook",        icon: Play,          color: "text-warning" },
  INCREASE_MONITORING:   { label: "Increase Monitoring",     icon: Activity,      color: "text-purple-400" },
};

function PendingActionCard({ action, busy, onApprove, onReject }: {
  action: import("@/lib/api").AiPendingAction;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const { t } = useT();
  const meta = ACTION_TYPE_META[action.actionType] ?? { label: action.actionType, icon: Zap, color: "text-hud" };
  const Icon = meta.icon;
  const confColor = action.confidence >= 85 ? "text-hud" : action.confidence >= 65 ? "text-warning" : "text-threat";

  return (
    <div className={`px-4 py-3 transition-colors hover:bg-hud/3 ${busy ? "opacity-50" : ""}`}>
      <div className="flex items-start gap-3">
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${meta.color}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[9px] font-bold uppercase tracking-[0.15em] border px-1.5 py-0.5 ${
              action.actionType === "CREATE_INCIDENT"
                ? "border-threat/40 bg-threat/8 text-threat"
                : action.actionType === "RUN_PLAYBOOK"
                  ? "border-warning/40 bg-warning/8 text-warning"
                  : action.actionType === "INCREASE_MONITORING"
                    ? "border-purple-400/40 bg-purple-400/8 text-purple-400"
                    : "border-hud/40 bg-hud/8 text-hud"
            }`}>{t(meta.label)}</span>
            <span className={`font-mono text-[10px] font-bold ${confColor}`}>{action.confidence}%</span>
          </div>
          <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">{action.reason}</p>
          <div className="mt-1 text-[9px] uppercase tracking-[0.12em] text-muted-foreground/60">
            {format(new Date(action.createdAt), "HH:mm:ss")} · AI-CORE
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            onClick={onApprove} disabled={busy}
            className="flex items-center gap-1 border border-hud/50 bg-hud/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.15em] text-hud transition-colors hover:bg-hud/20 disabled:opacity-40"
          >
            <Check className="h-3 w-3" /> {t("Approve")}
          </button>
          <button
            onClick={onReject} disabled={busy}
            className="flex items-center gap-1 border border-threat/50 bg-threat/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.15em] text-threat transition-colors hover:bg-threat/20 disabled:opacity-40"
          >
            <X className="h-3 w-3" /> {t("Reject")}
          </button>
        </div>
      </div>
    </div>
  );
}
