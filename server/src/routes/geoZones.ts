import { Router } from "express";
import { db } from "../db/client.js";
import { geoZones } from "../db/schema.js";
import { requireAuth } from "../middleware/auth.js";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

const router = Router();
router.use(requireAuth);

const zoneBody = z.object({
  name:   z.string().min(1).max(100),
  lat:    z.number().min(-90).max(90),
  lng:    z.number().min(-180).max(180),
  radius: z.number().min(100).max(50_000),
  level:  z.enum(["low", "medium", "high", "critical"]),
  active: z.boolean().optional(),
});

function toResponse(row: typeof geoZones.$inferSelect) {
  return {
    id:     row.id,
    name:   row.name,
    lat:    row.lat,
    lng:    row.lng,
    radius: row.radiusM,
    level:  row.threat,
    active: row.active,
  };
}

// GET /api/geo-zones
router.get("/", async (_req, res) => {
  try {
    const rows = await db.select().from(geoZones).orderBy(geoZones.name);
    res.json(rows.map(toResponse));
  } catch (err) {
    console.error("[geo-zones/list]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/geo-zones
router.post("/", async (req, res) => {
  const parsed = zoneBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid data", details: parsed.error.flatten() });
  }

  try {
    // Sequential ID: GZ-04, GZ-05, etc.
    const [{ next }] = await db.execute<{ next: number }>(sql`
      SELECT COALESCE(MAX(CAST(SUBSTRING(id FROM 4) AS INTEGER)), 0) + 1 AS next
      FROM geo_zones WHERE id ~ '^GZ-[0-9]+$'
    `);
    const id = `GZ-${String(next).padStart(2, "0")}`;

    const [row] = await db
      .insert(geoZones)
      .values({
        id,
        name:    parsed.data.name.trim().toUpperCase(),
        lat:     parsed.data.lat,
        lng:     parsed.data.lng,
        radiusM: parsed.data.radius,
        threat:  parsed.data.level,
        active:  parsed.data.active ?? true,
      })
      .returning();

    res.status(201).json(toResponse(row));
  } catch (err) {
    console.error("[geo-zones/create]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/geo-zones/:id
router.patch("/:id", async (req, res) => {
  const parsed = zoneBody.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid data" });
  }

  const updates: Partial<typeof geoZones.$inferInsert> = {};
  if (parsed.data.name   !== undefined) updates.name    = parsed.data.name.trim().toUpperCase();
  if (parsed.data.lat    !== undefined) updates.lat     = parsed.data.lat;
  if (parsed.data.lng    !== undefined) updates.lng     = parsed.data.lng;
  if (parsed.data.radius !== undefined) updates.radiusM = parsed.data.radius;
  if (parsed.data.level  !== undefined) updates.threat  = parsed.data.level;
  if (parsed.data.active !== undefined) updates.active  = parsed.data.active;

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: "No fields to update" });
  }

  try {
    const [row] = await db
      .update(geoZones)
      .set(updates)
      .where(eq(geoZones.id, req.params.id))
      .returning();

    if (!row) return res.status(404).json({ error: "Zone not found" });
    res.json(toResponse(row));
  } catch (err) {
    console.error("[geo-zones/patch]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/geo-zones/:id
router.delete("/:id", async (req, res) => {
  try {
    const [row] = await db
      .delete(geoZones)
      .where(eq(geoZones.id, req.params.id))
      .returning();

    if (!row) return res.status(404).json({ error: "Zone not found" });
    res.json({ ok: true });
  } catch (err) {
    console.error("[geo-zones/delete]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
