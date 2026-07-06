import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { HudPanel, PageHeader } from "@/components/HudPanel";
import { Loader2, RefreshCw, Wifi, WifiOff } from "lucide-react";
import { useT } from "@/lib/i18n";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell,
  Legend, Pie, PieChart, RadialBar, RadialBarChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { analyticsApi, type ApiAnalyticsSummary, type ApiDailyDetection, type ApiDailyIncident } from "@/lib/api";
import { useStore } from "@/lib/store";
import type { Detection, Incident, Sensor } from "@/lib/mockData";

export const Route = createFileRoute("/analytics")({
  component: Analytics,
  head: () => ({ meta: [{ title: "Analytics // DDS" }] }),
});

// ─── Theme ────────────────────────────────────────────────────
const C_HUD      = "var(--hud)";
const C_THREAT   = "var(--threat)";
const C_WARN     = "var(--warning)";
const C_MUTED    = "var(--muted-foreground)";
const C_BORDER   = "var(--border)";

const THREAT_COLORS: Record<string, string> = {
  critical: C_THREAT,
  high:     "oklch(0.65 0.20 35)",
  medium:   C_WARN,
  low:      C_HUD,
};
const STATUS_COLORS: Record<string, string> = {
  open:          C_THREAT,
  investigating: C_WARN,
  resolved:      C_HUD,
  dismissed:     "oklch(0.45 0.05 220)",
};
const STATUS_LABEL_EN: Record<string, string> = {
  open: "Open", investigating: "Investigating", resolved: "Resolved", dismissed: "Dismissed",
};
const THREAT_LABEL_EN: Record<string, string> = {
  critical: "Critical", high: "High", medium: "Medium", low: "Low",
};
const SENSOR_STATUS_COLORS: Record<string, string> = {
  online:      C_HUD,
  degraded:    C_WARN,
  offline:     C_THREAT,
  maintenance: "oklch(0.55 0.14 280)",
};
const SENSOR_STATUS_EN: Record<string, string> = {
  online: "Online", degraded: "Degraded", offline: "Offline", maintenance: "Maintenance",
};
const PIE_COLORS = [C_HUD, C_THREAT, C_WARN, "oklch(0.60 0.18 280)", "oklch(0.65 0.18 220)", "oklch(0.70 0.15 60)"];

const TOOLTIP_STYLE = {
  background: "rgba(10, 28, 18, 0.95)",
  border: "1px solid rgba(74, 222, 128, 0.35)",
  borderRadius: 6,
  fontSize: 12,
  color: "#e2fce2",
  padding: "8px 12px",
  boxShadow: "0 4px 20px rgba(0,0,0,0.6)",
};
const TOOLTIP_LABEL_STYLE = { color: "#86efac", fontWeight: 700, marginBottom: 4 };
const TOOLTIP_ITEM_STYLE  = { color: "#e2fce2" };

// ─── Heatmap config ───────────────────────────────────────────
const HEAT_ROWS   = 6;
const HEAT_COLS   = 12;
const HEAT_LAT_MAX = 51.40;
const HEAT_LAT_MIN = 50.96;
const HEAT_LNG_MIN = 71.15;
const HEAT_LNG_MAX = 71.75;

// ─── Helpers ──────────────────────────────────────────────────
function pctDelta(curr: number, prev: number) {
  if (!prev) return curr > 0 ? "+∞%" : "0%";
  const d = ((curr - prev) / prev) * 100;
  return (d >= 0 ? "+" : "") + d.toFixed(0) + "%";
}
function makeDateKey(daysAgo: number) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fillDetections(rows: ApiDailyDetection[], days: number): ApiDailyDetection[] {
  const map = new Map(rows.map((r) => [r.day, r]));
  return Array.from({ length: days }, (_, i) => {
    const key = makeDateKey(days - 1 - i);
    return map.get(key) ?? { day: key, detections: 0, threats: 0, critical: 0 };
  });
}
function fillIncidents(rows: ApiDailyIncident[], days: number): ApiDailyIncident[] {
  const map = new Map(rows.map((r) => [r.day, r]));
  return Array.from({ length: days }, (_, i) => {
    const key = makeDateKey(days - 1 - i);
    return map.get(key) ?? { day: key, incidents: 0, resolved: 0 };
  });
}

