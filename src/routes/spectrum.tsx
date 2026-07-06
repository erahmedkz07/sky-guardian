import { createFileRoute } from "@tanstack/react-router";
import { HudPanel, PageHeader } from "@/components/HudPanel";
import { Activity, Radio, RefreshCw, Wifi } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { format } from "date-fns";
import { useT } from "@/lib/i18n";

export const Route = createFileRoute("/spectrum")({
  component: Spectrum,
  head: () => ({ meta: [{ title: "RF Spectrum // DDS" }] }),
});

// ─── Config ───────────────────────────────────────────────────
interface SpectrumConfig {
  freqStart:   number;  // MHz
  freqEnd:     number;  // MHz
  noiseFloor:  number;  // dBm
  gain:        number;  // dB  −20 … +40
  threshold:   number;  // dBm (anomaly line)
  scanRate:    number;  // Hz  1 … 60
  agc:         boolean;
  notches:     number[]; // MHz to suppress
}

const DEFAULT_CONFIG: SpectrumConfig = {
  freqStart:  200,
  freqEnd:    6000,
  noiseFloor: -92,
  gain:        0,
  threshold:  -75,
  scanRate:    42,
  agc:         false,
  notches:     [],
};

const NOTCH_PRESETS = [
  { freq: 433,  label: "433 MHz" },
  { freq: 915,  label: "915 MHz" },
  { freq: 1200, label: "1.2 GHz" },
  { freq: 2412, label: "2.4 GHz" },
  { freq: 5800, label: "5.8 GHz" },
];

const BANDS = [
  { id: "B-1", label: "433 MHz",  freq: 433,  use: "Telemetry",       risk: "low"    },
  { id: "B-2", label: "915 MHz",  freq: 915,  use: "Control link",    risk: "medium" },
  { id: "B-3", label: "1.2 GHz",  freq: 1200, use: "Long-range video", risk: "medium" },
  { id: "B-4", label: "2.4 GHz",  freq: 2400, use: "DJI / Wi-Fi video", risk: "high"   },
  { id: "B-5", label: "5.8 GHz",  freq: 5800, use: "FPV / racing",    risk: "high"   },
];

const DYNAMIC_RANGE = 70; // dB shown above noise floor
const SAMPLE_COUNT  = 160;
const SVG_W = 600;
const SVG_H = 200;

// ─── Signal model ─────────────────────────────────────────────
function signalAtFreq(freq: number, tick: number): number {
  let power = 0;
  if (freq >= 430  && freq <= 436)   power = Math.max(0, 22 + Math.sin(tick * 0.25) * 8);
  if (freq >= 908  && freq <= 928)   power = Math.max(0, 28 + Math.sin(tick * 0.30) * 10);
  if (freq >= 1200 && freq <= 1240)  power = Math.max(0, 18 + Math.sin(tick * 0.22) * 7);
  if (freq >= 2400 && freq <= 2483)  power = Math.max(0, 38 + Math.sin(tick * 0.20) * 12);
  if (freq >= 5725 && freq <= 5875)  power = Math.max(0, 30 + Math.sin(tick * 0.18) * 10);
  return power;
}

function computeSamples(cfg: SpectrumConfig, tick: number): number[] {
  return Array.from({ length: SAMPLE_COUNT }, (_, i) => {
    const freq = cfg.freqStart + (i / (SAMPLE_COUNT - 1)) * (cfg.freqEnd - cfg.freqStart);
    const noise  = Math.sin(i * 1.71 + tick * 0.31) * 2.5 + 3;
    const notched = cfg.notches.some((nf) => Math.abs(freq - nf) < 8);
    const signal  = notched ? 0 : signalAtFreq(freq, tick);
    let above = noise + signal + cfg.gain;
    if (cfg.agc) above *= 0.60;
    return Math.max(0, Math.min(DYNAMIC_RANGE, above));
  });
}

function sampleToY(s: number): number {
  return SVG_H - (s / DYNAMIC_RANGE) * SVG_H;
}

function formatFreq(mhz: number): string {
  return mhz >= 1000 ? `${(mhz / 1000).toFixed(mhz % 1000 === 0 ? 0 : 1)} GHz` : `${mhz} MHz`;
}

