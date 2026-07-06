import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import { useStore, patchSensor, createSensor, deleteSensor } from "@/lib/store";
import { useT } from "@/lib/i18n";
import { HudPanel, PageHeader, StatusDot } from "@/components/HudPanel";
import {
  Power,
  Settings2,
  PlayCircle,
  X,
  MapPin,
  Radio,
  Cpu,
  Wifi,
  Save,
  Loader2,
  CheckCircle2,
  Plus,
  Edit2,
  Trash2,
  Sliders,
} from "lucide-react";
import { RelativeTime } from "@/components/RelativeTime";
import type { Sensor, SensorConfig } from "@/lib/mockData";
import { geoZonesApi, sensorsApi, type ApiGeoZone } from "@/lib/api";
import L from "leaflet";

export const Route = createFileRoute("/sensors")({
  component: SensorNetwork,
  head: () => ({ meta: [{ title: "Sensor Network // DDS" }] }),
});

// ─── Defaults ─────────────────────────────────────────────────
const DEFAULT_CONFIG: Record<
  string,
  Required<
    Pick<
      SensorConfig,
      "scanMode" | "detectionThreshold" | "alertSensitivity" | "updateRateS" | "powerMode"
    >
  > &
    SensorConfig
> = {
  RADAR: {
    scanMode: "active",
    detectionThreshold: 65,
    alertSensitivity: "high",
    updateRateS: 2,
    powerMode: "normal",
    prf: 1200,
    minRcsM2: 0.01,
  },
  RF: {
    scanMode: "passive",
    detectionThreshold: 55,
    alertSensitivity: "high",
    updateRateS: 1,
    powerMode: "normal",
    freqBandMhz: "2400",
    jammingDetection: true,
    agcEnabled: true,
  },
  OPTIC: {
    scanMode: "hybrid",
    detectionThreshold: 70,
    alertSensitivity: "normal",
    updateRateS: 1,
    powerMode: "performance",
    thermalMode: false,
    nvgMode: false,
    zoomLevel: 4,
  },
  ACOUSTIC: {
    scanMode: "passive",
    detectionThreshold: 60,
    alertSensitivity: "normal",
    updateRateS: 5,
    powerMode: "eco",
    gainDb: 30,
    noiseGateDb: -60,
    directional: false,
  },
};

function resolveConfig(sensor: Sensor): SensorConfig {
  return { ...DEFAULT_CONFIG[sensor.type], ...sensor.config };
}

const SENSOR_IP: Record<string, string> = {
  "ALPHA-01": "192.168.10.11",
  "BRAVO-02": "192.168.10.12",
  "CHARLIE-03": "192.168.10.13",
  "DELTA-04": "192.168.10.14",
  "ECHO-05": "192.168.10.15",
  "FOXTROT-06": "192.168.10.16",
};
const SENSOR_FW: Record<string, string> = {
  RADAR: "v3.4.1-stable",
  RF: "v2.9.0-lts",
  OPTIC: "v1.7.3-stable",
  ACOUSTIC: "v2.1.0-beta",
};

const CENTER = { lat: 51.13, lng: 71.44 };

const STATUS_COLOR: Record<string, string> = {
  online: "#4ade80",
  degraded: "#fbbf24",
  offline: "#ef4444",
  maintenance: "#7dd3fc",
};

const SNS_THREAT_COLOR: Record<string, string> = {
  low: "#7dd3fc",
  medium: "#fbbf24",
  high: "#f97316",
  critical: "#ef4444",
};

const TYPE_ABBREV: Record<string, string> = {
  RF: "RF",
  RADAR: "RA",
  OPTIC: "OP",
  ACOUSTIC: "AC",
};

function snsSensorIcon(type: string, status: string) {
  const color = STATUS_COLOR[status] ?? "#4ade80";
  const abbr = TYPE_ABBREV[type] ?? "??";
  const pulse =
    status === "online"
      ? `<div style="position:absolute;inset:-6px;border:1px solid ${color};opacity:0.3;border-radius:2px;animation:ping-ring 2.5s ease-out infinite"></div>`
      : "";
  return L.divIcon({
    className: "",
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    html: `<div style="position:relative;width:34px;height:34px">
      <div style="width:34px;height:34px;border:2px solid ${color};background:rgba(8,16,12,0.88);
        display:flex;align-items:center;justify-content:center;color:${color};
        font-size:9px;font-weight:bold;font-family:monospace;letter-spacing:0.05em">
        ${abbr}
      </div>${pulse}</div>`,
  });
}

