/**
 * AI Engine — autonomous incident response service.
 * Evaluates incoming drone/detection events and, depending on opMode:
 *   passive    → only logs, no actions
 *   advisory   → queues actions for human approval
 *   autonomous → executes actions immediately
 */
import { db } from "../db/client.js";
import {
  aiSettings,
  aiPendingActions,
  incidents,
  alertEvents,
  playbooks,
  auditLogs,
  drones,
} from "../db/schema.js";
import { eq, and, inArray } from "drizzle-orm";
import type { Server as SocketIO } from "socket.io";

// ─── Types ────────────────────────────────────────────────────
type ThreatLevel = "low" | "medium" | "high" | "critical";
type OpMode      = "passive" | "advisory" | "autonomous";

export interface AiSettingsData {
  opMode:              OpMode;
  autoIncident:        boolean;
  autoAck:             boolean;
  autoPlaybook:        boolean;
  globalMinConfidence: number;
  modelSettings:       Record<string, { enabled: boolean; threshold: number }>;
}

interface EvalDrone {
  id:         string;
  callsign:   string;
  model:      string;
  threat:     ThreatLevel;
  status:     string;
  confidence: number;
  lat:        number;
  lng:        number;
}

// ─── Settings cache (5-minute TTL) ───────────────────────────
let _settingsCache: AiSettingsData | null = null;
let _settingsCacheAt = 0;

const DEFAULT_SETTINGS: AiSettingsData = {
  opMode:              "advisory",
  autoIncident:        true,
  autoAck:             false,
  autoPlaybook:        false,
  globalMinConfidence: 60,
  modelSettings:       {},
};

export async function getAiSettings(): Promise<AiSettingsData> {
  if (_settingsCache && Date.now() - _settingsCacheAt < 5 * 60 * 1000) {
    return _settingsCache;
  }
  try {
    const [row] = await db.select().from(aiSettings).where(eq(aiSettings.id, 1)).limit(1);
    if (!row) {
      _settingsCache = DEFAULT_SETTINGS;
    } else {
      _settingsCache = {
        opMode:              (row.opMode as OpMode) ?? "advisory",
        autoIncident:        row.autoIncident,
        autoAck:             row.autoAck,
        autoPlaybook:        row.autoPlaybook,
        globalMinConfidence: row.globalMinConfidence,
        modelSettings:       (row.modelSettings as Record<string, { enabled: boolean; threshold: number }>) ?? {},
      };
    }
  } catch {
    _settingsCache = DEFAULT_SETTINGS;
  }
  _settingsCacheAt = Date.now();
  return _settingsCache!;
}

export function invalidateSettingsCache() {
  _settingsCache = null;
}

// ─── Tracked drone IDs already processed ─────────────────────
const _processedDroneEvents = new Set<string>();

// ─── WebSocket reference ──────────────────────────────────────
let _io: SocketIO | null = null;
export function setSocketServer(io: SocketIO) { _io = io; }

// ─── Audit helper ────────────────────────────────────────────
async function auditAi(action: string, resource: string, resourceId: string, details: object) {
  try {
    await db.insert(auditLogs).values({
      operatorName: "AI-CORE",
      action,
      resource,
      resourceId,
      details,
    });
  } catch { /* non-blocking */ }
}

// ─── Pending action helpers ───────────────────────────────────
async function createPending(
  actionType: string,
  payload: object,
  reason: string,
  confidence: number,
) {
  const [row] = await db.insert(aiPendingActions).values({
    actionType,
    payload:    payload as Record<string, unknown>,
    reason,
    confidence,
    status:     "pending",
  }).returning();

  await auditAi("AI_ACTION_QUEUED", "ai_pending_action", row.id, { actionType, reason });

  _io?.emit("ai:pending", { action: row });
  return row;
}

// ─── Action executors ─────────────────────────────────────────
async function execCreateIncident(payload: {
  title: string; threat: ThreatLevel; description: string; droneId?: string;
}) {
  const code = `INC-${Date.now().toString(36).toUpperCase()}`;
  const [row] = await db.insert(incidents).values({
    id:          code,
    code,
    title:       payload.title,
    threat:      payload.threat,
    status:      "open",
    description: payload.description,
  }).returning();
  await auditAi("INCIDENT_CREATE", "incident", row.id, { via: "AI-CORE", threat: payload.threat });
  _io?.emit("ai:incident_created", { incident: row });
  return row;
}

async function execAckAlert(payload: { alertId: string }) {
  await db.update(alertEvents)
    .set({ acknowledged: true })
    .where(eq(alertEvents.id, payload.alertId));
  await auditAi("ALERT_ACKNOWLEDGE", "alert", payload.alertId, { via: "AI-CORE" });
}

async function execRunPlaybook(payload: { threat: ThreatLevel }) {
  const [pb] = await db
    .select()
    .from(playbooks)
    .where(and(eq(playbooks.threatLevel, payload.threat), eq(playbooks.active, true)))
    .limit(1);
  if (!pb) return null;
  await auditAi("PLAYBOOK_EXECUTE", "playbook", pb.id, { via: "AI-CORE", name: pb.name });
  _io?.emit("ai:playbook_executed", { playbookId: pb.id, name: pb.name });
  return pb;
}

