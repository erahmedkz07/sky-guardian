import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { sensors } from "../db/schema.js";
import { eq, sql } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.js";
import { notifier } from "../bot/notifier.js";

const router = Router();
router.use(requireAuth);

function mapSensor(s: typeof sensors.$inferSelect) {
  return {
    id:       s.id,
    name:     s.name,
    type:     s.type,
    lat:      s.lat,
    lng:      s.lng,
    status:   s.status,
    health:   s.health,
    signal:   s.signal,
    range:    s.rangeKm,
    lastPing: s.lastPing,
    config:   s.config ?? {},
  };
}

const SensorConfigSchema = z.object({
  scanMode:           z.enum(["passive","active","hybrid"]).optional(),
  detectionThreshold: z.number().min(5).max(95).optional(),
  alertSensitivity:   z.enum(["low","normal","high","critical"]).optional(),
  updateRateS:        z.number().min(1).max(60).optional(),
  powerMode:          z.enum(["eco","normal","performance"]).optional(),
  prf:                z.number().min(100).max(10000).optional(),
  minRcsM2:           z.number().min(0.001).max(10).optional(),
  freqBandMhz:        z.string().optional(),
  jammingDetection:   z.boolean().optional(),
  agcEnabled:         z.boolean().optional(),
  thermalMode:        z.boolean().optional(),
  nvgMode:            z.boolean().optional(),
  zoomLevel:          z.number().min(1).max(20).optional(),
  gainDb:             z.number().min(0).max(60).optional(),
  noiseGateDb:        z.number().min(-80).max(-10).optional(),
  directional:        z.boolean().optional(),
}).passthrough();

const CreateSensorSchema = z.object({
  name:   z.string().min(1).max(50),
  type:   z.enum(["RF", "RADAR", "OPTIC", "ACOUSTIC"]),
  lat:    z.number().min(-90).max(90),
  lng:    z.number().min(-180).max(180),
  range:  z.number().min(1).max(100),
  status: z.enum(["online","degraded","offline","maintenance"]).optional(),
});

const PatchSensorSchema = z.object({
  name:   z.string().min(1).max(50).optional(),
  type:   z.enum(["RF", "RADAR", "OPTIC", "ACOUSTIC"]).optional(),
  lat:    z.number().min(-90).max(90).optional(),
  lng:    z.number().min(-180).max(180).optional(),
  range:  z.number().min(1).max(100).optional(),
  status: z.enum(["online","degraded","offline","maintenance"]).optional(),
  health: z.number().min(0).max(100).optional(),
  signal: z.number().min(0).max(100).optional(),
  config: SensorConfigSchema.optional(),
});

// GET /api/sensors
router.get("/", async (_req, res) => {
  try {
    const rows = await db.select().from(sensors).orderBy(sensors.name);
    res.json(rows.map(mapSensor));
  } catch (err) {
    console.error("[sensors/list]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/sensors/:id
router.get("/:id", async (req, res) => {
  try {
    const [row] = await db.select().from(sensors).where(eq(sensors.id, req.params.id)).limit(1);
    if (!row) { res.status(404).json({ error: "Sensor not found" }); return; }
    res.json(mapSensor(row));
  } catch (err) {
    console.error("[sensors/get]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/sensors
router.post("/", async (req, res) => {
  const parsed = CreateSensorSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid data", details: parsed.error.flatten() });
    return;
  }

  try {
    const [{ next }] = await db.execute<{ next: number }>(sql`
      SELECT COALESCE(MAX(CAST(SUBSTRING(id FROM 5) AS INTEGER)), 0) + 1 AS next
      FROM sensors WHERE id ~ '^SNS-[0-9]+$'
    `);
    const id = `SNS-${String(next).padStart(3, "0")}`;

    const [row] = await db
      .insert(sensors)
      .values({
        id,
        name:    parsed.data.name.trim().toUpperCase(),
        type:    parsed.data.type,
        lat:     parsed.data.lat,
        lng:     parsed.data.lng,
        rangeKm: parsed.data.range,
        status:  parsed.data.status ?? "online",
        health:  100,
        signal:  100,
        config:  {},
      })
      .returning();

    res.status(201).json(mapSensor(row));
  } catch (err) {
    console.error("[sensors/create]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/sensors/:id
router.patch("/:id", async (req, res) => {
  const parsed = PatchSensorSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  try {
    const { config, range, name, ...rest } = parsed.data;
    type SensorUpdate = typeof sensors.$inferInsert;
    const update: Partial<SensorUpdate> = { ...rest, lastPing: new Date() };
    if (name !== undefined) update.name = name.trim().toUpperCase();
    if (range   !== undefined) update.rangeKm = range;
    if (config  !== undefined) update.config  = config;

    const [updated] = await db.update(sensors)
      .set(update)
      .where(eq(sensors.id, req.params.id))
      .returning();
    if (!updated) { res.status(404).json({ error: "Sensor not found" }); return; }
    res.json(mapSensor(updated));

    if (rest.status && rest.status !== "online") {
      notifier.sensorDown({ id: updated.id, name: updated.name, status: updated.status }).catch(() => {});
    } else if (rest.status === "online") {
      notifier.sensorRestored({ id: updated.id, name: updated.name, status: updated.status }).catch(() => {});
    }
  } catch (err) {
    console.error("[sensors/update]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/sensors/:id
router.delete("/:id", async (req, res) => {
  try {
    const [row] = await db
      .delete(sensors)
      .where(eq(sensors.id, req.params.id))
      .returning();
    if (!row) { res.status(404).json({ error: "Sensor not found" }); return; }
    res.json({ ok: true });
  } catch (err) {
    console.error("[sensors/delete]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
