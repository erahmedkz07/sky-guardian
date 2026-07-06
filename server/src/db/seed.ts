/**
 * Seed script — populates PostgreSQL with realistic historical data.
 * Run with: npm run seed
 */
import { db } from "./client.js";
import {
  users, sensors, drones, detections, incidents,
  incidentDetections, alertEvents, geoZones, missions,
  playbooks, cameras, threatIntel, auditLogs,
} from "./schema.js";
import bcrypt from "bcryptjs";
import "dotenv/config";

// ─── Seeded PRNG ───────────────────────────────────────────────
let _seed = 1337;
function srand() { _seed = (_seed * 9301 + 49297) % 233280; return _seed / 233280; }
const rand    = (min: number, max: number) => min + srand() * (max - min);
const randInt = (min: number, max: number) => Math.floor(rand(min, max + 1));
const pick    = <T,>(arr: readonly T[]): T => arr[Math.floor(srand() * arr.length)];

// ─── Timestamp helpers ─────────────────────────────────────────
/** Returns a Date exactly `daysBack` days ago, randomised within that calendar day */
function tsDay(daysBack: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  d.setHours(randInt(0, 23), randInt(0, 59), randInt(0, 59), 0);
  return d;
}

/** Returns a Date between `minDays` and `maxDays` ago */
function tsRange(minDays: number, maxDays: number): Date {
  const daysBack = rand(minDays, maxDays);
  const d = new Date();
  d.setTime(d.getTime() - daysBack * 86_400_000);
  return d;
}

const CENTER = { lat: 51.180, lng: 71.446 }; // Astana

const droneModels  = ["DJI Mavic 3","Autel EVO II","Skydio X10","Bayraktar TB2","Shahed-136","Switchblade 600","Quantum Vector","Parrot Anafi"];
const callsigns    = ["RAVEN","VIPER","GHOST","WRAITH","PHANTOM","REAPER","HORNET","FALCON","OWL","SHRIKE","KESTREL","HYDRA"];
const operators    = ["Syrym Argyn"];
const threatLevels = ["low","low","medium","medium","high","critical"] as const;

// ─── Clean volatile tables before re-seeding ──────────────────
async function cleanVolatile() {
  console.log("  → Clearing old detections / incidents / audit logs...");
  await db.delete(incidentDetections);
  await db.delete(incidents);
  await db.delete(detections);
  await db.delete(auditLogs);
}

// ─── Users ────────────────────────────────────────────────────
async function seedUsers() {
  console.log("  → Seeding users...");
  const adminHash = await bcrypt.hash("cnb2026", 10);

  await db.insert(users).values([
    { operatorId: "OP-00001", name: "Syrym Argyn", email: "cnb@dds.kz", passwordHash: adminHash, role: "admin", clearance: "TOP SECRET", status: "online" },
  ]).onConflictDoUpdate({
    target: users.email,
    set: { name: "Syrym Argyn", role: "admin", clearance: "TOP SECRET", status: "online" },
  });
}

// ─── Sensors ──────────────────────────────────────────────────
async function seedSensors() {
  console.log("  → Seeding sensors...");
  const positions = [
    { name: "ALPHA-01",   type: "RADAR"    as const, dx: -0.12, dy: -0.05 },
    { name: "BRAVO-02",   type: "RF"       as const, dx:  0.14, dy:  0.07 },
    { name: "CHARLIE-03", type: "OPTIC"    as const, dx:  0.02, dy:  0.16 },
    { name: "DELTA-04",   type: "ACOUSTIC" as const, dx: -0.18, dy:  0.12 },
    { name: "ECHO-05",    type: "RADAR"    as const, dx:  0.2,  dy: -0.14 },
    { name: "FOXTROT-06", type: "RF"       as const, dx: -0.05, dy: -0.18 },
  ];

  await db.insert(sensors).values(
    positions.map((p, i) => ({
      id:       `SNS-${String(i + 1).padStart(3, "0")}`,
      name:     p.name,
      type:     p.type,
      lat:      CENTER.lat + p.dy,
      lng:      CENTER.lng + p.dx,
      status:   pick(["online","online","online","online","degraded","maintenance"] as const),
      health:   randInt(62, 99),
      signal:   randInt(55, 99),
      rangeKm:  randInt(8, 22),
      lastPing: new Date(Date.now() - randInt(2, 240) * 1000),
    }))
  ).onConflictDoNothing();
}

