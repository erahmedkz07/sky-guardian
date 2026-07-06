import { Router } from "express";
import { db } from "../db/client.js";
import { playbooks, auditLogs } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.js";
import type { AuthRequest } from "../middleware/auth.js";
import { notifier } from "../bot/notifier.js";

const router = Router();
router.use(requireAuth);

// GET /api/playbooks
router.get("/", async (_req, res) => {
  try {
    const rows = await db.select().from(playbooks).orderBy(playbooks.name);
    res.json(rows);
  } catch (err) {
    console.error("[playbooks/list]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/playbooks/:id/execute
router.post("/:id/execute", async (req: AuthRequest, res) => {
  try {
    const playbookId = req.params.id as string;
    const [pb] = await db.select().from(playbooks).where(eq(playbooks.id, playbookId)).limit(1);
    if (!pb) { res.status(404).json({ error: "Playbook not found" }); return; }

    await db.insert(auditLogs).values({
      userId:       req.user?.userId ?? undefined,
      operatorName: req.user?.name ?? undefined,
      action:       "PLAYBOOK_EXECUTE",
      resource:     "playbook",
      resourceId:   pb.id,
      details:      { name: pb.name, threatLevel: pb.threatLevel } as object,
      ipAddress:    req.ip ?? undefined,
    });

    res.json({ ok: true, playbookId: pb.id, name: pb.name, executedAt: new Date().toISOString() });
    notifier.playbookExecuted(pb.name, pb.threatLevel).catch(() => {});
  } catch (err) {
    console.error("[playbooks/execute]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
