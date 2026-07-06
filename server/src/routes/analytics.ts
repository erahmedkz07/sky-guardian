import { Router } from "express";
import { db } from "../db/client.js";
import { sql } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

// GET /api/analytics/summary
router.get("/summary", async (_req, res) => {
  try {
    const [summary] = await db.execute<{
      total7d:   number;
      prev7d:    number;
      critical7d: number;
      open_count: number;
    }>(sql`
      SELECT
        COUNT(*) FILTER (WHERE timestamp >= NOW() - INTERVAL '7 days')::int                               AS total7d,
        COUNT(*) FILTER (WHERE timestamp >= NOW() - INTERVAL '14 days'
                           AND timestamp <  NOW() - INTERVAL '7 days')::int                               AS prev7d,
        COUNT(*) FILTER (WHERE timestamp >= NOW() - INTERVAL '7 days' AND threat = 'critical')::int       AS critical7d,
        0::int AS open_count
      FROM detections
    `);

    const [{ open_count }] = await db.execute<{ open_count: number }>(sql`
      SELECT COUNT(*)::int AS open_count FROM incidents WHERE status IN ('open','investigating')
    `);

    const modelRows = await db.execute<{ name: string; value: number }>(sql`
      SELECT model AS name, COUNT(*)::int AS value
      FROM detections
      GROUP BY model
      ORDER BY value DESC
      LIMIT 8
    `);

    const threatRows = await db.execute<{ name: string; value: number }>(sql`
      SELECT threat AS name, COUNT(*)::int AS value
      FROM detections
      GROUP BY threat
      ORDER BY value DESC
    `);

    res.json({
      detections7d:  summary.total7d,
      prev7d:        summary.prev7d,
      critical7d:    summary.critical7d,
      openIncidents: open_count,
      modelDist:     Array.from(modelRows),
      threatDist:    Array.from(threatRows),
    });
  } catch (err) {
    console.error("[analytics/summary]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/analytics/detections?days=14
router.get("/detections", async (req, res) => {
  const days = Math.min(Number(req.query.days) || 14, 90);
  try {
    const rows = await db.execute(sql`
      SELECT
        TO_CHAR(DATE_TRUNC('day', timestamp AT TIME ZONE 'UTC'), 'MM-DD') AS day,
        COUNT(*)::int                                                         AS detections,
        COUNT(*) FILTER (WHERE threat IN ('high','critical'))::int            AS threats,
        COUNT(*) FILTER (WHERE threat = 'critical')::int                      AS critical
      FROM detections
      WHERE timestamp >= NOW() - (${days} || ' days')::interval
      GROUP BY DATE_TRUNC('day', timestamp AT TIME ZONE 'UTC')
      ORDER BY DATE_TRUNC('day', timestamp AT TIME ZONE 'UTC') ASC
    `);
    res.json(Array.from(rows));
  } catch (err) {
    console.error("[analytics/detections]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/analytics/incidents?days=14
router.get("/incidents", async (req, res) => {
  const days = Math.min(Number(req.query.days) || 14, 90);
  try {
    const rows = await db.execute(sql`
      SELECT
        TO_CHAR(DATE_TRUNC('day', created_at AT TIME ZONE 'UTC'), 'MM-DD') AS day,
        COUNT(*)::int                                                          AS incidents,
        COUNT(*) FILTER (WHERE status IN ('resolved','dismissed'))::int        AS resolved
      FROM incidents
      WHERE created_at >= NOW() - (${days} || ' days')::interval
      GROUP BY DATE_TRUNC('day', created_at AT TIME ZONE 'UTC')
      ORDER BY DATE_TRUNC('day', created_at AT TIME ZONE 'UTC') ASC
    `);
    res.json(Array.from(rows));
  } catch (err) {
    console.error("[analytics/incidents]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
