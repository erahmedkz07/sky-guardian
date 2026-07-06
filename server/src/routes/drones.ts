import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { drones } from "../db/schema.js";
import { eq, desc } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.js";
import { notifier } from "../bot/notifier.js";
import { getSocketServer } from "../ws/droneStream.js";

const router = Router();
router.use(requireAuth);

// GET /api/drones
router.get("/", async (_req, res) => {
  try {
    const rows = await db.select().from(drones).orderBy(desc(drones.detectedAt));
    // Map DB columns → frontend shape (matches mockData.ts Drone interface)
    const mapped = rows.map((d) => ({
      id:          d.id,
      callsign:    d.callsign,
      model:       d.model,
      lat:         d.lat,
      lng:         d.lng,
      altitude:    d.altitudeM,
      speed:       d.speedKmh,
      heading:     d.headingDeg,
      threat:      d.threat,
      status:      d.status,
      detectedAt:  d.detectedAt,
      lastSeen:    d.lastSeen,
      confidence:  d.confidence,
    }));
    res.json(mapped);
  } catch (err) {
    console.error("[drones/list]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/drones/:id
router.get("/:id", async (req, res) => {
  try {
    const [row] = await db.select().from(drones).where(eq(drones.id, req.params.id)).limit(1);
    if (!row) { res.status(404).json({ error: "Drone not found" }); return; }
    res.json(row);
  } catch (err) {
    console.error("[drones/get]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

const UpdateDroneSchema = z.object({
  status:     z.enum(["tracked","intercepted","lost","neutralized"]).optional(),
  threat:     z.enum(["low","medium","high","critical"]).optional(),
  lat:        z.number().optional(),
  lng:        z.number().optional(),
  altitudeM:  z.number().optional(),
  speedKmh:   z.number().optional(),
  headingDeg: z.number().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

// PATCH /api/drones/:id
router.patch("/:id", async (req, res) => {
  const parsed = UpdateDroneSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  try {
    const [before] = await db.select().from(drones).where(eq(drones.id, req.params.id)).limit(1);
    if (!before) { res.status(404).json({ error: "Drone not found" }); return; }

    const [updated] = await db.update(drones)
      .set({ ...parsed.data, lastSeen: new Date() })
      .where(eq(drones.id, req.params.id))
      .returning();

    // Emit immediate WS update so frontend map reflects new status without waiting for tick
    const io = getSocketServer();
    if (io) {
      io.emit("drone:updated", {
        id:         updated.id,
        callsign:   updated.callsign,
        model:      updated.model,
        lat:        updated.lat,
        lng:        updated.lng,
        altitude:   updated.altitudeM,
        speed:      updated.speedKmh,
        heading:    updated.headingDeg,
        threat:     updated.threat,
        status:     updated.status,
        confidence: updated.confidence,
        detectedAt: updated.detectedAt,
        lastSeen:   updated.lastSeen,
      });
    }

    // Notify Telegram subscribers when operator changes drone status to non-tracked
    if (parsed.data.status && parsed.data.status !== "tracked" && before.status !== parsed.data.status) {
      notifier.droneStatusChange(updated.callsign, before.status, updated.status).catch(() => {});
    }

    res.json(updated);
  } catch (err) {
    console.error("[drones/update]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/drones/:id
router.delete("/:id", async (req, res) => {
  try {
    const [row] = await db.delete(drones).where(eq(drones.id, req.params.id)).returning();
    if (!row) { res.status(404).json({ error: "Drone not found" }); return; }
    res.json({ ok: true });
  } catch (err) {
    console.error("[drones/delete]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
