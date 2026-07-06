import { Router } from "express";
import { db } from "../db/client.js";
import { auditLogs } from "../db/schema.js";
import { desc } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.js";
import type { AuthRequest } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

// GET /api/audit?limit=100
router.get("/", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  try {
    const rows = await db.select().from(auditLogs)
      .orderBy(desc(auditLogs.timestamp))
      .limit(limit);
    res.json(rows);
  } catch (err) {
    console.error("[audit/list]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/audit (internal — log an action)
router.post("/", async (req: AuthRequest, res) => {
  try {
    const { action, resource, resourceId, details } = req.body as {
      action: string; resource?: string; resourceId?: string; details?: object;
    };
    const [log] = await db.insert(auditLogs).values({
      userId:       req.user?.userId,
      operatorName: req.user?.name,
      action,
      resource,
      resourceId,
      details,
      ipAddress:    req.ip,
    }).returning();
    res.status(201).json(log);
  } catch (err) {
    console.error("[audit/create]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