// ─── Public: execute a pending action by ID ───────────────────
export async function executePendingAction(id: string, resolvedBy: string) {
  const [action] = await db
    .select()
    .from(aiPendingActions)
    .where(and(eq(aiPendingActions.id, id), eq(aiPendingActions.status, "pending")))
    .limit(1);

  if (!action) throw new Error("Pending action not found or already resolved");

  const payload = action.payload as Record<string, unknown>;

  switch (action.actionType) {
    case "CREATE_INCIDENT":
      await execCreateIncident(payload as Parameters<typeof execCreateIncident>[0]);
      break;
    case "ACK_ALERT":
      await execAckAlert(payload as Parameters<typeof execAckAlert>[0]);
      break;
    case "RUN_PLAYBOOK":
      await execRunPlaybook(payload as Parameters<typeof execRunPlaybook>[0]);
      break;
  }

  await db.update(aiPendingActions)
    .set({ status: "approved", resolvedBy, resolvedAt: new Date() })
    .where(eq(aiPendingActions.id, id));

  await auditAi("AI_ACTION_APPROVED", "ai_pending_action", id, { by: resolvedBy, actionType: action.actionType });
}

export async function rejectPendingAction(id: string, resolvedBy: string) {
  await db.update(aiPendingActions)
    .set({ status: "rejected", resolvedBy, resolvedAt: new Date() })
    .where(eq(aiPendingActions.id, id));
  await auditAi("AI_ACTION_REJECTED", "ai_pending_action", id, { by: resolvedBy });
}

// ─── Core evaluation ─────────────────────────────────────────
export async function evaluateDrone(drone: EvalDrone) {
  const settings = await getAiSettings();
  if (settings.opMode === "passive") return;

  const conf   = Math.round(drone.confidence * 100);
  const minConf = settings.globalMinConfidence;

  if (conf < minConf) return;
  if (drone.status === "neutralized" || drone.status === "lost") return;

  const eventKey = `${drone.id}:${drone.threat}:${drone.status}`;
  if (_processedDroneEvents.has(eventKey)) return;
  _processedDroneEvents.add(eventKey);

  // Evict old keys if set grows large
  if (_processedDroneEvents.size > 500) {
    const keys = [..._processedDroneEvents];
    keys.slice(0, 200).forEach((k) => _processedDroneEvents.delete(k));
  }

  const shouldAutoIncident = settings.autoIncident &&
    (drone.threat === "high" || drone.threat === "critical");

  const shouldAutoAck = settings.autoAck &&
    drone.threat === "low";

  const shouldAutoPlaybook = settings.autoPlaybook &&
    (drone.threat === "high" || drone.threat === "critical") &&
    settings.opMode === "autonomous";

  if (shouldAutoIncident) {
    const reason = `${drone.threat.toUpperCase()} threat drone ${drone.callsign} detected with ${conf}% confidence`;
    const incidentPayload = {
      title:       `Auto-detected: ${drone.callsign} (${drone.model})`,
      threat:      drone.threat,
      description: `AI-CORE auto-created incident for drone ${drone.callsign}. Threat: ${drone.threat}. Confidence: ${conf}%. Position: ${drone.lat.toFixed(4)}, ${drone.lng.toFixed(4)}.`,
      droneId:     drone.id,
    };

    if (settings.opMode === "autonomous") {
      await execCreateIncident(incidentPayload);
      await auditAi("AI_AUTO_ACTION", "drone", drone.id, { action: "CREATE_INCIDENT", reason });
    } else {
      await createPending("CREATE_INCIDENT", incidentPayload, reason, conf);
    }
  }

  if (shouldAutoAck) {
    const unackAlerts = await db
      .select()
      .from(alertEvents)
      .where(and(eq(alertEvents.level, "low"), eq(alertEvents.acknowledged, false)));

    for (const alert of unackAlerts.slice(0, 5)) {
      const reason = `Low-threat alert auto-acknowledged (drone ${drone.callsign} is low-threat)`;
      if (settings.opMode === "autonomous") {
        await execAckAlert({ alertId: alert.id });
      } else {
        await createPending("ACK_ALERT", { alertId: alert.id, title: alert.title }, reason, conf);
      }
    }
  }

  if (shouldAutoPlaybook) {
    const reason = `Auto-playbook triggered for ${drone.threat} threat: ${drone.callsign}`;
    await execRunPlaybook({ threat: drone.threat as ThreatLevel });
    await auditAi("AI_AUTO_ACTION", "drone", drone.id, { action: "RUN_PLAYBOOK", reason });
  } else if (
    settings.autoPlaybook &&
    settings.opMode === "advisory" &&
    (drone.threat === "high" || drone.threat === "critical")
  ) {
    const reason = `Playbook execution recommended for ${drone.threat} threat: ${drone.callsign}`;
    await createPending("RUN_PLAYBOOK", { threat: drone.threat }, reason, conf);
  }
}

// ─── Periodic sweep (call every ~30s) ────────────────────────
export async function periodicEvaluate() {
  try {
    const settings = await getAiSettings();
    if (settings.opMode === "passive") return;

    const activeDrones = await db
      .select()
      .from(drones)
      .where(inArray(drones.status, ["tracked", "intercepted"]));

    for (const d of activeDrones) {
      await evaluateDrone({
        id:         d.id,
        callsign:   d.callsign,
        model:      d.model,
        threat:     d.threat as ThreatLevel,
        status:     d.status,
        confidence: d.confidence,
        lat:        d.lat,
        lng:        d.lng,
      });
    }
  } catch (err) {
    console.error("[aiEngine] periodicEvaluate error:", err);
  }
}