function buildFallback(
  storeDets: Detection[], storeIncs: Incident[], days: number,
): { summary: ApiAnalyticsSummary; daily: ApiDailyDetection[]; incDaily: ApiDailyIncident[] } {
  const now = Date.now();
  const cut7  = now - 7  * 86_400_000;
  const cut14 = now - 14 * 86_400_000;
  const cutN  = now - days * 86_400_000;

  const det7d    = storeDets.filter((d) => d.timestamp.getTime() >= cut7).length;
  const prev7d   = storeDets.filter((d) => d.timestamp.getTime() >= cut14 && d.timestamp.getTime() < cut7).length;
  const critical7d = storeDets.filter((d) => d.timestamp.getTime() >= cut7 && d.threat === "critical").length;
  const openIncidents = storeIncs.filter((i) => i.status === "open" || i.status === "investigating").length;

  const modelCount: Record<string, number> = {};
  for (const d of storeDets) modelCount[d.model] = (modelCount[d.model] ?? 0) + 1;
  const modelDist = Object.entries(modelCount).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, value]) => ({ name, value }));

  const threatCount: Record<string, number> = {};
  for (const d of storeDets) threatCount[d.threat] = (threatCount[d.threat] ?? 0) + 1;
  const threatDist = Object.entries(threatCount).map(([name, value]) => ({ name, value }));

  const detBuckets: Record<string, ApiDailyDetection> = {};
  const incBuckets: Record<string, ApiDailyIncident> = {};
  for (let i = days - 1; i >= 0; i--) {
    const k = makeDateKey(i);
    detBuckets[k] = { day: k, detections: 0, threats: 0, critical: 0 };
    incBuckets[k] = { day: k, incidents: 0, resolved: 0 };
  }
  for (const d of storeDets) {
    if (d.timestamp.getTime() < cutN) continue;
    const k = `${String(d.timestamp.getMonth() + 1).padStart(2, "0")}-${String(d.timestamp.getDate()).padStart(2, "0")}`;
    if (detBuckets[k]) {
      detBuckets[k].detections++;
      if (d.threat === "high" || d.threat === "critical") detBuckets[k].threats++;
      if (d.threat === "critical") detBuckets[k].critical++;
    }
  }
  for (const inc of storeIncs) {
    if (inc.createdAt.getTime() < cutN) continue;
    const k = `${String(inc.createdAt.getMonth() + 1).padStart(2, "0")}-${String(inc.createdAt.getDate()).padStart(2, "0")}`;
    if (incBuckets[k]) {
      incBuckets[k].incidents++;
      if (inc.status === "resolved" || inc.status === "dismissed") incBuckets[k].resolved++;
    }
  }
  return {
    summary: { detections7d: det7d, prev7d, critical7d, openIncidents, modelDist, threatDist },
    daily:   Object.values(detBuckets),
    incDaily: Object.values(incBuckets),
  };
}

// Build heatmap grid from real detection positions
function buildHeatGrid(dets: Detection[]): number[][] {
  const grid = Array.from({ length: HEAT_ROWS }, () => Array<number>(HEAT_COLS).fill(0));
  const latRange = HEAT_LAT_MAX - HEAT_LAT_MIN;
  const lngRange = HEAT_LNG_MAX - HEAT_LNG_MIN;
  for (const d of dets) {
    if (d.lat == null || d.lng == null) continue;
    const col = Math.floor(((d.lng - HEAT_LNG_MIN) / lngRange) * HEAT_COLS);
    const row = Math.floor(((HEAT_LAT_MAX - d.lat) / latRange) * HEAT_ROWS);
    if (col >= 0 && col < HEAT_COLS && row >= 0 && row < HEAT_ROWS) {
      grid[row][col]++;
    }
  }
  return grid;
}

