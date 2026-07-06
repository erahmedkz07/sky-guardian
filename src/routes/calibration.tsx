import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import { HudPanel, PageHeader, StatusDot } from "@/components/HudPanel";
import {
  History,
  RotateCcw,
  Save,
  CheckCircle,
  AlertCircle,
  Bell,
  BellOff,
  Play,
  Sliders,
  Gauge,
} from "lucide-react";
import { useStore, applyCalibration, saveCalibration, type CalibrationConfig } from "@/lib/store";
import { auditApi, aiEngineApi, sensorsApi, type ApiAuditLog } from "@/lib/api";
// sensorsApi used only for calibration offset sync (per-sensor offsets now live in sensors.tsx)

export const Route = createFileRoute("/calibration")({
  component: Calibration,
  head: () => ({ meta: [{ title: "Calibration // DDS" }] }),
});

// ─── Profiles ─────────────────────────────────────────────────
interface ProfileDef {
  name: string;
  sub: string;
  confidence: number;
  altitude: number;
  speed: number;
  autoClassify: number;
  alertColor: string;
}

const PROFILES: ProfileDef[] = [
  {
    name: "PEACETIME",
    sub: "Standard threshold · low sensitivity",
    confidence: 55, altitude: 30, speed: 15, autoClassify: 92,
    alertColor: "text-hud border-hud/40 bg-hud/8",
  },
  {
    name: "HEIGHTENED READINESS",
    sub: "Moderate threshold · recommended at DEFCON 3",
    confidence: 62, altitude: 40, speed: 20, autoClassify: 88,
    alertColor: "text-warning border-warning/40 bg-warning/8",
  },
  {
    name: "COMBAT OPERATIONS",
    sub: "Aggressive threshold · maximum sensitivity",
    confidence: 45, altitude: 20, speed: 10, autoClassify: 80,
    alertColor: "text-threat border-threat/40 bg-threat/8",
  },
  {
    name: "TRAINING MODE",
    sub: "Conservative threshold · training mode",
    confidence: 70, altitude: 50, speed: 30, autoClassify: 95,
    alertColor: "text-purple-400 border-purple-400/40 bg-purple-400/8",
  },
];

function findProfile(name: string): ProfileDef | undefined {
  return PROFILES.find((p) => p.name === name);
}

