import { createFileRoute } from "@tanstack/react-router";
import { HudPanel, PageHeader } from "@/components/HudPanel";
import { useT } from "@/lib/i18n";
import {
  Play,
  Square,
  Trophy,
  Loader2,
  AlertTriangle,
  CheckCircle,
  Info,
  Target,
  Trash2,
  FileText,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { auditApi, simulationsApi, type ApiSimResult } from "@/lib/api";
import {
  injectSimDrones,
  batchUpdateSimDrones,
  patchSimDrone,
  removeSimDrones,
  injectSimAlert,
  injectSimDetection,
} from "@/lib/store";
import { PATROL_CENTER } from "@/lib/mockData";
import type { Drone, AlertEvent, Detection } from "@/lib/mockData";

export const Route = createFileRoute("/simulation")({
  component: Simulation,
  head: () => ({ meta: [{ title: "Simulation // DDS" }] }),
});

// ─── Constants ────────────────────────────────────────────────
const SIM_KEY = "dds_active_sim";
const HISTORY_KEY = "dds_sim_history";
const COS_LAT = Math.cos((51.18 * Math.PI) / 180);

const DIFF_COLOR: Record<string, string> = {
  Beginner: "text-hud",
  Advanced:  "text-info",
  Expert:    "text-warning",
  Critical:  "text-threat",
};

const STRESS_TONE: Record<string, "hud" | "warning" | undefined> = {
  Low: "hud", Medium: undefined, High: "warning",
};

// ─── Types ────────────────────────────────────────────────────
interface Scenario {
  id: string;
  name: string;
  difficulty: "Beginner" | "Advanced" | "Expert" | "Critical";
  durationS: number;
  threats: number;
}

interface SimEvent {
  elapsed: number;
  type: "detection" | "neutralized" | "alert" | "info";
  msg: string;
}

interface SimDroneState {
  id: string;
  initialLat: number;
  initialLng: number;
  vLat: number;
  vLng: number;
  threat: Drone["threat"];
  callsign: string;
  model: string;
  altitude: number;
  speed: number;
  heading: number;
  bearing: string;
  detectAt: number;
  neutralizeAt: number;
  freq: string;
}

interface PersistedSim {
  scenarioId: string;
  startedAt: number | null;
  elapsed: number;
  neutralized: number;
  collateral: number;
  timeline: SimEvent[];
  running: boolean;
  done: boolean;
}

interface SimResult {
  scenarioId: string;
  scenarioName: string;
  difficulty: string;
  score: number;
  neutralized: number;
  threats: number;
  elapsed: number;
  completedAt: number;
  aborted: boolean;
}

// ─── Scenarios — 4 scenarios, one per difficulty level ────────
const SCENARIOS: Scenario[] = [
  { id: "SIM-01", name: "Single intruder · low altitude",   difficulty: "Beginner", durationS:  8 * 60, threats: 1  },
  { id: "SIM-02", name: "Coordinated swarm · 4 units",      difficulty: "Advanced", durationS: 18 * 60, threats: 4  },
  { id: "SIM-03", name: "GPS jamming · multiple vectors",   difficulty: "Expert",   durationS: 30 * 60, threats: 8  },
  { id: "SIM-04", name: "Mass strike · mixed group",        difficulty: "Critical", durationS: 40 * 60, threats: 12 },
];

// ─── Helpers ──────────────────────────────────────────────────
function fmtTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
}

function calcScore(neutralized: number, threats: number, elapsed: number, durationS: number, collateral: number) {
  const neutralPct = threats > 0 ? neutralized / threats : 0;
  const timePct = Math.max(0, 1 - elapsed / durationS);
  return Math.max(0, Math.min(100, Math.round(neutralPct * 60 + timePct * 35 - collateral * 10)));
}

function seededRand(seed: number) {
  let s = seed;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) | 0;
    return (s >>> 0) / 0xffffffff;
  };
}

