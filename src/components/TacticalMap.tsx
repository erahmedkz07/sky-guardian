// Tactical Leaflet map. Renders only on client.
import { useEffect, useRef, useState, useCallback } from "react";
import L from "leaflet";
import { useStore, selectDrone, selectIncident } from "@/lib/store";
import { PATROL_CENTER } from "@/lib/mockData";
import { geoZonesApi, type ApiGeoZone } from "@/lib/api";
import type { Incident } from "@/lib/mockData";
import { startRecorder, getFrames, type Snapshot, type DroneFrame } from "@/lib/recorder";
import { PlaybackBar } from "./PlaybackBar";

const threatColor: Record<string, string> = {
  low: "#7dd3fc",
  medium: "#fbbf24",
  high: "#f97316",
  critical: "#ef4444",
};

function droneIcon(threat: string, selected: boolean) {
  const color = threatColor[threat] ?? "#7dd3fc";
  return L.divIcon({
    className: "",
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    html: `
      <div style="position:relative;width:28px;height:28px;">
        <div style="position:absolute;inset:0;border:1px solid ${color};border-radius:50%;
          ${selected ? `box-shadow:0 0 12px ${color}` : ""}"></div>
        <div style="position:absolute;top:50%;left:50%;width:6px;height:6px;background:${color};
          transform:translate(-50%,-50%);border-radius:50%"></div>
        ${
          threat === "critical" || threat === "high"
            ? `<div style="position:absolute;inset:-6px;border:1px solid ${color};border-radius:50%;animation:ping-ring 1.6s ease-out infinite"></div>`
            : ""
        }
      </div>
    `,
  });
}

function sensorIcon() {
  return L.divIcon({
    className: "",
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    html: `
      <div style="width:22px;height:22px;border:1px solid #4ade80;background:rgba(20,40,30,0.7);
        display:flex;align-items:center;justify-content:center;color:#4ade80;font-size:9px;font-weight:bold;font-family:monospace">
        ◊
      </div>
    `,
  });
}

function incidentIcon(threat: string, status: string, selected: boolean) {
  const color = threatColor[threat] ?? threatColor.low;
  const dim = status === "resolved" || status === "dismissed";
  const investigating = status === "investigating";
  const opacity = dim ? "0.35" : "1";
  const glow = selected ? `filter:drop-shadow(0 0 6px ${color})` : "";
  return L.divIcon({
    className: "",
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    html: `
      <div style="width:26px;height:26px;position:relative;opacity:${opacity};${glow}">
        ${investigating ? `<div style="position:absolute;inset:-8px;border:1.5px solid ${color};border-radius:50%;animation:ping-ring 1.6s ease-out infinite;opacity:0.55"></div>` : ""}
        <svg viewBox="0 0 26 26" xmlns="http://www.w3.org/2000/svg" width="26" height="26">
          <polygon points="13,2 24,22 2,22" fill="${color}" fill-opacity="${dim ? 0.1 : investigating ? 0.3 : 0.18}"
            stroke="${color}" stroke-width="${investigating ? 2 : 1.5}"/>
          <text x="13" y="19" text-anchor="middle" fill="${color}"
            font-size="11" font-weight="bold" font-family="monospace">!</text>
          ${
            selected
              ? `<polygon points="13,2 24,22 2,22" fill="none" stroke="${color}" stroke-width="1" stroke-dasharray="3 2" opacity="0.6"/>`
              : ""
          }
        </svg>
      </div>
    `,
  });
}

const MAX_TRAIL = 30;