// ─── Drones ───────────────────────────────────────────────────
async function seedDrones() {
  console.log("  → Seeding drones...");
  const droneStatusArr = ["tracked","tracked","tracked","intercepted","lost"] as const;

  const droneRows = Array.from({ length: 10 }, (_, i) => ({
    id:         `DRN-${String(i + 1).padStart(4, "0")}`,
    callsign:   `${pick(callsigns)}-${randInt(10, 99)}`,
    model:      pick(droneModels),
    lat:        CENTER.lat + rand(-0.18, 0.18),
    lng:        CENTER.lng + rand(-0.25, 0.25),
    altitudeM:  randInt(40, 1200),
    speedKmh:   rand(35, 180),
    headingDeg: rand(0, 360),
    threat:     pick(threatLevels),
    status:     pick(droneStatusArr),
    confidence: rand(0.62, 0.99),
    detectedAt: new Date(Date.now() - randInt(30, 3600) * 1000),
    lastSeen:   new Date(),
  }));

  await db.insert(drones).values(droneRows).onConflictDoNothing();
  return droneRows;
}

// ─── Detections — 150 entries spread over 30 days ─────────────
async function seedDetections(droneRows: { id: string; callsign: string; model: string; threat: "low" | "medium" | "high" | "critical" }[]) {
  console.log("  → Seeding detections (150 entries · 30 days)...");
  const sensorIds   = ["SNS-001","SNS-002","SNS-003","SNS-004","SNS-005","SNS-006"];
  const noteOptions = [
    "Loitering pattern detected",
    "RF signature matched known threat",
    "Crossing restricted zone perimeter",
    "Low-altitude stealth profile",
    "Erratic heading changes",
    "Formation flight detected",
    null, null, null,        // ~33 % no note
  ] as const;

  // 150 detections: 5 per day × 30 days (bucket approach → guaranteed coverage)
  const detectionRows = Array.from({ length: 150 }, (_, i) => {
    const d        = pick(droneRows);
    const si       = randInt(0, 5);
    // Bucket by day: i=0..4 → 29 days ago, i=145..149 → today
    const daysBack = 29 - Math.floor(i / 5);
    return {
      id:         `DET-${String(i + 1).padStart(5, "0")}`,
      droneId:    d.id,
      sensorId:   sensorIds[si],
      callsign:   d.callsign,
      model:      d.model,
      threat:     d.threat,
      lat:        CENTER.lat + rand(-0.18, 0.18),
      lng:        CENTER.lng + rand(-0.25, 0.25),
      confidence: rand(0.55, 0.99),
      notes:      pick(noteOptions),
      timestamp:  tsDay(daysBack),
    };
  });

  await db.insert(detections).values(detectionRows);
  return detectionRows;
}

// ─── Incidents — 15 entries spread over 30 days ───────────────
async function seedIncidents(detectionRows: { id: string; threat: "low" | "medium" | "high" | "critical" }[]) {
  console.log("  → Seeding incidents (15 entries · 30 days)...");
  const titles = [
    "Unauthorized incursion at perimeter",
    "Suspected swarm formation detected",
    "Repeat offender — RF signature match",
    "Loitering object near restricted zone",
    "High-speed approach vector",
    "Low-altitude crossing",
    "Signal jamming attempt",
    "GPS spoofing detected in grid 14-C",
    "Multi-contact coordinated ingress",
    "Drone dropped payload near COMMS ARRAY",
    "Night operation — stealth profile",
    "Airspace violation — civilian sector",
    "RF anomaly during sensor maintenance window",
    "Formation of 3 contacts dispersed after intercept",
    "Unknown contact — ID unresolved after 12h",
  ];
  const incidentStatuses = ["open","open","open","investigating","investigating","resolved","dismissed"] as const;

  const incidentRows = Array.from({ length: 15 }, (_, i) => {
    const det       = pick(detectionRows);
    const daysBack  = 29 - Math.floor(i * 2);   // 2-day spacing → day 29 down to day 1
    const createdAt = tsDay(Math.max(0, daysBack));
    const updatedAt = new Date(createdAt.getTime() + randInt(3600, 86400) * 1000);
    return {
      id:          `INC-${String(i + 1).padStart(4, "0")}`,
      code:        `OP-${1000 + i}`,
      title:       titles[i % titles.length],
      threat:      det.threat,
      status:      pick(incidentStatuses),
      assignee:    pick(operators),
      description: "Cross-referenced with sensor cluster. Awaiting visual confirmation and engagement decision.",
      createdAt,
      updatedAt,
    };
  });

  await db.insert(incidents).values(incidentRows);

  const links = incidentRows.map((inc, i) => ({
    incidentId:  inc.id,
    detectionId: detectionRows[i % detectionRows.length].id,
  }));
  await db.insert(incidentDetections).values(links);
}

