import { Router } from "express";
import { db } from "../db/client.js";
import { detections, incidents, auditLogs, sensors } from "../db/schema.js";
import { desc, gte, sql } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.js";
import type { AuthRequest } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

function daysAgo(n: number) {
  const d = new Date(); d.setDate(d.getDate() - n); d.setHours(0, 0, 0, 0); return d;
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const lines   = rows.map((r) =>
    headers.map((h) => {
      const v = r[h];
      if (v == null) return "";
      const s = String(v);
      return s.includes(",") || s.includes('"') || s.includes("\n")
        ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(",")
  );
  return [headers.join(","), ...lines].join("\n");
}

// POST /api/reports/generate
// Body: { type: "detections"|"incidents"|"sensors"|"audit", days?: number }
router.post("/generate", async (req: AuthRequest, res) => {
  const { type = "detections", days = 30 } = req.body as { type?: string; days?: number };
  const since = daysAgo(Math.min(Number(days), 365));
  const filename = `sky-guardian-${type}-${new Date().toISOString().slice(0, 10)}.csv`;

  try {
    let rows: Record<string, unknown>[] = [];

    if (type === "detections") {
      const data = await db.select({
        id:        detections.id,
        callsign:  detections.callsign,
        model:     detections.model,
        threat:    detections.threat,
        lat:       detections.lat,
        lng:       detections.lng,
        confidence:detections.confidence,
        timestamp: detections.timestamp,
      }).from(detections).where(gte(detections.timestamp, since)).orderBy(desc(detections.timestamp)).limit(5000);
      rows = data as unknown as Record<string, unknown>[];
    } else if (type === "incidents") {
      const data = await db.select({
        id:          incidents.id,
        code:        incidents.code,
        title:       incidents.title,
        threat:      incidents.threat,
        status:      incidents.status,
        assignee:    incidents.assignee,
        description: incidents.description,
        createdAt:   incidents.createdAt,
        updatedAt:   incidents.updatedAt,
      }).from(incidents).where(gte(incidents.createdAt, since)).orderBy(desc(incidents.createdAt));
      rows = data as unknown as Record<string, unknown>[];
    } else if (type === "sensors") {
      const data = await db.select().from(sensors).orderBy(sensors.name);
      rows = data as unknown as Record<string, unknown>[];
    } else if (type === "audit") {
      const data = await db.select({
        id:           auditLogs.id,
        operatorName: auditLogs.operatorName,
        action:       auditLogs.action,
        resource:     auditLogs.resource,
        resourceId:   auditLogs.resourceId,
        ipAddress:    auditLogs.ipAddress,
        timestamp:    auditLogs.timestamp,
      }).from(auditLogs).where(gte(auditLogs.timestamp, since)).orderBy(desc(auditLogs.timestamp)).limit(2000);
      rows = data as unknown as Record<string, unknown>[];
    }

    const csv = toCsv(rows);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    console.error("[reports/generate]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/reports/summary — counts for the reports page
router.get("/summary", async (_req, res) => {
  try {
    const [
      { detTotal }, { incTotal }, { audTotal },
    ] = await Promise.all([
      db.select({ detTotal: sql<number>`COUNT(*)::int` }).from(detections).then((r) => r[0]),
      db.select({ incTotal: sql<number>`COUNT(*)::int` }).from(incidents).then((r) => r[0]),
      db.select({ audTotal: sql<number>`COUNT(*)::int` }).from(auditLogs).then((r) => r[0]),
    ]);
    res.json({ detections: detTotal, incidents: incTotal, auditActions: audTotal });
  } catch (err) {
    console.error("[reports/summary]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
