import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import { HudPanel, PageHeader } from "@/components/HudPanel";
import {
  ChevronRight,
  Play,
  ShieldCheck,
  Radio,
  Lock,
  AlertOctagon,
  Loader2,
  CheckCircle,
  RefreshCw,
  Clock,
  Info,
  X,
  Zap,
  Users,
  BookOpen,
  TriangleAlert,
  UserCheck,
} from "lucide-react";
import { playbooksApi, type ApiPlaybook } from "@/lib/api";

export const Route = createFileRoute("/playbooks")({
  component: Playbooks,
  head: () => ({ meta: [{ title: "Response Playbooks // DDS" }] }),
});

const SEV_COLOR: Record<string, string> = {
  critical: "text-threat border-threat/50 bg-threat/10",
  high: "text-threat/90 border-threat/40 bg-threat/5",
  medium: "text-warning border-warning/40 bg-warning/10",
  low: "text-info border-info/40 bg-info/10",
};

interface Step {
  order: number;
  action: string;
  responsible: string;
}

type StepStatus = "running" | "waiting" | "done";

interface StepState {
  status: StepStatus;
  elapsed?: number;
}

function isAuto(responsible: string) {
  return responsible.toLowerCase().includes("ai") || responsible.toLowerCase().includes("system");
}

const LAST_RUN_KEY = "dds_playbook_last_run";
const ABOUT_KEY = "dds_playbooks_about_dismissed";

const TRIGGER_CONDITIONS: Record<string, string[]> = {
  critical: [
    "Hostile drone signature crosses inner perimeter ring",
    "AI confidence ≥ 90% on critical threat classification",
    "Swarm formation of 3+ contacts confirmed",
    "GPS spoofing or jamming signal detected",
  ],
  high: [
    "Sustained tracking of unknown contact for > 60 s",
    "High-threat drone approaches restricted geo-zone",
    "RF emission matches military-grade frequency pattern",
    "Visual confirmation of payload-capable airframe",
  ],
  medium: [
    "RF anomaly detected in monitored spectrum band",
    "Sensor health degrades below 70% threshold",
    "Repeated loitering in buffer zone (> 3 min)",
    "Unresolved detection after automated ID timeout",
  ],
  low: [
    "Sensor degradation event logged by SYS-MON",
    "Scheduled maintenance window approaching",
    "False positive rate exceeds 15% in current shift",
    "Operator-initiated drill or tabletop exercise",
  ],
};

const PURPOSE_MAP: Record<string, string> = {
  perimeter:
    "Coordinate immediate response to confirmed airspace violations. Escalates from sensor alert through engagement decision with documented chain-of-command approval.",
  swarm:
    "Handle coordinated multi-contact incursions. Activates all radar nodes, calculates intercept vectors via AI-CORE, and sequences electronic countermeasures.",
  rf: "Investigate unidentified RF emissions and potential jamming/spoofing attempts. Cross-references signal database and escalates to senior operator if military-grade interference is confirmed.",
  sensor:
    "Restore sensor network coverage after equipment failure. Redirects monitoring to adjacent nodes while scheduling maintenance, ensuring no detection gap.",
};

function getPurposeKey(name: string): string {
  const n = name.toUpperCase();
  if (n.includes("PERIMETER") || n.includes("BREACH")) return "perimeter";
  if (n.includes("SWARM")) return "swarm";
  if (n.includes("RF") || n.includes("ANOMALY")) return "rf";
  if (n.includes("SENSOR") || n.includes("DEGRADAT")) return "sensor";
  return "";
}

