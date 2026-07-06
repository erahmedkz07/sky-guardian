/**
 * API client for Sky Guardian backend.
 * Falls back gracefully if server is unavailable (mock data stays as fallback in store.ts).
 */

const BASE = `${import.meta.env.VITE_API_URL ?? "http://localhost:3001"}/api`;

function getToken() {
  return sessionStorage.getItem("dds_token");
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, { ...options, headers });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ─── Auth ─────────────────────────────────────────────────────
export const authApi = {
  login: (email: string, password: string) =>
    request<{ token: string; user: ApiUser } | { requiresTwoFactor: true; pendingToken: string }>(
      "/auth/login",
      {
        method: "POST",
        body: JSON.stringify({ email, password }),
      },
    ),

  loginWith2fa: (pendingToken: string, code: string) =>
    request<{ token: string; user: ApiUser }>("/auth/login/2fa", {
      method: "POST",
      body: JSON.stringify({ pendingToken, code }),
    }),

  me: () => request<ApiUser>("/auth/me"),

  logout: () => request<void>("/auth/logout", { method: "POST" }),

  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ message: string }>("/auth/me/password", {
      method: "PATCH",
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
};

export const twoFactorApi = {
  setup: () =>
    request<{ secret: string; qrDataUrl: string }>("/auth/2fa/setup", { method: "POST" }),
  verify: (code: string) =>
    request<{ ok: boolean }>("/auth/2fa/verify", {
      method: "POST",
      body: JSON.stringify({ code }),
    }),
  disable: (code: string) =>
    request<{ ok: boolean }>("/auth/2fa/disable", {
      method: "DELETE",
      body: JSON.stringify({ code }),
    }),
};

// ─── Drones ───────────────────────────────────────────────────
export const dronesApi = {
  list: () => request<ApiDrone[]>("/drones"),
  get: (id: string) => request<ApiDrone>(`/drones/${id}`),
  patch: (id: string, data: Partial<ApiDrone>) =>
    request<ApiDrone>(`/drones/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  delete: (id: string) => request<{ ok: boolean }>(`/drones/${id}`, { method: "DELETE" }),
};

// ─── Sensors ──────────────────────────────────────────────────
export const sensorsApi = {
  list: () => request<ApiSensor[]>("/sensors"),
  get: (id: string) => request<ApiSensor>(`/sensors/${id}`),
  patch: (id: string, data: Partial<ApiSensor & { range: number }>) =>
    request<ApiSensor>(`/sensors/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  create: (data: {
    name: string;
    type: string;
    lat: number;
    lng: number;
    range: number;
    status?: string;
  }) => request<ApiSensor>("/sensors", { method: "POST", body: JSON.stringify(data) }),
  delete: (id: string) => request<{ ok: boolean }>(`/sensors/${id}`, { method: "DELETE" }),
};

// ─── Detections ───────────────────────────────────────────────
export const detectionsApi = {
  list: (limit = 50) => request<ApiDetection[]>(`/detections?limit=${limit}`),
};

// ─── Incidents ────────────────────────────────────────────────
export const incidentsApi = {
  list: () => request<ApiIncident[]>("/incidents"),
  get: (id: string) => request<ApiIncident>(`/incidents/${id}`),
  create: (data: { title: string; threat: string; description?: string; assignee?: string }) =>
    request<ApiIncident>("/incidents", { method: "POST", body: JSON.stringify(data) }),
  patch: (id: string, data: { status?: string; assignee?: string; threat?: string; description?: string; title?: string }) =>
    request<ApiIncident>(`/incidents/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
};

// ─── Alerts ───────────────────────────────────────────────────
export const alertsApi = {
  list: () => request<ApiAlert[]>("/alerts"),
  acknowledge: (id: string) => request<ApiAlert>(`/alerts/${id}/acknowledge`, { method: "PATCH" }),
};

// ─── Geo Zones ────────────────────────────────────────────────
export const geoZonesApi = {
  list: () => request<ApiGeoZone[]>("/geo-zones"),
  create: (data: {
    name: string;
    lat: number;
    lng: number;
    radius: number;
    level: string;
    active: boolean;
  }) => request<ApiGeoZone>("/geo-zones", { method: "POST", body: JSON.stringify(data) }),
  patch: (
    id: string,
    data: Partial<{
      name: string;
      lat: number;
      lng: number;
      radius: number;
      level: string;
      active: boolean;
    }>,
  ) => request<ApiGeoZone>(`/geo-zones/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  delete: (id: string) => request<{ ok: boolean }>(`/geo-zones/${id}`, { method: "DELETE" }),
};

// ─── Team ─────────────────────────────────────────────────────
export const teamApi = {
  list: () => request<ApiUser[]>("/team"),
  invite: (data: {
    name: string;
    email: string;
    role: string;
    clearance: string;
    password: string;
  }) => request<ApiUser>("/team", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: { role?: string; clearance?: string; status?: string }) =>
    request<ApiUser>(`/team/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  remove: (id: string) => request<{ message: string }>(`/team/${id}`, { method: "DELETE" }),
};

// ─── Profile ──────────────────────────────────────────────────
export const profileApi = {
  stats: () => request<ApiProfileStats>("/profile/stats"),

  updateName: (name: string) =>
    request<{ name: string }>("/profile", { method: "PATCH", body: JSON.stringify({ name }) }),

  uploadAvatar: async (file: File): Promise<{ avatarUrl: string }> => {
    const token = sessionStorage.getItem("dds_token");
    const form = new FormData();
    form.append("avatar", file);
    const res = await fetch(`${BASE.replace("/api", "")}/api/profile/avatar`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error ?? `HTTP ${res.status}`);
    }
    return res.json();
  },
};

// ─── Missions ─────────────────────────────────────────────────
export const missionsApi = {
  list: () => request<ApiMission[]>("/missions"),
  create: (data: { name: string; priority?: string; assignee?: string; description?: string }) =>
    request<ApiMission>("/missions", { method: "POST", body: JSON.stringify(data) }),
  patch: (id: string, data: { status?: string; assignee?: string; priority?: string }) =>
    request<ApiMission>(`/missions/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
};

// ─── Audit ────────────────────────────────────────────────────
export const auditApi = {
  list: (limit = 100) => request<ApiAuditLog[]>(`/audit?limit=${limit}`),
  log: (data: { action: string; resource?: string; resourceId?: string; details?: object }) =>
    request<ApiAuditLog>("/audit", { method: "POST", body: JSON.stringify(data) }),
};

// ─── Playbooks ────────────────────────────────────────────────
export const playbooksApi = {
  list: () => request<ApiPlaybook[]>("/playbooks"),
  execute: (id: string) =>
    request<{ ok: boolean; name: string; executedAt: string }>(`/playbooks/${id}/execute`, {
      method: "POST",
    }),
};

// ─── Cameras ──────────────────────────────────────────────────
export const camerasApi = {
  list: () => request<ApiCamera[]>("/cameras"),
};

// ─── Threat Intel ─────────────────────────────────────────────
export const threatIntelApi = {
  list: () => request<ApiThreatIntel[]>("/threat-intel"),
  create: (data: {
    title: string;
    source: string;
    threatLevel: string;
    summary?: string;
    verified?: boolean;
  }) => request<ApiThreatIntel>("/threat-intel", { method: "POST", body: JSON.stringify(data) }),
};

// ─── Types (mirror mockData.ts shapes + extras) ───────────────
export interface ApiUser {
  id: string;
  operatorId: string;
  name: string;
  email: string;
  role: string;
  clearance: string;
  status: string;
  lastActive?: string;
  avatarUrl?: string;
  createdAt?: string;
}

export interface ApiDrone {
  id: string;
  callsign: string;
  model: string;
  lat: number;
  lng: number;
  altitude: number;
  speed: number;
  heading: number;
  threat: "low" | "medium" | "high" | "critical";
  status: "tracked" | "intercepted" | "lost" | "neutralized";
  confidence: number;
  detectedAt: string;
  lastSeen: string;
}

export interface SensorConfig {
  scanMode?: "passive" | "active" | "hybrid";
  detectionThreshold?: number;
  alertSensitivity?: "low" | "normal" | "high" | "critical";
  updateRateS?: number;
  powerMode?: "eco" | "normal" | "performance";
  // RADAR
  prf?: number;
  minRcsM2?: number;
  // RF
  freqBandMhz?: string;
  jammingDetection?: boolean;
  agcEnabled?: boolean;
  // OPTIC
  thermalMode?: boolean;
  nvgMode?: boolean;
  zoomLevel?: number;
  // ACOUSTIC
  gainDb?: number;
  noiseGateDb?: number;
  directional?: boolean;
}

export interface ApiSensor {
  id: string;
  name: string;
  type: "RF" | "RADAR" | "OPTIC" | "ACOUSTIC";
  lat: number;
  lng: number;
  status: "online" | "degraded" | "offline" | "maintenance";
  health: number;
  signal: number;
  range: number;
  lastPing: string;
  config: SensorConfig;
}

export interface ApiDetection {
  id: string;
  droneId: string | null;
  callsign: string;
  model: string;
  threat: "low" | "medium" | "high" | "critical";
  sensorId: string | null;
  sensorName: string;
  timestamp: string;
  lat: number;
  lng: number;
  confidence: number;
  notes: string | null;
}

export interface ApiIncident {
  id: string;
  code: string;
  title: string;
  threat: "low" | "medium" | "high" | "critical";
  status: "open" | "investigating" | "resolved" | "dismissed";
  assignee: string | null;
  createdAt: string;
  updatedAt: string;
  description: string | null;
  detectionIds: string[];
  lat: number | null;
  lng: number | null;
}

export interface ApiAlert {
  id: string;
  level: "low" | "medium" | "high" | "critical";
  title: string;
  message: string;
  timestamp: string;
  source: string;
  acknowledged: boolean;
}

export interface ApiGeoZone {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radius: number;
  level: "low" | "medium" | "high" | "critical";
  active: boolean;
}

export interface ApiMission {
  id: string;
  code: string;
  name: string;
  status: string;
  priority: string;
  assignee: string | null;
  description: string | null;
  startTime: string | null;
  endTime: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApiAuditLog {
  id: string;
  userId: string | null;
  operatorName: string | null;
  action: string;
  resource: string | null;
  resourceId: string | null;
  details: unknown;
  timestamp: string;
}

export interface ApiPlaybook {
  id: string;
  name: string;
  threatLevel: string;
  steps: { order: number; action: string; responsible: string }[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ApiCamera {
  id: string;
  name: string;
  lat: number;
  lng: number;
  status: string;
  feedUrl: string | null;
  createdAt: string;
}

export interface ApiThreatIntel {
  id: string;
  title: string;
  source: string;
  threatLevel: string;
  summary: string | null;
  verified: boolean;
  createdAt: string;
}

export interface ApiProfileStats {
  user: ApiUser & { createdAt: string; lastActive: string | null; avatarUrl: string | null };
  stats: {
    totalDetections: number;
    assignedIncidents: number;
    closedIncidents: number;
    auditActions: number;
  };
}

export interface ApiAnalyticsSummary {
  detections7d: number;
  prev7d: number;
  critical7d: number;
  openIncidents: number;
  modelDist: { name: string; value: number }[];
  threatDist: { name: string; value: number }[];
}

export interface ApiDailyDetection {
  day: string;
  detections: number;
  threats: number;
  critical: number;
}

export interface ApiDailyIncident {
  day: string;
  incidents: number;
  resolved: number;
}

export interface ApiReportsSummary {
  detections: number;
  incidents: number;
  auditActions: number;
}

export interface ApiSimResult {
  id: string;
  userId: string | null;
  operatorName: string | null;
  scenarioId: string;
  scenarioName: string;
  difficulty: string;
  score: number;
  neutralized: number;
  threats: number;
  elapsedS: number;
  aborted: boolean;
  completedAt: string;
}

// ─── AI Engine ────────────────────────────────────────────────
export const aiEngineApi = {
  getSettings: () => request<AiEngineSettings>("/ai-engine/settings"),

  patchSettings: (data: Partial<AiEngineSettings>) =>
    request<AiEngineSettings>("/ai-engine/settings", {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  listPending: () => request<AiPendingAction[]>("/ai-engine/pending"),

  listHistory: () => request<AiPendingAction[]>("/ai-engine/history"),

  approve: (id: string) =>
    request<{ ok: boolean }>(`/ai-engine/pending/${id}/approve`, { method: "POST" }),

  reject: (id: string) =>
    request<{ ok: boolean }>(`/ai-engine/pending/${id}/reject`, { method: "POST" }),

  evaluate: () =>
    request<{ ok: boolean; timestamp: string }>("/ai-engine/evaluate", { method: "POST" }),

  analyze: () =>
    request<AiAnalysisResult>("/ai-engine/analyze", { method: "POST" }),

  createPending: (data: { actionType: string; payload: Record<string, unknown>; reason: string; confidence: number }) =>
    request<AiPendingAction>("/ai-engine/pending", { method: "POST", body: JSON.stringify(data) }),
};

export interface AiAnalysisResult {
  threatLevel: "low" | "medium" | "high" | "critical";
  summary: string;
  observations: string[];
  recommendations: string[];
  actions: Array<{
    type: string;
    priority: "high" | "medium" | "low";
    description: string;
    confidence: number;
  }>;
  timestamp: string;
  source?: "claude" | "fallback";
}

export interface AiEngineSettings {
  opMode: "passive" | "advisory" | "autonomous";
  autoIncident: boolean;
  autoAck: boolean;
  autoPlaybook: boolean;
  globalMinConfidence: number;
  modelSettings: Record<string, { enabled: boolean; threshold: number }>;
}

export interface AiPendingAction {
  id: string;
  actionType: string;
  payload: Record<string, unknown>;
  reason: string;
  confidence: number;
  status: "pending" | "approved" | "rejected";
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

// ─── Simulations ─────────────────────────────────────────────
export const simulationsApi = {
  list: () => request<ApiSimResult[]>("/simulations"),
  save: (data: {
    scenarioId: string;
    scenarioName: string;
    difficulty: string;
    score: number;
    neutralized: number;
    threats: number;
    elapsedS: number;
    aborted: boolean;
  }) => request<ApiSimResult>("/simulations", { method: "POST", body: JSON.stringify(data) }),
  delete: (id: string) => request<{ ok: boolean }>(`/simulations/${id}`, { method: "DELETE" }),
};

// ─── Analytics ────────────────────────────────────────────────
export const analyticsApi = {
  summary: () => request<ApiAnalyticsSummary>("/analytics/summary"),
  detections: (days = 14) => request<ApiDailyDetection[]>(`/analytics/detections?days=${days}`),
  incidents: (days = 14) => request<ApiDailyIncident[]>(`/analytics/incidents?days=${days}`),
};

// ─── Reports ──────────────────────────────────────────────────
export const telegramApi = {
  status:  () => request<{ linked: boolean }>("/telegram/status"),
  botInfo: () => request<{ configured: boolean; username: string | null }>("/telegram/bot-info"),
  link:    (code: string) => request<{ ok: boolean }>("/telegram/link", { method: "POST", body: JSON.stringify({ code }) }),
  unlink:  () => request<{ ok: boolean }>("/telegram/unlink", { method: "DELETE" }),
};

export const reportsApi = {
  summary: () => request<ApiReportsSummary>("/reports/summary"),
  download: async (type: "detections" | "incidents" | "sensors" | "audit", days = 30) => {
    const token = sessionStorage.getItem("dds_token");
    const res = await fetch(`${BASE}/reports/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ type, days }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const cd = res.headers.get("Content-Disposition") ?? "";
    const filename = cd.match(/filename="([^"]+)"/)?.[1] ?? `${type}.csv`;
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },
};
