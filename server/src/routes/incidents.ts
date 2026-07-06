import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { incidents, incidentDetections, detections, missions, auditLogs, alertEvents } from "../db/schema.js";
import { eq, desc, inArray } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.js";
import { notifier } from "../bot/notifier.js";
import { getSocketServer } from "../ws/droneStream.js";

const router = Router();
router.use(requireAuth);

// GET /api/incidents
router.get("/", async (_req, res) => {
  try {
    const rows = await db.select().from(incidents).orderBy(desc(incidents.createdAt));

    // Fetch linked detection IDs for each incident
    const allLinks = await db.select().from(incidentDetections);
    const linkMap  = new Map<string, string[]>();
    for (const link of allLinks) {
      const arr = linkMap.get(link.incidentId) ?? [];
      arr.push(link.detectionId);
      linkMap.set(link.incidentId, arr);
    }

    // Fetch detection positions to compute incident centroid lat/lng
    const allDetectionIds = [...new Set(allLinks.map((l) => l.detectionId))];
    const detectionRows = allDetectionIds.length
      ? await db
          .select({ id: detections.id, lat: detections.lat, lng: detections.lng })
          .from(detections)
          .where(inArray(detections.id, allDetectionIds))
      : [];
    const detectionPosMap = new Map<string, { lat: number; lng: number }>();
    for (const d of detectionRows) detectionPosMap.set(d.id, { lat: d.lat, lng: d.lng });

    const mapped = rows.map((inc) => {
      const dids = linkMap.get(inc.id) ?? [];
      const positions = dids.map((d) => detectionPosMap.get(d)).filter(Boolean) as { lat: number; lng: number }[];
      const lat = positions.length ? positions.reduce((s, p) => s + p.lat, 0) / positions.length : null;
      const lng = positions.length ? positions.reduce((s, p) => s + p.lng, 0) / positions.length : null;
      return {
        id:           inc.id,
        code:         inc.code,
        title:        inc.title,
        threat:       inc.threat,
        status:       inc.status,
        assignee:     inc.assignee,
        createdAt:    inc.createdAt,
        updatedAt:    inc.updatedAt,
        description:  inc.description,
        detectionIds: dids,
        lat,
        lng,
      };
    });
    res.json(mapped);
  } catch (err) {
    console.error("[incidents/list]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/incidents/:id
router.get("/:id", async (req, res) => {
  try {
    const [row] = await db.select().from(incidents).where(eq(incidents.id, req.params.id)).limit(1);
    if (!row) { res.status(404).json({ error: "Incident not found" }); return; }
    res.json(row);
  } catch (err) {
    console.error("[incidents/get]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

const CreateIncidentSchema = z.object({
  title:       z.string().min(3).max(200),
  threat:      z.enum(["low","medium","high","critical"]),
  description: z.string().optional(),
  assignee:    z.string().optional(),
});

// POST /api/incidents
router.post("/", async (req, res) => {
  const parsed = CreateIncidentSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  try {
    const count   = await db.select().from(incidents);
    const nextNum = count.length + 1;
    const id      = `INC-${String(nextNum).padStart(4, "0")}`;
    const code    = `OP-${1000 + nextNum}`;

    const [created] = await db.insert(incidents).values({
      id,
      code,
      ...parsed.data,
      status: "open",
    }).returning();
    res.status(201).json(created);

    // Fire-and-forget: audit + auto-mission for high/critical
    db.insert(auditLogs).values({
      action:     "INCIDENT_CREATED",
      resource:   "incident",
      resourceId: created.id,
      details:    { code: created.code, title: created.title, threat: created.threat } as object,
    }).catch(() => {});

    if (created.threat === "high" || created.threat === "critical") {
      const missionId = `MSN-${Date.now().toString(36).toUpperCase()}`;
      db.insert(missions).values({
        id:          missionId,
        code:        missionId,
        name:        `Auto: ${created.title}`,
        status:      "planned",
        priority:    created.threat as any,
        description: `Автоматически создана из инцидента ${created.code}.`,
      }).catch(() => {});
    }

    notifier.incident({ code: created.code, title: created.title, threat: created.threat, status: created.status }).catch(() => {});
  } catch (err) {
    console.error("[incidents/create]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

const UpdateIncidentSchema = z.object({
  status:      z.enum(["open","investigating","resolved","dismissed"]).optional(),
  assignee:    z.string().max(100).optional(),
  threat:      z.enum(["low","medium","high","critical"]).optional(),
  description: z.string().max(4000).optional(),
  title:       z.string().min(3).max(200).optional(),
});

// PATCH /api/incidents/:id
router.patch("/:id", async (req, res) => {
  const parsed = UpdateIncidentSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  try {
    const [updated] = await db.update(incidents)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(incidents.id, req.params.id))
      .returning();
    if (!updated) { res.status(404).json({ error: "Incident not found" }); return; }
    res.json(updated);

    // Emit system alert when incident moves to "investigating"
    if (parsed.data.status === "investigating") {
      const io = getSocketServer();
      const alertLevel = updated.threat === "critical" || updated.threat === "high" ? "alert" : "warn";
      const alertMsg = `Инцидент ${updated.code} переведён в расследование: "${updated.title}". Ответственный: ${updated.assignee ?? "не назначен"}.`;
      io?.emit("feed:event", {
        id: Date.now(), time: new Date().toISOString().slice(11, 19),
        source: updated.code, level: alertLevel, text: alertMsg,
      });
      const alertId = `ALT-${Date.now().toString(36).toUpperCase()}`;
      db.insert(alertEvents).values({
        id: alertId,
        level: (updated.threat === "critical" ? "critical" : updated.threat === "high" ? "high" : "medium") as any,
        title:        `Расследование: ${updated.code}`,
        message:      alertMsg,
        source:       updated.code,
        acknowledged: false,
        timestamp:    new Date(),
      }).catch(() => {});
    }

    db.insert(auditLogs).values({
      action:     "INCIDENT_UPDATED",
      resource:   "incident",
      resourceId: req.params.id,
      details:    parsed.data as object,
    }).catch(() => {});

    // Notify Telegram subscribers whenever an operator changes the incident's status
    if (parsed.data.status) {
      notifier.incident({ code: updated.code, title: updated.title, threat: updated.threat, status: updated.status }).catch(() => {});
    }
  } catch (err) {
    console.error("[incidents/update]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/incidents/:id
router.delete("/:id", async (req, res) => {
  try {
    await db.delete(incidentDetections).where(eq(incidentDetections.incidentId, req.params.id));
    const [removed] = await db.delete(incidents).where(eq(incidents.id, req.params.id)).returning();
    if (!removed) { res.status(404).json({ error: "Incident not found" }); return; }
    res.json({ ok: true });
  } catch (err) {
    console.error("[incidents/delete]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