// ─── Alerts ───────────────────────────────────────────────────
async function seedAlerts() {
  console.log("  → Seeding alert events...");
  await db.insert(alertEvents).values([
    { id: "ALT-1", level: "critical", title: "PERIMETER BREACH",   message: "Hostile signature crossed inner ring at 11:42:08", source: "ALPHA-01",   acknowledged: false, timestamp: new Date(Date.now() - randInt(10,  300) * 1000) },
    { id: "ALT-2", level: "high",     title: "SWARM DETECTED",     message: "Cluster of 4+ contacts moving in formation",       source: "BRAVO-02",   acknowledged: false, timestamp: new Date(Date.now() - randInt(10,  600) * 1000) },
    { id: "ALT-3", level: "medium",   title: "RF ANOMALY",         message: "Unidentified 5.8GHz emission from grid 14-C",      source: "FOXTROT-06", acknowledged: false, timestamp: new Date(Date.now() - randInt(10,  900) * 1000) },
    { id: "ALT-4", level: "high",     title: "JAMMING ATTEMPT",    message: "GPS spoofing pattern detected",                    source: "ECHO-05",    acknowledged: true,  timestamp: new Date(Date.now() - randInt(10, 1200) * 1000) },
    { id: "ALT-5", level: "low",      title: "BIRD STRIKE FILTER", message: "12 false positives auto-dismissed",                source: "AI-CORE",    acknowledged: true,  timestamp: new Date(Date.now() - randInt(10, 1800) * 1000) },
    { id: "ALT-6", level: "critical", title: "AI RECOMMENDATION",  message: "Engage countermeasures on RAVEN-42",               source: "AI-CORE",    acknowledged: false, timestamp: new Date(Date.now() - randInt(10,  400) * 1000) },
    { id: "ALT-7", level: "medium",   title: "SENSOR DEGRADED",    message: "DELTA-04 health dropped to 68%",                   source: "SYS-MON",    acknowledged: true,  timestamp: new Date(Date.now() - randInt(10,  600) * 1000) },
  ]).onConflictDoUpdate({
    target: alertEvents.id,
    set: { acknowledged: false },
  });
}

// ─── Geo Zones ────────────────────────────────────────────────
async function seedGeoZones() {
  console.log("  → Seeding geo zones...");
  const zoneRows = [
    { id: "GZ-01", name: "NUR-SULTAN INTL AIRPORT", lat: 51.022, lng: 71.467, radiusM: 5000, threat: "critical" as const },
    { id: "GZ-02", name: "AKORDA PALACE",            lat: 51.180, lng: 71.446, radiusM: 2000, threat: "critical" as const },
    { id: "GZ-03", name: "BAYTEREK MONUMENT",        lat: 51.128, lng: 71.430, radiusM: 1500, threat: "high"     as const },
  ];
  for (const z of zoneRows) {
    await db.insert(geoZones).values(z).onConflictDoUpdate({
      target: geoZones.id,
      set: { name: z.name, lat: z.lat, lng: z.lng, radiusM: z.radiusM, threat: z.threat },
    });
  }
}

// ─── Missions ─────────────────────────────────────────────────
async function seedMissions() {
  console.log("  → Seeding missions...");
  await db.insert(missions).values([
    { id: "MSN-001", code: "MSN-2401", name: "PERIMETER SWEEP — SECTOR 7",   status: "active",    priority: "high",     assignee: "Syrym Argyn", description: "Continuous scan of eastern sector perimeter." },
    { id: "MSN-002", code: "MSN-2402", name: "RF SIGNATURE COLLECTION",       status: "active",    priority: "medium",   assignee: "Syrym Argyn", description: "Passive collection of RF signatures from unknown contacts." },
    { id: "MSN-003", code: "MSN-2403", name: "SWARM INTERCEPT — GRID 14-C",   status: "planned",   priority: "critical", assignee: "Syrym Argyn", description: "Deploy countermeasures on confirmed swarm formation." },
    { id: "MSN-004", code: "MSN-2404", name: "SENSOR CALIBRATION — DELTA-04", status: "completed", priority: "low",      assignee: "Syrym Argyn", description: "Health restoration after degraded status event." },
    { id: "MSN-005", code: "MSN-2405", name: "THREAT ASSESSMENT — RAVEN-42",  status: "active",    priority: "high",     assignee: "Syrym Argyn", description: "Full threat classification and engagement recommendation." },
  ]).onConflictDoUpdate({ target: missions.id, set: { assignee: "Syrym Argyn" } });
}