// ─── Sim drone state generation ───────────────────────────────
const SIM_MODELS = [
  "DJI Mavic 3", "Байрактар TB2", "Шахед-136", "FPV Камикадзе",
  "Parrot Anafi", "Skydio X10", "Орлан-10", "Ланцет-3",
  "ZALA 421-16E", "Elbit Skylark", "Форпост", "Шахед-131",
];
const SIM_CALLSIGNS = [
  "АКУЛА", "БЕРКУТ", "ГРОЗА", "ДРАКОН", "ЯСТРЕБ",
  "КОРШУН", "СОКОЛ", "ОРЁЛ", "РЫСЬ", "ТИГР", "ВОЛК", "ЛИСА",
];
const SIM_THREATS: Array<Drone["threat"]> = [
  "high", "critical", "medium", "high", "critical",
  "high", "medium", "critical", "high", "high", "critical", "high",
];
const BEARING_NAMES = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const FREQS = ["2.412 GHz", "915 MHz", "1.200 GHz", "5.745 GHz", "433 MHz"];

function generateSimDroneStates(scenario: Scenario): SimDroneState[] {
  const rand = seededRand(parseInt(scenario.id.replace(/\D/g, ""), 10) * 7 + 13);
  const d = scenario.durationS;
  const states: SimDroneState[] = [];

  for (let i = 0; i < scenario.threats; i++) {
    const angleDeg = (360 / scenario.threats) * i + rand() * 30 - 15;
    const angleRad = (angleDeg * Math.PI) / 180;
    const distKm = 15 + rand() * 13;

    const latOffset = (distKm / 111) * Math.cos(angleRad);
    const lngOffset = (distKm / (111 * COS_LAT)) * Math.sin(angleRad);

    const norm = Math.sqrt(latOffset * latOffset + lngOffset * lngOffset);
    const speedDegS = 0.00015 + rand() * 0.0001;
    const vLat = (-latOffset / norm) * speedDegS;
    const vLng = (-lngOffset / norm) * speedDegS;

    const detectAt = Math.floor(rand() * d * 0.65);
    const neutralizeAt = Math.min(d - 5, detectAt + Math.floor(rand() * 90 + 30));

    const bearingIdx = Math.round((((angleDeg % 360) + 360) % 360) / 45) % 8;

    states.push({
      id: `SIM-${scenario.id}-${String(i + 1).padStart(2, "0")}`,
      initialLat: PATROL_CENTER.lat + latOffset,
      initialLng: PATROL_CENTER.lng + lngOffset,
      vLat,
      vLng,
      threat: SIM_THREATS[i % SIM_THREATS.length],
      callsign: `${SIM_CALLSIGNS[i % SIM_CALLSIGNS.length]}-${String(i + 1).padStart(2, "0")}`,
      model: SIM_MODELS[i % SIM_MODELS.length],
      altitude: Math.floor(rand() * 400 + 50),
      speed: Math.floor(rand() * 100 + 60),
      heading: (angleDeg + 180) % 360,
      bearing: BEARING_NAMES[bearingIdx],
      detectAt,
      neutralizeAt,
      freq: FREQS[i % FREQS.length],
    });
  }
  return states;
}

function buildSimTimeline(scenario: Scenario, states: SimDroneState[]): SimEvent[] {
  const rand = seededRand(parseInt(scenario.id.replace(/\D/g, ""), 10) * 3 + 7);
  const d = scenario.durationS;
  const events: SimEvent[] = [];

  const n = scenario.threats;
  events.push({
    elapsed: 0,
    type: "info",
    msg: `${scenario.id} initialized · ${n} threat vector${n !== 1 ? "s" : ""} active`,
  });

  states.forEach((sd, i) => {
    events.push({
      elapsed: sd.detectAt,
      type: "detection",
      msg: `RADAR: ${sd.model} · heading ${sd.bearing} · ${sd.altitude} m · ${sd.freq}`,
    });
    events.push({
      elapsed: sd.neutralizeAt,
      type: "neutralized",
      msg: `INTERCEPT: Threat ${i + 1}/${scenario.threats} neutralized · RT ${sd.neutralizeAt - sd.detectAt}s`,
    });
  });

  const alerts = [
    "EW jamming detected on 433 MHz — switching to backup frequency",
    "GPS anomaly in sector 14-C · inertial navigation activated",
    "Unknown emitter triangulated — 1.8 km NW",
    "Swarm coordination signal intercepted on 5.8 GHz",
    "Low-altitude contact below minimum RADAR coverage",
    "EMP flash detected · 3.2 GHz · duration 0.8 s",
  ];
  const alertCount = Math.min(4, scenario.threats + 1);
  for (let i = 0; i < alertCount; i++) {
    events.push({
      elapsed: Math.floor(rand() * d * 0.85 + 30),
      type: "alert",
      msg: alerts[i % alerts.length],
    });
  }

  if (scenario.threats > 3) {
    events.push({
      elapsed: Math.floor(d * 0.5),
      type: "info",
      msg: "50% — intercept perimeter holding",
    });
  }

  return events.sort((a, b) => a.elapsed - b.elapsed);
}

