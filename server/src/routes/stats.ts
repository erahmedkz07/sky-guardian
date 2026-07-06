import { Router } from "express";
import { db } from "../db/client.js";
import { sensors, drones, incidents } from "../db/schema.js";
import { eq, count } from "drizzle-orm";

const router = Router();

// GET /api/stats — public, no auth required
router.get("/", async (_req, res) => {
  try {
    const [[sensorRow], [droneRow], [incidentRow]] = await Promise.all([
      db.select({ total: count(), online: count(sensors.id) })
        .from(sensors),
      db.select({ total: count() })
        .from(drones)
        .where(eq(drones.status, "tracked")),
      db.select({ total: count() })
        .from(incidents)
        .where(eq(incidents.status, "open")),
    ]);

    const [allSensors] = await db
      .select({ total: count() })
      .from(sensors);

    const [onlineSensors] = await db
      .select({ total: count() })
      .from(sensors)
      .where(eq(sensors.status, "online"));

    res.json({
      sensors: {
        online: onlineSensors.total,
        total:  allSensors.total,
      },
      activeTracks:  droneRow?.total  ?? 0,
      openIncidents: incidentRow?.total ?? 0,
    });
  } catch {
    res.status(500).json({ error: "Stats unavailable" });
  }
});

export default router;
