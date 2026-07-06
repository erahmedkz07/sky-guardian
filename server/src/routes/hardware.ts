/**
 * POST /api/hardware/detect
 *
 * Endpoint for physical sensor hardware (Arduino, RF scanners, etc.) to submit
 * drone detections. Uses API key auth instead of JWT — embeds can't do OAuth.
 *
 * Required header: X-Api-Key: <HARDWARE_API_KEY from .env>
 *
 * Body:
 *   sensorId   — e.g. "SNS-001"
 *   callsign   — drone callsign or "UNK-xxx"
 *   model      — drone model or "Unknown"
 *   threat     — "low" | "medium" | "high" | "critical"
 *   lat        — latitude (decimal degrees)
 *   lng        — longitude (decimal degrees)
 *   altitude   — altitude in meters (optional, default 0)
 *   speed      — speed in km/h (optional, default 0)
 *   heading    — heading in degrees (optional, default 0)
 *   confidence — 0.0–1.0
 *   notes      — free text (optional)
 */

import { Router } from "express";
import { db } from "../db/client.js";
import { detections, drones, sensors, incidents, alertEvents, auditLogs, missions, incidentDetections } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { getSocketServer } from "../ws/droneStream.js";
import { notifier } from "../bot/notifier.js";
import "dotenv/config";

const router = Router();

const HARDWARE_KEY = process.env.HARDWARE_API_KEY ?? "sg-hardware-key-2024";

// ─── API key middleware ───────────────────────────────────────────
function requireHardwareKey(req: any, res: any, next: any) {
  const key = req.headers["x-api-key"];
  if (!key || key !== HARDWARE_KEY) {
    res.status(401).json({ error: "Invalid or missing X-Api-Key" });
    return;
  }
  next();
}

router.use(requireHardwareKey);

// ─── Helpers ─────────────────────────────────────────────────────

function genDetectionId(): string {
  return `DET-${Date.now().toString(36).toUpperCase()}`;
}

function genDroneId(): string {
  return `DRN-${Date.now().toString(36).toUpperCase()}`;
}

function genIncidentId(): string {
  return `INC-${Date.now().toString(36).toUpperCase()}`;
}

function genAlertId(): string {
  return `ALT-${Date.now().toString(36).toUpperCase()}`;
}