// ─── Persistence ──────────────────────────────────────────────
function loadSim(): PersistedSim | null {
  try { return JSON.parse(localStorage.getItem(SIM_KEY) ?? "null"); }
  catch { return null; }
}
function saveSim(sim: PersistedSim | null) {
  if (sim) localStorage.setItem(SIM_KEY, JSON.stringify(sim));
  else localStorage.removeItem(SIM_KEY);
}
function loadLocalHistory(): SimResult[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]"); }
  catch { return []; }
}
function pushLocalHistory(r: SimResult) {
  const hist = loadLocalHistory();
  hist.unshift(r);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(hist.slice(0, 10)));
}
function dbRowToResult(r: ApiSimResult): SimResult & { id: string } {
  return {
    id: r.id,
    scenarioId: r.scenarioId,
    scenarioName: r.scenarioName,
    difficulty: r.difficulty,
    score: r.score,
    neutralized: r.neutralized,
    threats: r.threats,
    elapsed: r.elapsedS,
    completedAt: new Date(r.completedAt).getTime(),
    aborted: r.aborted,
  };
}
function resolveElapsed(saved: PersistedSim, scenario: Scenario) {
  if (!saved.running || !saved.startedAt)
    return { elapsed: saved.elapsed, done: saved.done, running: saved.running };
  const real = saved.elapsed + Math.floor((Date.now() - saved.startedAt) / 1000);
  if (real >= scenario.durationS) return { elapsed: scenario.durationS, done: true, running: false };
  return { elapsed: real, done: false, running: true };
}

// ─── System event injection ────────────────────────────────────
function buildStoreDrone(sd: SimDroneState, lat: number, lng: number): Drone {
  return {
    id: sd.id,
    callsign: sd.callsign,
    model: sd.model,
    lat,
    lng,
    altitude: sd.altitude,
    speed: sd.speed,
    heading: sd.heading,
    threat: sd.threat,
    status: "tracked",
    detectedAt: new Date(),
    confidence: 0.72 + Math.random() * 0.25,
    vLat: sd.vLat,
    vLng: sd.vLng,
  };
}

function droneLatAt(sd: SimDroneState, t: number) { return sd.initialLat + sd.vLat * t; }
function droneLngAt(sd: SimDroneState, t: number) { return sd.initialLng + sd.vLng * t; }