function modelToFreq(model: string): string {
  const m = model.toUpperCase();
  if (m.includes("DJI") || m.includes("MAVIC")) return "2.412 GHz";
  if (m.includes("FPV") || m.includes("RACING")) return "5.745 GHz";
  if (m.includes("ШАХЕД") || m.includes("SHAHED")) return "915 MHz";
  if (m.includes("БАЙРАКТАР") || m.includes("BAYRAKTAR")) return "1.200 GHz";
  return "2.450 GHz";
}
function modelToMatch(model: string): string {
  const m = model.toUpperCase();
  if (m.includes("DJI") || m.includes("MAVIC")) return "DJI OcuSync";
  if (m.includes("БАЙРАКТАР") || m.includes("BAYRAKTAR")) return "Mil-grade enc.";
  if (m.includes("ШАХЕД") || m.includes("SHAHED")) return "Thermal · low RF";
  if (m.includes("FPV")) return "FPV analog";
  return "Unknown emitter";
}
function threatToPower(threat: string): string {
  return { critical: "−48 dBm", high: "−58 dBm", medium: "−68 dBm", low: "−78 dBm" }[threat] ?? "−65 dBm";
}

// ─── Outer shell ──────────────────────────────────────────────
function Spectrum() {
  const [config, setConfig] = useState<SpectrumConfig>(DEFAULT_CONFIG);
  const [scanKey, setScanKey] = useState(0);

  function patch(partial: Partial<SpectrumConfig>) {
    setConfig((c) => ({ ...c, ...partial }));
  }

  function toggleNotch(freq: number) {
    setConfig((c) => ({
      ...c,
      notches: c.notches.includes(freq)
        ? c.notches.filter((n) => n !== freq)
        : [...c.notches, freq],
    }));
  }

  function rescan() {
    setScanKey((k) => k + 1);
  }

  return (
    <SpectrumInner
      key={scanKey}
      config={config}
      onPatch={patch}
      onToggleNotch={toggleNotch}
      onRescan={rescan}
    />
  );
}

