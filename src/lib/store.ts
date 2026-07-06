/**
 * Global store for DDS data.
 * Strategy: loads from real API on boot; falls back to mock data if API is unavailable.
 * Mock data stays alive as the safety net until Arduino hardware is ready.
 */
import { useEffect, useState } from "react";
import {
  type AlertEvent,
  type Detection,
  type Drone,
  type Incident,
  type Sensor,
  makeDrones,
  resetMockSeed,
  tickDrones,
} from "./mockData";
import {
  dronesApi,
  sensorsApi,
  detectionsApi,
  incidentsApi,
  alertsApi,
  aiEngineApi,
  type ApiDrone,
  type ApiSensor,
  type ApiDetection,
  type ApiIncident,
  type ApiAlert,
  type AiPendingAction,
} from "./api";
import { connectSocket, disconnectSocket, getSocket } from "./socket";

// ─── Normalizers (API shape → mockData shape) ─────────────────
function normalizeDrone(d: ApiDrone): Drone {
  return {
    id: d.id,
    callsign: d.callsign,
    model: d.model,
    lat: d.lat,
    lng: d.lng,
    altitude: d.altitude,
    speed: d.speed,
    heading: d.heading,
    threat: d.threat,
    status: d.status,
    detectedAt: new Date(d.detectedAt),
    confidence: d.confidence,
    vLat: 0,
    vLng: 0,
  };
}

function normalizeSensor(s: ApiSensor): Sensor {
  return {
    id: s.id,
    name: s.name,
    type: s.type,
    lat: s.lat,
    lng: s.lng,
    status: s.status,
    health: s.health,
    signal: s.signal,
    range: s.range,
    lastPing: new Date(s.lastPing),
    config: s.config ?? {},
  };
}

function normalizeDetection(d: ApiDetection): Detection {
  return {
    id: d.id,
    droneId: d.droneId ?? "",
    callsign: d.callsign,
    model: d.model,
    threat: d.threat,
    sensorId: d.sensorId ?? "",
    sensorName: d.sensorName,
    timestamp: new Date(d.timestamp),
    lat: d.lat,
    lng: d.lng,
    confidence: d.confidence,
    notes: d.notes ?? undefined,
  };
}

function normalizeIncident(inc: ApiIncident): Incident {
  return {
    id: inc.id,
    code: inc.code,
    title: inc.title,
    threat: inc.threat,
    status: inc.status,
    assignee: inc.assignee ?? "",
    createdAt: new Date(inc.createdAt),
    updatedAt: new Date(inc.updatedAt),
    description: inc.description ?? "",
    detectionIds: inc.detectionIds,
    lat: inc.lat ?? undefined,
    lng: inc.lng ?? undefined,
  };
}

function normalizeAlert(a: ApiAlert): AlertEvent {
  return {
    id: a.id,
    level: a.level,
    title: a.title,
    message: a.message,
    timestamp: new Date(a.timestamp),
    source: a.source,
    acknowledged: a.acknowledged,
  };
}

// ─── Calibration config ───────────────────────────────────────
export interface CalibrationConfig {
  confidence: number;
  altitude: number;
  speed: number;
  autoClassify: number;
  activeProfile: string;
  pushNotif: boolean;
  emailDigest: boolean;
  telegram: boolean;
  sms: boolean;
  audio: boolean;
  sensorOffsets: Record<string, number>;
}

const CAL_STORAGE_KEY = "dds_calibration";