// ─── Component ────────────────────────────────────────────────
function Simulation() {
  const { t } = useT();
  const saved   = loadSim();
  const savedSc = saved ? (SCENARIOS.find((s) => s.id === saved.scenarioId) ?? null) : null;
  const resolved = saved && savedSc ? resolveElapsed(saved, savedSc) : null;

  const [active,     setActive]     = useState<Scenario | null>(savedSc);
  const [running,    setRunning]    = useState(resolved?.running ?? false);
  const [elapsed,    setElapsed]    = useState(resolved?.elapsed ?? 0);
  const [neutralized,setNeutralized]= useState<number>(() => {
    if (!saved || !resolved || !savedSc) return 0;
    return Math.min(
      savedSc.threats,
      (saved.timeline ?? []).filter(
        (ev) => ev.type === "neutralized" && ev.elapsed <= resolved.elapsed,
      ).length,
    );
  });
  const [collateral] = useState<number>(() => saved?.collateral ?? 0);
  const [timeline,   setTimeline]   = useState<SimEvent[]>(() => saved?.timeline ?? []);
  const [done,       setDone]       = useState(resolved?.done ?? false);
  const [saving,     setSaving]     = useState(false);
  const [history,    setHistory]    = useState<SimResult[]>(loadLocalHistory);
  const [reportModal,setReportModal]= useState<SimResult | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Refs for interval closure
  const elapsedRef  = useRef(elapsed);
  const activeRef   = useRef(active);
  const neutralRef  = useRef(neutralized);
  const timelineRef = useRef(timeline);
  const prevElapsedRef   = useRef(elapsed);
  const simDroneStatesRef= useRef<SimDroneState[]>([]);

  useEffect(() => { elapsedRef.current  = elapsed;    }, [elapsed]);
  useEffect(() => { activeRef.current   = active;     }, [active]);
  useEffect(() => { neutralRef.current  = neutralized;}, [neutralized]);
  useEffect(() => { timelineRef.current = timeline;   }, [timeline]);

  // Load history from DB
  useEffect(() => {
    simulationsApi.list().then((rows) => setHistory(rows.map(dbRowToResult))).catch(() => {});
  }, []);

  // Re-inject drones on mount if a sim was already running (e.g. after page refresh)
  useEffect(() => {
    if (active && simDroneStatesRef.current.length === 0) {
      const states = generateSimDroneStates(active);
      simDroneStatesRef.current = states;
      const el = elapsedRef.current;
      const alive = states.filter((sd) => sd.neutralizeAt > el);
      if (alive.length > 0) {
        injectSimDrones(alive.map((sd) => buildStoreDrone(sd, droneLatAt(sd, el), droneLngAt(sd, el))));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist on every change
  useEffect(() => {
    if (!active) { saveSim(null); return; }
    saveSim({ scenarioId: active.id, startedAt: running ? Date.now() - elapsed * 1000 : null, elapsed, neutralized, collateral, timeline, running, done });
  }, [active, elapsed, neutralized, collateral, timeline, running, done]);

  // ── Tick interval ──────────────────────────────────────────
  useEffect(() => {
    if (!running || !active) return;

    const id = setInterval(() => {
      const a = activeRef.current;
      if (!a) return;

      const prev = prevElapsedRef.current;
      const next = prev + 1;
      prevElapsedRef.current = next;
      setElapsed(next);

      // Count neutralized
      const due = timelineRef.current.filter(
        (ev) => ev.type === "neutralized" && ev.elapsed <= next,
      ).length;
      setNeutralized(Math.min(a.threats, due));

      // Move live sim drones
      const updates = simDroneStatesRef.current
        .filter((sd) => sd.neutralizeAt > next)
        .map((sd) => ({
          id: sd.id,
          lat: droneLatAt(sd, next),
          lng: droneLngAt(sd, next),
        }));
      if (updates.length > 0) batchUpdateSimDrones(updates);

      // Newly due events
      const newlyFired = timelineRef.current.filter(
        (ev) => ev.elapsed > prev && ev.elapsed <= next,
      );
      for (const ev of newlyFired) {
        processSimEvent(ev, next, a.id);
      }

      if (next >= a.durationS) {
        clearInterval(id);
        setRunning(false);
        setDone(true);
      }
    }, 1000);

    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, active?.id]);

  // ── System event handler ────────────────────────────────────
  function processSimEvent(ev: SimEvent, t: number, scenarioId: string) {
    if (ev.type === "detection") {
      const sd = simDroneStatesRef.current.find((s) => s.detectAt === t) ??
                 simDroneStatesRef.current.find((s) => s.detectAt <= t && t - s.detectAt < 3);
      const alert: AlertEvent = {
        id: `SIM-DET-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        level: "high",
        title: "TARGET DETECTED",
        message: ev.msg,
        timestamp: new Date(),
        source: "SIMULATION",
        acknowledged: false,
      };
      injectSimAlert(alert);

      if (sd) {
        const det: Detection = {
          id: `SIM-D-${sd.id}-${Date.now()}`,
          droneId: sd.id,
          callsign: sd.callsign,
          model: sd.model,
          threat: sd.threat,
          sensorId: "SIM-RADAR",
          sensorName: "[SIM] RADAR",
          timestamp: new Date(),
          lat: droneLatAt(sd, t),
          lng: droneLngAt(sd, t),
          confidence: 0.70 + Math.random() * 0.28,
        };
        injectSimDetection(det);
      }

      auditApi.log({ action: "SIM_DETECTION", resource: "simulation", resourceId: scenarioId, details: { msg: ev.msg, elapsed: t } }).catch(() => {});
    } else if (ev.type === "neutralized") {
      const sd = simDroneStatesRef.current.find((s) => s.neutralizeAt === t) ??
                 simDroneStatesRef.current.find((s) => s.neutralizeAt <= t && t - s.neutralizeAt < 3);
      if (sd) {
        patchSimDrone(sd.id, { status: "neutralized" });
        setTimeout(() => removeSimDrones([sd.id]), 3000);
      }
      injectSimAlert({
        id: `SIM-NEU-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        level: "low",
        title: "THREAT NEUTRALIZED",
        message: ev.msg,
        timestamp: new Date(),
        source: "SIMULATION",
        acknowledged: false,
      });
      auditApi.log({ action: "SIM_NEUTRALIZED", resource: "simulation", resourceId: scenarioId, details: { msg: ev.msg, elapsed: t } }).catch(() => {});
    } else if (ev.type === "alert") {
      injectSimAlert({
        id: `SIM-ALT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        level: "medium",
        title: "SYSTEM ALERT",
        message: ev.msg,
        timestamp: new Date(),
        source: "SIMULATION",
        acknowledged: false,
      });
    }
  }

  // ── Actions ─────────────────────────────────────────────────
  function launch(s: Scenario) {
    const states = generateSimDroneStates(s);
    const tl = buildSimTimeline(s, states);
    simDroneStatesRef.current = states;
    prevElapsedRef.current = 0;

    // Inject all drones at their initial positions
    injectSimDrones(states.map((sd) => buildStoreDrone(sd, sd.initialLat, sd.initialLng)));

    // Initial alert
    injectSimAlert({
      id: `SIM-START-${Date.now()}`,
      level: "high",
      title: "SIMULATION STARTED",
      message: `${s.id}: ${s.name} · ${s.threats} threat${s.threats !== 1 ? "s" : ""} · ${s.difficulty}`,
      timestamp: new Date(),
      source: "SIMULATION",
      acknowledged: false,
    });

    auditApi.log({
      action: "SIM_STARTED",
      resource: "simulation",
      resourceId: s.id,
      details: { scenario: s.name, threats: s.threats, difficulty: s.difficulty },
    }).catch(() => {});

    setActive(s);
    setElapsed(0);
    setNeutralized(0);
    setTimeline(tl);
    setDone(false);
    setRunning(true);
  }

  async function abort() {
    if (!active) return;
    const snap = { scenario: active, neutralized: neutralRef.current, elapsed: elapsedRef.current, collateral };
    setRunning(false);
    setDone(false);
    setActive(null);
    saveSim(null);

    // Remove all sim drones
    removeSimDrones(simDroneStatesRef.current.map((sd) => sd.id));
    simDroneStatesRef.current = [];

    const score = calcScore(snap.neutralized, snap.scenario.threats, snap.elapsed, snap.scenario.durationS, snap.collateral);
    const result: SimResult = { scenarioId: snap.scenario.id, scenarioName: snap.scenario.name, difficulty: snap.scenario.difficulty, score, neutralized: snap.neutralized, threats: snap.scenario.threats, elapsed: snap.elapsed, completedAt: Date.now(), aborted: true };
    pushLocalHistory(result);
    setHistory(loadLocalHistory());

    setSaving(true);
    try {
      await simulationsApi.save({ scenarioId: snap.scenario.id, scenarioName: snap.scenario.name, difficulty: snap.scenario.difficulty, score, neutralized: snap.neutralized, threats: snap.scenario.threats, elapsedS: snap.elapsed, aborted: true });
      setHistory((await simulationsApi.list()).map(dbRowToResult));
    } catch { /* keep localStorage */ }
    await auditApi.log({ action: "SIM_ABORTED", resource: "simulation", resourceId: snap.scenario.id, details: { scenario: snap.scenario.name, elapsed: snap.elapsed, neutralized: snap.neutralized, score } }).catch(() => {});
    setSaving(false);
  }

  async function complete() {
    if (!active) return;
    const snap = { scenario: active, neutralized: neutralRef.current, elapsed: elapsedRef.current, collateral };
    setActive(null);
    setDone(false);
    saveSim(null);

    removeSimDrones(simDroneStatesRef.current.map((sd) => sd.id));
    simDroneStatesRef.current = [];

    const score = calcScore(snap.neutralized, snap.scenario.threats, snap.elapsed, snap.scenario.durationS, snap.collateral);
    const result: SimResult = { scenarioId: snap.scenario.id, scenarioName: snap.scenario.name, difficulty: snap.scenario.difficulty, score, neutralized: snap.neutralized, threats: snap.scenario.threats, elapsed: snap.elapsed, completedAt: Date.now(), aborted: false };
    pushLocalHistory(result);
    setHistory(loadLocalHistory());

    setSaving(true);
    try {
      await simulationsApi.save({ scenarioId: snap.scenario.id, scenarioName: snap.scenario.name, difficulty: snap.scenario.difficulty, score, neutralized: snap.neutralized, threats: snap.scenario.threats, elapsedS: snap.elapsed, aborted: false });
      setHistory((await simulationsApi.list()).map(dbRowToResult));
    } catch { /* keep localStorage */ }
    await auditApi.log({ action: "SIM_COMPLETE", resource: "simulation", resourceId: snap.scenario.id, details: { scenario: snap.scenario.name, elapsed: snap.elapsed, neutralized: snap.neutralized, score } }).catch(() => {});
    setSaving(false);
  }

  async function handleDeleteResult(r: SimResult, dbId: string) {
    setDeletingId(dbId);
    try {
      await simulationsApi.delete(dbId);
      setHistory((await simulationsApi.list()).map(dbRowToResult));
    } catch {
      // fallback: remove from localStorage only
      const hist = loadLocalHistory().filter((h) => h.completedAt !== r.completedAt);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(hist));
      setHistory(hist);
    }
    setDeletingId(null);
  }

  // Derived
  const score    = active ? calcScore(neutralized, active.threats, elapsed, active.durationS, collateral) : 0;
  const progress = active ? Math.min(100, (elapsed / active.durationS) * 100) : 0;
  const stressKey = !active ? "Low" : elapsed / active.durationS < 0.4 ? "Low" : elapsed / active.durationS < 0.75 ? "Medium" : "High";
  const visibleEvents = timeline.filter((ev) => ev.elapsed <= elapsed).reverse();

  return (
    <div>
      <PageHeader
        title={t("Simulation & Training")}
        subtitle={t("Operator drills · scenario library · performance scoring")}
      />

      {reportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="w-full max-w-lg border border-hud/40 bg-background shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <div className="font-bold tracking-widest text-hud text-xs uppercase">Simulation Report</div>
              <button onClick={() => setReportModal(null)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 p-5">
              <div className="border border-border/40 bg-panel/40 px-4 py-3">
                <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground mb-0.5">{t("Scenario")}</div>
                <div className="text-sm font-bold tracking-wider text-foreground">{reportModal.scenarioName}</div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                {[
                  { label: t("Final score"), value: String(reportModal.score), tone: reportModal.score >= 70 ? "text-hud" : reportModal.score >= 40 ? "text-warning" : "text-threat" },
                  { label: t("Status"), value: reportModal.aborted ? t("Aborted") : t("COMPLETE"), tone: reportModal.aborted ? "text-threat" : "text-hud" },
                  { label: t("Threats neutralized"), value: `${reportModal.neutralized} / ${reportModal.threats}`, tone: "" },
                  { label: t("Total time"), value: fmtTime(reportModal.elapsed), tone: "" },
                  { label: t("Difficulty"), value: t(reportModal.difficulty), tone: DIFF_COLOR[reportModal.difficulty] ?? "" },
                  { label: t("Completed"), value: new Date(reportModal.completedAt).toLocaleString("en-GB", { timeZone: "Asia/Almaty" }), tone: "" },
                ].map(({ label, value, tone }) => (
                  <div key={label} className="border border-border/40 bg-panel/20 px-3 py-2">
                    <div className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">{label}</div>
                    <div className={`hud-stat mt-0.5 font-bold ${tone || "text-foreground"}`}>{value}</div>
                  </div>
                ))}
              </div>
              <div className="border border-border/40 bg-panel/20 px-4 py-3">
                <div className="mb-2 text-[9px] uppercase tracking-[0.2em] text-muted-foreground">{t("Score")}</div>
                <div className="h-2 w-full bg-muted/40 overflow-hidden">
                  <div
                    className={`h-full transition-all ${reportModal.score >= 70 ? "bg-hud" : reportModal.score >= 40 ? "bg-warning" : "bg-threat"}`}
                    style={{ width: `${reportModal.score}%` }}
                  />
                </div>
                <div className="mt-1.5 text-[10px] text-muted-foreground">
                  {reportModal.score >= 70 ? "Excellent — all threats neutralized on time."
                    : reportModal.score >= 40 ? "Satisfactory — improve response speed."
                    : "Low score — repeat training."}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-3 px-4 py-4 sm:px-6 lg:grid-cols-[2fr_1fr]">
        {/* Left */}
        <div className="space-y-3">
          <HudPanel title={t("Scenario Library")} subtitle={`${SCENARIOS.length} ${t("scenarios")}`} bodyClassName="p-0">
            <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-xs">
              <thead className="bg-panel-elevated text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">{t("ID")}</th>
                  <th className="px-3 py-2 text-left">{t("Scenario")}</th>
                  <th className="px-3 py-2 text-left">{t("Difficulty")}</th>
                  <th className="px-3 py-2 text-left">{t("Duration")}</th>
                  <th className="px-3 py-2 text-left">{t("Threats")}</th>
                  <th className="px-3 py-2 text-left">Action</th>
                </tr>
              </thead>
              <tbody>
                {SCENARIOS.map((s) => {
                  const isActive = active?.id === s.id;
                  return (
                    <tr key={s.id} className={`border-t border-border/40 hover:bg-hud/5 ${isActive ? "bg-hud/8" : ""}`}>
                      <td className="hud-stat px-3 py-2 text-hud">{s.id}</td>
                      <td className="px-3 py-2 font-bold">{s.name}</td>
                      <td className={`px-3 py-2 font-bold ${DIFF_COLOR[s.difficulty] ?? ""}`}>
                        {t(s.difficulty)}
                      </td>
                      <td className="hud-stat px-3 py-2">{fmtTime(s.durationS)}</td>
                      <td className="hud-stat px-3 py-2 text-muted-foreground">{s.threats}</td>
                      <td className="px-3 py-2">
                        {isActive && running ? (
                          <span className="blink-pulse border border-hud/50 bg-hud/10 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-hud">
                            {t("RUNNING")}
                          </span>
                        ) : isActive && done ? (
                          <span className="border border-warning/50 bg-warning/10 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-warning">
                            {t("COMPLETE")}
                          </span>
                        ) : (
                          <button
                            disabled={!!running}
                            onClick={() => launch(s)}
                            className="flex items-center gap-1 border border-hud bg-hud/10 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-hud hover:bg-hud/20 disabled:cursor-not-allowed disabled:opacity-30"
                          >
                            <Play className="h-3 w-3" /> {t("Launch")}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </HudPanel>

          {history.length > 0 && (
            <HudPanel title={t("Recent Results")} subtitle={`${history.length} ${t("completed")}`} bodyClassName="p-0">
              <div className="divide-y divide-border/40">
                {history.map((r, i) => {
                  const dbId = (r as SimResult & { id?: string }).id ?? "";
                  return (
                    <div key={i} className="flex items-center gap-3 px-4 py-2.5 hover:bg-hud/3 group">
                      {r.aborted ? (
                        <Square className="h-3.5 w-3.5 shrink-0 text-threat" />
                      ) : (
                        <CheckCircle className="h-3.5 w-3.5 shrink-0 text-hud" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="truncate text-[10px] font-bold uppercase tracking-wider text-foreground">
                          {r.scenarioName}
                        </div>
                        <div className="text-[9px] uppercase tracking-[0.15em] text-muted-foreground">
                          {new Date(r.completedAt).toLocaleDateString("en-GB", {
                            day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
                          })}
                          {r.aborted && ` · ${t("Aborted")}`}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className={`hud-stat text-sm font-bold ${r.score >= 70 ? "text-hud" : r.score >= 40 ? "text-warning" : "text-threat"}`}>
                          {r.score}
                        </div>
                        <div className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                          {r.neutralized}/{r.threats} · {fmtTime(r.elapsed)}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => setReportModal(r)}
                          title="Просмотреть отчёт"
                          className="border border-border p-1 text-muted-foreground hover:border-hud hover:text-hud"
                        >
                          <FileText className="h-3 w-3" />
                        </button>
                        <button
                          disabled={deletingId === dbId}
                          onClick={() => handleDeleteResult(r, dbId)}
                          title="Удалить результат"
                          className="border border-border p-1 text-muted-foreground hover:border-threat hover:text-threat disabled:opacity-40"
                        >
                          {deletingId === dbId ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </HudPanel>
          )}
        </div>

        {/* Right */}
        <div className="space-y-3">
          <HudPanel title={t("Active Simulation")} bodyClassName="p-4">
            {!active && (
              <div className="py-8 text-center text-xs uppercase tracking-[0.2em] text-muted-foreground">
                {saving ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="h-3 w-3 animate-spin" /> {t("Saving result…")}
                  </span>
                ) : (
                  t("Select a scenario to begin training")
                )}
              </div>
            )}

            {active && running && (
              <div className="space-y-4">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
                    {active.id} · {t(active.difficulty)}
                  </div>
                  <div className="hud-text-glow text-lg font-bold tracking-widest text-hud">{t("RUNNING")}</div>
                </div>

                <div>
                  <div className="mb-1 flex justify-between text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                    <span>{t("Progress")}</span>
                    <span className="hud-stat text-hud">{Math.round(progress)}%</span>
                  </div>
                  <div className="h-1 w-full bg-muted">
                    <div className="h-full bg-hud transition-all duration-1000" style={{ width: `${progress}%` }} />
                  </div>
                </div>

                <div className="space-y-2 text-xs">
                  <Row label={t("Elapsed")}              value={fmtTime(elapsed)} />
                  <Row label={t("Remaining")}            value={fmtTime(Math.max(0, active.durationS - elapsed))} />
                  <Row label={t("Threats neutralized")}  value={`${neutralized} / ${active.threats}`} tone={neutralized === active.threats ? "hud" : undefined} />
                  <Row label={t("Collateral")}           value={String(collateral)} tone="hud" />
                  <Row label={t("Score")}                value={String(score)} tone="hud" />
                  <Row label={t("Operator stress")}      value={t(stressKey)} tone={STRESS_TONE[stressKey]} />
                </div>

                <button
                  onClick={abort}
                  className="flex w-full items-center justify-center gap-2 border border-threat bg-threat/15 px-4 py-2 text-[10px] uppercase tracking-[0.2em] text-threat hover:bg-threat/25"
                >
                  <Square className="h-3 w-3" /> {t("Abort Simulation")}
                </button>
              </div>
            )}

            {active && done && (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Trophy className="h-6 w-6 text-warning" />
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">{active.id}</div>
                    <div className="text-lg font-bold tracking-widest text-hud">{t("COMPLETE")}</div>
                  </div>
                </div>
                <div className="space-y-2 text-xs">
                  <Row label={t("Threats neutralized")} value={`${neutralized} / ${active.threats}`} tone="hud" />
                  <Row label={t("Collateral")}          value={String(collateral)} tone="hud" />
                  <Row label={t("Final score")}         value={String(score)} tone="hud" />
                  <Row label={t("Total time")}          value={fmtTime(elapsed)} />
                </div>
                <button
                  onClick={complete}
                  disabled={saving}
                  className="flex w-full items-center justify-center gap-2 border border-hud bg-hud/15 px-4 py-2 text-[10px] uppercase tracking-[0.2em] text-hud hover:bg-hud/25 disabled:opacity-40"
                >
                  {saving && <Loader2 className="h-3 w-3 animate-spin" />}
                  {saving ? t("Saving…") : t("Save & Close")}
                </button>
              </div>
            )}
          </HudPanel>

          {active && (running || done) && (
            <HudPanel
              title={t("Event Log")}
              subtitle={`${visibleEvents.length} ${t("events")}`}
              bodyClassName="p-0"
            >
              <div className="max-h-64 divide-y divide-border/30 overflow-y-auto">
                {visibleEvents.length === 0 && (
                  <div className="px-4 py-4 text-center text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                    {t("Awaiting first contact…")}
                  </div>
                )}
                {visibleEvents.map((ev, i) => <EventRow key={i} event={ev} />)}
              </div>
            </HudPanel>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────
const EV_META: Record<SimEvent["type"], { icon: React.ElementType; color: string }> = {
  detection:   { icon: Target,        color: "text-warning" },
  neutralized: { icon: CheckCircle,   color: "text-hud"     },
  alert:       { icon: AlertTriangle, color: "text-threat"  },
  info:        { icon: Info,          color: "text-info"    },
};

function EventRow({ event: ev }: { event: SimEvent }) {
  const { icon: Icon, color } = EV_META[ev.type];
  return (
    <div className={`flex items-start gap-2.5 px-3 py-2 ${ev.type === "alert" ? "bg-threat/3" : ""}`}>
      <Icon className={`mt-0.5 h-3 w-3 shrink-0 ${color}`} />
      <div className="min-w-0 flex-1">
        <div className="text-[10px] leading-relaxed text-foreground">{ev.msg}</div>
      </div>
      <span className="hud-stat shrink-0 text-[9px] text-muted-foreground">{fmtTime(ev.elapsed)}</span>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "hud" | "warning" }) {
  const t = tone === "hud" ? "text-hud" : tone === "warning" ? "text-warning" : "text-foreground";
  return (
    <div className="flex justify-between border-b border-border/40 pb-1">
      <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{label}</span>
      <span className={`hud-stat font-bold ${t}`}>{value}</span>
    </div>
  );
}
