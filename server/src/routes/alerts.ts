import { Router } from "express";
import { db } from "../db/client.js";
import { alertEvents } from "../db/schema.js";
import { eq, desc } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

// GET /api/alerts
router.get("/", async (_req, res) => {
  try {
    const rows = await db.select().from(alertEvents).orderBy(desc(alertEvents.timestamp));
    const mapped = rows.map((a) => ({
      id:           a.id,
      level:        a.level,
      title:        a.title,
      message:      a.message,
      timestamp:    a.timestamp,
      source:       a.source,
      acknowledged: a.acknowledged,
    }));
    res.json(mapped);
  } catch (err) {
    console.error("[alerts/list]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/alerts/:id/acknowledge
router.patch("/:id/acknowledge", async (req, res) => {
  try {
    const [updated] = await db.update(alertEvents)
      .set({ acknowledged: true })
      .where(eq(alertEvents.id, req.params.id))
      .returning();
    if (!updated) { res.status(404).json({ error: "Alert not found" }); return; }
    res.json(updated);
  } catch (err) {
    console.error("[alerts/acknowledge]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
