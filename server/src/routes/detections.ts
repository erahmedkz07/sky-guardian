import { Router } from "express";
import { db } from "../db/client.js";
import { detections } from "../db/schema.js";
import { eq, desc } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

// GET /api/detections?limit=50
router.get("/", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  try {
    const rows = await db.select().from(detections)
      .orderBy(desc(detections.timestamp))
      .limit(limit);

    const mapped = rows.map((d) => ({
      id:         d.id,
      droneId:    d.droneId,
      callsign:   d.callsign,
      model:      d.model,
      threat:     d.threat,
      sensorId:   d.sensorId,
      sensorName: d.sensorId ?? "UNKNOWN",
      timestamp:  d.timestamp,
      lat:        d.lat,
      lng:        d.lng,
      confidence: d.confidence,
      notes:      d.notes,
    }));
    res.json(mapped);
  } catch (err) {
    console.error("[detections/list]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/detections/:id
router.get("/:id", async (req, res) => {
  try {
    const [row] = await db.select().from(detections).where(eq(detections.id, req.params.id)).limit(1);
    if (!row) { res.status(404).json({ error: "Detection not found" }); return; }
    res.json(row);
  } catch (err) {
    console.error("[detections/get]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
