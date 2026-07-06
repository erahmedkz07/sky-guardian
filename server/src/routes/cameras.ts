import { Router } from "express";
import { db } from "../db/client.js";
import { cameras } from "../db/schema.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

// GET /api/cameras
router.get("/", async (_req, res) => {
  try {
    const rows = await db.select().from(cameras).orderBy(cameras.name);
    res.json(rows);
  } catch (err) {
    console.error("[cameras/list]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
