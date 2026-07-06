// Mock data layer for DDS — drones, sensors, detections, incidents, alerts.

export type ThreatLevel = "low" | "medium" | "high" | "critical";
export type DroneStatus = "tracked" | "intercepted" | "lost" | "neutralized";
export type SensorStatus = "online" | "degraded" | "offline" | "maintenance";
export type IncidentStatus = "open" | "investigating" | "resolved" | "dismissed";

export interface Drone {
  id: string;
  callsign: string;
  model: string;
  lat: number;
  lng: number;
  altitude: number; // meters
  speed: number; // km/h
  heading: number; // degrees
  threat: ThreatLevel;
  status: DroneStatus;
  detectedAt: Date;
  confidence: number; // 0-1
  // simulation deltas
  vLat: number;
  vLng: number;
}

export interface SensorConfig {
  scanMode?: "passive" | "active" | "hybrid";
  detectionThreshold?: number;
  alertSensitivity?: "low" | "normal" | "high" | "critical";
  updateRateS?: number;
  powerMode?: "eco" | "normal" | "performance";
  prf?: number;
  minRcsM2?: number;
  freqBandMhz?: string;
  jammingDetection?: boolean;
  agcEnabled?: boolean;
  thermalMode?: boolean;
  nvgMode?: boolean;
  zoomLevel?: number;
  gainDb?: number;
  noiseGateDb?: number;
  directional?: boolean;
}

export interface Sensor {
  id: string;
  name: string;
  type: "RF" | "RADAR" | "OPTIC" | "ACOUSTIC";
  lat: number;
  lng: number;
  status: SensorStatus;
  health: number;
  signal: number;
  range: number;
  lastPing: Date;
  config: SensorConfig;
}

export interface Detection {
  id: string;
  droneId: string;
  callsign: string;
  model: string;
  threat: ThreatLevel;
  sensorId: string;
  sensorName: string;
  timestamp: Date;
  lat: number;
  lng: number;
  confidence: number;
  notes?: string;
}

export interface Incident {
  id: string;
  code: string;
  title: string;
  threat: ThreatLevel;
  status: IncidentStatus;
  assignee: string;
  createdAt: Date;
  updatedAt: Date;
  description: string;
  detectionIds: string[];
  lat?: number;
  lng?: number;
}

export interface AlertEvent {
  id: string;
  level: ThreatLevel;
  title: string;
  message: string;
  timestamp: Date;
  source: string;
  acknowledged: boolean;
}

// Centered around a fictional perimeter
const CENTER = { lat: 51.18, lng: 71.446 }; // Astana

// Deterministic PRNG so SSR and client produce identical initial mock data
// (prevents React hydration mismatch errors).
let _seed = 1337;
function srand(): number {
  _seed = (_seed * 9301 + 49297) % 233280;
  return _seed / 233280;
}
export function resetMockSeed(seed = 1337) {
  _seed = seed;
}
const rand = (min: number, max: number) => min + srand() * (max - min);
const randInt = (min: number, max: number) => Math.floor(rand(min, max + 1));
const pick = <T>(arr: T[]): T => arr[Math.floor(srand() * arr.length)];

const droneModels = [
  "DJI Mavic 3",
  "Autel EVO II",
  "Skydio X10",
  "Bayraktar TB2",
  "Shahed-136",
  "Switchblade 600",
  "Quantum Vector",
  "Parrot Anafi",
];

const callsigns = [
  "RAVEN",
  "VIPER",
  "GHOST",
  "WRAITH",
  "PHANTOM",
  "REAPER",
  "HORNET",
  "FALCON",
  "OWL",
  "SHRIKE",
  "KESTREL",
  "HYDRA",
];

const operators = ["Syrym Argyn"];