// ─── Main Component ───────────────────────────────────────────
function SensorNetwork() {
  const { t } = useT();
  const sensors = useStore((s) => s.sensors);

  const [configSensor, setConfigSensor] = useState<Sensor | null>(null);
  const [editSensor, setEditSensor] = useState<Sensor | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Sensor | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createLatLng, setCreateLatLng] = useState<{ lat: number; lng: number } | null>(null);
  const [addMode, setAddMode] = useState(false);
  const [pending, setPending] = useState<Record<string, "start" | "disable">>({});
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Per-sensor calibration offsets (sensorId → offset -20..+20)
  const [calibOffsets, setCalibOffsets] = useState<Record<string, number>>({});
  const [calibExpanded, setCalibExpanded] = useState<Record<string, boolean>>({});
  const [calibSaving, setCalibSaving] = useState<Record<string, boolean>>({});
  const [calibSaved, setCalibSaved] = useState<Record<string, boolean>>({});
  const mapInstanceRef = useRef<L.Map | null>(null);

  function handleMapClick(lat: number, lng: number) {
    setAddMode(false);
    setCreateLatLng({ lat, lng });
    setShowCreate(true);
  }

  async function handleStart(s: Sensor) {
    if (s.status === "online") return;
    setPending((p) => ({ ...p, [s.id]: "start" }));
    await patchSensor(s.id, { status: "online" });
    setPending((p) => {
      const n = { ...p };
      delete n[s.id];
      return n;
    });
  }

  async function handleDisable(s: Sensor) {
    if (s.status === "offline") return;
    setPending((p) => ({ ...p, [s.id]: "disable" }));
    await patchSensor(s.id, { status: "offline" });
    setPending((p) => {
      const n = { ...p };
      delete n[s.id];
      return n;
    });
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    try {
      await deleteSensor(deleteTarget.id);
      setDeleteTarget(null);
      setDeleteError(null);
    } catch {
      setDeleteError("Failed to delete station. Try again.");
    }
  }

  async function handleSaveCalib(s: Sensor) {
    const offset = calibOffsets[s.id] ?? 0;
    setCalibSaving((p) => ({ ...p, [s.id]: true }));
    try {
      const newThreshold = Math.max(0, Math.min(100, 50 + offset));
      await sensorsApi.patch(s.id, { config: { detectionThreshold: newThreshold } });
      setCalibSaved((p) => ({ ...p, [s.id]: true }));
      setTimeout(() => setCalibSaved((p) => ({ ...p, [s.id]: false })), 2500);
    } catch { /* ignore */ }
    setCalibSaving((p) => ({ ...p, [s.id]: false }));
  }

  const online = sensors.filter((s) => s.status === "online").length;
  const offline = sensors.filter((s) => s.status === "offline").length;
  const degrad = sensors.filter(
    (s) => s.status === "degraded" || s.status === "maintenance",
  ).length;

  return (
    <div>
      <PageHeader
        title={t("Sensor Network")}
        subtitle={t("Distributed detection grid · health & telemetry")}
        actions={
          <div className="flex items-center gap-3">
            <div className="flex gap-4 text-[10px] uppercase tracking-[0.2em]">
              <span className="text-hud">
                ● {online} {t("online")}
              </span>
              {degrad > 0 && (
                <span className="text-warning">
                  ◐ {degrad} {t("degraded")}
                </span>
              )}
              {offline > 0 && (
                <span className="text-threat">
                  ○ {offline} {t("offline")}
                </span>
              )}
            </div>
            <button
              onClick={() => setAddMode((v) => !v)}
              className={`flex items-center gap-1.5 border px-3 py-2 text-[10px] font-bold uppercase tracking-[0.2em] transition-colors ${
                addMode
                  ? "border-hud bg-hud/15 text-hud"
                  : "border-border text-muted-foreground hover:border-hud hover:text-hud"
              }`}
            >
              <MapPin className="h-3 w-3" />
              {addMode ? t("Cancel") : t("Place on Map")}
            </button>
            <button
              onClick={() => {
                setCreateLatLng(null);
                setShowCreate(true);
              }}
              className="flex items-center gap-2 border border-hud bg-hud/10 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.25em] text-hud hover:bg-hud/20"
            >
              <Plus className="h-3.5 w-3.5" /> {t("New Station")}
            </button>
          </div>
        }
      />

      {/* Stats row */}
      {sensors.length > 0 && (
        <div className="grid grid-cols-2 gap-1.5 px-4 pt-4 sm:grid-cols-4 sm:px-6">
          <StatCard label={t("Total")} value={sensors.length} tone="hud" />
          <StatCard label={t("Online")} value={online} tone="hud" />
          <StatCard label={t("Degraded")} value={degrad} tone={degrad > 0 ? "warning" : "hud"} />
          <StatCard label={t("Offline")} value={offline} tone={offline > 0 ? "threat" : "hud"} />
        </div>
      )}

      {/* Placement banner */}
      {addMode && (
        <div className="mx-4 mt-3 flex items-center gap-2 border border-hud/40 bg-hud/5 px-4 py-2 text-[11px] text-hud sm:mx-6">
          <MapPin className="h-3.5 w-3.5 shrink-0" />
          {t("Click anywhere on the map to place a new station — or press Cancel to exit")}
        </div>
      )}

      {/* Sensor placement map */}
      <div className="relative z-0 mx-4 mt-3 h-[240px] border border-border sm:mx-6 sm:h-[360px] lg:h-[480px]">
        <SensorNetworkMap
          addMode={addMode}
          onMapClick={handleMapClick}
          onMapReady={(m) => {
            mapInstanceRef.current = m;
          }}
        />
        {/* Legend */}
        <div className="absolute bottom-3 left-3 z-[1100] space-y-1 border border-border/60 bg-background/90 px-3 py-2 backdrop-blur-sm pointer-events-none">
          <div className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground mb-1.5">
            {t("Sensor Status")}
          </div>
          {(["online", "degraded", "offline", "maintenance"] as const).map((st) => (
            <div
              key={st}
              className="flex items-center gap-2 text-[9px] uppercase tracking-[0.15em] text-muted-foreground"
            >
              <span
                className="h-2 w-2 shrink-0 rounded-sm"
                style={{ background: STATUS_COLOR[st] }}
              />
              {t(st)}
            </div>
          ))}
          <div className="border-t border-border/40 mt-1.5 pt-1.5 text-[9px] uppercase tracking-[0.15em] text-muted-foreground">
            <span className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-sky-300 shrink-0" /> {t("Drone")}
            </span>
          </div>
        </div>
        {/* Type legend */}
        <div className="absolute bottom-3 right-3 z-[1100] space-y-1 border border-border/60 bg-background/90 px-3 py-2 backdrop-blur-sm pointer-events-none">
          <div className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground mb-1.5">
            {t("Sensor Type")}
          </div>
          {(["RF", "RA", "OP", "AC"] as const).map((abbr, i) => (
            <div
              key={abbr}
              className="flex items-center gap-2 text-[9px] font-mono text-muted-foreground"
            >
              <span className="w-5 text-center border border-hud/30 text-hud text-[8px]">
                {abbr}
              </span>
              {["RF", "RADAR", "OPTIC", "ACOUSTIC"][i]}
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-3 px-4 py-4 sm:px-6 md:grid-cols-2 lg:grid-cols-3">
        {sensors.length === 0 && (
          <div className="col-span-full border border-border/40 p-10 text-center">
            <Radio className="mx-auto h-8 w-8 text-muted-foreground/30 mb-3" />
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              {t("No stations registered")}
            </p>
            <button
              onClick={() => setShowCreate(true)}
              className="mt-3 flex items-center gap-1.5 mx-auto text-[10px] text-hud hover:underline uppercase tracking-[0.15em]"
            >
              <Plus className="h-3 w-3" /> {t("Register first station")}
            </button>
          </div>
        )}

        {sensors.map((s) => {
          const busy = pending[s.id];
          return (
            <HudPanel key={s.id} bodyClassName="p-4">
              {/* Header */}
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
                    {s.id} · {s.type}
                  </div>
                  <div className="truncate text-base font-bold tracking-widest text-hud hud-text-glow">
                    {s.name}
                  </div>
                </div>
                <div className="flex items-center gap-2 border border-border px-2 py-1 text-[10px] uppercase tracking-[0.2em] shrink-0">
                  <StatusDot status={s.status} />
                  {s.status}
                </div>
              </div>

              {/* Bars */}
              <div className="mt-4 space-y-3">
                <Bar
                  label={t("Health Score")}
                  value={s.health}
                  tone={s.health > 80 ? "hud" : s.health > 60 ? "warning" : "threat"}
                />
                <Bar label={t("Signal Strength")} value={s.signal} tone="hud" />
                <Bar
                  label={t("Coverage Range")}
                  value={(s.range / 25) * 100}
                  display={`${s.range} km`}
                  tone="info"
                />
              </div>

              {/* Last ping */}
              <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                <span>
                  {t("Last ping")} <RelativeTime date={s.lastPing} />
                </span>
              </div>

              {/* Action row 1: operational */}
              <div className="mt-3 grid grid-cols-3 gap-2">
                <ActionBtn
                  icon={
                    <PlayCircle className={`h-3 w-3 ${busy === "start" ? "animate-pulse" : ""}`} />
                  }
                  label={t("Start")}
                  disabled={!!busy || s.status === "online"}
                  onClick={() => handleStart(s)}
                />
                <ActionBtn
                  icon={<Settings2 className="h-3 w-3" />}
                  label={t("Config")}
                  onClick={() => setConfigSensor(s)}
                />
                <ActionBtn
                  icon={
                    <Power className={`h-3 w-3 ${busy === "disable" ? "animate-pulse" : ""}`} />
                  }
                  label={s.status === "offline" ? t("Offline") : t("Disable")}
                  tone="threat"
                  disabled={!!busy || s.status === "offline"}
                  onClick={() => handleDisable(s)}
                />
              </div>

              {/* Action row 2: CRUD */}
              <div className="mt-1.5 flex divide-x divide-border/40 border border-border/40">
                <button
                  onClick={() => setEditSensor(s)}
                  className="flex flex-1 items-center justify-center gap-1 py-1.5 text-[9px] uppercase tracking-[0.15em] text-muted-foreground transition-colors hover:bg-hud/10 hover:text-hud"
                >
                  <Edit2 className="h-3 w-3" /> {t("Edit")}
                </button>
                <button
                  onClick={() => setCalibExpanded((p) => ({ ...p, [s.id]: !p[s.id] }))}
                  className={`flex flex-1 items-center justify-center gap-1 py-1.5 text-[9px] uppercase tracking-[0.15em] transition-colors ${
                    calibExpanded[s.id] ? "bg-hud/10 text-hud" : "text-muted-foreground hover:bg-hud/5 hover:text-hud"
                  }`}
                >
                  <Sliders className="h-3 w-3" /> Калибровка
                </button>
                <button
                  onClick={() => {
                    setDeleteTarget(s);
                    setDeleteError(null);
                  }}
                  className="flex flex-1 items-center justify-center gap-1 py-1.5 text-[9px] uppercase tracking-[0.15em] text-muted-foreground transition-colors hover:bg-threat/10 hover:text-threat"
                >
                  <Trash2 className="h-3 w-3" /> {t("Delete")}
                </button>
              </div>

              {/* Per-sensor calibration panel */}
              {calibExpanded[s.id] && (() => {
                const offset = calibOffsets[s.id] ?? 0;
                const adjSignal = Math.max(0, Math.min(100, s.signal + offset));
                return (
                  <div className="mt-2 border border-hud/20 bg-hud/[0.03] px-3 py-2.5">
                    <div className="mb-2 text-[9px] uppercase tracking-[0.2em] text-hud flex items-center gap-1.5">
                      <Sliders className="h-2.5 w-2.5" /> Калибровка · {s.name}
                    </div>
                    <div className="mb-1 flex items-center justify-between text-[9px]">
                      <span className="text-muted-foreground">Offset чувствительности</span>
                      <span className={`font-mono font-bold ${offset > 0 ? "text-hud" : offset < 0 ? "text-threat" : "text-muted-foreground"}`}>
                        {offset > 0 ? "+" : ""}{offset}%
                      </span>
                    </div>
                    <input
                      type="range" min={-20} max={20} step={1} value={offset}
                      onChange={(e) => setCalibOffsets((p) => ({ ...p, [s.id]: Number(e.target.value) }))}
                      className="w-full accent-[var(--hud)]"
                    />
                    <div className="mt-0.5 flex justify-between text-[8px] text-muted-foreground/50 mb-2">
                      <span>−20%</span><span>0</span><span>+20%</span>
                    </div>
                    {/* Adjusted signal bar */}
                    <div className="mb-2">
                      <div className="flex justify-between text-[9px] mb-0.5">
                        <span className="text-muted-foreground">Скорректированный сигнал</span>
                        <span className={adjSignal >= 60 ? "text-hud" : "text-threat"}>{adjSignal}%</span>
                      </div>
                      <div className="h-1 w-full bg-muted/30">
                        <div className={`h-full transition-all ${adjSignal >= 60 ? "bg-hud" : adjSignal >= 30 ? "bg-warning" : "bg-threat"}`}
                          style={{ width: `${adjSignal}%` }} />
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {offset !== 0 && (
                        <button
                          onClick={() => setCalibOffsets((p) => { const n = {...p}; delete n[s.id]; return n; })}
                          className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground hover:text-threat"
                        >Сброс</button>
                      )}
                      <button
                        disabled={calibSaving[s.id]}
                        onClick={() => handleSaveCalib(s)}
                        className="ml-auto flex items-center gap-1 border border-hud bg-hud/10 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.15em] text-hud hover:bg-hud/20 disabled:opacity-40"
                      >
                        {calibSaving[s.id] ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : calibSaved[s.id] ? <CheckCircle2 className="h-2.5 w-2.5" /> : <Save className="h-2.5 w-2.5" />}
                        {calibSaving[s.id] ? "Сохр…" : calibSaved[s.id] ? "Сохранено" : "Применить"}
                      </button>
                    </div>
                  </div>
                );
              })()}
            </HudPanel>
          );
        })}
      </div>

      {/* Modals */}
      {showCreate && (
        <StationModal
          mode="create"
          initialLat={createLatLng?.lat}
          initialLng={createLatLng?.lng}
          onClose={() => {
            setShowCreate(false);
            setCreateLatLng(null);
          }}
        />
      )}
      {editSensor && (
        <StationModal mode="edit" sensor={editSensor} onClose={() => setEditSensor(null)} />
      )}
      {configSensor && (
        <ConfigModal
          sensor={configSensor}
          onClose={() => setConfigSensor(null)}
          onSaved={(updated) => setConfigSensor(updated)}
        />
      )}
      {deleteTarget && (
        <DeleteModal
          sensor={deleteTarget}
          error={deleteError}
          onConfirm={handleConfirmDelete}
          onClose={() => {
            setDeleteTarget(null);
            setDeleteError(null);
          }}
        />
      )}
    </div>
  );
}

// ─── Create / Edit Station Modal ──────────────────────────────
function StationModal({
  mode,
  sensor,
  initialLat,
  initialLng,
  onClose,
}: {
  mode: "create" | "edit";
  sensor?: Sensor;
  initialLat?: number;
  initialLng?: number;
  onClose: () => void;
}) {
  const { t } = useT();
  const [name, setName] = useState(sensor?.name ?? "");
  const [type, setType] = useState<"RF" | "RADAR" | "OPTIC" | "ACOUSTIC">(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sensor?.type as any) ?? "RADAR",
  );
  const [lat, setLat] = useState(sensor ? String(sensor.lat) : String(initialLat ?? CENTER.lat));
  const [lng, setLng] = useState(sensor ? String(sensor.lng) : String(initialLng ?? CENTER.lng));
  const [rangeV, setRange] = useState(sensor ? String(sensor.range) : "10");
  const [status, setStatus] = useState<"online" | "degraded" | "offline" | "maintenance">(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sensor?.status as any) ?? "online",
  );

  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveErr, setSaveErr] = useState<string | null>(null);

  function validate() {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = "Required";
    const latN = parseFloat(lat);
    const lngN = parseFloat(lng);
    const rngN = parseFloat(rangeV);
    if (isNaN(latN) || latN < -90 || latN > 90) e.lat = "Range: −90 to 90";
    if (isNaN(lngN) || lngN < -180 || lngN > 180) e.lng = "Range: −180 to 180";
    if (isNaN(rngN) || rngN < 1 || rngN > 100) e.range = "Range: 1 to 100 km";
    return e;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) {
      setErrors(errs);
      return;
    }
    setSaving(true);
    setSaveErr(null);
    try {
      const payload = {
        name: name.trim(),
        type,
        lat: parseFloat(lat),
        lng: parseFloat(lng),
        range: Math.round(parseFloat(rangeV)),
        status,
      };
      if (mode === "create") {
        await createSensor(payload);
      } else if (sensor) {
        await patchSensor(sensor.id, payload);
      }
      onClose();
    } catch (err) {
      setSaveErr(err instanceof Error ? err.message : "Server error");
    }
    setSaving(false);
  }

  const rangeNum = Math.min(Math.max(parseFloat(rangeV) || 1, 1), 100);

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-md border border-hud/40 bg-background shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="font-bold tracking-widest text-hud uppercase text-xs">
            {mode === "create" ? t("Register New Station") : `${t("Edit")} · ${sensor?.id}`}
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          {/* Name */}
          <MField label={t("Station Name *")} error={errors.name}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ALPHA-07"
              className={`w-full border bg-transparent px-3 py-2 text-xs uppercase tracking-wider focus:outline-none focus:border-hud ${
                errors.name ? "border-threat" : "border-border"
              }`}
            />
          </MField>

          {/* Type */}
          <MField label={t("Sensor Type")}>
            <div className="flex gap-2">
              {(["RADAR", "RF", "OPTIC", "ACOUSTIC"] as const).map((stype) => (
                <button
                  key={stype}
                  type="button"
                  onClick={() => setType(stype)}
                  className={`flex-1 border py-1.5 text-[9px] uppercase tracking-[0.15em] transition-colors ${
                    type === stype
                      ? "border-hud bg-hud/20 text-hud"
                      : "border-border text-muted-foreground hover:border-hud"
                  }`}
                >
                  {stype}
                </button>
              ))}
            </div>
          </MField>

          {/* Coordinates */}
          <div className="grid grid-cols-2 gap-3">
            <MField label={t("Latitude *")} error={errors.lat}>
              <input
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                placeholder="51.1300"
                className={`w-full border bg-transparent px-3 py-2 font-mono text-xs focus:outline-none focus:border-hud ${
                  errors.lat ? "border-threat" : "border-border"
                }`}
              />
            </MField>
            <MField label={t("Longitude *")} error={errors.lng}>
              <input
                value={lng}
                onChange={(e) => setLng(e.target.value)}
                placeholder="71.4400"
                className={`w-full border bg-transparent px-3 py-2 font-mono text-xs focus:outline-none focus:border-hud ${
                  errors.lng ? "border-threat" : "border-border"
                }`}
              />
            </MField>
          </div>

          {/* Range */}
          <MField label={`${t("Coverage Range")} · ${rangeNum} km`} error={errors.range}>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="1"
                max="100"
                step="1"
                value={rangeNum}
                onChange={(e) => setRange(e.target.value)}
                className="flex-1 accent-[var(--hud)]"
              />
              <input
                value={rangeV}
                onChange={(e) => setRange(e.target.value)}
                className="w-14 border border-border bg-transparent px-2 py-1.5 text-center font-mono text-xs focus:border-hud focus:outline-none"
              />
              <span className="shrink-0 text-[10px] text-muted-foreground">km</span>
            </div>
          </MField>

          {/* Status */}
          <MField label={t("Initial Status")}>
            <div className="flex gap-1.5">
              {(["online", "degraded", "offline", "maintenance"] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatus(st)}
                  className={`flex-1 border py-1.5 text-[9px] uppercase tracking-[0.1em] transition-colors ${
                    status === st
                      ? st === "online"
                        ? "border-hud bg-hud/20 text-hud"
                        : st === "offline"
                          ? "border-threat bg-threat/20 text-threat"
                          : st === "degraded"
                            ? "border-warning bg-warning/20 text-warning"
                            : "border-info bg-info/20 text-info"
                      : "border-border text-muted-foreground hover:border-hud"
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>
          </MField>

          {saveErr && <p className="text-[10px] text-threat">{saveErr}</p>}

          <div className="flex gap-2 border-t border-border pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border border-border py-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:border-hud hover:text-hud"
            >
              {t("Cancel")}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 border border-hud bg-hud/10 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-hud hover:bg-hud/20 disabled:opacity-50"
            >
              {saving ? (
                <span className="flex items-center justify-center gap-1.5">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {t("Saving…")}
                </span>
              ) : mode === "create" ? (
                t("Register Station")
              ) : (
                t("Save Changes")
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Delete Confirmation Modal ────────────────────────────────
function DeleteModal({
  sensor,
  error,
  onConfirm,
  onClose,
}: {
  sensor: Sensor;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useT();
  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="w-full max-w-sm border border-threat/40 bg-background shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="flex items-center gap-2 font-bold tracking-widest text-threat uppercase text-xs">
            <Trash2 className="h-4 w-4" />
            {t("Delete Station")}
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-muted-foreground">
            Remove <span className="font-bold text-foreground">{sensor.name}</span> ({sensor.id},{" "}
            {sensor.type})? This action cannot be undone and will stop all active monitoring from
            this station.
          </p>
          {error && <p className="text-[10px] text-threat">{error}</p>}
          <div className="flex gap-2 border-t border-border pt-4">
            <button
              onClick={onClose}
              className="flex-1 border border-border py-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:border-hud hover:text-hud"
            >
              {t("Cancel")}
            </button>
            <button
              onClick={onConfirm}
              className="flex-1 border border-threat bg-threat/10 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-threat hover:bg-threat/20"
            >
              {t("Delete Station")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Config Modal (operational parameters) ────────────────────
function ConfigModal({
  sensor,
  onClose,
  onSaved,
}: {
  sensor: Sensor;
  onClose: () => void;
  onSaved: (s: Sensor) => void;
}) {
  const { t } = useT();
  const ip =
    SENSOR_IP[sensor.name] ??
    `192.168.10.${sensor.id.replace(/\D/g, "").slice(-2).padStart(2, "0")}`;
  const fw = SENSOR_FW[sensor.type] ?? "v1.0.0";
  const calDue = new Date(new Date(sensor.lastPing).getTime() + 30 * 86_400_000);
  const isOverdue = calDue < new Date();

  const [cfg, setCfg] = useState<SensorConfig>(() => resolveConfig(sensor));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function set<K extends keyof SensorConfig>(key: K, value: SensorConfig[K]) {
    setCfg((c) => ({ ...c, [key]: value }));
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    try {
      await patchSensor(sensor.id, { config: cfg });
      onSaved({ ...sensor, config: cfg });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg border border-hud/40 bg-background shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3 shrink-0">
          <div>
            <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
              {sensor.id} · {sensor.type}
            </div>
            <div className="font-bold tracking-widest text-hud">{sensor.name}</div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 divide-y divide-border/50">
          {/* Live Telemetry */}
          <section className="px-5 py-4">
            <SectionTitle icon={<Radio className="h-3 w-3" />} label={t("Live Telemetry")} />
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <TelemetryBadge
                label={t("Status")}
                value={sensor.status.toUpperCase()}
                tone={
                  sensor.status === "online"
                    ? "hud"
                    : sensor.status === "offline"
                      ? "threat"
                      : "warning"
                }
              />
              <TelemetryBadge
                label={t("Health")}
                value={`${sensor.health}%`}
                tone={sensor.health > 80 ? "hud" : sensor.health > 60 ? "warning" : "threat"}
              />
              <TelemetryBadge label={t("Signal")} value={`${sensor.signal}%`} tone="hud" />
              <TelemetryBadge label={t("Range")} value={`${sensor.range} km`} tone="info" />
            </div>
          </section>

          {/* Detection Parameters */}
          <section className="px-5 py-4 space-y-3">
            <SectionTitle icon={<Cpu className="h-3 w-3" />} label={t("Detection Parameters")} />
            <CfgRow label={t("Scan Mode")}>
              <CfgSelect
                value={cfg.scanMode ?? "active"}
                onChange={(v) => set("scanMode", v as SensorConfig["scanMode"])}
                options={[
                  { value: "passive", label: t("Passive") },
                  { value: "active", label: t("Active") },
                  { value: "hybrid", label: t("Hybrid") },
                ]}
              />
            </CfgRow>
            <CfgRow label={`${t("Detection Threshold")} · ${cfg.detectionThreshold ?? 65}%`}>
              <input
                type="range"
                min={5}
                max={95}
                step={5}
                value={cfg.detectionThreshold ?? 65}
                onChange={(e) => set("detectionThreshold", Number(e.target.value))}
                className="h-1 w-full cursor-pointer appearance-none rounded-none bg-muted accent-hud"
              />
            </CfgRow>
            <CfgRow label={t("Alert Sensitivity")}>
              <CfgSelect
                value={cfg.alertSensitivity ?? "normal"}
                onChange={(v) => set("alertSensitivity", v as SensorConfig["alertSensitivity"])}
                options={[
                  { value: "low", label: t("Low") },
                  { value: "normal", label: t("Normal") },
                  { value: "high", label: t("High") },
                  { value: "critical", label: t("Critical") },
                ]}
              />
            </CfgRow>
            <CfgRow label={t("Update Rate")}>
              <CfgSelect
                value={String(cfg.updateRateS ?? 2)}
                onChange={(v) => set("updateRateS", Number(v))}
                options={[
                  { value: "1", label: "1 s" },
                  { value: "2", label: "2 s" },
                  { value: "5", label: "5 s" },
                  { value: "10", label: "10 s" },
                ]}
              />
            </CfgRow>
          </section>

          {/* System */}
          <section className="px-5 py-4 space-y-3">
            <SectionTitle icon={<Settings2 className="h-3 w-3" />} label={t("System")} />
            <CfgRow label={t("Power Mode")}>
              <CfgSelect
                value={cfg.powerMode ?? "normal"}
                onChange={(v) => set("powerMode", v as SensorConfig["powerMode"])}
                options={[
                  { value: "eco", label: t("Eco") },
                  { value: "normal", label: t("Normal") },
                  { value: "performance", label: t("Performance") },
                ]}
              />
            </CfgRow>
            {sensor.type === "RADAR" && (
              <>
                <CfgRow label="PRF (Hz)">
                  <NumInput
                    value={cfg.prf ?? 1200}
                    min={100}
                    max={10000}
                    step={100}
                    onChange={(v) => set("prf", v)}
                  />
                </CfgRow>
                <CfgRow label="Min. RCS (m²)">
                  <NumInput
                    value={cfg.minRcsM2 ?? 0.01}
                    min={0.001}
                    max={10}
                    step={0.001}
                    onChange={(v) => set("minRcsM2", v)}
                  />
                </CfgRow>
              </>
            )}
            {sensor.type === "RF" && (
              <>
                <CfgRow label="Frequency Band">
                  <CfgSelect
                    value={cfg.freqBandMhz ?? "2400"}
                    onChange={(v) => set("freqBandMhz", v)}
                    options={[
                      { value: "433", label: "433 MHz" },
                      { value: "868", label: "868 MHz" },
                      { value: "915", label: "915 MHz" },
                      { value: "1200", label: "1.2 GHz" },
                      { value: "2400", label: "2.4 GHz" },
                      { value: "5800", label: "5.8 GHz" },
                    ]}
                  />
                </CfgRow>
                <CfgRow label="Jamming Detection">
                  <Toggle
                    value={cfg.jammingDetection ?? true}
                    onChange={(v) => set("jammingDetection", v)}
                  />
                </CfgRow>
                <CfgRow label="Auto Gain Control (AGC)">
                  <Toggle value={cfg.agcEnabled ?? true} onChange={(v) => set("agcEnabled", v)} />
                </CfgRow>
              </>
            )}
            {sensor.type === "OPTIC" && (
              <>
                <CfgRow label="Zoom Level">
                  <CfgSelect
                    value={String(cfg.zoomLevel ?? 4)}
                    onChange={(v) => set("zoomLevel", Number(v))}
                    options={[1, 2, 4, 6, 8, 10, 16, 20].map((n) => ({
                      value: String(n),
                      label: `${n}×`,
                    }))}
                  />
                </CfgRow>
                <CfgRow label="Thermal Imaging">
                  <Toggle
                    value={cfg.thermalMode ?? false}
                    onChange={(v) => set("thermalMode", v)}
                  />
                </CfgRow>
                <CfgRow label="Night Vision (NVG)">
                  <Toggle value={cfg.nvgMode ?? false} onChange={(v) => set("nvgMode", v)} />
                </CfgRow>
              </>
            )}
            {sensor.type === "ACOUSTIC" && (
              <>
                <CfgRow label={`Gain · ${cfg.gainDb ?? 30} dB`}>
                  <input
                    type="range"
                    min={0}
                    max={60}
                    step={1}
                    value={cfg.gainDb ?? 30}
                    onChange={(e) => set("gainDb", Number(e.target.value))}
                    className="h-1 w-full cursor-pointer appearance-none rounded-none bg-muted accent-hud"
                  />
                </CfgRow>
                <CfgRow label={`Noise Gate · ${cfg.noiseGateDb ?? -60} dB`}>
                  <input
                    type="range"
                    min={-80}
                    max={-10}
                    step={5}
                    value={cfg.noiseGateDb ?? -60}
                    onChange={(e) => set("noiseGateDb", Number(e.target.value))}
                    className="h-1 w-full cursor-pointer appearance-none rounded-none bg-muted accent-hud"
                  />
                </CfgRow>
                <CfgRow label="Directional Mode">
                  <Toggle
                    value={cfg.directional ?? false}
                    onChange={(v) => set("directional", v)}
                  />
                </CfgRow>
              </>
            )}
          </section>

          {/* Network & Firmware */}
          <section className="px-5 py-4">
            <SectionTitle icon={<Wifi className="h-3 w-3" />} label={t("Network & Firmware")} />
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
              <InfoRow label={t("IP Address")} value={ip} />
              <InfoRow label={t("Firmware")} value={fw} />
              <InfoRow label={t("Protocol")} value="MQTT / TLS 1.3" />
              <InfoRow label={t("Port")} value="8883" />
            </div>
          </section>

          {/* Position & Calibration */}
          <section className="px-5 py-4">
            <SectionTitle
              icon={<MapPin className="h-3 w-3" />}
              label={t("Position & Calibration")}
            />
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
              <InfoRow label={t("Latitude")} value={sensor.lat.toFixed(5)} />
              <InfoRow label={t("Longitude")} value={sensor.lng.toFixed(5)} />
              <InfoRow
                label={t("Cal. due")}
                value={calDue.toLocaleDateString("ru-KZ", { timeZone: "Asia/Almaty" })}
              />
              <div className="flex items-center justify-between text-xs col-span-1">
                <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  {t("Cal. status")}
                </span>
                <span className={`font-bold text-[10px] ${isOverdue ? "text-threat" : "text-hud"}`}>
                  {isOverdue ? t("⚠ OVERDUE") : t("✓ CURRENT")}
                </span>
              </div>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="border-t border-border px-5 py-3 flex gap-2 shrink-0">
          <button
            onClick={save}
            disabled={saving}
            className="flex flex-1 items-center justify-center gap-2 border border-hud bg-hud/10 py-2 text-[10px] uppercase tracking-[0.2em] text-hud hover:bg-hud/20 disabled:opacity-40"
          >
            {saving ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" /> {t("Saving…")}
              </>
            ) : saved ? (
              <>
                <CheckCircle2 className="h-3 w-3" /> {t("Saved")}
              </>
            ) : (
              <>
                <Save className="h-3 w-3" /> {t("Save Configuration")}
              </>
            )}
          </button>
          <button
            onClick={onClose}
            className="border border-border px-5 py-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:border-hud hover:text-hud"
          >
            {t("Close")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Sensor Network Map ───────────────────────────────────────
function SensorNetworkMap({
  addMode,
  onMapClick,
  onMapReady,
}: {
  addMode: boolean;
  onMapClick: (lat: number, lng: number) => void;
  onMapReady?: (map: L.Map) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const sensorLayerRef = useRef<L.LayerGroup | null>(null);
  const droneLayerRef = useRef<L.LayerGroup | null>(null);
  const zoneLayerRef = useRef<L.LayerGroup | null>(null);
  const clickHandlerRef = useRef<((e: L.LeafletMouseEvent) => void) | null>(null);
  const readyRef = useRef(false);

  const sensors = useStore((s) => s.sensors);
  const drones = useStore((s) => s.drones);
  const [geoZones, setGeoZones] = useState<ApiGeoZone[]>([]);

  // Init map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const el = containerRef.current;
    /* eslint-disable @typescript-eslint/no-explicit-any */
    if ((el as any)._leaflet_id) {
      try {
        delete (el as any)._leaflet_id;
        /* eslint-enable @typescript-eslint/no-explicit-any */
      } catch {
        // ignore stale Leaflet id
      }
    }

    const map = L.map(el, {
      center: [CENTER.lat, CENTER.lng],
      zoom: 11,
      zoomControl: true,
      attributionControl: false,
      zoomAnimation: false,
      fadeAnimation: false,
      markerZoomAnimation: false,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18 }).addTo(map);

    zoneLayerRef.current = L.layerGroup().addTo(map);
    sensorLayerRef.current = L.layerGroup().addTo(map);
    droneLayerRef.current = L.layerGroup().addTo(map);

    mapRef.current = map;
    readyRef.current = true;
    onMapReady?.(map);

    geoZonesApi
      .list()
      .then(setGeoZones)
      .catch(() => {});

    const t = setTimeout(() => map.invalidateSize(), 100);
    return () => {
      clearTimeout(t);
      readyRef.current = false;
      sensorLayerRef.current = null;
      droneLayerRef.current = null;
      zoneLayerRef.current = null;
      try {
        map.remove();
      } catch {
        // ignore Leaflet cleanup errors
      }
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Click-to-place handler
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (clickHandlerRef.current)
      map.off("click", clickHandlerRef.current as L.LeafletEventHandlerFn);
    if (addMode) {
      const handler = (e: L.LeafletMouseEvent) => onMapClick(e.latlng.lat, e.latlng.lng);
      clickHandlerRef.current = handler;
      map.on("click", handler as L.LeafletEventHandlerFn);
      map.getContainer().style.cursor = "crosshair";
    } else {
      clickHandlerRef.current = null;
      map.getContainer().style.cursor = "";
    }
  }, [addMode, onMapClick]);

  // Geo zones
  useEffect(() => {
    if (!readyRef.current || !zoneLayerRef.current) return;
    zoneLayerRef.current.clearLayers();
    geoZones.forEach((z) => {
      const color = SNS_THREAT_COLOR[z.level] ?? "#7dd3fc";
      L.circle([z.lat, z.lng], {
        radius: z.radius,
        color,
        weight: 1,
        fillColor: color,
        fillOpacity: 0.04,
        dashArray: "3 6",
      })
        .addTo(zoneLayerRef.current!)
        .bindTooltip(z.name, { className: "hud-tooltip" });
    });
  }, [geoZones]);

  // Sensors
  useEffect(() => {
    if (!readyRef.current || !sensorLayerRef.current) return;
    sensorLayerRef.current.clearLayers();
    sensors.forEach((s) => {
      const color = STATUS_COLOR[s.status] ?? "#4ade80";
      L.circle([s.lat, s.lng], {
        radius: s.range * 1000,
        color,
        weight: 1,
        fillOpacity: 0.04,
        opacity: 0.4,
      }).addTo(sensorLayerRef.current!);
      L.marker([s.lat, s.lng], { icon: snsSensorIcon(s.type, s.status) })
        .addTo(sensorLayerRef.current!)
        .bindTooltip(`${s.name} · ${s.type} · ${s.status.toUpperCase()}`, {
          className: "hud-tooltip",
        })
        .on("click", () =>
          mapRef.current?.flyTo([s.lat, s.lng], 13, { animate: true, duration: 0.5 }),
        );
    });
  }, [sensors]);

  // Drones
  useEffect(() => {
    if (!readyRef.current || !droneLayerRef.current) return;
    droneLayerRef.current.clearLayers();
    drones.forEach((d) => {
      const color = SNS_THREAT_COLOR[d.threat] ?? "#7dd3fc";
      L.circleMarker([d.lat, d.lng], {
        radius: 4,
        color,
        fillColor: color,
        fillOpacity: 0.85,
        weight: 1,
      })
        .addTo(droneLayerRef.current!)
        .bindTooltip(`${d.callsign} · ${d.model}`, { className: "hud-tooltip" });
    });
  }, [drones]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      style={{ cursor: addMode ? "crosshair" : undefined }}
    />
  );
}

// ─── Small helpers ────────────────────────────────────────────
function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "hud" | "warning" | "threat";
}) {
  return (
    <div className="border border-border/60 p-2 text-center">
      <div
        className={`hud-stat text-xl font-bold ${
          tone === "threat" ? "text-threat" : tone === "warning" ? "text-warning" : "text-hud"
        }`}
      >
        {value}
      </div>
      <div className="text-[9px] uppercase tracking-[0.15em] text-muted-foreground">{label}</div>
    </div>
  );
}

function SectionTitle({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
      {icon} {label}
    </div>
  );
}

function TelemetryBadge({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "hud" | "warning" | "threat" | "info";
}) {
  const color = {
    hud: "text-hud border-hud/30",
    warning: "text-warning border-warning/30",
    threat: "text-threat border-threat/30",
    info: "text-info border-info/30",
  }[tone];
  return (
    <div className={`border px-2 py-1.5 text-center ${color}`}>
      <div className="hud-stat font-bold text-xs">{value}</div>
      <div className="text-[9px] uppercase tracking-[0.15em] text-muted-foreground mt-0.5">
        {label}
      </div>
    </div>
  );
}

function CfgRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground shrink-0 w-44">
        {label}
      </span>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{label}</span>
      <span className="hud-stat font-bold">{value}</span>
    </div>
  );
}

function MField({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </div>
      {children}
      {error && <div className="mt-0.5 text-[10px] text-threat">{error}</div>}
    </div>
  );
}

function CfgSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full border border-border bg-background px-2 py-1 text-[10px] uppercase tracking-[0.15em] text-foreground focus:border-hud focus:outline-none"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function NumInput({
  value,
  min,
  max,
  step,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full border border-border bg-background px-2 py-1 text-[10px] font-mono text-foreground focus:border-hud focus:outline-none"
    />
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={`flex items-center gap-1.5 border px-2 py-1 text-[10px] uppercase tracking-[0.15em] transition-colors ${
        value
          ? "border-hud/50 bg-hud/10 text-hud"
          : "border-border text-muted-foreground hover:border-border"
      }`}
    >
      <span
        className={`inline-block h-2 w-2 rounded-full ${value ? "bg-hud" : "bg-muted-foreground"}`}
      />
      {value ? "Enabled" : "Disabled"}
    </button>
  );
}

function Bar({
  label,
  value,
  display,
  tone,
}: {
  label: string;
  value: number;
  display?: string;
  tone: "hud" | "warning" | "threat" | "info";
}) {
  const color = { hud: "bg-hud", warning: "bg-warning", threat: "bg-threat", info: "bg-info" }[
    tone
  ];
  const text = {
    hud: "text-hud",
    warning: "text-warning",
    threat: "text-threat",
    info: "text-info",
  }[tone];
  return (
    <div>
      <div className="flex justify-between text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        <span>{label}</span>
        <span className={`hud-stat font-bold ${text}`}>{display ?? `${Math.round(value)}%`}</span>
      </div>
      <div className="mt-1 h-1 w-full bg-muted">
        <div className={`h-full ${color}`} style={{ width: `${Math.min(100, value)}%` }} />
      </div>
    </div>
  );
}

function ActionBtn({
  icon,
  label,
  tone,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  tone?: "threat";
  disabled?: boolean;
  onClick?: () => void;
}) {
  const cls =
    tone === "threat"
      ? "border-threat/40 text-threat hover:bg-threat/10 disabled:opacity-30"
      : "border-border text-muted-foreground hover:border-hud hover:text-hud disabled:opacity-30";
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`flex items-center justify-center gap-1 border px-1 py-1.5 text-[10px] uppercase tracking-[0.2em] transition-colors ${cls}`}
    >
      {icon}
      {label}
    </button>
  );
}