function loadCalibration(): CalibrationConfig {
  try {
    const raw = localStorage.getItem(CAL_STORAGE_KEY);
    if (raw) return { ...defaultCalibration(), ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return defaultCalibration();
}

function defaultCalibration(): CalibrationConfig {
  return {
    confidence: 62,
    altitude: 40,
    speed: 20,
    autoClassify: 88,
    activeProfile: "ПОВЫШЕННАЯ ГОТОВНОСТЬ",
    pushNotif: true,
    emailDigest: true,
    telegram: false,
    sms: true,
    audio: true,
    sensorOffsets: {},
  };
}

// ─── State ────────────────────────────────────────────────────
interface State {
  drones: Drone[];
  sensors: Sensor[];
  detections: Detection[];
  incidents: Incident[];
  alerts: AlertEvent[];
  pendingAiActions: AiPendingAction[];
  selectedDroneId: string | null;
  selectedIncidentId: string | null;
  apiConnected: boolean;
  calibration: CalibrationConfig;
}

let _state: State | null = null;

function getMockState(): State {
  resetMockSeed(1337);
  const drones = makeDrones(10);
  return {
    drones,
    sensors: [],
    detections: [],
    incidents: [],
    alerts: [],
    pendingAiActions: [],
    selectedDroneId: null,
    selectedIncidentId: null,
    apiConnected: false,
    calibration: loadCalibration(),
  };
}

function getState(): State {
  if (!_state) _state = getMockState();
  return _state;
}

const subs = new Set<() => void>();
function notify() {
  subs.forEach((cb) => cb());
}

// ─── API bootstrap ────────────────────────────────────────────
let _bootstrapped = false;

async function bootstrapFromApi() {
  if (_bootstrapped || typeof window === "undefined") return;
  _bootstrapped = true;

  try {
    const [drones, sensors, detections, incidents, alerts, pendingAi] = await Promise.all([
      dronesApi.list(),
      sensorsApi.list(),
      detectionsApi.list(50),
      incidentsApi.list(),
      alertsApi.list(),
      aiEngineApi.listPending().catch(() => [] as AiPendingAction[]),
    ]);

    const s = getState();
    s.drones = drones.map(normalizeDrone);
    s.sensors = sensors.map(normalizeSensor);
    s.detections = detections.map(normalizeDetection);
    s.incidents = incidents.map(normalizeIncident);
    s.alerts = alerts.map(normalizeAlert);
    s.pendingAiActions = pendingAi;
    s.apiConnected = true;

    notify();
    console.info("[store] Loaded from API ✓");
    setupWebSocket();
  } catch {
    console.warn("[store] API unavailable — using mock data (fallback mode)");
    ensureMockLoop();
  }
}

// ─── WebSocket — real-time drone positions ────────────────────

// Debounce: same source fires at most 1 feed alert per 25 seconds
const _lastFeedTs = new Map<string, number>();

interface FeedEventPayload {
  id: number;
  time: string;
  source: string;
  level: "info" | "warn" | "alert";
  text: string;
}

function setupWebSocket() {
  const token = localStorage.getItem("dds_token") ?? "";
  const socket = connectSocket(token);

  // Inject server-side live feed events into the alerts array
  socket.on("feed:event", (ev: FeedEventPayload) => {
    const now = Date.now();
    const last = _lastFeedTs.get(ev.source) ?? 0;
    if (now - last < 25_000) return;
    _lastFeedTs.set(ev.source, now);

    const levelMap: Record<string, AlertEvent["level"]> = {
      alert: "critical", warn: "high", info: "low",
    };
    const level = levelMap[ev.level] ?? "medium";
    const titleMap: Record<string, string> = {
      alert: "Критический контакт",
      warn:  "Высокая угроза",
      info:  "Системное сообщение",
    };

    const alert: AlertEvent = {
      id:           `feed-${ev.source}-${now}`,
      level,
      title:        titleMap[ev.level] ?? "Событие",
      message:      ev.text,
      source:       ev.source,
      acknowledged: false,
      timestamp:    new Date(),
    };

    const s = getState();
    // Prepend, deduplicate, cap at 50
    s.alerts = [alert, ...s.alerts.filter((a) => a.id !== alert.id)].slice(0, 50);
    notify();
  });

  socket.on("drones:tick", (payload: ApiDrone[]) => {
    const s = getState();
    if (!s.apiConnected) return;
    s.drones = payload.map(normalizeDrone);
    notify();
  });

  socket.on("sensors:tick", (payload: ApiSensor[]) => {
    const s = getState();
    if (!s.apiConnected) return;
    s.sensors = payload.map(normalizeSensor);
    notify();
  });

  socket.on("drone:updated", (payload: ApiDrone) => {
    const s = getState();
    const idx = s.drones.findIndex((d) => d.id === payload.id);
    if (idx !== -1) {
      s.drones = s.drones.map((d) => d.id === payload.id ? normalizeDrone(payload) : d);
    } else {
      s.drones = [...s.drones, normalizeDrone(payload)];
    }
    notify();
  });

  socket.on("ai:pending", ({ action }: { action: AiPendingAction }) => {
    const s = getState();
    s.pendingAiActions = [action, ...s.pendingAiActions.filter((a) => a.id !== action.id)];
    notify();
  });

  socket.on("ai:incident_created", () => {
    incidentsApi
      .list()
      .then((rows) => {
        getState().incidents = rows.map(normalizeIncident);
        notify();
      })
      .catch(() => {});
  });

  // New detection from hardware → prepend to detections list
  socket.on("detection:new", (payload: ApiDetection) => {
    const s = getState();
    const det = normalizeDetection(payload);
    s.detections = [det, ...s.detections.filter((d) => d.id !== det.id)].slice(0, 100);
    notify();
  });

  // Sensor heartbeat/status update
  socket.on("sensor:updated", (payload: { sensorId: string; health?: number; signal?: number; status?: string; lastPing: string }) => {
    const s = getState();
    s.sensors = s.sensors.map((sensor) =>
      sensor.id === payload.sensorId
        ? {
            ...sensor,
            ...(payload.health  != null && { health:  payload.health }),
            ...(payload.signal  != null && { signal:  payload.signal }),
            ...(payload.status  != null && { status:  payload.status as any }),
            lastPing: new Date(payload.lastPing),
          }
        : sensor,
    );
    notify();
  });

  socket.on("disconnect", () => {
    getState().apiConnected = false;
    ensureMockLoop();
  });

  socket.on("connect", () => {
    const s = getState();
    if (!s.apiConnected) {
      s.apiConnected = true;
      if (_mockInterval) {
        clearInterval(_mockInterval);
        _mockInterval = null;
      }
    }
  });
}

// ─── Mock animation loop (fallback when API is down) ──────────
let _mockInterval: ReturnType<typeof setInterval> | null = null;

function ensureMockLoop() {
  if (_mockInterval || typeof window === "undefined") return;
  _mockInterval = setInterval(() => {
    const s = getState();
    if (s.apiConnected) return;
    s.drones = tickDrones(s.drones);
    notify();
  }, 1200);
}

// ─── Public hook ─────────────────────────────────────────────
export function useStore<T>(selector: (s: State) => T): T {
  const [, force] = useState(0);

  useEffect(() => {
    bootstrapFromApi();
    const cb = () => force((n) => n + 1);
    subs.add(cb);
    return () => {
      subs.delete(cb);
    };
  }, []);

  return selector(getState());
}

export function selectIncident(id: string | null) {
  getState().selectedIncidentId = id;
  notify();
}

export function selectDrone(id: string | null) {
  getState().selectedDroneId = id;
  notify();
}

export async function patchDrone(
  id: string,
  data: {
    status?: "tracked" | "intercepted" | "lost" | "neutralized";
    threat?: "low" | "medium" | "high" | "critical";
  },
) {
  await dronesApi.patch(id, data);
  const s = getState();
  s.drones = s.drones.map((d) => (d.id === id ? { ...d, ...data } : d));
  notify();
}

export async function removeDrone(id: string) {
  await dronesApi.delete(id);
  const s = getState();
  s.drones = s.drones.filter((d) => d.id !== id);
  if (s.selectedDroneId === id) s.selectedDroneId = null;
  notify();
}

export function isApiConnected() {
  return getState().apiConnected;
}

export async function createIncident(data: {
  title: string;
  threat: "low" | "medium" | "high" | "critical";
  description?: string;
  assignee?: string;
}) {
  const created = await incidentsApi.create(data);
  const s = getState();
  s.incidents = [normalizeIncident(created), ...s.incidents];
  notify();
  return created;
}

export async function patchIncident(
  id: string,
  data: {
    status?: "open" | "investigating" | "resolved" | "dismissed";
    assignee?: string;
    threat?: "low" | "medium" | "high" | "critical";
    description?: string;
    title?: string;
  },
) {
  const s = getState();
  const prev = s.incidents.find((x) => x.id === id);
  if (!prev) throw new Error("Incident not found");

  // Optimistic update
  s.incidents = s.incidents.map((x) =>
    x.id === id ? { ...x, ...data, updatedAt: new Date() } : x,
  );
  notify();

  try {
    const updated = await incidentsApi.patch(id, data);
    // Sync store with actual server response (authoritative timestamps, etc.)
    s.incidents = s.incidents.map((x) => (x.id === id ? normalizeIncident(updated) : x));
    notify();
  } catch (err) {
    // Roll back optimistic update and surface the error to the caller
    s.incidents = s.incidents.map((x) => (x.id === id ? prev : x));
    notify();
    throw err;
  }
}

export async function acknowledgeAlert(id: string) {
  const s = getState();
  s.alerts = s.alerts.map((a) => (a.id === id ? { ...a, acknowledged: true } : a));
  notify();
  try {
    await alertsApi.acknowledge(id);
  } catch {
    /* ignore */
  }
}

export async function acknowledgeAllAlerts() {
  const s = getState();
  const ids = s.alerts.map((a) => a.id);
  await Promise.allSettled(ids.map((id) => alertsApi.acknowledge(id)));
  // Refetch alerts
  try {
    const fresh = await alertsApi.list();
    s.alerts = fresh.map(normalizeAlert);
    notify();
  } catch {
    /* ignore */
  }
}

export async function patchSensor(
  id: string,
  data: Partial<{
    name: string;
    type: "RF" | "RADAR" | "OPTIC" | "ACOUSTIC";
    lat: number;
    lng: number;
    range: number;
    status: "online" | "degraded" | "offline" | "maintenance";
    health: number;
    signal: number;
    config: Sensor["config"];
  }>,
) {
  const s = getState();
  const prev = s.sensors.find((x) => x.id === id);
  if (!prev) return;

  s.sensors = s.sensors.map((x) => (x.id === id ? { ...x, ...data, lastPing: new Date() } : x));
  notify();

  try {
    const updated = await sensorsApi.patch(id, data);
    s.sensors = s.sensors.map((x) => (x.id === id ? normalizeSensor(updated) : x));
    notify();
  } catch {
    s.sensors = s.sensors.map((x) => (x.id === id ? prev : x));
    notify();
  }
}

export async function createSensor(data: {
  name: string;
  type: "RF" | "RADAR" | "OPTIC" | "ACOUSTIC";
  lat: number;
  lng: number;
  range: number;
  status?: "online" | "degraded" | "offline" | "maintenance";
}): Promise<ApiSensor> {
  const created = await sensorsApi.create(data);
  const s = getState();
  s.sensors = [...s.sensors, normalizeSensor(created)].sort((a, b) => a.name.localeCompare(b.name));
  notify();
  return created;
}

export async function deleteSensor(id: string) {
  const s = getState();
  const snapshot = [...s.sensors];
  s.sensors = s.sensors.filter((x) => x.id !== id);
  notify();
  try {
    await sensorsApi.delete(id);
  } catch {
    s.sensors = snapshot;
    notify();
    throw new Error("Failed to delete sensor");
  }
}

export async function approveAiAction(id: string) {
  const s = getState();
  s.pendingAiActions = s.pendingAiActions.filter((a) => a.id !== id);
  notify();
  await aiEngineApi.approve(id);
  // Refresh incidents in case a new one was created
  try {
    const fresh = await incidentsApi.list();
    s.incidents = fresh.map(normalizeIncident);
    notify();
  } catch {
    /* ignore */
  }
}

export async function rejectAiAction(id: string) {
  const s = getState();
  s.pendingAiActions = s.pendingAiActions.filter((a) => a.id !== id);
  notify();
  await aiEngineApi.reject(id);
}

export function getPendingAiCount(): number {
  return getState().pendingAiActions.length;
}

// ─── Simulation injection ─────────────────────────────────────
export function injectSimDrones(drones: Drone[]) {
  const s = getState();
  const simIds = new Set(drones.map((d) => d.id));
  s.drones = [...s.drones.filter((d) => !simIds.has(d.id)), ...drones];
  notify();
}

export function batchUpdateSimDrones(updates: { id: string; lat: number; lng: number }[]) {
  const s = getState();
  const map = new Map(updates.map((u) => [u.id, u]));
  s.drones = s.drones.map((d) => {
    const u = map.get(d.id);
    return u ? { ...d, lat: u.lat, lng: u.lng } : d;
  });
  notify();
}

export function patchSimDrone(id: string, updates: Partial<Drone>) {
  const s = getState();
  s.drones = s.drones.map((d) => (d.id === id ? { ...d, ...updates } : d));
  notify();
}

export function removeSimDrones(ids: string[]) {
  const s = getState();
  const rmSet = new Set(ids);
  s.drones = s.drones.filter((d) => !rmSet.has(d.id));
  notify();
}

export function injectSimAlert(alert: AlertEvent) {
  const s = getState();
  s.alerts = [alert, ...s.alerts.filter((a) => a.id !== alert.id)].slice(0, 50);
  notify();
}

export function injectSimDetection(det: Detection) {
  const s = getState();
  s.detections = [det, ...s.detections.filter((d) => d.id !== det.id)].slice(0, 100);
  notify();
}

export function applyCalibration(cfg: Partial<CalibrationConfig>) {
  const s = getState();
  s.calibration = { ...s.calibration, ...cfg };
  notify();
}

export function saveCalibration(cfg: CalibrationConfig) {
  try { localStorage.setItem(CAL_STORAGE_KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
  applyCalibration(cfg);
}

export function getCalibration(): CalibrationConfig {
  return getState().calibration;
}
