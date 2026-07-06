import { Router } from "express";
import { db } from "../db/client.js";
import { simulationResults } from "../db/schema.js";
import { and, desc, eq } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.js";
import type { AuthRequest } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

// GET /api/simulations — list results for current user (last 20)
router.get("/", async (req: AuthRequest, res) => {
  try {
    const rows = await db
      .select()
      .from(simulationResults)
      .where(eq(simulationResults.userId, req.user!.userId))
      .orderBy(desc(simulationResults.completedAt))
      .limit(20);
    res.json(rows);
  } catch (err) {
    console.error("[simulations/list]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/simulations — save a completed or aborted simulation result
router.post("/", async (req: AuthRequest, res) => {
  try {
    const {
      scenarioId, scenarioName, difficulty,
      score, neutralized, threats, elapsedS, aborted,
    } = req.body as {
      scenarioId:   string;
      scenarioName: string;
      difficulty:   string;
      score:        number;
      neutralized:  number;
      threats:      number;
      elapsedS:     number;
      aborted:      boolean;
    };

    const [row] = await db
      .insert(simulationResults)
      .values({
        userId:       req.user!.userId,
        operatorName: req.user!.name,
        scenarioId,
        scenarioName,
        difficulty,
        score,
        neutralized,
        threats,
        elapsedS,
        aborted: Boolean(aborted),
      })
      .returning();

    res.status(201).json(row);
  } catch (err) {
    console.error("[simulations/create]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/simulations/:id — delete a result belonging to current user
router.delete("/:id", async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const deleted = await db
      .delete(simulationResults)
      .where(and(eq(simulationResults.id, id), eq(simulationResults.userId, req.user!.userId)))
      .returning({ id: simulationResults.id });
    if (deleted.length === 0) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (err) {
    console.error("[simulations/delete]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