export function makeDrones(n = 8): Drone[] {
  return Array.from({ length: n }, (_, i) => {
    const lat = CENTER.lat + rand(-0.18, 0.18);
    const lng = CENTER.lng + rand(-0.25, 0.25);
    const heading = rand(0, 360);
    const speed = rand(35, 180);
    const threat = pick<ThreatLevel>(["low", "low", "medium", "medium", "high", "critical"]);
    return {
      id: `DRN-${String(i + 1).padStart(4, "0")}`,
      callsign: `${pick(callsigns)}-${randInt(10, 99)}`,
      model: pick(droneModels),
      lat,
      lng,
      altitude: randInt(40, 1200),
      speed,
      heading,
      threat,
      status: pick<DroneStatus>(["tracked", "tracked", "tracked", "intercepted", "lost"]),
      detectedAt: new Date(Date.now() - randInt(30, 3600) * 1000),
      confidence: rand(0.62, 0.99),
      vLat: Math.cos((heading * Math.PI) / 180) * 0.00012 * (speed / 80),
      vLng: Math.sin((heading * Math.PI) / 180) * 0.00012 * (speed / 80),
    };
  });
}

export function tickDrones(drones: Drone[]): Drone[] {
  return drones.map((d) => {
    if (d.status === "neutralized" || d.status === "lost") return d;
    const lat = d.lat + d.vLat;
    const lng = d.lng + d.vLng;
    let { vLat, vLng, heading } = d;

    // Bounce off perimeter
    if (Math.abs(lat - CENTER.lat) > 0.22) {
      vLat = -vLat;
      heading = (heading + 180) % 360;
    }
    if (Math.abs(lng - CENTER.lng) > 0.3) {
      vLng = -vLng;
      heading = (heading + 180) % 360;
    }

    // Small jitter
    if (Math.random() < 0.05) {
      const jitter = rand(-15, 15);
      heading = (heading + jitter + 360) % 360;
      const sp = d.speed;
      vLat = Math.cos((heading * Math.PI) / 180) * 0.00012 * (sp / 80);
      vLng = Math.sin((heading * Math.PI) / 180) * 0.00012 * (sp / 80);
    }

    return { ...d, lat, lng, vLat, vLng, heading };
  });
}