export function TacticalMap() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const droneLayerRef = useRef<L.LayerGroup | null>(null);
  const sensorLayerRef = useRef<L.LayerGroup | null>(null);
  const zoneLayerRef = useRef<L.LayerGroup | null>(null);
  const incidentLayerRef = useRef<L.LayerGroup | null>(null);
  const trailLayerRef = useRef<L.LayerGroup | null>(null);
  const droneMarkersRef = useRef<Record<string, L.Marker>>({});
  const incidentMarkersRef = useRef<Record<string, L.Marker>>({});
  const trailDataRef = useRef<Record<string, Array<[number, number]>>>({});
  const trailLinesRef = useRef<Record<string, L.Polyline>>({});
  const readyRef = useRef(false);
  const [showTrails, setShowTrails] = useState(true);

  const liveDrones = useStore((s) => s.drones);
  const sensors = useStore((s) => s.sensors);
  const incidents = useStore((s) => s.incidents);
  const selectedId = useStore((s) => s.selectedDroneId);
  const selectedInc = useStore((s) => s.selectedIncidentId);
  const [geoZones, setGeoZones] = useState<ApiGeoZone[]>([]);
  const [playbackSnap, setPlaybackSnap] = useState<Snapshot | null>(null);

  // Use playback frame if set, otherwise live drones
  const drones: DroneFrame[] = (playbackSnap?.drones ?? liveDrones) as DroneFrame[];

  const handleFrame = useCallback((snap: Snapshot | null) => {
    setPlaybackSnap(snap);
  }, []);

  // Start recorder on mount
  useEffect(() => {
    startRecorder(() => liveDrones);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    // Defensive: ensure container is empty (HMR / strict-mode double-mount)
    const el = containerRef.current;
    // Leaflet stores instance on this property — clear if leftover
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((el as any)._leaflet_id) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete (el as any)._leaflet_id;
      } catch {
        // ignore
      }
    }

    const map = L.map(el, {
      center: [PATROL_CENTER.lat, PATROL_CENTER.lng],
      zoom: 11,
      zoomControl: true,
      attributionControl: false,
      // Disable zoom transition animation — prevents the
      // "_leaflet_pos of undefined" race during teardown.
      zoomAnimation: false,
      fadeAnimation: false,
      markerZoomAnimation: false,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
    }).addTo(map);

    trailLayerRef.current = L.layerGroup().addTo(map);
    droneLayerRef.current = L.layerGroup().addTo(map);
    sensorLayerRef.current = L.layerGroup().addTo(map);
    zoneLayerRef.current = L.layerGroup().addTo(map);
    incidentLayerRef.current = L.layerGroup().addTo(map);

    mapRef.current = map;
    readyRef.current = true;

    // Fetch geo zones from API after map is ready
    geoZonesApi
      .list()
      .then((zones) => setGeoZones(zones))
      .catch(() => {});

    // Force size recalc once layout settles
    const sizeTimer = setTimeout(() => {
      if (mapRef.current) mapRef.current.invalidateSize();
    }, 100);

    return () => {
      clearTimeout(sizeTimer);
      readyRef.current = false;
      droneMarkersRef.current = {};
      incidentMarkersRef.current = {};
      trailDataRef.current = {};
      trailLinesRef.current = {};
      trailLayerRef.current = null;
      droneLayerRef.current = null;
      sensorLayerRef.current = null;
      zoneLayerRef.current = null;
      incidentLayerRef.current = null;
      try {
        map.remove();
      } catch {
        // ignore teardown races
      }
      mapRef.current = null;
    };
  }, []);

  // Show/hide trail layer
  useEffect(() => {
    if (!trailLayerRef.current || !mapRef.current) return;
    if (showTrails) {
      mapRef.current.addLayer(trailLayerRef.current);
    } else {
      mapRef.current.removeLayer(trailLayerRef.current);
      // Clear accumulated data so stale trails don't reappear
      Object.keys(trailLinesRef.current).forEach((id) => {
        try {
          trailLayerRef.current?.removeLayer(trailLinesRef.current[id]);
        } catch {
          /* ignore */
        }
        delete trailLinesRef.current[id];
      });
      Object.keys(trailDataRef.current).forEach((id) => {
        delete trailDataRef.current[id];
      });
    }
  }, [showTrails]);

  // Geo zones — redrawn when API data arrives
  useEffect(() => {
    if (!readyRef.current || !zoneLayerRef.current) return;
    zoneLayerRef.current.clearLayers();
    geoZones.forEach((z) => {
      const color = threatColor[z.level] ?? threatColor.low;
      L.circle([z.lat, z.lng], {
        radius: z.radius,
        color,
        weight: 1.5,
        fillColor: color,
        fillOpacity: 0.08,
        dashArray: "4 6",
      })
        .addTo(zoneLayerRef.current!)
        .bindTooltip(`${z.id} · ${z.name}`, { permanent: false, className: "hud-tooltip" });
    });
  }, [geoZones]);

  // Sensors
  useEffect(() => {
    if (!readyRef.current || !sensorLayerRef.current) return;
    sensorLayerRef.current.clearLayers();
    sensors.forEach((s) => {
      L.circle([s.lat, s.lng], {
        radius: s.range * 1000,
        color: "#4ade80",
        weight: 1,
        fillOpacity: 0.03,
        opacity: 0.35,
      }).addTo(sensorLayerRef.current!);
      L.marker([s.lat, s.lng], { icon: sensorIcon() })
        .addTo(sensorLayerRef.current!)
        .bindTooltip(`${s.name} · ${s.type}`);
    });
  }, [sensors]);

  // Drones — update positions in place + accumulate trails
  useEffect(() => {
    if (!readyRef.current || !droneLayerRef.current) return;
    const layer = droneLayerRef.current;
    const seen = new Set<string>();

    drones.forEach((d) => {
      seen.add(d.id);

      // ── Marker ─────────────────────────────────────────────
      const existing = droneMarkersRef.current[d.id];
      if (existing) {
        try {
          existing.setLatLng([d.lat, d.lng]);
          existing.setIcon(droneIcon(d.threat, d.id === selectedId));
        } catch {
          delete droneMarkersRef.current[d.id];
        }
      } else {
        const m = L.marker([d.lat, d.lng], { icon: droneIcon(d.threat, d.id === selectedId) })
          .addTo(layer)
          .bindTooltip(`${d.callsign} · ${d.model}`)
          .on("click", () => selectDrone(d.id));
        droneMarkersRef.current[d.id] = m;
      }

      // ── Trail ──────────────────────────────────────────────
      if (!showTrails) return;
      const trail = trailDataRef.current[d.id] ?? [];
      const last = trail[trail.length - 1];
      if (!last || last[0] !== d.lat || last[1] !== d.lng) {
        trail.push([d.lat, d.lng]);
        if (trail.length > MAX_TRAIL) trail.shift();
        trailDataRef.current[d.id] = trail;
      }
      if (trail.length >= 2 && trailLayerRef.current) {
        const color = threatColor[d.threat] ?? threatColor.low;
        const existingLine = trailLinesRef.current[d.id];
        if (existingLine) {
          existingLine.setLatLngs(trail);
          existingLine.setStyle({ color });
        } else {
          const poly = L.polyline(trail, {
            color,
            weight: 1.5,
            opacity: 0.5,
            dashArray: "5 6",
          }).addTo(trailLayerRef.current);
          trailLinesRef.current[d.id] = poly;
        }
      }
    });

    // Remove stale markers and trails
    Object.keys(droneMarkersRef.current).forEach((id) => {
      if (!seen.has(id)) {
        try {
          layer.removeLayer(droneMarkersRef.current[id]);
        } catch {
          /* ignore */
        }
        delete droneMarkersRef.current[id];
      }
    });
    Object.keys(trailLinesRef.current).forEach((id) => {
      if (!seen.has(id)) {
        try {
          trailLayerRef.current?.removeLayer(trailLinesRef.current[id]);
        } catch {
          /* ignore */
        }
        delete trailLinesRef.current[id];
        delete trailDataRef.current[id];
      }
    });
  }, [drones, selectedId, showTrails]);

  // Incidents — update markers in place (same pattern as drones)
  useEffect(() => {
    if (!readyRef.current || !incidentLayerRef.current) return;
    const layer = incidentLayerRef.current;
    const seen = new Set<string>();

    incidents.forEach((inc: Incident) => {
      if (inc.lat == null || inc.lng == null) return;
      seen.add(inc.id);
      const existing = incidentMarkersRef.current[inc.id];
      const icon = incidentIcon(inc.threat, inc.status, inc.id === selectedInc);
      if (existing) {
        try {
          existing.setLatLng([inc.lat, inc.lng]);
          existing.setIcon(icon);
        } catch {
          delete incidentMarkersRef.current[inc.id];
        }
      } else {
        const m = L.marker([inc.lat, inc.lng], { icon })
          .addTo(layer)
          .bindTooltip(`${inc.code} · ${inc.title}`, { direction: "top", offset: [0, -10] })
          .on("click", () => {
            selectIncident(inc.id === selectedInc ? null : inc.id);
          });
        incidentMarkersRef.current[inc.id] = m;
      }
    });

    Object.keys(incidentMarkersRef.current).forEach((id) => {
      if (!seen.has(id)) {
        try {
          layer.removeLayer(incidentMarkersRef.current[id]);
        } catch {
          /* ignore */
        }
        delete incidentMarkersRef.current[id];
      }
    });
  }, [incidents, selectedInc]);

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="absolute inset-0" />

      {/* Trail toggle */}
      <button
        onClick={() => setShowTrails((v) => !v)}
        style={{ position: "absolute", bottom: 56, right: 8, zIndex: 1000 }}
        className={`border px-2 py-1 text-[9px] font-bold uppercase tracking-[0.15em] backdrop-blur-sm transition-colors
          ${
            showTrails
              ? "border-hud/60 bg-hud/15 text-hud"
              : "border-border bg-panel/70 text-muted-foreground hover:text-hud"
          }`}
        title="Toggle drone trails"
      >
        {showTrails ? "Trails ON" : "Trails OFF"}
      </button>

      {/* Playback bar — appears once we have recorded frames */}
      {getFrames().length >= 2 && <PlaybackBar onFrame={handleFrame} />}
    </div>
  );
}