// ─── POST /api/hardware/detect ───────────────────────────────────
router.post("/detect", async (req: any, res: any) => {
  const {
    sensorId,
    callsign,
    model,
    threat,
    lat,
    lng,
    altitude = 0,
    speed = 0,
    heading = 0,
    confidence,
    notes,
  } = req.body;

  // ── Validate required fields ──────────────────────────────────
  if (!sensorId || !callsign || !threat || lat == null || lng == null || confidence == null) {
    res.status(400).json({ error: "Missing required fields: sensorId, callsign, threat, lat, lng, confidence" });
    return;
  }

  const validThreats = ["low", "medium", "high", "critical"];
  if (!validThreats.includes(threat)) {
    res.status(400).json({ error: "threat must be: low | medium | high | critical" });
    return;
  }

  try {
    const io = getSocketServer();
    const now = new Date();

    // ── 1. Verify sensor exists ───────────────────────────────
    const [sensor] = await db.select({ id: sensors.id, name: sensors.name })
      .from(sensors)
      .where(eq(sensors.id, sensorId))
      .limit(1);

    if (!sensor) {
      res.status(404).json({ error: `Sensor '${sensorId}' not found in DB` });
      return;
    }

    // ── 2. Find or create drone ────────────────────────────────
    let [existingDrone] = await db.select().from(drones)
      .where(eq(drones.callsign, callsign))
      .limit(1);

    let droneId: string;

    if (existingDrone) {
      droneId = existingDrone.id;
      await db.update(drones).set({
        lat,
        lng,
        altitudeM:  Math.round(altitude),
        speedKmh:   speed,
        headingDeg: heading,
        threat:     threat as any,
        confidence,
        status:     existingDrone.status === "neutralized" || existingDrone.status === "lost"
                      ? existingDrone.status
                      : "tracked",
        lastSeen:   now,
      }).where(eq(drones.id, droneId));
    } else {
      droneId = genDroneId();
      await db.insert(drones).values({
        id:          droneId,
        callsign:    callsign.slice(0, 50),
        model:       (model ?? "Unknown").slice(0, 100),
        lat,
        lng,
        altitudeM:  Math.round(altitude),
        speedKmh:   speed,
        headingDeg: heading,
        threat:     threat as any,
        status:     "tracked",
        confidence,
        detectedAt: now,
        lastSeen:   now,
      });
      existingDrone = null as any;
    }

    // ── 3. Save detection ──────────────────────────────────────
    const detectionId = genDetectionId();
    const [savedDetection] = await db.insert(detections).values({
      id:         detectionId,
      droneId,
      sensorId:   sensor.id,
      callsign:   callsign.slice(0, 50),
      model:      (model ?? "Unknown").slice(0, 100),
      threat:     threat as any,
      lat,
      lng,
      confidence,
      notes:      notes ?? null,
      timestamp:  now,
    }).returning();

    // ── 3b. Audit log — DETECTION_RECEIVED ────────────────────
    db.insert(auditLogs).values({
      action:     "DETECTION_RECEIVED",
      resource:   "detection",
      resourceId: detectionId,
      details: {
        callsign,
        model:      model ?? "Unknown",
        threat,
        confidence,
        sensorId:   sensor.id,
        sensorName: sensor.name,
        lat,
        lng,
      } as object,
    }).catch(() => {});

    // ── 4. Auto-create incident for high/critical new detections ──
    if (threat === "high" || threat === "critical") {
      const [openInc] = await db.select({ id: incidents.id })
        .from(incidents)
        .where(and(
          eq(incidents.status, "open"),
        ))
        .limit(1);

      // Only create if no open incident for this drone already
      const incidentCode = genIncidentId();
      if (!openInc) {
        await db.insert(incidents).values({
          id:          incidentCode,
          code:        incidentCode,
          title:       `Auto-detected: ${callsign} (${model ?? "Unknown"})`,
          threat:      threat as any,
          status:      "open",
          description: `Automatic incident from sensor ${sensor.name}. Confidence: ${(confidence * 100).toFixed(0)}%. Position: ${lat.toFixed(5)}, ${lng.toFixed(5)}.`,
          createdAt:   now,
          updatedAt:   now,
        });

        // Link detection to incident (enables lat/lng centroid on map)
        db.insert(incidentDetections).values({
          incidentId:  incidentCode,
          detectionId: detectionId,
        }).catch(() => {});

        // Push incident update to frontend
        io?.emit("ai:incident_created", { incidentCode });

        // Auto-create a mission for this incident
        const missionId = `MSN-${Date.now().toString(36).toUpperCase()}`;
        db.insert(missions).values({
          id:          missionId,
          code:        missionId,
          name:        `Auto: ${callsign} (${threat.toUpperCase()})`,
          status:      "planned",
          priority:    threat as any,
          description: `Автоматически создана при обнаружении дрона ${callsign} сенсором ${sensor.name}. Угроза: ${threat.toUpperCase()}, уверенность: ${(confidence * 100).toFixed(0)}%.`,
        }).catch(() => {});

        db.insert(auditLogs).values({
          action:     "INCIDENT_CREATED",
          resource:   "incident",
          resourceId: incidentCode,
          details:    { code: incidentCode, callsign, threat, sensor: sensor.name } as object,
        }).catch(() => {});
      }
    }

    // ── 5. Create alert event ──────────────────────────────────
    if (threat === "high" || threat === "critical") {
      const alertId = genAlertId();
      const alertLevel = threat === "critical" ? "critical" : "high";
      const alertTitle = threat === "critical"
        ? `Критическая угроза: ${callsign}`
        : `Высокая угроза: ${callsign}`;
      const alertMsg = `${model ?? "Unknown"} обнаружен сенсором ${sensor.name} — угроза ${threat.toUpperCase()}, уверенность ${(confidence * 100).toFixed(0)}%, высота ${Math.round(altitude)} м`;

      await db.insert(alertEvents).values({
        id:           alertId,
        level:        alertLevel as any,
        title:        alertTitle,
        message:      alertMsg,
        source:       callsign,
        acknowledged: false,
        timestamp:    now,
      });

      // Push alert to frontend via WebSocket feed:event
      io?.emit("feed:event", {
        id:     Date.now(),
        time:   now.toISOString().slice(11, 19),
        source: callsign,
        level:  threat === "critical" ? "alert" : "warn",
        text:   alertMsg,
      });

      // Notify Telegram subscribers
      notifier.droneStatusChange(callsign, "new_contact", threat).catch(() => {});
    }

    // ── 6. Push drone update to all connected clients ─────────
    const dronePayload = {
      id:          droneId,
      callsign,
      model:       model ?? "Unknown",
      lat,
      lng,
      altitude:    Math.round(altitude),
      speed,
      heading,
      threat,
      status:      "tracked",
      confidence,
      detectedAt:  now,
      lastSeen:    now,
    };
    io?.emit("drone:updated", dronePayload);

    // ── 7. Return saved detection ──────────────────────────────
    res.status(201).json({
      detection: {
        id:         savedDetection.id,
        droneId,
        sensorId:   sensor.id,
        callsign,
        model:      model ?? "Unknown",
        threat,
        lat,
        lng,
        confidence,
        notes:      notes ?? null,
        timestamp:  now,
      },
      drone: dronePayload,
    });

  } catch (err) {
    console.error("[hardware/detect]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/hardware/status — health check for sensors ─────────
router.get("/status", async (_req: any, res: any) => {
  try {
    const rows = await db.select({
      id:     sensors.id,
      name:   sensors.name,
      type:   sensors.type,
      status: sensors.status,
      health: sensors.health,
      signal: sensors.signal,
    }).from(sensors);
    res.json({ ok: true, sensors: rows, timestamp: new Date() });
  } catch (err) {
    res.status(500).json({ ok: false, error: "DB error" });
  }
});

// ─── POST /api/hardware/sensor-ping — sensor heartbeat ───────────
router.post("/sensor-ping", async (req: any, res: any) => {
  const { sensorId, health, signal, status } = req.body;
  if (!sensorId) {
    res.status(400).json({ error: "sensorId required" });
    return;
  }
  try {
    await db.update(sensors).set({
      lastPing: new Date(),
      ...(health  != null && { health:  Math.min(100, Math.max(0, health))  }),
      ...(signal  != null && { signal:  Math.min(100, Math.max(0, signal))  }),
      ...(status  != null && { status }),
    }).where(eq(sensors.id, sensorId));

    const io = getSocketServer();
    io?.emit("sensor:updated", { sensorId, health, signal, status, lastPing: new Date() });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "DB error" });
  }
});

export default router;
