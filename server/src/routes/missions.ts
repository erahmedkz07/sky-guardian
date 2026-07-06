import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { missions, auditLogs } from "../db/schema.js";
import { eq, desc } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.js";
import type { AuthRequest } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

// Terminal states — no further status transitions allowed
// Note: "completed" is NOT terminal — missions can be reopened (completed → active)
const TERMINAL_STATUSES = new Set(["aborted"]);

// Valid FSM transitions
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  planned:   ["active"],
  active:    ["completed", "aborted"],
  completed: ["active"], // reopen
};

// GET /api/missions
router.get("/", async (_req, res) => {
  try {
    const rows = await db.select().from(missions).orderBy(desc(missions.createdAt));
    res.json(rows);
  } catch (err) {
    console.error("[missions/list]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

const CreateMissionSchema = z.object({
  name:        z.string().min(3).max(200),
  priority:    z.enum(["low", "medium", "high", "critical"]).default("medium"),
  assignee:    z.string().max(100).optional(),
  description: z.string().max(2000).optional(),
});

// POST /api/missions
router.post("/", async (req: AuthRequest, res) => {
  const parsed = CreateMissionSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  try {
    const id = `MSN-${Date.now().toString(36).toUpperCase()}`;
    const [created] = await db.insert(missions).values({
      id,
      code:        id,
      name:        parsed.data.name,
      status:      "planned",
      priority:    parsed.data.priority,
      assignee:    parsed.data.assignee,
      description: parsed.data.description,
    }).returning();

    res.status(201).json(created);

    db.insert(auditLogs).values({
      userId:       req.user?.userId ?? undefined,
      operatorName: req.user?.name ?? undefined,
      action:       "MISSION_CREATED",
      resource:     "mission",
      resourceId:   id,
      details:      { name: parsed.data.name, priority: parsed.data.priority } as object,
      ipAddress:    req.ip ?? undefined,
    }).catch(() => {});
  } catch (err) {
    console.error("[missions/create]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

const PatchMissionSchema = z.object({
  status:   z.enum(["planned", "active", "completed", "aborted"]).optional(),
  assignee: z.string().max(100).optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
});

// PATCH /api/missions/:id
router.patch("/:id", async (req: AuthRequest, res) => {
  const parsed = PatchMissionSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  try {
    const missionId = req.params.id as string;

    // Fetch current status to enforce FSM
    const [current] = await db
      .select({ status: missions.status })
      .from(missions)
      .where(eq(missions.id, missionId))
      .limit(1);

    if (!current) { res.status(404).json({ error: "Mission not found" }); return; }

    if (TERMINAL_STATUSES.has(current.status)) {
      res.status(409).json({ error: `Mission is ${current.status} — terminal state, no further transitions allowed` });
      return;
    }

    if (parsed.data.status) {
      const allowed = ALLOWED_TRANSITIONS[current.status] ?? [];
      if (!allowed.includes(parsed.data.status)) {
        res.status(400).json({ error: `Invalid transition: ${current.status} → ${parsed.data.status}` });
        return;
      }
    }

    // When reopening (completed → active): clear endTime, stamp startTime
    const timeFields: Record<string, unknown> = {};
    if (parsed.data.status === "active" && current.status === "completed") {
      timeFields.startTime = new Date();
      timeFields.endTime   = null;
    }
    // When completing (active → completed): stamp endTime
    if (parsed.data.status === "completed" && current.status === "active") {
      timeFields.endTime = new Date();
    }
    // When activating for the first time (planned → active): stamp startTime
    if (parsed.data.status === "active" && current.status === "planned") {
      timeFields.startTime = new Date();
    }

    const [updated] = await db.update(missions)
      .set({ ...parsed.data, ...timeFields, updatedAt: new Date() })
      .where(eq(missions.id, missionId))
      .returning();

    res.json(updated);

    db.insert(auditLogs).values({
      userId:       req.user?.userId ?? undefined,
      operatorName: req.user?.name ?? undefined,
      action:       "MISSION_UPDATE",
      resource:     "mission",
      resourceId:   missionId,
      details:      { from: current.status, ...parsed.data } as object,
      ipAddress:    req.ip ?? undefined,
    }).catch(() => {});
  } catch (err) {
    console.error("[missions/patch]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/missions/:id
router.delete("/:id", async (req: AuthRequest, res) => {
  try {
    const [removed] = await db.delete(missions).where(eq(missions.id, req.params.id)).returning();
    if (!removed) { res.status(404).json({ error: "Mission not found" }); return; }
    res.json({ ok: true });
  } catch (err) {
    console.error("[missions/delete]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