// ─── Playbooks ────────────────────────────────────────────────
async function seedPlaybooks() {
  console.log("  → Seeding playbooks...");
  await db.insert(playbooks).values([
    {
      name: "CRITICAL INCURSION RESPONSE", threatLevel: "critical",
      steps: [
        { order: 1, action: "Activate perimeter alarm",               responsible: "Operator on duty" },
        { order: 2, action: "Notify command authority",               responsible: "Senior Operator"  },
        { order: 3, action: "Lock AI countermeasure on target",       responsible: "AI-CORE"          },
        { order: 4, action: "Request engagement authorization",       responsible: "Admin"            },
        { order: 5, action: "Execute neutralization if authorized",   responsible: "Senior Operator"  },
        { order: 6, action: "File incident report within 30 min",     responsible: "Analyst"          },
      ],
    },
    {
      name: "RF ANOMALY INVESTIGATION", threatLevel: "medium",
      steps: [
        { order: 1, action: "Identify emission frequency and grid",            responsible: "Analyst"         },
        { order: 2, action: "Cross-reference RF signature database",           responsible: "AI-CORE"         },
        { order: 3, action: "Dispatch optical sensor to confirm",              responsible: "Operator"        },
        { order: 4, action: "Escalate if military-grade jamming confirmed",    responsible: "Senior Operator" },
      ],
    },
    {
      name: "SWARM DETECTION PROTOCOL", threatLevel: "high",
      steps: [
        { order: 1, action: "Confirm swarm count (4+ contacts)",     responsible: "AI-CORE"         },
        { order: 2, action: "Activate all RADAR sensors",            responsible: "Operator"        },
        { order: 3, action: "Calculate intercept trajectories",      responsible: "AI-CORE"         },
        { order: 4, action: "Alert all operators on duty",           responsible: "Senior Operator" },
        { order: 5, action: "Initiate electronic countermeasures",   responsible: "Admin"           },
      ],
    },
    {
      name: "SENSOR DEGRADATION RECOVERY", threatLevel: "low",
      steps: [
        { order: 1, action: "Identify degraded sensor and cause",               responsible: "Analyst"  },
        { order: 2, action: "Redirect coverage to adjacent sensors",            responsible: "Operator" },
        { order: 3, action: "Schedule maintenance crew",                        responsible: "Senior Operator" },
        { order: 4, action: "Verify recovery via health metric > 85%",          responsible: "Operator" },
      ],
    },
  ]).onConflictDoNothing();
}

// ─── Cameras ──────────────────────────────────────────────────
async function seedCameras() {
  console.log("  → Seeding cameras...");
  await db.insert(cameras).values([
    { id: "CAM-001", name: "NORTH GATE — PTZ",     lat: CENTER.lat + 0.15, lng: CENTER.lng - 0.10, status: "online"   },
    { id: "CAM-002", name: "EAST PERIMETER",        lat: CENTER.lat + 0.05, lng: CENTER.lng + 0.20, status: "online"   },
    { id: "CAM-003", name: "SOUTH TOWER — THERMAL", lat: CENTER.lat - 0.14, lng: CENTER.lng + 0.03, status: "online"   },
    { id: "CAM-004", name: "WEST APPROACH",         lat: CENTER.lat - 0.03, lng: CENTER.lng - 0.22, status: "degraded" },
    { id: "CAM-005", name: "AIRBASE PRIMARY — IR",  lat: CENTER.lat + 0.04, lng: CENTER.lng - 0.02, status: "online"   },
    { id: "CAM-006", name: "COMMS ARRAY — OPTIC",   lat: CENTER.lat - 0.08, lng: CENTER.lng + 0.11, status: "offline"  },
  ]).onConflictDoNothing();
}

