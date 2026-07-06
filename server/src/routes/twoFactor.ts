import { Router } from "express";
import { generateSecret, generateSync, verifySync, generateURI } from "otplib";
import qrcode from "qrcode";
import { z } from "zod";
import { db } from "../db/client.js";
import { users } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";

const router = Router();

function checkCode(code: string, secret: string): boolean {
  const result = verifySync({ token: code, secret });
  return typeof result === "object" ? result.valid : !!result;
}

// POST /api/auth/2fa/setup
router.post("/setup", requireAuth, async (req: AuthRequest, res) => {
  try {
    const [user] = await db.select().from(users).where(eq(users.id, req.user!.userId)).limit(1);
    if (!user) { res.status(404).json({ error: "User not found" }); return; }
    if (user.totpEnabled) { res.status(400).json({ error: "2FA is already enabled" }); return; }

    const secret    = generateSecret();
    const otpAuth   = generateURI({ secret, label: user.email, issuer: "Sky Guardian" });
    const qrDataUrl = await qrcode.toDataURL(otpAuth);

    await db.update(users)
      .set({ totpSecret: secret, updatedAt: new Date() })
      .where(eq(users.id, user.id));

    res.json({ secret, qrDataUrl });
  } catch (err) {
    console.error("[2fa/setup]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/auth/2fa/verify
router.post("/verify", requireAuth, async (req: AuthRequest, res) => {
  const { code } = z.object({ code: z.string().length(6) }).parse(req.body);
  try {
    const [user] = await db.select().from(users).where(eq(users.id, req.user!.userId)).limit(1);
    if (!user || !user.totpSecret) { res.status(400).json({ error: "2FA setup not started" }); return; }

    if (!checkCode(code, user.totpSecret)) { res.status(400).json({ error: "Invalid code" }); return; }

    await db.update(users)
      .set({ totpEnabled: true, updatedAt: new Date() })
      .where(eq(users.id, user.id));

    res.json({ ok: true });
  } catch (err) {
    console.error("[2fa/verify]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/auth/2fa/disable
router.delete("/disable", requireAuth, async (req: AuthRequest, res) => {
  const { code } = z.object({ code: z.string().length(6) }).parse(req.body);
  try {
    const [user] = await db.select().from(users).where(eq(users.id, req.user!.userId)).limit(1);
    if (!user || !user.totpEnabled || !user.totpSecret) {
      res.status(400).json({ error: "2FA is not enabled" }); return;
    }

    if (!checkCode(code, user.totpSecret)) { res.status(400).json({ error: "Invalid code" }); return; }

    await db.update(users)
      .set({ totpEnabled: false, totpSecret: null, updatedAt: new Date() })
      .where(eq(users.id, user.id));

    res.json({ ok: true });
  } catch (err) {
    console.error("[2fa/disable]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Export helper for use in auth.ts
export { generateSecret, generateSync, checkCode };
export default router;