const DEFAULT_SENSOR_CONFIG: Record<string, SensorConfig> = {
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

export function makeSensors(): Sensor[] {
  const positions = [
    { name: "ALPHA-01", type: "RADAR" as const, dx: -0.12, dy: -0.05 },
    { name: "BRAVO-02", type: "RF" as const, dx: 0.14, dy: 0.07 },
    { name: "CHARLIE-03", type: "OPTIC" as const, dx: 0.02, dy: 0.16 },
    { name: "DELTA-04", type: "ACOUSTIC" as const, dx: -0.18, dy: 0.12 },
    { name: "ECHO-05", type: "RADAR" as const, dx: 0.2, dy: -0.14 },
    { name: "FOXTROT-06", type: "RF" as const, dx: -0.05, dy: -0.18 },
  ];
  return positions.map((p, i) => ({
    id: `SNS-${String(i + 1).padStart(3, "0")}`,
    name: p.name,
    type: p.type,
    lat: CENTER.lat + p.dy,
    lng: CENTER.lng + p.dx,
    status: pick<SensorStatus>(["online", "online", "online", "online", "degraded", "maintenance"]),
    health: randInt(62, 99),
    signal: randInt(55, 99),
    range: randInt(8, 22),
    lastPing: new Date(Date.now() - randInt(2, 240) * 1000),
    config: { ...DEFAULT_SENSOR_CONFIG[p.type]! },
  }));
}

export function makeDetections(drones: Drone[], sensors: Sensor[], n = 30): Detection[] {
  return Array.from({ length: n }, (_, i) => {
    const d = pick(drones);
    const s = pick(sensors);
    return {
      id: `DET-${String(i + 1).padStart(5, "0")}`,
      droneId: d.id,
      callsign: d.callsign,
      model: d.model,
      threat: d.threat,
      sensorId: s.id,
      sensorName: s.name,
      timestamp: new Date(Date.now() - randInt(60, 86400) * 1000),
      lat: d.lat + rand(-0.02, 0.02),
      lng: d.lng + rand(-0.02, 0.02),
      confidence: rand(0.55, 0.99),
      notes: Math.random() < 0.3 ? "Loitering pattern detected" : undefined,
    };
  }).sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
}

export function makeIncidents(detections: Detection[]): Incident[] {
  const titles = [
    "Unauthorized incursion at perimeter",
    "Suspected swarm formation detected",
    "Repeat offender — RF signature match",
    "Loitering object near restricted zone",
    "High-speed approach vector",
    "Low-altitude crossing",
    "Signal jamming attempt",
  ];
  return Array.from({ length: 7 }, (_, i) => {
    const det = pick(detections);
    return {
      id: `INC-${String(i + 1).padStart(4, "0")}`,
      code: `OP-${1000 + i}`,
      title: titles[i % titles.length],
      threat: det.threat,
      status: pick<IncidentStatus>([
        "open",
        "open",
        "investigating",
        "investigating",
        "resolved",
        "dismissed",
      ]),
      assignee: pick(operators),
      createdAt: new Date(Date.now() - randInt(300, 86400 * 3) * 1000),
      updatedAt: new Date(Date.now() - randInt(60, 3600) * 1000),
      description:
        "Cross-referenced with sensor cluster. Awaiting visual confirmation and engagement decision.",
      detectionIds: [det.id],
      lat: det.lat,
      lng: det.lng,
    };
  });
}

export function makeAlerts(): AlertEvent[] {
  const samples: Omit<AlertEvent, "id" | "timestamp">[] = [
    {
      level: "critical",
      title: "PERIMETER BREACH",
      message: "Hostile signature crossed inner ring at 11:42:08",
      source: "ALPHA-01",
      acknowledged: false,
    },
    {
      level: "high",
      title: "SWARM DETECTED",
      message: "Cluster of 4+ contacts moving in formation",
      source: "BRAVO-02",
      acknowledged: false,
    },
    {
      level: "medium",
      title: "RF ANOMALY",
      message: "Unidentified 5.8GHz emission from grid 14-C",
      source: "FOXTROT-06",
      acknowledged: false,
    },
    {
      level: "high",
      title: "JAMMING ATTEMPT",
      message: "GPS spoofing pattern detected",
      source: "ECHO-05",
      acknowledged: true,
    },
    {
      level: "low",
      title: "BIRD STRIKE FILTER",
      message: "12 false positives auto-dismissed",
      source: "AI-CORE",
      acknowledged: true,
    },
    {
      level: "critical",
      title: "AI RECOMMENDATION",
      message: "Engage countermeasures on RAVEN-42",
      source: "AI-CORE",
      acknowledged: false,
    },
    {
      level: "medium",
      title: "SENSOR DEGRADED",
      message: "DELTA-04 health dropped to 68%",
      source: "SYS-MON",
      acknowledged: true,
    },
  ];
  return samples.map((s, i) => ({
    ...s,
    id: `ALT-${i + 1}`,
    timestamp: new Date(Date.now() - randInt(10, 1800) * 1000),
    acknowledged: false,
  }));
}

export const PATROL_CENTER = CENTER;
export const RESTRICTED_ZONES: Array<{
  id: string;
  name: string;
  lat: number;
  lng: number;
  radius: number;
  level: ThreatLevel;
}> = [
  {
    id: "GZ-01",
    name: "AIRBASE PRIMARY",
    lat: CENTER.lat + 0.04,
    lng: CENTER.lng - 0.02,
    radius: 3500,
    level: "critical",
  },
  {
    id: "GZ-02",
    name: "COMMS ARRAY",
    lat: CENTER.lat - 0.08,
    lng: CENTER.lng + 0.11,
    radius: 1800,
    level: "high",
  },
  {
    id: "GZ-03",
    name: "FUEL DEPOT",
    lat: CENTER.lat + 0.09,
    lng: CENTER.lng + 0.14,
    radius: 1200,
    level: "high",
  },
];