function loadLastRun(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(LAST_RUN_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function Playbooks() {
  const { t } = useT();
  const [list, setList] = useState<ApiPlaybook[]>([]);
  const [active, setActive] = useState<ApiPlaybook | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [runDone, setRunDone] = useState(false);
  const [runErr, setRunErr] = useState("");
  const [runStep, setRunStep] = useState(-1);
  const [stepStates, setStepStates] = useState<Record<number, StepState>>({});
  const [waitingStep, setWaitingStep] = useState<number | null>(null);
  const confirmRef = useRef<(() => void) | null>(null);
  const [lastRun, setLastRun] = useState<Record<string, string>>(loadLastRun);
  const [showAbout, setShowAbout] = useState(() => !localStorage.getItem(ABOUT_KEY));

  async function load() {
    setLoading(true);
    try {
      const data = await playbooksApi.list();
      setList(data);
      if (!active && data.length > 0) setActive(data[0]);
    } catch {
      /* ignore */
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleExecute() {
    if (!active || running) return;
    setRunning(true);
    setRunDone(false);
    setRunErr("");
    setRunStep(-1);
    setStepStates({});
    setWaitingStep(null);

    const stepList = (active.steps as unknown as Step[]).sort((a, b) => a.order - b.order);

    for (let i = 0; i < stepList.length; i++) {
      const s = stepList[i];
      const auto = isAuto(s.responsible);
      const start = Date.now();

      setRunStep(i);
      setStepStates((prev) => ({ ...prev, [i]: { status: auto ? "running" : "waiting" } }));

      if (auto) {
        // AUTO steps: realistic 1.5–4 s simulated processing
        await new Promise((r) => setTimeout(r, 1500 + Math.random() * 2500));
      } else {
        // MANUAL steps: block until operator clicks "Confirm step"
        setWaitingStep(i);
        await new Promise<void>((resolve) => {
          confirmRef.current = resolve;
        });
        setWaitingStep(null);
      }

      const elapsed = Math.round((Date.now() - start) / 100) / 10;
      setStepStates((prev) => ({ ...prev, [i]: { status: "done", elapsed } }));
      if (i < stepList.length - 1) await new Promise((r) => setTimeout(r, 300));
    }

    try {
      await playbooksApi.execute(active.id);
      const now = new Date().toISOString();
      const updated = { ...lastRun, [active.id]: now };
      setLastRun(updated);
      localStorage.setItem(LAST_RUN_KEY, JSON.stringify(updated));
      setRunDone(true);
      setTimeout(() => setRunDone(false), 5000);
    } catch {
      setRunErr(t("Execute failed — check server connection"));
    }
    setRunStep(-1);
    setRunning(false);
  }

  function handleConfirm() {
    if (confirmRef.current) {
      confirmRef.current();
      confirmRef.current = null;
    }
  }

  const steps: Step[] = active
    ? (active.steps as unknown as Step[]).sort((a, b) => a.order - b.order)
    : [];

  const autoCount = steps.filter((s) => isAuto(s.responsible)).length;
  const manualCount = steps.length - autoCount;

  const purposeKey = active ? getPurposeKey(active.name) : "";
  const purpose = active
    ? purposeKey
      ? t(PURPOSE_MAP[purposeKey])
      : t("Standard SOP for {{level}}-level threats. Follows STRF-2024 compliance with full audit trail.").replace(
          "{{level}}",
          active.threatLevel,
        )
    : "";

  return (
    <div>
      <PageHeader
        title={t("Response Playbooks")}
        subtitle={t("Automated SOPs · trigger conditions · approval gates")}
        actions={
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-2 border border-border px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:border-hud hover:text-hud disabled:opacity-40"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> {t("Refresh")}
          </button>
        }
      />

      {/* ── About banner ──────────────────────────────────────── */}
      {showAbout && (
        <div className="mx-6 mt-4 border border-hud/30 bg-hud/5">
          <div className="flex items-start justify-between gap-4 px-5 py-4">
            <div className="flex items-start gap-3">
              <BookOpen className="mt-0.5 h-5 w-5 shrink-0 text-hud" />
              <div>
                <div className="text-xs font-bold uppercase tracking-[0.2em] text-hud">
                  {t("What are Response Playbooks?")}
                </div>
                <p className="mt-1.5 max-w-3xl text-[11px] leading-relaxed text-muted-foreground">
                  {t(
                    "Playbooks are scripted Standard Operating Procedures (SOPs) defining step-by-step response actions for specific threat scenarios. Each playbook can be triggered manually by a qualified operator or automatically by the AI threat-correlation engine. All executions are cryptographically logged to the audit trail.",
                  )}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    {
                      icon: Zap,
                      title: t("AUTO Steps"),
                      desc: t("Executed by AI-CORE without human input"),
                    },
                    {
                      icon: Users,
                      title: t("MANUAL Steps"),
                      desc: t("Require operator acknowledgment before proceeding"),
                    },
                    {
                      icon: ShieldCheck,
                      title: t("2-of-3 Approval"),
                      desc: t("Critical playbooks need multi-party sign-off"),
                    },
                    {
                      icon: TriangleAlert,
                      title: t("Threat Levels"),
                      desc: t("LOW → MEDIUM → HIGH → CRITICAL escalation tiers"),
                    },
                  ].map(({ icon: Icon, title, desc }) => (
                    <div key={title} className="border border-border bg-background/40 px-3 py-2.5">
                      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.15em] text-hud">
                        <Icon className="h-3 w-3" /> {title}
                      </div>
                      <p className="mt-1 text-[10px] leading-snug text-muted-foreground">{desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <button
              onClick={() => {
                setShowAbout(false);
                localStorage.setItem(ABOUT_KEY, "1");
              }}
              className="shrink-0 text-muted-foreground hover:text-foreground"
              title="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {!showAbout && (
        <div className="flex items-center gap-2 px-6 pt-4 text-[10px] text-muted-foreground">
          <Info className="h-3 w-3" />
          <span>{t("Playbooks are scripted SOPs for automated incident response.")}</span>
          <button
            onClick={() => setShowAbout(true)}
            className="text-hud/70 hover:text-hud underline underline-offset-2"
          >
            {t("Learn more")}
          </button>
        </div>
      )}

      <div className="grid gap-3 px-6 py-4 lg:grid-cols-[1fr_2fr]">
        {/* Library list */}
        <HudPanel
          title={t("Library")}
          subtitle={loading ? t("Loading…") : `${list.length} ${t("playbooks")}`}
          bodyClassName="p-0"
        >
          {loading && (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-hud" />
            </div>
          )}
          {!loading && list.length === 0 && (
            <div className="px-4 py-8 text-center text-xs text-muted-foreground uppercase tracking-[0.2em]">
              {t("No playbooks in database")}
            </div>
          )}
          {list.map((p) => {
            const ran = lastRun[p.id];
            return (
              <button
                key={p.id}
                onClick={() => {
                  setActive(p);
                  setRunDone(false);
                  setRunErr("");
                  setRunStep(-1);
                  setStepStates({});
                  setWaitingStep(null);
                }}
                className={`flex w-full items-center justify-between border-b border-border/40 px-4 py-3 text-left transition-colors hover:bg-hud/5 ${
                  active?.id === p.id ? "bg-hud/10 border-l-2 border-l-hud" : ""
                }`}
              >
                <div className="min-w-0">
                  <div className="truncate text-xs font-bold uppercase tracking-wider">{p.name}</div>
                  <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span className={p.active ? "text-hud" : "text-muted-foreground"}>
                      {p.active ? t("● Active") : t("○ Inactive")}
                    </span>
                    <span>·</span>
                    <span className="hud-stat">
                      {(p.steps as unknown as Step[]).length} {t("steps")}
                    </span>
                  </div>
                  {ran && (
                    <div className="mt-0.5 flex items-center gap-1 text-[10px] text-hud/70">
                      <Clock className="h-2.5 w-2.5" />
                      {new Date(ran).toLocaleString("ru-KZ", { timeZone: "Asia/Almaty" })}
                    </div>
                  )}
                </div>
                <span
                  className={`ml-2 shrink-0 border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] ${SEV_COLOR[p.threatLevel] ?? ""}`}
                >
                  {p.threatLevel}
                </span>
              </button>
            );
          })}
        </HudPanel>

        {/* Detail panel */}
        <div className="space-y-3">
          {active ? (
            <>
              <HudPanel
                title={active.name}
                subtitle={`${t("Threat level:")} ${active.threatLevel.toUpperCase()}`}
                actions={
                  <div className="flex items-center gap-2">
                    {runDone && (
                      <span className="flex items-center gap-1 text-[10px] uppercase tracking-[0.2em] text-hud">
                        <CheckCircle className="h-3.5 w-3.5" /> {t("Logged")}
                      </span>
                    )}
                    <button
                      onClick={handleExecute}
                      disabled={running || !active.active}
                      className="flex items-center gap-2 border border-threat bg-threat/15 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.25em] text-threat hover:bg-threat/25 disabled:opacity-40"
                    >
                      {running ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Play className="h-3 w-3" />
                      )}
                      {running ? t("Running…") : t("Run Now")}
                    </button>
                  </div>
                }
              >
                <p className="mb-4 text-[11px] leading-relaxed text-muted-foreground border-l-2 border-hud/40 pl-3">
                  {purpose}
                </p>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <Field label={t("Threat Level")} value={active.threatLevel.toUpperCase()} />
                  <Field label={t("Status")} value={active.active ? t("ACTIVE") : t("INACTIVE")} />
                  <Field
                    label={t("Steps")}
                    value={`${steps.length} (${autoCount} auto · ${manualCount} manual)`}
                  />
                  <Field
                    label={t("Last Updated")}
                    value={active.updatedAt ? new Date(active.updatedAt).toLocaleDateString() : "—"}
                  />
                </div>
                {runErr && <div className="mt-3 text-[11px] text-threat">{runErr}</div>}
                {runDone && (
                  <div className="mt-3 border border-hud/30 bg-hud/5 px-3 py-2 text-[11px] text-hud">
                    {t("Execution logged to audit trail. Operators notified.")}
                  </div>
                )}
              </HudPanel>

              {/* Execution Steps */}
              <HudPanel
                title={t("Execution Steps")}
                subtitle={`${steps.length} ${t("stages")}`}
                bodyClassName="p-0"
              >
                {steps.map((s, i) => {
                  const auto = isAuto(s.responsible);
                  const state = stepStates[i];
                  const isRunningStep = state?.status === "running";
                  const isWaitingStep = state?.status === "waiting";
                  const isDone = state?.status === "done";

                  return (
                    <div
                      key={i}
                      className={`border-b border-border/40 px-4 py-3 transition-colors ${
                        isRunningStep
                          ? "bg-hud/15"
                          : isWaitingStep
                            ? "bg-warning/10"
                            : isDone
                              ? "bg-hud/5 opacity-60"
                              : ""
                      }`}
                    >
                      <div className="flex items-center gap-4">
                        {/* Step number / status badge */}
                        <div
                          className={`hud-stat flex h-7 w-7 shrink-0 items-center justify-center border text-[10px] font-bold ${
                            isDone
                              ? "border-hud/40 text-hud/60"
                              : isRunningStep
                                ? "border-hud bg-hud text-background animate-pulse"
                                : isWaitingStep
                                  ? "border-warning bg-warning/20 text-warning"
                                  : "border-hud/50 text-hud"
                          }`}
                        >
                          {isDone ? "✓" : isWaitingStep ? "!" : String(s.order).padStart(2, "0")}
                        </div>

                        {/* Step description */}
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-bold uppercase tracking-wider">{s.action}</div>
                          <div className="mt-0.5 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                            {t("Responsible")}:{" "}
                            <span className="text-foreground">{s.responsible}</span>
                          </div>
                          {isDone && state.elapsed !== undefined && (
                            <div className="mt-0.5 text-[10px] text-hud/70">
                              {state.elapsed} {t("s")}
                            </div>
                          )}
                          {isWaitingStep && (
                            <div className="mt-0.5 text-[10px] text-warning">
                              {t("Awaiting operator confirmation…")}
                            </div>
                          )}
                          {isRunningStep && (
                            <div className="mt-0.5 text-[10px] text-hud">
                              {t("Running…")}
                            </div>
                          )}
                        </div>

                        {/* AUTO / MANUAL badge */}
                        <span
                          className={`shrink-0 border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] ${
                            auto
                              ? "border-hud/50 text-hud bg-hud/10"
                              : "border-warning/50 text-warning bg-warning/10"
                          }`}
                        >
                          {auto ? t("AUTO") : t("MANUAL")}
                        </span>

                        {/* Right icon */}
                        {isRunningStep ? (
                          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-hud" />
                        ) : isDone ? (
                          <CheckCircle className="h-3.5 w-3.5 shrink-0 text-hud/60" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        )}
                      </div>

                      {/* MANUAL confirmation button — shown only when this step is waiting */}
                      {isWaitingStep && waitingStep === i && (
                        <div className="mt-3 flex justify-end">
                          <button
                            onClick={handleConfirm}
                            className="flex items-center gap-2 border border-warning bg-warning/15 px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.25em] text-warning hover:bg-warning/25"
                          >
                            <UserCheck className="h-3 w-3" />
                            {t("Confirm step")}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </HudPanel>

              {/* Trigger Conditions */}
              <HudPanel
                title={t("Trigger Conditions")}
                subtitle={t("This playbook activates when any condition is met")}
                actions={<TriangleAlert className="h-4 w-4 text-warning" />}
                bodyClassName="p-4"
              >
                <ul className="space-y-2">
                  {(TRIGGER_CONDITIONS[active.threatLevel] ?? TRIGGER_CONDITIONS.medium).map(
                    (cond, i) => (
                      <li key={i} className="flex items-start gap-2.5 text-[11px]">
                        <span className="mt-0.5 h-1.5 w-1.5 shrink-0 border border-hud/60 bg-hud/30" />
                        <span className="leading-snug text-muted-foreground">{t(cond)}</span>
                      </li>
                    ),
                  )}
                </ul>
                <div className="mt-4 border-t border-border pt-3 text-[10px] text-muted-foreground">
                  {t("Conditions evaluated every")}{" "}
                  <span className="text-hud font-bold">1.2 s</span>{" "}
                  {t("by AI-CORE · Manual override available to")}{" "}
                  <span className="text-hud font-bold">{t("Senior Operator")}</span>{" "}
                  {t("and above")}
                </div>
              </HudPanel>

              <div className="grid grid-cols-3 gap-3">
                <Card icon={ShieldCheck} label={t("Compliance")} value="SOP-2024 ✓" />
                <Card icon={Radio} label={t("Steps Auto")} value={`${autoCount} / ${steps.length}`} />
                <Card icon={Lock} label={t("Approval")} value="2-of-3" />
              </div>
            </>
          ) : (
            !loading && (
              <HudPanel title={t("Getting Started")} bodyClassName="p-5">
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {t("Select a playbook from the")}{" "}
                  <span className="text-foreground font-semibold">{t("Library")}</span>{" "}
                  {t(
                    "on the left to review its execution steps, trigger conditions, and compliance metadata.",
                  )}
                </p>
                <div className="mt-5 space-y-3">
                  {[
                    {
                      n: "01",
                      title: t("Choose a scenario"),
                      desc: t(
                        "Pick the playbook that matches the current threat type and severity level.",
                      ),
                    },
                    {
                      n: "02",
                      title: t("Review steps"),
                      desc: t(
                        "Check AUTO vs MANUAL steps. AUTO steps run without human input; MANUAL steps pause for operator confirmation.",
                      ),
                    },
                    {
                      n: "03",
                      title: t("Verify trigger conditions"),
                      desc: t(
                        "Confirm the situation meets at least one of the playbook's trigger criteria before executing.",
                      ),
                    },
                    {
                      n: "04",
                      title: t("Execute & audit"),
                      desc: t(
                        "Click 'Run Now' to start. Each step is animated in real time and the execution is logged to the audit trail with your operator ID.",
                      ),
                    },
                  ].map(({ n, title, desc }) => (
                    <div key={n} className="flex gap-3">
                      <div className="hud-stat flex h-7 w-7 shrink-0 items-center justify-center border border-hud/40 text-[11px] font-bold text-hud">
                        {n}
                      </div>
                      <div>
                        <div className="text-[11px] font-bold uppercase tracking-wider text-foreground">
                          {title}
                        </div>
                        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                          {desc}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-5 border-t border-border pt-4 text-[10px] text-muted-foreground">
                  <span className="font-bold text-foreground">{t("Note:")}</span> {t("Only")}{" "}
                  <span className="text-hud">ACTIVE</span> {t("playbooks can be executed.")}{" "}
                  {t(
                    "Inactive playbooks are visible for review but the Run button is disabled.",
                  )}
                </div>
              </HudPanel>
            )
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{label}</div>
      <div className="hud-stat font-bold text-foreground">{value}</div>
    </div>
  );
}

function Card({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof AlertOctagon;
  label: string;
  value: string;
}) {
  return (
    <div className="hud-panel flex items-center gap-3 px-4 py-3">
      <Icon className="h-5 w-5 text-hud" />
      <div>
        <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">{label}</div>
        <div className="hud-stat text-sm font-bold text-hud">{value}</div>
      </div>
    </div>
  );
}