// ─── Threat Intel ─────────────────────────────────────────────
async function seedThreatIntel() {
  console.log("  → Seeding threat intel...");
  await db.insert(threatIntel).values([
    { title: "Bayraktar TB2 Activity Spike",           source: "SIGINT-7",   threatLevel: "high",     summary: "Increased TB2 activity reported 80km north of patrol zone. Likely reconnaissance pattern.", verified: true  },
    { title: "Shahed-136 RF Signature Library Update", source: "AI-CORE",    threatLevel: "critical", summary: "New RF variants detected. Signature database updated with 14 new fingerprints.",            verified: true  },
    { title: "GPS Spoofing Vector — 1575.42 MHz",      source: "FOXTROT-06", threatLevel: "high",     summary: "Spoofing attempts at 1575.42 MHz detected in grid 14-C. Source triangulation pending.",     verified: false },
    { title: "Commercial Drone Modification Pattern",  source: "HUMINT",     threatLevel: "medium",   summary: "DJI Mavic 3 units being modified with military payloads. Visual ID protocol updated.",       verified: true  },
    { title: "Night Operation — Low Altitude Profile", source: "ALPHA-01",   threatLevel: "medium",   summary: "Sub-50m flight profiles observed 02:00–04:00 UTC. RADAR coverage gap identified.",           verified: false },
  ]).onConflictDoNothing();
}

// ─── Audit Logs — 50 historical operator actions ──────────────
async function seedAuditLogs() {
  console.log("  → Seeding audit logs (50 entries · 30 days)...");

  const actions: { action: string; resource: string; detail: object }[] = [
    { action: "LOGIN",             resource: "auth",        detail: { method: "password" } },
    { action: "PLAYBOOK_EXECUTE",  resource: "playbook",    detail: { name: "CRITICAL INCURSION RESPONSE" } },
    { action: "MISSION_UPDATE",    resource: "mission",     detail: { status: "active" } },
    { action: "SENSOR_REBOOT",     resource: "sensor",      detail: { sensorId: "SNS-004" } },
    { action: "INCIDENT_CREATE",   resource: "incident",    detail: { threat: "high" } },
    { action: "INCIDENT_UPDATE",   resource: "incident",    detail: { status: "resolved" } },
    { action: "ALERT_ACKNOWLEDGE", resource: "alert",       detail: { alertId: "ALT-1" } },
    { action: "DETECTION_CREATE",  resource: "detection",   detail: { model: "DJI Mavic 3" } },
    { action: "PLAYBOOK_EXECUTE",  resource: "playbook",    detail: { name: "SWARM DETECTION PROTOCOL" } },
    { action: "MISSION_UPDATE",    resource: "mission",     detail: { status: "completed" } },
    { action: "CALIBRATION_SAVE",  resource: "calibration", detail: { confidence: 62, altitude: 40, speed: 20, autoClassify: 88 } },
    { action: "CALIBRATION_SAVE",  resource: "calibration", detail: { confidence: 55, altitude: 30, speed: 15, autoClassify: 92 } },
    { action: "CALIBRATION_SAVE",  resource: "calibration", detail: { confidence: 70, altitude: 50, speed: 30, autoClassify: 95 } },
  ];

  const auditRows = Array.from({ length: 50 }, (_, i) => {
    const entry  = actions[i % actions.length];
    const op     = pick(operators);
    // Spread over 30 days, 1-2 entries per day approximately
    const daysBack = 29 - Math.floor(i * 29 / 49);
    return {
      operatorName: op,
      action:       entry.action,
      resource:     entry.resource,
      resourceId:   `${entry.resource.toUpperCase().slice(0, 3)}-${String(i + 1).padStart(3, "0")}`,
      details:      entry.detail as object,
      timestamp:    tsDay(daysBack),
    };
  });

  await db.insert(auditLogs).values(auditRows);
}

// ─── Main ─────────────────────────────────────────────────────
async function main() {
  console.log("🌱 Starting Sky Guardian database seed...\n");

  try {
    await cleanVolatile();        // clear time-sensitive tables first
    await seedUsers();
    await seedSensors();
    const droneRows     = await seedDrones();
    const detectionRows = await seedDetections(droneRows);
    await seedIncidents(detectionRows);
    await seedAlerts();
    await seedGeoZones();
    await seedMissions();
    await seedPlaybooks();
    await seedCameras();
    await seedThreatIntel();
    await seedAuditLogs();

    console.log("\n✅ Database seeded successfully!\n");
    console.log("  Default credentials:");
    console.log("  Admin → cnb@dds.kz / cnb2026  (Syrym Argyn, OP-00001)");
    console.log("\n  Data summary:");
    console.log("  Detections : 150 entries · 30-day spread");
    console.log("  Incidents  : 15 entries  · 30-day spread");
    console.log("  Audit logs : 50 entries  · 30-day spread");
  } catch (err) {
    console.error("❌ Seed failed:", err);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

main();