// Fallback pattern so heatmap is never all-black
function fallbackHeatPattern(): number[] {
  return Array.from({ length: HEAT_ROWS * HEAT_COLS }, (_, i) => {
    const v = (Math.sin(i * 1.37) * 0.5 + 0.5) * (Math.cos(i * 0.71) * 0.3 + 0.7);
    return Math.round(v * 5); // 0-5 virtual "detections"
  });
}

// Map intensity 0→1 to an oklch color: dark-green → yellow → bright-red
function heatColor(intensity: number): string {
  const L = 0.30 + intensity * 0.48; // lightness: 0.30 → 0.78
  const C = 0.07 + intensity * 0.20; // chroma: 0.07 → 0.27
  const H = 145  - intensity * 145;  // hue: 145° green → 0° red
  const A = 0.45 + intensity * 0.55; // opacity: 0.45 → 1.0
  return `oklch(${L.toFixed(3)} ${C.toFixed(3)} ${H.toFixed(1)} / ${A.toFixed(2)})`;
}

// ─── Component ────────────────────────────────────────────────
const DAY_OPTIONS = [
  { value: 7,  label: "7 days"  },
  { value: 14, label: "14 days" },
  { value: 30, label: "30 days" },
] as const;

function Analytics() {
  const { t } = useT();
  const storeDets = useStore((s) => s.detections);
  const storeIncs = useStore((s) => s.incidents);
  const storeSensors = useStore((s) => s.sensors);

  const [summary, setSummary]     = useState<ApiAnalyticsSummary | null>(null);
  const [daily,   setDaily]       = useState<ApiDailyDetection[]>([]);
  const [incDaily,setIncDaily]    = useState<ApiDailyIncident[]>([]);
  const [loading, setLoading]     = useState(true);
  const [offline, setOffline]     = useState(false);
  const [days,    setDays]        = useState<7 | 14 | 30>(14);

  async function load() {
    setLoading(true);
    try {
      const [s, d, i] = await Promise.all([
        analyticsApi.summary(),
        analyticsApi.detections(days),
        analyticsApi.incidents(days),
      ]);
      setSummary(s);
      setDaily(fillDetections(d, days));
      setIncDaily(fillIncidents(i, days));
      setOffline(false);
    } catch {
      const fb = buildFallback(storeDets, storeIncs, days);
      setSummary(fb.summary);
      setDaily(fb.daily);
      setIncDaily(fb.incDaily);
      setOffline(true);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, [days]);

  // Heatmap
  const heatData = useMemo(() => {
    if (storeDets.length > 0) {
      const grid = buildHeatGrid(storeDets);
      const flat = grid.flat();
      const maxVal = Math.max(1, ...flat);
      return flat.map((v) => v / maxVal);
    }
    // Fallback pattern — always visible
    const pattern = fallbackHeatPattern();
    const maxVal = Math.max(1, ...pattern);
    return pattern.map((v) => v / maxVal);
  }, [storeDets]);

  // Incident status donut
  const incStatusData = useMemo(() => {
    const counts: Record<string, number> = { open: 0, investigating: 0, resolved: 0, dismissed: 0 };
    for (const inc of storeIncs) counts[inc.status] = (counts[inc.status] ?? 0) + 1;
    return Object.entries(counts)
      .filter(([, v]) => v > 0)
      .map(([name, value]) => ({ name, label: STATUS_LABEL_EN[name] ?? name, value }));
  }, [storeIncs]);

  // Sensor health bar data
  const sensorHealthData = useMemo(() => {
    const counts: Record<string, number> = { online: 0, degraded: 0, offline: 0, maintenance: 0 };
    for (const s of storeSensors) counts[s.status] = (counts[s.status] ?? 0) + 1;
    return Object.entries(counts)
      .filter(([, v]) => v > 0)
      .map(([status, count]) => ({
        status: SENSOR_STATUS_EN[status] ?? status,
        count,
        fill: SENSOR_STATUS_COLORS[status],
      }));
  }, [storeSensors]);

  // Derived KPIs
  const det7d   = summary?.detections7d ?? 0;
  const prev7d  = summary?.prev7d ?? 0;
  const crit7d  = summary?.critical7d ?? 0;
  const openInc = summary?.openIncidents ?? 0;
  const delta   = pctDelta(det7d, prev7d);
  const positiveGrowth = delta.startsWith("+");

  const xInterval = days > 14 ? 4 : days > 7 ? 1 : 0;

  return (
    <div>
      <PageHeader
        title={t("Analytics")}
        subtitle={t("Trends · heatmaps · predictive intelligence")}
        actions={
          <div className="flex items-center gap-2">
            {offline ? (
              <span className="flex items-center gap-1 border border-warning/50 bg-warning/10 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.2em] text-warning">
                <WifiOff className="h-3 w-3" /> {t("Offline · Mock Data")}
              </span>
            ) : !loading ? (
              <span className="flex items-center gap-1 border border-hud/40 bg-hud/5 px-2 py-1 text-[9px] uppercase tracking-[0.15em] text-hud/70">
                <Wifi className="h-3 w-3" /> Live
              </span>
            ) : null}

            <div className="flex">
              {DAY_OPTIONS.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => setDays(value)}
                  className={`-ml-px border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.2em] transition-colors first:ml-0 ${
                    days === value
                      ? "z-10 border-hud bg-hud/15 text-hud"
                      : "border-border text-muted-foreground hover:border-hud hover:text-hud"
                  }`}
                >
                  {t(label)}
                </button>
              ))}
            </div>

            <button
              onClick={load}
              disabled={loading}
              className="flex items-center gap-1 border border-border px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:border-hud hover:text-hud disabled:opacity-40"
            >
              <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
              {t("Refresh")}
            </button>
          </div>
        }
      />

      {/* KPI cards */}
      <div className="grid gap-3 px-4 py-4 sm:px-6 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t("Detections (7d)")}
          value={loading ? "…" : String(det7d)}
          delta={loading ? "" : `${delta} ${t("vs prev period")}`}
          deltaTone={positiveGrowth ? "text-threat" : "text-hud"}
          tone="hud"
        />
        <StatCard
          label={t("Critical events (7d)")}
          value={loading ? "…" : String(crit7d)}
          delta={crit7d > 0 ? t("Requires attention") : t("None detected")}
          deltaTone={crit7d > 0 ? "text-threat" : "text-hud"}
          tone="threat"
        />
        <StatCard
          label={t("Open incidents")}
          value={loading ? "…" : String(openInc)}
          delta={openInc > 3 ? t("High workload") : t("Manageable")}
          deltaTone={openInc > 3 ? "text-threat" : "text-hud"}
          tone="hud"
        />
        <StatCard
          label={t("Drone models tracked")}
          value={loading ? "…" : String(summary?.modelDist.length ?? 0)}
          delta={t("Distinct signatures")}
          deltaTone="text-muted-foreground"
          tone="hud"
        />
      </div>

      {/* Row 1: Detection volume + Incidents */}
      <div className="grid gap-3 px-4 pb-3 sm:px-6 lg:grid-cols-2">
        {/* Detection volume */}
        <HudPanel
          title={`${t("Detection Volume")} · ${days}d`}
          subtitle="All · Threats · Critical"
          bodyClassName="p-3 h-64"
        >
          {daily.length === 0 ? (loading ? <ChartLoading /> : <ChartEmpty />) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={daily} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="gDet" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor={C_HUD}    stopOpacity={0.45} />
                    <stop offset="100%" stopColor={C_HUD}    stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gThr" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor={C_THREAT} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={C_THREAT} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={C_BORDER} strokeDasharray="2 4" />
                <XAxis dataKey="day" stroke={C_MUTED} tick={{ fontSize: 9 }} tickLine={false} interval={xInterval} />
                <YAxis stroke={C_MUTED} tick={{ fontSize: 9 }} tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} formatter={(v, n) => [v, n === "detections" ? t("Detections") : n === "threats" ? t("Threats") : t("Critical")]} />
                <Legend wrapperStyle={{ fontSize: 10, paddingTop: 4 }} formatter={(v) => v === "detections" ? t("Detections") : v === "threats" ? t("Threats") : t("Critical")} />
                <Area type="monotone" dataKey="detections" name="detections" stroke={C_HUD}    fill="url(#gDet)" strokeWidth={2}   dot={false} />
                <Area type="monotone" dataKey="threats"    name="threats"    stroke={C_THREAT} fill="url(#gThr)" strokeWidth={1.5} dot={false} />
                <Area type="monotone" dataKey="critical"   name="critical"   stroke={C_WARN}   fill="none"       strokeWidth={1}   strokeDasharray="3 3" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </HudPanel>

        {/* Incidents opened vs resolved */}
        <HudPanel
          title={`${t("Incidents")} · ${days}d`}
          subtitle={`${t("Opened")} / ${t("Resolved")}`}
          bodyClassName="p-3 h-64"
        >
          {incDaily.length === 0 ? (loading ? <ChartLoading /> : <ChartEmpty />) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={incDaily} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
                <CartesianGrid stroke={C_BORDER} strokeDasharray="2 4" />
                <XAxis dataKey="day" stroke={C_MUTED} tick={{ fontSize: 9 }} tickLine={false} interval={xInterval} />
                <YAxis stroke={C_MUTED} tick={{ fontSize: 9 }} tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} formatter={(v, n) => [v, n === "incidents" ? t("Opened") : t("Resolved")]} />
                <Legend wrapperStyle={{ fontSize: 10, paddingTop: 4 }} formatter={(v) => v === "incidents" ? t("Opened") : t("Resolved")} />
                <Bar dataKey="incidents" name="incidents" fill={C_THREAT} radius={[2, 2, 0, 0]} maxBarSize={24} />
                <Bar dataKey="resolved"  name="resolved"  fill={C_HUD}    radius={[2, 2, 0, 0]} maxBarSize={24} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </HudPanel>
      </div>

      {/* Row 2: Model distribution + Threat distribution */}
      <div className="grid gap-3 px-4 pb-3 sm:px-6 lg:grid-cols-2">
        {/* Drone model distribution — donut */}
        <HudPanel title={t("Drone Model Distribution")} subtitle={t("Based on") + " " + t("detections in the last 7 days")} bodyClassName="p-3 h-64">
          {!summary?.modelDist.length ? (loading ? <ChartLoading /> : <ChartEmpty />) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={summary.modelDist} dataKey="value" nameKey="name" innerRadius={50} outerRadius={85} paddingAngle={2} strokeWidth={0}>
                  {summary.modelDist.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} />
                <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </HudPanel>

        {/* Threat level distribution — horizontal bar */}
        <HudPanel title={t("Threat Level Distribution")} subtitle={t("By detection count")} bodyClassName="p-3 h-64">
          {!summary?.threatDist.length ? (loading ? <ChartLoading /> : <ChartEmpty />) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={summary.threatDist.map((r) => ({ ...r, label: t(THREAT_LABEL_EN[r.name] ?? r.name) }))}
                layout="vertical"
                margin={{ top: 4, right: 16, left: 4, bottom: 0 }}
              >
                <CartesianGrid stroke={C_BORDER} strokeDasharray="2 4" horizontal={false} />
                <XAxis type="number" stroke={C_MUTED} tick={{ fontSize: 9 }} tickLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="label" stroke={C_MUTED} tick={{ fontSize: 10 }} tickLine={false} width={72} />
                <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} formatter={(v) => [v, t("Detections")]} />
                <Bar dataKey="value" name={t("Detections")} radius={[0, 3, 3, 0]} maxBarSize={28}>
                  {summary.threatDist.map((entry, i) => (
                    <Cell key={i} fill={THREAT_COLORS[entry.name] ?? C_HUD} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </HudPanel>
      </div>

      {/* Row 3: Incident status + Sensor health */}
      <div className="grid gap-3 px-4 pb-3 sm:px-6 lg:grid-cols-2">
        {/* Incident status breakdown */}
        <HudPanel title={t("Incident Status")} subtitle={`Total: ${storeIncs.length}`} bodyClassName="p-3 h-64">
          {incStatusData.length === 0 ? <ChartEmpty /> : (
            <div className="flex h-full items-center">
              <ResponsiveContainer width="55%" height="100%">
                <PieChart>
                  <Pie data={incStatusData} dataKey="value" nameKey="label" innerRadius={46} outerRadius={80} paddingAngle={3} strokeWidth={0}>
                    {incStatusData.map((entry, i) => (
                      <Cell key={i} fill={STATUS_COLORS[entry.name] ?? C_MUTED} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} formatter={(v, n) => [v, t(String(n))]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-2 pl-2">
                {incStatusData.map((entry) => (
                  <div key={entry.name} className="flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-sm shrink-0" style={{ background: STATUS_COLORS[entry.name] ?? C_MUTED }} />
                      <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{t(entry.label)}</span>
                    </div>
                    <span className="hud-stat font-bold" style={{ color: STATUS_COLORS[entry.name] ?? C_MUTED }}>{entry.value}</span>
                  </div>
                ))}
                {storeIncs.length === 0 && (
                  <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">{t("No data for this period")}</div>
                )}
              </div>
            </div>
          )}
        </HudPanel>

        {/* Sensor health */}
        <HudPanel title={t("Sensor Health")} subtitle={`${storeSensors.length} sensors`} bodyClassName="p-3 h-64">
          {storeSensors.length === 0 ? <ChartEmpty /> : (
            <div className="flex h-full flex-col justify-center gap-4 px-2">
              {/* Status bar */}
              <div>
                <div className="mb-1.5 flex justify-between text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
                  <span>{t("Status")}</span>
                  <span>{storeSensors.length}</span>
                </div>
                <div className="flex h-5 w-full overflow-hidden rounded-sm border border-border/40">
                  {sensorHealthData.map((seg, i) => (
                    <div
                      key={i}
                      style={{ width: `${(seg.count / storeSensors.length) * 100}%`, background: seg.fill }}
                      title={`${t(seg.status)}: ${seg.count}`}
                      className="h-full transition-all"
                    />
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                  {sensorHealthData.map((seg) => (
                    <div key={seg.status} className="flex items-center gap-1.5 text-[10px]">
                      <div className="h-2 w-2 rounded-sm" style={{ background: seg.fill }} />
                      <span className="text-muted-foreground">{t(seg.status)}</span>
                      <span className="hud-stat font-bold" style={{ color: seg.fill }}>{seg.count}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Avg health gauge via RadialBar */}
              {(() => {
                const avgHealth = storeSensors.length > 0
                  ? Math.round(storeSensors.reduce((s, x) => s + x.health, 0) / storeSensors.length)
                  : 0;
                const color = avgHealth >= 75 ? C_HUD : avgHealth >= 50 ? C_WARN : C_THREAT;
                return (
                  <div className="flex items-center gap-4">
                    <ResponsiveContainer width={100} height={80}>
                      <RadialBarChart innerRadius={28} outerRadius={44} data={[{ value: avgHealth, fill: color }]} startAngle={180} endAngle={0} barSize={10}>
                        <RadialBar dataKey="value" cornerRadius={4} background={{ fill: "var(--muted)/20" }} />
                      </RadialBarChart>
                    </ResponsiveContainer>
                    <div>
                      <div className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">{t("Health Score")}</div>
                      <div className="hud-stat text-2xl font-bold" style={{ color }}>{avgHealth}%</div>
                      <div className="text-[9px] uppercase tracking-[0.15em] text-muted-foreground">
                        {avgHealth >= 75 ? t("Normal") : avgHealth >= 50 ? t("Degraded") : t("CRITICAL")}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </HudPanel>
      </div>

      {/* Heatmap */}
      <HudPanel title={t("Detection Density · Grid View")} className="mx-4 mb-4 sm:mx-6 sm:mb-6" bodyClassName="p-4">
        <div
          className="grid gap-0.5"
          style={{ gridTemplateColumns: `repeat(${HEAT_COLS}, 1fr)` }}
        >
          {heatData.map((intensity, i) => {
            const row = Math.floor(i / HEAT_COLS);
            const col = i % HEAT_COLS;
            const lat = (HEAT_LAT_MAX - (row + 0.5) * (HEAT_LAT_MAX - HEAT_LAT_MIN) / HEAT_ROWS).toFixed(2);
            const lng = (HEAT_LNG_MIN + (col + 0.5) * (HEAT_LNG_MAX - HEAT_LNG_MIN) / HEAT_COLS).toFixed(2);
            return (
              <div
                key={i}
                className="aspect-square border border-border/20 transition-colors duration-500"
                style={{ background: heatColor(intensity) }}
                title={`${lat}°N ${lng}°E · ${(intensity * 100).toFixed(0)}%`}
              />
            );
          })}
        </div>

        {/* Legend */}
        <div className="mt-3 flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          <span>{t("Low activity")}</span>
          <div className="h-3 w-28 rounded-sm sm:w-48" style={{
            background: "linear-gradient(to right, oklch(0.30 0.07 145 / 0.45), oklch(0.54 0.17 72 / 0.72), oklch(0.78 0.27 0 / 1.0))",
          }} />
          <span>{t("High activity")}</span>
        </div>

        <div className="mt-2 flex items-center justify-center gap-6 text-[10px] text-muted-foreground">
          <span>
            Grid: <span className="font-mono text-hud/70">{HEAT_ROWS}×{HEAT_COLS}</span>
          </span>
          <span>
            {t("Detections")}:{" "}
            <span className="hud-stat font-bold text-hud">{storeDets.length}</span>
          </span>
          <span>
            Coverage:{" "}
            <span className="font-mono text-hud/70">51.0–51.4°N · 71.2–71.7°E</span>
          </span>
        </div>
      </HudPanel>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────
function StatCard({
  label, value, delta, deltaTone, tone,
}: {
  label: string; value: string; delta: string; deltaTone: string; tone: "hud" | "threat";
}) {
  return (
    <HudPanel bodyClassName="px-4 py-3">
      <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">{label}</div>
      <div className={`hud-stat mt-1 text-3xl font-bold ${tone === "threat" ? "text-threat" : "text-hud"}`}>{value}</div>
      {delta && <div className={`mt-1 text-[10px] uppercase tracking-[0.2em] ${deltaTone}`}>{delta}</div>}
    </HudPanel>
  );
}

function ChartEmpty() {
  const { t } = useT();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2">
      <div className="grid grid-cols-7 gap-1 opacity-20">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="w-6 rounded-sm bg-hud/40" style={{ height: `${20 + (i % 3) * 12}px` }} />
        ))}
      </div>
      <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{t("No data for this period")}</span>
    </div>
  );
}

function ChartLoading() {
  const { t } = useT();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2">
      <Loader2 className="h-5 w-5 animate-spin text-hud/60" />
      <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{t("Loading…")}</span>
    </div>
  );
}