// ─── Inner — remounts on every rescan ─────────────────────────
function SpectrumInner({
  config, onPatch, onToggleNotch, onRescan,
}: {
  config: SpectrumConfig;
  onPatch: (p: Partial<SpectrumConfig>) => void;
  onToggleNotch: (freq: number) => void;
  onRescan: () => void;
}) {
  const { t } = useT();
  const detections  = useStore((s) => s.detections);
  const [tick, setTick] = useState(0);
  const [done, setDone] = useState(false);
  const TOTAL_TICKS = 180;

  // Restart timer when scanRate changes (rescan triggers remount anyway)
  useEffect(() => {
    const ms = Math.round(1000 / Math.max(1, config.scanRate));
    const id = setInterval(() => {
      setTick((t) => {
        if (t + 1 >= TOTAL_TICKS) { clearInterval(id); setDone(true); return TOTAL_TICKS; }
        return t + 1;
      });
    }, ms);
    return () => clearInterval(id);
  }, [config.scanRate]);

  const progress = tick / TOTAL_TICKS;
  const sweepX   = progress * SVG_W;

  const samples = useMemo(() => computeSamples(config, tick), [config, tick]);

  // Threshold in pixel Y
  const threshAbove = config.threshold - config.noiseFloor;
  const threshY = SVG_H - Math.max(0, Math.min(SVG_H, (threshAbove / DYNAMIC_RANGE) * SVG_H));

  // Anomalies: samples above threshold
  const anomalies = samples.filter((s) => config.noiseFloor + s >= config.threshold).length;

  // Visible bands within freq range
  const visibleBands = BANDS.filter((b) => b.freq >= config.freqStart && b.freq <= config.freqEnd);

  // Freq-axis labels (5 evenly spaced)
  const freqLabels = Array.from({ length: 5 }, (_, i) => {
    const freq = config.freqStart + (i / 4) * (config.freqEnd - config.freqStart);
    const x = (i / 4) * SVG_W;
    return { freq, x };
  });

  // dBm Y-axis labels
  const dbmLabels = [0, 20, 40, 60].map((offset) => ({
    dbm: config.noiseFloor + offset,
    y: SVG_H - (offset / DYNAMIC_RANGE) * SVG_H,
  }));

  // SVG path
  const pathD = samples.length < 2 ? "" :
    `M0,${sampleToY(samples[0])} ` +
    samples.map((s, i) => `L${(i / (SAMPLE_COUNT - 1)) * SVG_W},${sampleToY(s)}`).join(" ") +
    ` L${SVG_W},${SVG_H} L0,${SVG_H} Z`;

  const recentEmissions = detections.slice(0, 8);

  return (
    <div>
      <PageHeader
        title={t("RF Spectrum")}
        subtitle={`${t("Wideband sweep · 200 MHz – 6 GHz")} · ${formatFreq(config.freqStart)} – ${formatFreq(config.freqEnd)}`}
        actions={
          <button
            onClick={onRescan}
            disabled={!done}
            className={`flex items-center gap-2 border px-3 py-2 text-[10px] uppercase tracking-[0.2em] transition-colors ${
              done ? "border-hud text-hud hover:bg-hud/10" : "border-border text-muted-foreground opacity-40 cursor-not-allowed"
            }`}
          >
            <RefreshCw className={`h-3 w-3 ${!done ? "animate-spin" : ""}`} />
            {done ? t("Rescan") : t("Scanning…")}
          </button>
        }
      />

      {/* KPIs */}
      <div className="grid gap-3 px-4 py-4 sm:px-6 sm:grid-cols-2 lg:grid-cols-4">
        <KPI icon={Activity} label={t("Sweep rate")}    value={`${config.scanRate} Hz`} />
        <KPI icon={Radio}    label={t("Active bands")}  value={`${visibleBands.filter((b) => b.risk !== "low").length} / ${visibleBands.length}`} />
        <KPI icon={Wifi}     label={t("Anomalies")}     value={String(anomalies)} tone={anomalies > 0 ? "warning" : undefined} />
        <KPI icon={Activity} label={t("Noise floor")}   value={`${config.noiseFloor} dBm`} />
      </div>

      {/* Main layout: waterfall + cal panel */}
      <div className="grid gap-3 px-4 pb-4 sm:px-6 xl:grid-cols-[1fr_320px]">
        {/* Left: Waterfall */}
        <div className="space-y-3">
          <HudPanel
            title={t("Live Waterfall")}
            subtitle={done ? t("Sweep complete · static snapshot") : `${t("Scanning…")} ${Math.round(progress * 100)}%`}
            bodyClassName="p-3"
            actions={
              done ? (
                <span className="border border-hud/50 bg-hud/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.2em] text-hud">{t("Complete")}</span>
              ) : (
                <span className="blink-pulse border border-warning/50 bg-warning/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.2em] text-warning">{t("Scanning")}</span>
              )
            }
          >
            <svg viewBox={`0 0 ${SVG_W + 40} ${SVG_H + 30}`} className="h-64 w-full" style={{ fontFamily: "monospace" }}>
              <defs>
                <linearGradient id="spec-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor="var(--hud)" stopOpacity="0.55" />
                  <stop offset="100%" stopColor="var(--hud)" stopOpacity="0.02" />
                </linearGradient>
                <linearGradient id="spec-fill-hot" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor="var(--threat)" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="var(--threat)" stopOpacity="0" />
                </linearGradient>
                <clipPath id="sweep-clip">
                  <rect x="40" y="0" width={sweepX} height={SVG_H} />
                </clipPath>
              </defs>

              {/* Y-axis labels (dBm) */}
              {dbmLabels.map(({ dbm, y }) => (
                <g key={dbm}>
                  <text x="36" y={y + 4} fill="var(--muted-foreground)" fontSize="8" textAnchor="end">{dbm}</text>
                  <line x1="38" x2="40" y1={y} y2={y} stroke="var(--border)" />
                </g>
              ))}
              <text x="0" y={SVG_H / 2} fill="var(--muted-foreground)" fontSize="7" textAnchor="middle"
                transform={`rotate(-90, 8, ${SVG_H / 2})`}>dBm</text>

              {/* Grid */}
              <g transform="translate(40,0)">
                {[0, 50, 100, 150, SVG_H].map((y) => (
                  <line key={y} x1="0" x2={SVG_W} y1={y} y2={y} stroke="var(--border)" strokeDasharray="2 4" strokeOpacity="0.6" />
                ))}
                {[0, 100, 200, 300, 400, 500, SVG_W].map((x) => (
                  <line key={x} x1={x} x2={x} y1="0" y2={SVG_H} stroke="var(--border)" strokeDasharray="2 4" strokeOpacity="0.6" />
                ))}

                {/* Threshold line */}
                <line x1="0" x2={SVG_W} y1={threshY} y2={threshY}
                  stroke="var(--threat)" strokeWidth="1" strokeDasharray="4 3" strokeOpacity="0.7" />
                <text x={SVG_W - 2} y={threshY - 3} fill="var(--threat)" fontSize="8" textAnchor="end">
                  Threshold {config.threshold} dBm
                </text>

                {/* Notch markers */}
                {config.notches.map((nf) => {
                  const x = ((nf - config.freqStart) / (config.freqEnd - config.freqStart)) * SVG_W;
                  if (x < 0 || x > SVG_W) return null;
                  return (
                    <g key={nf}>
                      <line x1={x} x2={x} y1={0} y2={SVG_H} stroke="oklch(0.65 0.20 280)" strokeWidth="1.5" strokeDasharray="3 2" strokeOpacity="0.6" />
                      <text x={x + 2} y="10" fill="oklch(0.65 0.20 280)" fontSize="8">NOTCH</text>
                    </g>
                  );
                })}

                {/* Band markers */}
                {visibleBands.map((b) => {
                  const x = ((b.freq - config.freqStart) / (config.freqEnd - config.freqStart)) * SVG_W;
                  if (x < 0 || x > SVG_W) return null;
                  const tone = b.risk === "high" ? "var(--threat)" : b.risk === "medium" ? "var(--warning)" : "var(--hud)";
                  return (
                    <g key={b.id}>
                      <line x1={x} x2={x} y1={0} y2={SVG_H} stroke={tone} strokeWidth="0.8" strokeDasharray="2 4" strokeOpacity="0.4" />
                      <text x={x + 2} y={SVG_H - 4} fill={tone} fontSize="7">{b.label}</text>
                    </g>
                  );
                })}

                {/* Waveform */}
                <g clipPath={done ? undefined : "url(#sweep-clip)"}>
                  <path d={pathD} fill="url(#spec-fill)" stroke="var(--hud)" strokeWidth="1.2" />
                  {/* Anomaly dots */}
                  {samples.map((s, i) => {
                    const aboveFloor = config.noiseFloor + s;
                    if (aboveFloor < config.threshold) return null;
                    const cx = (i / (SAMPLE_COUNT - 1)) * SVG_W;
                    const cy = sampleToY(s);
                    return <circle key={i} cx={cx} cy={cy} r="2.5" fill="var(--threat)" stroke="var(--threat)" strokeOpacity="0.4" strokeWidth="3" />;
                  })}
                </g>

                {/* Scan line */}
                {!done && (
                  <>
                    <line x1={sweepX} x2={sweepX} y1="0" y2={SVG_H} stroke="var(--hud)" strokeWidth="1.5" strokeOpacity="0.9" />
                    <line x1={sweepX} x2={sweepX} y1="0" y2={SVG_H} stroke="var(--hud)" strokeWidth="8" strokeOpacity="0.08" />
                    <rect x={Math.max(0, sweepX - 20)} y="0" width="20" height={SVG_H}
                      fill="var(--hud)" fillOpacity="0.03" />
                  </>
                )}

                {/* Freq labels */}
                {freqLabels.map(({ freq, x }) => (
                  <text key={freq} x={Math.min(x, SVG_W - 4)} y={SVG_H + 14}
                    fill="var(--muted-foreground)" fontSize="8"
                    textAnchor={x < 20 ? "start" : x > SVG_W - 20 ? "end" : "middle"}>
                    {formatFreq(freq)}
                  </text>
                ))}
              </g>
            </svg>
          </HudPanel>

          {/* Bands table */}
          <HudPanel title={t("Monitored Bands")} subtitle={`${visibleBands.length} ${t("channels")}`} bodyClassName="p-0">
            <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-xs">
              <thead className="bg-panel-elevated text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">{t("ID")}</th>
                  <th className="px-3 py-2 text-left">{t("Band")}</th>
                  <th className="px-3 py-2 text-left">{t("Use")}</th>
                  <th className="px-3 py-2 text-left">{t("Risk")}</th>
                  <th className="px-3 py-2 text-left">{t("Notch")}</th>
                  <th className="px-3 py-2 text-right">{t("Activity")}</th>
                </tr>
              </thead>
              <tbody>
                {visibleBands.map((b, idx) => {
                  const tone = b.risk === "high" ? "text-threat" : b.risk === "medium" ? "text-warning" : "text-hud";
                  const bgTone = b.risk === "high" ? "bg-threat" : b.risk === "medium" ? "bg-warning" : "bg-hud";
                  // Activity: sample value around this band's freq position
                  const sampleIdx = Math.floor(((b.freq - config.freqStart) / (config.freqEnd - config.freqStart)) * SAMPLE_COUNT);
                  const activity = sampleIdx >= 0 && sampleIdx < SAMPLE_COUNT
                    ? Math.round((samples[sampleIdx] / DYNAMIC_RANGE) * 100)
                    : 0;
                  const notched = config.notches.includes(b.freq);
                  return (
                    <tr key={b.id} className={`border-t border-border/40 hover:bg-hud/5 ${notched ? "opacity-50" : ""}`}>
                      <td className="hud-stat px-3 py-2 text-hud">{b.id}</td>
                      <td className="px-3 py-2 font-bold">{b.label}</td>
                      <td className="px-3 py-2 text-muted-foreground">{b.use}</td>
                      <td className={`hud-stat px-3 py-2 font-bold uppercase ${tone}`}>
                        {b.risk === "high" ? t("High") : b.risk === "medium" ? t("Medium") : t("Low")}
                      </td>
                      <td className="px-3 py-2">
                        {notched && (
                          <span className="border border-border/50 px-1.5 py-0.5 text-[8px] uppercase tracking-[0.15em] text-muted-foreground">
                            NOTCH
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="ml-auto flex items-center gap-2">
                          <span className={`hud-stat text-[10px] ${tone}`}>{activity}%</span>
                          <div className="h-1 w-20 bg-muted">
                            <div className={`h-full transition-[width] duration-200 ${bgTone}`} style={{ width: `${activity}%` }} />
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {visibleBands.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-4 text-center text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                      {t("No bands in selected frequency window")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            </div>
          </HudPanel>

          {/* Recent emissions */}
          <HudPanel
            title={t("Recent Emissions")}
            subtitle={recentEmissions.length > 0 ? t("From live detections") : t("No detections")}
            bodyClassName="p-0 max-h-60 overflow-auto"
          >
            {recentEmissions.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs uppercase tracking-[0.2em] text-muted-foreground">
                {t("Awaiting detection data…")}
              </div>
            ) : (
              recentEmissions.map((d) => (
                <div key={d.id} className="grid grid-cols-4 gap-2 border-b border-border/40 px-4 py-2 text-[11px]">
                  <span className="hud-stat text-muted-foreground">{format(d.timestamp, "HH:mm:ss")}</span>
                  <span className="hud-stat font-bold text-hud">{modelToFreq(d.model)}</span>
                  <span className="hud-stat">{threatToPower(d.threat)}</span>
                  <span className="truncate text-muted-foreground">{modelToMatch(d.model)}</span>
                </div>
              ))
            )}
          </HudPanel>
        </div>

        {/* Right: Calibration Panel */}
        <CalibPanel
          config={config}
          onPatch={onPatch}
          onToggleNotch={onToggleNotch}
        />
      </div>
    </div>
  );
}

// ─── Calibration panel ────────────────────────────────────────
function CalibPanel({
  config, onPatch, onToggleNotch,
}: {
  config: SpectrumConfig;
  onPatch: (p: Partial<SpectrumConfig>) => void;
  onToggleNotch: (freq: number) => void;
}) {
  const { t } = useT();
  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="border border-hud/30 bg-panel px-4 py-2">
        <div className="text-[9px] uppercase tracking-[0.3em] text-muted-foreground">Block</div>
        <div className="text-sm font-bold tracking-[0.3em] text-hud">{t("RF Calibration Block")}</div>
        <div className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground/70">RF-CAL v2.1</div>
      </div>

      {/* Potentiometers */}
      <HudPanel title={t("Potentiometers")} bodyClassName="p-4">
        <div className="flex items-end justify-around gap-2">
          <Knob
            label={t("GAIN")}
            value={config.gain}
            min={-20}
            max={40}
            unit=" dB"
            onChange={(v) => onPatch({ gain: v })}
          />
          <Knob
            label={t("THRESHOLD")}
            value={config.threshold}
            min={-120}
            max={-40}
            unit=" dBm"
            onChange={(v) => onPatch({ threshold: v })}
          />
          <Knob
            label={t("RATE")}
            value={config.scanRate}
            min={1}
            max={60}
            unit=" Hz"
            onChange={(v) => onPatch({ scanRate: v })}
          />
        </div>
      </HudPanel>

      {/* Frequency window */}
      <HudPanel title={t("Frequency Window")} bodyClassName="p-4">
        <FreqRangeSlider
          low={config.freqStart}
          high={config.freqEnd}
          onChangeLow={(v) => onPatch({ freqStart: v })}
          onChangeHigh={(v) => onPatch({ freqEnd: v })}
        />
      </HudPanel>

      {/* Noise floor */}
      <HudPanel title={t("Noise floor")} bodyClassName="p-4">
        <HudSlider
          label={t("Noise floor")}
          value={config.noiseFloor}
          min={-120}
          max={-40}
          unit=" dBm"
          onChange={(v) => onPatch({ noiseFloor: v })}
          colorFn={(pct) => pct > 0.7 ? "bg-threat" : pct > 0.4 ? "bg-warning" : "bg-hud"}
        />
        <div className="mt-3 flex items-center justify-between text-[10px] text-muted-foreground">
          <span>−120 dBm</span>
          <span className="hud-stat text-hud">{config.noiseFloor} dBm</span>
          <span>−40 dBm</span>
        </div>
      </HudPanel>

      {/* AGC */}
      <HudPanel title="Receiver" bodyClassName="p-4 space-y-3">
        <CalibToggle
          label={`AGC — ${t("Auto Gain Control (AGC)")}`}
          sublabel={config.agc ? "Range ×0.6" : "Manual mode"}
          on={config.agc}
          onChange={(v) => onPatch({ agc: v })}
        />
        <div className="border-t border-border/30 pt-3">
          <div className="mb-1 text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
            Dynamic range
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1 h-2 bg-muted">
              <div
                className="h-full bg-hud/60 transition-all"
                style={{ width: config.agc ? "60%" : "100%" }}
              />
            </div>
            <span className="hud-stat text-[11px] text-hud font-bold">
              {config.agc ? "42" : "70"} dB
            </span>
          </div>
        </div>
      </HudPanel>

      {/* Notch filters */}
      <HudPanel title={t("Notch Filters")} subtitle="Suppress frequencies" bodyClassName="p-3">
        <div className="space-y-1.5">
          {NOTCH_PRESETS.map(({ freq, label }) => {
            const active = config.notches.includes(freq);
            return (
              <button
                key={freq}
                onClick={() => onToggleNotch(freq)}
                className={`flex w-full items-center justify-between border px-3 py-2 text-[10px] uppercase tracking-[0.15em] transition-colors ${
                  active
                    ? "border-[oklch(0.65_0.20_280)] bg-[oklch(0.65_0.20_280)]/10 text-[oklch(0.65_0.20_280)]"
                    : "border-border/40 text-muted-foreground hover:border-hud hover:text-hud"
                }`}
              >
                <span>{label}</span>
                <span className={`font-bold ${active ? "" : "opacity-40"}`}>
                  {active ? "NOTCH ●" : "OFF"}
                </span>
              </button>
            );
          })}
        </div>
        {config.notches.length > 0 && (
          <div className="mt-2 text-center text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
            {config.notches.length} {t("Notch Filters").toLowerCase()} active
          </div>
        )}
      </HudPanel>

      {/* Live readout */}
      <div className="border border-border/30 bg-panel/50 p-3 font-mono text-[10px] space-y-1">
        <div className="text-[9px] uppercase tracking-[0.25em] text-muted-foreground mb-2">{t("Live Readout")}</div>
        <ReadoutRow k="FREQ" v={`${formatFreq(config.freqStart)} – ${formatFreq(config.freqEnd)}`} />
        <ReadoutRow k="GAIN" v={`${config.gain >= 0 ? "+" : ""}${config.gain} dB`} />
        <ReadoutRow k="NFLR" v={`${config.noiseFloor} dBm`} />
        <ReadoutRow k="THR"  v={`${config.threshold} dBm`} />
        <ReadoutRow k="AGC"  v={config.agc ? "ON" : "OFF"} />
        <ReadoutRow k="NOTCH" v={config.notches.length > 0 ? config.notches.map(formatFreq).join(", ") : "NONE"} />
      </div>
    </div>
  );
}

// ─── Knob (SVG potentiometer) ────────────────────────────────
function Knob({
  label, value, min, max, unit, onChange,
}: {
  label: string; value: number; min: number; max: number; unit: string; onChange: (v: number) => void;
}) {
  const SIZE   = 72;
  const R_OUTER = SIZE / 2 - 5;
  const R_TRACK = R_OUTER - 2;
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const MIN_DEG = -135;
  const MAX_DEG = 135;

  const pct = (value - min) / (max - min);
  const angleDeg = MIN_DEG + pct * (MAX_DEG - MIN_DEG);

  function polarXY(deg: number, r: number) {
    const rad = (deg * Math.PI) / 180;
    return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) };
  }

  function arcPath(a1: number, a2: number, r: number) {
    const p1 = polarXY(a1, r);
    const p2 = polarXY(a2, r);
    const large = Math.abs(a2 - a1) > 180 ? 1 : 0;
    const sweep = a2 > a1 ? 1 : 0;
    return `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} A ${r} ${r} 0 ${large} ${sweep} ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }

  const tipPt = polarXY(angleDeg, R_OUTER - 9);
  const drag = useRef<{ active: boolean; startY: number; startVal: number }>({ active: false, startY: 0, startVal: 0 });

  const onPointerDown = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    drag.current = { active: true, startY: e.clientY, startVal: value };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  }, [value]);

  const onPointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (!drag.current.active) return;
    const dy = drag.current.startY - e.clientY;
    const delta = (dy / 120) * (max - min);
    const next = Math.max(min, Math.min(max, drag.current.startVal + delta));
    onChange(Math.round(next));
  }, [max, min, onChange]);

  const onPointerUp = useCallback(() => { drag.current.active = false; }, []);

  return (
    <div className="flex flex-col items-center gap-1.5 select-none">
      <svg
        width={SIZE} height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="cursor-ns-resize touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        style={{ userSelect: "none" }}
      >
        {/* Tick marks */}
        {Array.from({ length: 9 }, (_, i) => {
          const deg = MIN_DEG + (i / 8) * (MAX_DEG - MIN_DEG);
          const p1 = polarXY(deg, R_OUTER + 1);
          const p2 = polarXY(deg, R_OUTER - 3);
          return <line key={i} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="var(--border)" strokeWidth="1" />;
        })}
        {/* Background arc */}
        <path d={arcPath(MIN_DEG, MAX_DEG, R_TRACK)} fill="none" stroke="var(--border)" strokeWidth="4" strokeLinecap="round" />
        {/* Active arc */}
        {pct > 0 && (
          <path d={arcPath(MIN_DEG, angleDeg, R_TRACK)} fill="none" stroke="var(--hud)" strokeWidth="4" strokeLinecap="round" />
        )}
        {/* Body */}
        <circle cx={cx} cy={cy} r={R_OUTER - 9} fill="var(--panel-elevated)" stroke="var(--border)" strokeWidth="1.5" />
        {/* Grooves */}
        {Array.from({ length: 12 }, (_, i) => {
          const deg = (i / 12) * 360;
          const p1 = polarXY(deg, R_OUTER - 11);
          const p2 = polarXY(deg, R_OUTER - 14);
          return <line key={i} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="var(--border)" strokeWidth="0.8" />;
        })}
        {/* Pointer */}
        <line x1={cx} y1={cy} x2={tipPt.x} y2={tipPt.y} stroke="var(--hud)" strokeWidth="2" strokeLinecap="round" />
        <circle cx={cx} cy={cy} r="3" fill="var(--hud)" />
        <circle cx={tipPt.x} cy={tipPt.y} r="2" fill="var(--hud)" />
      </svg>
      <div className="text-center leading-tight">
        <div className="hud-stat font-bold text-hud text-[11px]">{value}{unit}</div>
        <div className="text-[8px] uppercase tracking-[0.2em] text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

// ─── Dual-handle frequency range slider ───────────────────────
function FreqRangeSlider({
  low, high, onChangeLow, onChangeHigh,
}: {
  low: number; high: number; onChangeLow: (v: number) => void; onChangeHigh: (v: number) => void;
}) {
  const MIN = 200;
  const MAX = 6000;
  const pctLow  = ((low  - MIN) / (MAX - MIN)) * 100;
  const pctHigh = ((high - MIN) / (MAX - MIN)) * 100;

  return (
    <div>
      <div className="mb-2 flex justify-between text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
        <span>Start: <span className="text-hud hud-stat font-bold">{formatFreq(low)}</span></span>
        <span>End: <span className="text-hud hud-stat font-bold">{formatFreq(high)}</span></span>
      </div>
      {/* Track */}
      <div className="relative h-8 mt-1">
        <div className="absolute top-3 left-0 right-0 h-2 bg-muted rounded-sm" />
        {/* Active range */}
        <div
          className="absolute top-3 h-2 bg-hud/30 rounded-sm border-t border-b border-hud/40"
          style={{ left: `${pctLow}%`, right: `${100 - pctHigh}%` }}
        />
        {/* Low handle */}
        <input
          type="range" min={MIN} max={MAX} step={10} value={low}
          onChange={(e) => { const v = Number(e.target.value); if (v < high - 100) onChangeLow(v); }}
          className="absolute inset-0 w-full opacity-0 cursor-pointer"
          style={{ zIndex: 2 }}
        />
        {/* High handle */}
        <input
          type="range" min={MIN} max={MAX} step={10} value={high}
          onChange={(e) => { const v = Number(e.target.value); if (v > low + 100) onChangeHigh(v); }}
          className="absolute inset-0 w-full opacity-0 cursor-pointer"
          style={{ zIndex: 3 }}
        />
        {/* Visual handles */}
        <div
          className="pointer-events-none absolute top-1.5 h-5 w-3 -translate-x-1/2 border border-hud bg-hud/30 rounded-sm"
          style={{ left: `${pctLow}%`, zIndex: 4 }}
        />
        <div
          className="pointer-events-none absolute top-1.5 h-5 w-3 -translate-x-1/2 border border-hud bg-hud/30 rounded-sm"
          style={{ left: `${pctHigh}%`, zIndex: 4 }}
        />
      </div>
      {/* Scale labels */}
      <div className="flex justify-between text-[8px] text-muted-foreground mt-1">
        {[200, 915, 2400, 4000, 6000].map((f) => (
          <span key={f}>{formatFreq(f)}</span>
        ))}
      </div>

      {/* Quick presets */}
      <div className="mt-3 grid grid-cols-3 gap-1">
        {[
          { label: "200M–1G",  s: 200,  e: 1000 },
          { label: "1G–3G",   s: 1000, e: 3000 },
          { label: "5G–6G",   s: 5000, e: 6000 },
          { label: "Full",    s: 200,  e: 6000 },
          { label: "DJI",     s: 2350, e: 2500 },
          { label: "FPV",     s: 5700, e: 5900 },
        ].map(({ label, s, e }) => (
          <button
            key={label}
            onClick={() => { onChangeLow(s); onChangeHigh(e); }}
            className={`border px-1.5 py-1 text-[9px] uppercase tracking-[0.12em] transition-colors ${
              low === s && high === e
                ? "border-hud bg-hud/15 text-hud"
                : "border-border/40 text-muted-foreground hover:border-hud hover:text-hud"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Hud slider ───────────────────────────────────────────────
function HudSlider({
  label, value, min, max, unit, onChange, colorFn,
}: {
  label: string; value: number; min: number; max: number; unit: string;
  onChange: (v: number) => void;
  colorFn?: (pct: number) => string;
}) {
  const pct = (value - min) / (max - min);
  const color = colorFn ? colorFn(pct) : "bg-hud";
  return (
    <div>
      <div className="mb-1 flex justify-between text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
        <span>{label}</span>
        <span className="hud-stat text-hud">{value}{unit}</span>
      </div>
      <div className="relative">
        <div className="h-2 w-full bg-muted rounded-sm" />
        <div className={`absolute top-0 left-0 h-2 rounded-sm transition-all ${color}`} style={{ width: `${pct * 100}%` }} />
        <input
          type="range" min={min} max={max} value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="absolute inset-0 w-full opacity-0 cursor-pointer"
        />
      </div>
    </div>
  );
}

// ─── Calib toggle ─────────────────────────────────────────────
function CalibToggle({ label, sublabel, on, onChange }: { label: string; sublabel?: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className="flex w-full items-center justify-between text-left gap-3"
    >
      <div>
        <div className="text-[10px] uppercase tracking-[0.15em] text-foreground">{label}</div>
        {sublabel && <div className="text-[9px] text-muted-foreground">{sublabel}</div>}
      </div>
      <div className={`relative h-5 w-10 shrink-0 border transition-colors ${on ? "border-hud bg-hud/20" : "border-border bg-muted"}`}>
        <div className={`absolute top-0.5 h-3.5 w-3.5 transition-all ${on ? "left-5 bg-hud" : "left-0.5 bg-muted-foreground/60"}`} />
      </div>
    </button>
  );
}

// ─── Helpers ──────────────────────────────────────────────────
function ReadoutRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-12 shrink-0 text-muted-foreground text-[9px]">{k}</span>
      <span className="text-hud text-[10px] font-bold">{v}</span>
    </div>
  );
}

function KPI({ icon: Icon, label, value, tone }: { icon: typeof Activity; label: string; value: string; tone?: "warning" }) {
  const t = tone === "warning" ? "text-warning" : "text-hud";
  return (
    <div className="hud-panel flex items-center gap-3 px-4 py-3">
      <Icon className={`h-5 w-5 ${t}`} />
      <div>
        <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">{label}</div>
        <div className={`hud-stat text-2xl font-bold ${t}`}>{value}</div>
      </div>
    </div>
  );
}
