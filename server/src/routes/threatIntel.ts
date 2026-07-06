import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { threatIntel } from "../db/schema.js";
import { desc } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

// GET /api/threat-intel
router.get("/", async (_req, res) => {
  try {
    const rows = await db.select().from(threatIntel).orderBy(desc(threatIntel.createdAt));
    res.json(rows);
  } catch (err) {
    console.error("[threat-intel/list]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

const CreateSchema = z.object({
  title:       z.string().min(1).max(200),
  source:      z.string().min(1).max(100),
  threatLevel: z.enum(["low", "medium", "high", "critical"]),
  summary:     z.string().max(2000).optional(),
  verified:    z.boolean().optional(),
});

// POST /api/threat-intel
router.post("/", async (req, res) => {
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  try {
    const [row] = await db.insert(threatIntel).values({
      title:       parsed.data.title,
      source:      parsed.data.source,
      threatLevel: parsed.data.threatLevel,
      summary:     parsed.data.summary ?? null,
      verified:    parsed.data.verified ?? false,
    }).returning();
    res.status(201).json(row);
  } catch (err) {
    console.error("[threat-intel/create]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