// ─── Main component ───────────────────────────────────────────
function Calibration() {
  const { t } = useT();
  const calibStore = useStore((s) => s.calibration);
  const detections = useStore((s) => s.detections);

  // Local (pending) values — separate from applied store values
  const [cfg, setCfg] = useState<CalibrationConfig>(() => ({ ...calibStore }));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [history, setHistory] = useState<ApiAuditLog[]>([]);
  const [histLoading, setHistLoading] = useState(true);

  // Notification test state
  const [testing, setTesting] = useState<string | null>(null);

  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function loadHistory() {
    setHistLoading(true);
    auditApi.list(40)
      .then((rows) => setHistory(rows.filter((r) => r.resource === "calibration" || r.action === "CALIBRATION_SAVE")))
      .catch(() => {})
      .finally(() => setHistLoading(false));
  }

  useEffect(() => { loadHistory(); }, []);

  function patch(update: Partial<CalibrationConfig>) {
    setCfg((prev) => ({ ...prev, ...update }));
    setDirty(true);
    setSaved(false);
  }

  function activateProfile(p: ProfileDef) {
    patch({
      activeProfile: p.name,
      confidence: p.confidence,
      altitude: p.altitude,
      speed: p.speed,
      autoClassify: p.autoClassify,
    });
  }

  function handleApply() {
    applyCalibration({ ...cfg });
  }

  async function handleSave() {
    setSaving(true);
    saveCalibration({ ...cfg });

    // Sync AI engine confidence
    try {
      await aiEngineApi.patchSettings({ globalMinConfidence: cfg.confidence });
    } catch { /* ignore */ }

    // Audit log
    try {
      await auditApi.log({
        action: "CALIBRATION_SAVE",
        resource: "calibration",
        resourceId: cfg.activeProfile,
        details: {
          confidence: cfg.confidence,
          altitude: cfg.altitude,
          speed: cfg.speed,
          autoClassify: cfg.autoClassify,
        } as unknown as object,
      });
    } catch { /* ignore */ }

    setSaving(false);
    setDirty(false);
    setSaved(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 3000);
    loadHistory();
  }

  function handleRollback() {
    const defaultProfile = PROFILES[1];
    const reset: CalibrationConfig = {
      confidence: defaultProfile.confidence,
      altitude: defaultProfile.altitude,
      speed: defaultProfile.speed,
      autoClassify: defaultProfile.autoClassify,
      activeProfile: defaultProfile.name,
      pushNotif: true, emailDigest: true, telegram: false, sms: true, audio: true,
      sensorOffsets: {},
    };
    setCfg(reset);
    setDirty(false);
    applyCalibration(reset);
    saveCalibration(reset);
  }

  async function testChannel(channel: string) {
    setTesting(channel);
    await new Promise((r) => setTimeout(r, 1200));
    setTesting(null);
  }

  // ── Live preview calculations ──
  const applied = calibStore; // values currently active in system
  const preview = cfg;        // values pending apply

  const detAbove   = detections.filter((d) => d.confidence >= preview.confidence / 100).length;
  const detBelow   = detections.length - detAbove;
  const autoCount  = detections.filter((d) => d.confidence >= preview.autoClassify / 100).length;
  const pctPassing = detections.length ? Math.round((detAbove / detections.length) * 100) : 0;

  const appliedDiff =
    applied.confidence !== preview.confidence ||
    applied.altitude    !== preview.altitude   ||
    applied.speed       !== preview.speed      ||
    applied.autoClassify !== preview.autoClassify;

  return (
    <div>
      <PageHeader
        title={t("System Calibration")}
        subtitle={t("Detection tuning · notification routing · profile management")}
        actions={
          <div className="flex items-center gap-2">
            {dirty && (
              <span className="flex items-center gap-1 text-[10px] uppercase tracking-[0.15em] text-warning">
                <AlertCircle className="h-3 w-3" /> {t("Unsaved changes")}
              </span>
            )}
            {saved && (
              <span className="flex items-center gap-1 text-[10px] uppercase tracking-[0.15em] text-hud">
                <CheckCircle className="h-3 w-3" /> {t("Saved")}
              </span>
            )}
            <button
              onClick={handleRollback}
              className="flex items-center gap-2 border border-border px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:border-hud hover:text-hud"
            >
              <RotateCcw className="h-3 w-3" /> {t("Rollback")}
            </button>
            {appliedDiff && (
              <button
                onClick={handleApply}
                className="flex items-center gap-2 border border-warning/60 bg-warning/10 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-warning hover:bg-warning/20"
              >
                <Play className="h-3 w-3" /> {t("Apply")}
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 border border-hud bg-hud/10 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-hud hover:bg-hud/20 disabled:opacity-50"
            >
              <Save className="h-3 w-3" />
              {saving ? t("Saving...") : t("Save")}
            </button>
          </div>
        }
      />

      <div className="grid gap-3 px-4 py-4 sm:px-6 lg:grid-cols-2">
        {/* ── Detection Sensitivity ── */}
        <HudPanel title={t("Detection Sensitivity")} actions={<Gauge className="h-4 w-4 text-hud" />}>
          <CalSlider
            label={t("Min confidence threshold")}
            value={cfg.confidence}
            min={30} max={95} unit="%"
            warnBelow={50}
            onChange={(v) => patch({ confidence: v })}
          />
          <CalSlider
            label={t("Min target altitude")}
            value={cfg.altitude}
            min={5} max={200} unit=" m"
            onChange={(v) => patch({ altitude: v })}
          />
          <CalSlider
            label={t("Min target speed")}
            value={cfg.speed}
            min={5} max={100} unit=" km/h"
            onChange={(v) => patch({ speed: v })}
          />
          <CalSlider
            label={t("Auto-classify threshold")}
            value={cfg.autoClassify}
            min={50} max={99} unit="%"
            warnBelow={75}
            onChange={(v) => patch({ autoClassify: v })}
          />
        </HudPanel>

        {/* ── Notification Routing ── */}
        <HudPanel title={t("Notification Routing")} actions={<Bell className="h-4 w-4 text-hud" />}>
          <NotifToggle
            label={t("Push notifications")}
            sub={t("Browser push · real-time")}
            on={cfg.pushNotif}
            onChange={(v) => patch({ pushNotif: v })}
            testing={testing === "push"}
            onTest={() => testChannel("push")}
          />
          <NotifToggle
            label={t("Email digest (hourly)")}
            sub={t("Hourly threat digest by email")}
            on={cfg.emailDigest}
            onChange={(v) => patch({ emailDigest: v })}
            testing={testing === "email"}
            onTest={() => testChannel("email")}
          />
          <NotifToggle
            label="Telegram bot"
            sub={t("Instant alerts via Telegram")}
            on={cfg.telegram}
            onChange={(v) => patch({ telegram: v })}
            testing={testing === "telegram"}
            onTest={() => testChannel("telegram")}
          />
          <NotifToggle
            label={t("SMS for CRITICAL only")}
            sub={t("SMS alert for Critical level only")}
            on={cfg.sms}
            onChange={(v) => patch({ sms: v })}
            testing={testing === "sms"}
            onTest={() => testChannel("sms")}
          />
          <NotifToggle
            label={t("Audio klaxon (web)")}
            sub={t("Audio klaxon on threat detection")}
            on={cfg.audio}
            onChange={(v) => patch({ audio: v })}
            testing={testing === "audio"}
            onTest={() => testChannel("audio")}
          />
        </HudPanel>

        {/* ── Config Profiles ── */}
        <HudPanel title={t("Configuration Profiles")} bodyClassName="p-0">
          {PROFILES.map((p) => {
            const active = cfg.activeProfile === p.name;
            return (
              <div
                key={p.name}
                className={`flex items-center justify-between border-b border-border/40 px-4 py-3 transition-colors ${active ? "bg-hud/8" : "hover:bg-hud/3"}`}
              >
                <div className="min-w-0 flex-1">
                  <div className={`text-xs font-bold tracking-widest ${active ? "text-hud hud-text-glow" : "text-foreground"}`}>
                    {t(p.name)}
                  </div>
                  <div className="mt-0.5 text-[9px] uppercase tracking-[0.15em] text-muted-foreground">{t(p.sub)}</div>
                  <div className="mt-1 font-mono text-[9px] text-muted-foreground/70">
                    conf {p.confidence}% · alt {p.altitude}m · spd {p.speed}km/h · auto {p.autoClassify}%
                  </div>
                </div>
                <button
                  onClick={() => activateProfile(p)}
                  className={`ml-3 shrink-0 border px-3 py-1.5 text-[9px] font-bold uppercase tracking-[0.15em] transition-colors ${
                    active ? p.alertColor : "border-border/50 text-muted-foreground hover:border-hud hover:text-hud"
                  }`}
                >
                  {active ? t("Active") : t("Activate")}
                </button>
              </div>
            );
          })}
        </HudPanel>

        {/* ── Live Preview ── */}
        <HudPanel title={t("Detection Sensitivity")} subtitle="Live preview" actions={<Sliders className="h-4 w-4 text-hud" />}>
          {detections.length === 0 ? (
            <div className="py-4 text-center text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              {t("No detection data · run a simulation")}
            </div>
          ) : (
            <div className="space-y-4">
              {/* Confidence filter */}
              <div>
                <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-[0.15em]">
                  <span className="text-muted-foreground">{t("Confidence")} filter ≥ {preview.confidence}%</span>
                  <span className="font-mono font-bold text-hud">{detAbove} / {detections.length}</span>
                </div>
                <div className="h-2 w-full overflow-hidden bg-muted/40">
                  <div
                    className="h-full bg-hud transition-all duration-300"
                    style={{ width: `${pctPassing}%` }}
                  />
                </div>
                <div className="mt-1 flex justify-between text-[9px] text-muted-foreground">
                  <span className="text-hud">{detAbove} {t("passed filter")}</span>
                  <span className="text-threat">{detBelow} {t("filtered out")}</span>
                </div>
              </div>

              {/* Auto-classify */}
              <div>
                <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-[0.15em]">
                  <span className="text-muted-foreground">Auto-classify ≥ {preview.autoClassify}%</span>
                  <span className="font-mono font-bold text-warning">{autoCount}</span>
                </div>
                <div className="text-[9px] text-muted-foreground">
                  {autoCount} detections auto-classified
                </div>
              </div>

              {/* Applied vs pending diff */}
              {appliedDiff && (
                <div className="border border-warning/30 bg-warning/5 p-2 text-[9px] text-warning uppercase tracking-[0.12em]">
                  {t("Settings changed — click Apply to activate in system")}
                </div>
              )}

              {/* Currently applied values */}
              <div className="border-t border-border/40 pt-3">
                <div className="mb-1.5 text-[9px] uppercase tracking-[0.15em] text-muted-foreground">{t("Currently active in system")}</div>
                <div className="grid grid-cols-2 gap-1 font-mono text-[10px]">
                  <div className="text-muted-foreground">{t("Confidence")}</div>
                  <div className={`text-right ${applied.confidence !== preview.confidence ? "text-warning" : "text-hud"}`}>{applied.confidence}%</div>
                  <div className="text-muted-foreground">{t("Altitude")}</div>
                  <div className={`text-right ${applied.altitude !== preview.altitude ? "text-warning" : "text-hud"}`}>{applied.altitude} m</div>
                  <div className="text-muted-foreground">{t("Speed")}</div>
                  <div className={`text-right ${applied.speed !== preview.speed ? "text-warning" : "text-hud"}`}>{applied.speed} km/h</div>
                  <div className="text-muted-foreground">Auto</div>
                  <div className={`text-right ${applied.autoClassify !== preview.autoClassify ? "text-warning" : "text-hud"}`}>{applied.autoClassify}%</div>
                </div>
              </div>
            </div>
          )}
        </HudPanel>


        {/* ── Change History ── */}
        <div className="lg:col-span-2">
          <HudPanel
            title={t("Change History")}
            actions={<History className="h-4 w-4 text-hud" />}
          >
            {histLoading ? (
              <div className="text-xs text-muted-foreground">{t("Loading…")}</div>
            ) : history.length === 0 ? (
              <div className="text-xs text-muted-foreground">
                {t('No calibration history — click Save to log changes.')}
              </div>
            ) : (
              <div className="space-y-2 text-xs">
                {history.map((c) => {
                  const d = c.details as { confidence?: number; altitude?: number; speed?: number; autoClassify?: number } | null;
                  return (
                    <div key={c.id} className="border-l-2 border-hud/40 bg-hud/5 px-3 py-2">
                      <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground hud-stat">
                        {new Date(c.timestamp).toLocaleString("en-GB", { timeZone: "Asia/Almaty" })}
                        {c.operatorName ? ` · ${c.operatorName}` : ""}
                      </div>
                      <div className="mt-0.5">
                        {t("Calibration saved")}
                        {c.resourceId ? ` — profile: ${t(c.resourceId)}` : ""}
                      </div>
                      {d && (
                        <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                          {d.confidence !== undefined && `conf ${d.confidence}% · `}
                          {d.altitude   !== undefined && `alt ${d.altitude}m · `}
                          {d.speed      !== undefined && `spd ${d.speed}km/h`}
                          {d.autoClassify !== undefined && ` · auto ${d.autoClassify}%`}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </HudPanel>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────

function CalSlider({
  label, value, min, max, unit, warnBelow, onChange,
}: {
  label: string; value: number; min: number; max: number; unit: string;
  warnBelow?: number; onChange: (v: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  const isWarn = warnBelow !== undefined && value < warnBelow;
  return (
    <div className="mb-5 last:mb-0">
      <div className="flex justify-between text-[10px] uppercase tracking-[0.15em]">
        <span className="text-muted-foreground">{label}</span>
        <span className={`hud-stat font-mono font-bold ${isWarn ? "text-warning" : "text-hud"}`}>
          {value}{unit}
        </span>
      </div>
      <div className="relative mt-2">
        <div className="pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 bg-muted/40" />
        <div
          className={`pointer-events-none absolute top-1/2 h-1 -translate-y-1/2 transition-all duration-150 ${isWarn ? "bg-warning/70" : "bg-hud/70"}`}
          style={{ width: `${pct}%` }}
        />
        <input
          type="range" min={min} max={max} value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="relative w-full cursor-pointer opacity-0"
          style={{ height: "18px" }}
        />
        {/* Custom thumb */}
        <div
          className={`pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 border-2 transition-all ${isWarn ? "border-warning bg-background" : "border-hud bg-background"}`}
          style={{ left: `${pct}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[8px] text-muted-foreground/50">
        <span>{min}{unit}</span>
        <span>{max}{unit}</span>
      </div>
    </div>
  );
}

function NotifToggle({
  label, sub, on, onChange, testing, onTest,
}: {
  label: string; sub: string; on: boolean; onChange: (v: boolean) => void;
  testing: boolean; onTest: () => void;
}) {
  const { t } = useT();
  return (
    <div className="flex items-center justify-between border-b border-border/40 py-2.5 last:border-0">
      <div className="min-w-0 flex-1 pr-3">
        <div className="text-xs font-bold uppercase tracking-wider">{label}</div>
        <div className="mt-0.5 text-[9px] text-muted-foreground">{sub}</div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {on && (
          <button
            onClick={onTest}
            disabled={testing}
            className={`border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.1em] transition-colors ${
              testing
                ? "border-hud/60 text-hud animate-pulse"
                : "border-border/50 text-muted-foreground hover:border-hud hover:text-hud"
            }`}
          >
            {testing ? "…" : t("Test")}
          </button>
        )}
        <button
          onClick={() => onChange(!on)}
          className={`relative h-5 w-10 shrink-0 border transition-colors ${on ? "border-hud bg-hud/20" : "border-border bg-muted"}`}
        >
          <div className={`absolute top-0.5 h-3.5 w-3.5 transition-all ${on ? "left-5 bg-hud" : "left-0.5 bg-muted-foreground"}`} />
        </button>
        {on
          ? <Bell className="h-3.5 w-3.5 shrink-0 text-hud" />
          : <BellOff className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
        }
      </div>
    </div>
  );
}
