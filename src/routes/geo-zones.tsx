import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { HudPanel, PageHeader, ThreatBadge } from "@/components/HudPanel";
import { geoZonesApi, type ApiGeoZone } from "@/lib/api";
import {
  Plus,
  X,
  Edit2,
  Trash2,
  Power,
  Loader2,
  RefreshCw,
  MapPin,
  AlertTriangle,
  Shield,
} from "lucide-react";
import L from "leaflet";
import { useT } from "@/lib/i18n";

export const Route = createFileRoute("/geo-zones")({
  component: GeoZones,
  head: () => ({ meta: [{ title: "Geo Zones // DDS" }] }),
});

const ASTANA = { lat: 51.13, lng: 71.44 };

const THREAT_COLOR: Record<string, string> = {
  low: "#4ade80",
  medium: "#fbbf24",
  high: "#f97316",
  critical: "#ef4444",
};

type ModalState = { mode: "create"; lat: number; lng: number } | { mode: "edit"; zone: ApiGeoZone };

// ─── Main Component ──────────────────────────────────────────
function GeoZones() {
  const { t } = useT();
  const [zones, setZones] = useState<ApiGeoZone[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addMode, setAddMode] = useState(false);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ApiGeoZone | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const mapInstanceRef = useRef<L.Map | null>(null);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      setZones(await geoZonesApi.list());
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t("Failed to load zones"));
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function handleMapClick(lat: number, lng: number) {
    setAddMode(false);
    setModal({ mode: "create", lat, lng });
  }

  function handleZoneClick(id: string) {
    setSelectedId((prev) => (prev === id ? null : id));
    const zone = zones.find((z) => z.id === id);
    if (zone)
      mapInstanceRef.current?.flyTo([zone.lat, zone.lng], 13, { animate: true, duration: 0.5 });
  }

  function handleListClick(zone: ApiGeoZone) {
    setSelectedId(zone.id);
    mapInstanceRef.current?.flyTo([zone.lat, zone.lng], 13, { animate: true, duration: 0.5 });
  }

  async function handleToggleActive(zone: ApiGeoZone) {
    const snapshot = [...zones];
    setZones((z) => z.map((x) => (x.id === zone.id ? { ...x, active: !x.active } : x)));
    try {
      const updated = await geoZonesApi.patch(zone.id, { active: !zone.active });
      setZones((z) => z.map((x) => (x.id === zone.id ? updated : x)));
    } catch {
      setZones(snapshot);
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    const { id } = deleteTarget;
    const snapshot = [...zones];
    setDeleting(true);
    setDeleteTarget(null);
    setZones((z) => z.filter((x) => x.id !== id));
    if (selectedId === id) setSelectedId(null);
    try {
      await geoZonesApi.delete(id);
    } catch {
      setZones(snapshot);
    }
    setDeleting(false);
  }

  async function handleSave(data: {
    name: string;
    lat: number;
    lng: number;
    radius: number;
    level: string;
    active: boolean;
  }) {
    setSaving(true);
    setSaveError(null);
    try {
      if (modal?.mode === "create") {
        const created = await geoZonesApi.create(data);
        setZones((z) => [...z, created].sort((a, b) => a.name.localeCompare(b.name)));
        setSelectedId(created.id);
        setModal(null);
        setTimeout(() => {
          mapInstanceRef.current?.flyTo([created.lat, created.lng], 13, {
            animate: true,
            duration: 0.8,
          });
        }, 150);
      } else if (modal?.mode === "edit") {
        const updated = await geoZonesApi.patch(modal.zone.id, data);
        setZones((z) => z.map((x) => (x.id === modal.zone.id ? updated : x)));
        setModal(null);
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Server error");
    }
    setSaving(false);
  }

  const activeCount = zones.filter((z) => z.active).length;
  const highRiskCount = zones.filter((z) => z.level === "critical" || z.level === "high").length;

  return (
    <div className="flex flex-col">
      <PageHeader
        title={t("Geo Zones")}
        subtitle={t("Geofenced perimeters · automatic engagement triggers")}
        actions={
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              <span className="text-hud">
                {activeCount} {t("active")}
              </span>
              {zones.length - activeCount > 0 && (
                <span className="ml-2">
                  {zones.length - activeCount} {t("inactive")}
                </span>
              )}
            </span>
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
                setModal({ mode: "create", lat: ASTANA.lat, lng: ASTANA.lng });
                setSaveError(null);
              }}
              className="flex items-center gap-2 border border-hud bg-hud/10 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.25em] text-hud hover:bg-hud/20"
            >
              <Plus className="h-3.5 w-3.5" /> {t("New Zone")}
            </button>
          </div>
        }
      />

      {/* Banners */}
      {addMode && (
        <div className="mx-6 mt-3 flex items-center gap-2 border border-hud/40 bg-hud/5 px-4 py-2 text-[11px] text-hud">
          <MapPin className="h-3.5 w-3.5 shrink-0" />
          {t("Click anywhere on the map to place a new zone — or press Cancel to exit")}
        </div>
      )}
      {loadError && (
        <div className="mx-4 mt-3 flex items-center gap-2 border border-threat/50 bg-threat/5 px-4 py-2 text-[11px] text-threat sm:mx-6">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {loadError}
          <button
            onClick={load}
            className="ml-auto flex items-center gap-1 text-threat/70 hover:text-threat"
          >
            <RefreshCw className="h-3 w-3" /> {t("Retry")}
          </button>
        </div>
      )}
      {saveError && (
        <div className="mx-4 mt-3 flex items-center gap-2 border border-threat/50 bg-threat/5 px-4 py-2 text-[11px] text-threat sm:mx-6">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {saveError}
          <button
            onClick={() => setSaveError(null)}
            className="ml-auto text-threat/60 hover:text-threat"
          >
            ✕
          </button>
        </div>
      )}

      {/* Main layout */}
      <div className="flex flex-col gap-3 px-4 py-4 sm:px-6 md:flex-row">
        {/* Interactive map — z-0 creates an isolated stacking context so Leaflet's
            internal panes (z-index 200-1000) stay below the fixed modals at z-[2000] */}
        <div className="relative z-0 min-h-[280px] flex-1 border border-border sm:min-h-[400px] md:min-h-[600px]">
          {(loading || deleting) && (
            <div className="absolute inset-0 z-[1100] flex items-center justify-center bg-background/60">
              <Loader2 className="h-6 w-6 animate-spin text-hud" />
            </div>
          )}
          <GeoZoneMap
            zones={zones}
            selectedId={selectedId}
            addMode={addMode}
            onMapClick={handleMapClick}
            onZoneClick={handleZoneClick}
            onMapReady={(map) => {
              mapInstanceRef.current = map;
            }}
          />
          {/* Map legend — above Leaflet controls (z-1000) */}
          <div className="absolute bottom-3 left-3 z-[1100] space-y-1 border border-border/60 bg-background/90 px-3 py-2 backdrop-blur-sm">
            <div className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground mb-1">
              {t("Threat Level")}
            </div>
            {(["critical", "high", "medium", "low"] as const).map((lvl) => (
              <div
                key={lvl}
                className="flex items-center gap-2 text-[9px] uppercase tracking-[0.15em] text-muted-foreground"
              >
                <span
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ background: THREAT_COLOR[lvl] }}
                />
                {t(lvl)}
              </div>
            ))}
          </div>
        </div>

        {/* Zone list panel */}
        <div className="flex w-full shrink-0 flex-col gap-2 md:w-72">
          {/* Stats row */}
          {!loading && zones.length > 0 && (
            <div className="grid grid-cols-3 gap-1.5">
              <StatCard label={t("Total")} value={zones.length} tone="hud" />
              <StatCard label={t("Active")} value={activeCount} tone="hud" />
              <StatCard
                label={t("High Risk")}
                value={highRiskCount}
                tone={highRiskCount > 0 ? "threat" : "hud"}
              />
            </div>
          )}

          {loading && (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-hud" />
            </div>
          )}

          {!loading && !loadError && zones.length === 0 && (
            <div className="border border-border/40 p-6 text-center">
              <Shield className="mx-auto h-8 w-8 text-muted-foreground/30 mb-3" />
              <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                {t("No zones defined")}
              </p>
              <button
                onClick={() => {
                  setModal({ mode: "create", lat: ASTANA.lat, lng: ASTANA.lng });
                  setSaveError(null);
                }}
                className="mt-3 flex items-center gap-1.5 mx-auto text-[10px] text-hud hover:underline uppercase tracking-[0.15em]"
              >
                <Plus className="h-3 w-3" /> {t("Create the first zone")}
              </button>
            </div>
          )}

          {zones.map((zone) => {
            const isSelected = zone.id === selectedId;
            const dotColor = THREAT_COLOR[zone.level] ?? THREAT_COLOR.low;

            return (
              <div
                key={zone.id}
                className={`border transition-colors ${
                  isSelected ? "border-hud/60 bg-hud/5" : "border-border/60 hover:border-border"
                }`}
              >
                {/* Zone info */}
                <button onClick={() => handleListClick(zone)} className="w-full p-3 text-left">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ background: dotColor }}
                        />
                        <span className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
                          {zone.id}
                        </span>
                        {!zone.active && (
                          <span className="border border-border px-1 text-[8px] uppercase tracking-[0.1em] text-muted-foreground">
                            {t("OFF")}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 truncate text-xs font-bold uppercase tracking-wider text-foreground">
                        {zone.name}
                      </div>
                    </div>
                    <ThreatBadge level={zone.level} />
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px]">
                    <span className="text-muted-foreground">
                      {t("Lat:")}{" "}
                      <span className="font-mono font-bold text-foreground">
                        {zone.lat.toFixed(4)}
                      </span>
                    </span>
                    <span className="text-muted-foreground">
                      {t("Lng:")}{" "}
                      <span className="font-mono font-bold text-foreground">
                        {zone.lng.toFixed(4)}
                      </span>
                    </span>
                    <span className="col-span-2 text-muted-foreground">
                      {t("Radius:")}{" "}
                      <span className="font-bold text-hud">
                        {(zone.radius / 1000).toFixed(1)} km
                      </span>
                    </span>
                  </div>
                </button>

                {/* Action bar */}
                <div className="flex divide-x divide-border/40 border-t border-border/40">
                  <ActionBtn
                    icon={Edit2}
                    label={t("Edit")}
                    onClick={() => {
                      setModal({ mode: "edit", zone });
                      setSaveError(null);
                    }}
                  />
                  <ActionBtn
                    icon={Power}
                    label={zone.active ? t("Disable") : t("Enable")}
                    tone={zone.active ? "warning" : "hud"}
                    onClick={() => handleToggleActive(zone)}
                  />
                  <ActionBtn
                    icon={Trash2}
                    label={t("Delete")}
                    tone="threat"
                    onClick={() => setDeleteTarget(zone)}
                  />
                </div>
              </div>
            );
          })}

          {!loading && zones.length > 0 && (
            <button
              onClick={load}
              className="mt-1 flex items-center justify-center gap-1.5 border border-border/40 py-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:border-hud hover:text-hud"
            >
              <RefreshCw className="h-3 w-3" /> {t("Refresh")}
            </button>
          )}
        </div>
      </div>

      {/* Modals */}
      {modal && (
        <ZoneModal
          modal={modal}
          saving={saving}
          onSave={handleSave}
          onClose={() => {
            setModal(null);
            setSaveError(null);
          }}
        />
      )}
      {deleteTarget && (
        <DeleteModal
          zone={deleteTarget}
          onConfirm={handleConfirmDelete}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

// ─── Leaflet map ─────────────────────────────────────────────
interface GeoZoneMapProps {
  zones: ApiGeoZone[];
  selectedId: string | null;
  addMode: boolean;
  onMapClick: (lat: number, lng: number) => void;
  onZoneClick: (id: string) => void;
  onMapReady: (map: L.Map) => void;
}

function GeoZoneMap({
  zones,
  selectedId,
  addMode,
  onMapClick,
  onZoneClick,
  onMapReady,
}: GeoZoneMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const addModeRef = useRef(addMode);
  const onMapClickRef = useRef(onMapClick);
  const onZoneClickRef = useRef(onZoneClick);

  useEffect(() => {
    addModeRef.current = addMode;
  }, [addMode]);
  useEffect(() => {
    onMapClickRef.current = onMapClick;
  }, [onMapClick]);
  useEffect(() => {
    onZoneClickRef.current = onZoneClick;
  }, [onZoneClick]);

  // Initialise once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const el = containerRef.current;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((el as any)._leaflet_id) delete (el as any)._leaflet_id;

    const map = L.map(el, {
      center: [ASTANA.lat, ASTANA.lng],
      zoom: 12,
      zoomAnimation: false,
      fadeAnimation: false,
      markerZoomAnimation: false,
      attributionControl: false,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18 }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    onMapReady(map);

    map.on("click", (e: L.LeafletMouseEvent) => {
      if (addModeRef.current) onMapClickRef.current(e.latlng.lat, e.latlng.lng);
    });

    setTimeout(() => {
      map.invalidateSize();
    }, 120);

    return () => {
      try {
        map.remove();
      } catch {
        /* ignore */
      }
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  // Redraw zones
  useEffect(() => {
    if (!layerRef.current) return;
    layerRef.current.clearLayers();

    zones.forEach((z) => {
      const color = THREAT_COLOR[z.level] ?? THREAT_COLOR.low;
      const isSelected = z.id === selectedId;

      const circle = L.circle([z.lat, z.lng], {
        radius: z.radius,
        color,
        weight: isSelected ? 3 : 1.5,
        fillColor: color,
        fillOpacity: z.active ? (isSelected ? 0.18 : 0.07) : 0.03,
        dashArray: z.active ? undefined : "4 6",
        opacity: z.active ? 1 : 0.45,
      })
        .addTo(layerRef.current!)
        .bindTooltip(
          `<div style="font-family:monospace;font-size:10px;line-height:1.5">
            <b>${z.id}</b> · ${z.name}<br>
            ${(z.radius / 1000).toFixed(1)} km · ${z.level.toUpperCase()}<br>
            ${z.active ? "● ACTIVE" : "○ INACTIVE"}
          </div>`,
          { className: "hud-tooltip" },
        )
        .on("click", (e) => {
          L.DomEvent.stopPropagation(e);
          onZoneClickRef.current(z.id);
        });

      // Permanent label at zone center
      L.marker([z.lat, z.lng], {
        icon: L.divIcon({
          className: "",
          html: `<div style="
            font-family: monospace;
            font-size: 9px;
            font-weight: bold;
            letter-spacing: 0.15em;
            text-transform: uppercase;
            white-space: nowrap;
            color: ${color};
            text-shadow: 0 0 6px #000a, 0 0 3px #000;
            pointer-events: none;
            transform: translate(-50%, calc(-${z.radius > 2000 ? 16 : 8}px - 100%));
          ">${z.id}</div>`,
          iconSize: [0, 0],
          iconAnchor: [0, 0],
        }),
        interactive: false,
        zIndexOffset: 100,
      }).addTo(layerRef.current!);
    });
  }, [zones, selectedId]);

  // Cursor
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.style.cursor = addMode ? "crosshair" : "";
    }
  }, [addMode]);

  return <div ref={containerRef} className="absolute inset-0" />;
}

// ─── Zone Create / Edit Modal ─────────────────────────────────
function ZoneModal({
  modal,
  saving,
  onSave,
  onClose,
}: {
  modal: ModalState;
  saving: boolean;
  onSave: (data: {
    name: string;
    lat: number;
    lng: number;
    radius: number;
    level: string;
    active: boolean;
  }) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const init = modal.mode === "edit" ? modal.zone : null;

  const [name, setName] = useState(init?.name ?? "");
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const [lat, setLat] = useState(
    init ? String(init.lat) : String((modal as any).lat ?? ASTANA.lat),
  );
  const [lng, setLng] = useState(
    init ? String(init.lng) : String((modal as any).lng ?? ASTANA.lng),
  );
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const [radiusKm, setRadiusKm] = useState(init ? String((init.radius / 1000).toFixed(1)) : "1.0");
  const [level, setLevel] = useState<"low" | "medium" | "high" | "critical">(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (init?.level as any) ?? "medium",
  );
  const [active, setActive] = useState(init?.active ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function validate() {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = t("Required");
    const latN = parseFloat(lat);
    const lngN = parseFloat(lng);
    const radN = parseFloat(radiusKm);
    if (isNaN(latN) || latN < -90 || latN > 90) e.lat = t("Range: −90 to 90");
    if (isNaN(lngN) || lngN < -180 || lngN > 180) e.lng = t("Range: −180 to 180");
    if (isNaN(radN) || radN < 0.1 || radN > 50) e.radius = t("Range: 0.1 to 50 km");
    return e;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) {
      setErrors(errs);
      return;
    }
    onSave({
      name: name.trim(),
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      radius: Math.round(parseFloat(radiusKm) * 1000),
      level,
      active,
    });
  }

  const radiusVal = Math.min(Math.max(parseFloat(radiusKm) || 0.1, 0.1), 50);

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="w-full max-w-md border border-hud/40 bg-background shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="font-bold tracking-widest text-hud">
            {modal.mode === "create"
              ? t("Create Zone")
              : // eslint-disable-next-line @typescript-eslint/no-explicit-any
                `${t("Edit")} · ${(modal as any).zone?.id}`}
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          {/* Name */}
          <MField label={t("Zone Name *")} error={errors.name}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="AIRSPACE PERIMETER 14-C"
              className={`w-full border bg-transparent px-3 py-2 text-xs uppercase tracking-wider focus:outline-none focus:border-hud ${
                errors.name ? "border-threat" : "border-border"
              }`}
            />
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

          {/* Radius */}
          <MField label={`${t("Radius")} · ${radiusVal.toFixed(1)} km`} error={errors.radius}>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="0.1"
                max="50"
                step="0.1"
                value={radiusVal}
                onChange={(e) => setRadiusKm(e.target.value)}
                className="flex-1 accent-[var(--hud)]"
              />
              <input
                value={radiusKm}
                onChange={(e) => setRadiusKm(e.target.value)}
                className="w-16 border border-border bg-transparent px-2 py-1.5 text-center font-mono text-xs focus:border-hud focus:outline-none"
              />
              <span className="shrink-0 text-[10px] text-muted-foreground">km</span>
            </div>
          </MField>

          {/* Threat level */}
          <MField label={t("Threat Level")}>
            <div className="flex gap-2">
              {(["low", "medium", "high", "critical"] as const).map((tl) => (
                <button
                  key={tl}
                  type="button"
                  onClick={() => setLevel(tl)}
                  className={`flex-1 border py-1.5 text-[10px] uppercase tracking-[0.2em] transition-colors ${
                    level === tl
                      ? tl === "critical"
                        ? "border-threat bg-threat/20 text-threat"
                        : tl === "high"
                          ? "border-orange-500/70 bg-orange-500/10 text-orange-400"
                          : tl === "medium"
                            ? "border-warning bg-warning/20 text-warning"
                            : "border-hud bg-hud/20 text-hud"
                      : "border-border text-muted-foreground hover:border-hud"
                  }`}
                >
                  {t(tl)}
                </button>
              ))}
            </div>
          </MField>

          {/* Active */}
          <label className="flex cursor-pointer items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="accent-[var(--hud)]"
            />
            <span>{t("Zone active — trigger alerts on drone incursion")}</span>
          </label>

          {modal.mode === "create" && (
            <p className="text-[10px] text-muted-foreground">
              {t("Tip: use")} <span className="font-bold text-hud">{t("Place on Map")}</span>{" "}
              {t("to click the map and auto-fill coordinates.")}
            </p>
          )}

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
              ) : modal.mode === "create" ? (
                t("Create Zone")
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
  zone,
  onConfirm,
  onClose,
}: {
  zone: ApiGeoZone;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useT();
  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="w-full max-w-sm border border-threat/40 bg-background shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="flex items-center gap-2 font-bold tracking-widest text-threat">
            <Trash2 className="h-4 w-4" />
            {t("Delete Zone")}
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-muted-foreground">
            {t("Delete")} <span className="font-bold text-foreground">{zone.name}</span> ({zone.id}
            )? {t("This action cannot be undone. Any associated geofence alerts will stop.")}
          </p>
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
              {t("Delete Zone")}
            </button>
          </div>
        </div>
      </div>
    </div>
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
  tone: "hud" | "threat";
}) {
  return (
    <div className="border border-border/60 p-2 text-center">
      <div
        className={`hud-stat text-xl font-bold ${tone === "threat" ? "text-threat" : "text-hud"}`}
      >
        {value}
      </div>
      <div className="text-[9px] uppercase tracking-[0.15em] text-muted-foreground">{label}</div>
    </div>
  );
}

function ActionBtn({
  icon: Icon,
  label,
  tone,
  onClick,
}: {
  icon: typeof Edit2;
  label: string;
  tone?: "hud" | "warning" | "threat";
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const hoverClass =
    tone === "threat"
      ? "hover:bg-threat/10 hover:text-threat"
      : tone === "warning"
        ? "hover:bg-warning/10 hover:text-warning"
        : "hover:bg-hud/10 hover:text-hud";

  return (
    <button
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1 py-2 text-[9px] uppercase tracking-[0.15em] text-muted-foreground transition-colors ${hoverClass}`}
    >
      <Icon className="h-3 w-3" /> {label}
    </button>
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
