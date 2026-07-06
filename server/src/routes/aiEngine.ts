import { Router } from "express";
import { db } from "../db/client.js";
import { aiSettings, aiPendingActions, drones, detections, incidents } from "../db/schema.js";
import { eq, desc, inArray } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.js";
import type { AuthRequest } from "../middleware/auth.js";
import {
  getAiSettings,
  invalidateSettingsCache,
  executePendingAction,
  rejectPendingAction,
  periodicEvaluate,
} from "../services/aiEngine.js";

const router = Router();
router.use(requireAuth);

// GET /api/ai-engine/settings
router.get("/settings", async (_req, res) => {
  try {
    const s = await getAiSettings();
    res.json(s);
  } catch (err) {
    console.error("[ai-engine/settings get]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/ai-engine/settings
router.patch("/settings", async (req: AuthRequest, res) => {
  try {
    const { opMode, autoIncident, autoAck, autoPlaybook, globalMinConfidence, modelSettings } = req.body;

    const upsertData = {
      id:          1,
      updatedAt:   new Date(),
      ...(opMode              !== undefined && { opMode }),
      ...(autoIncident        !== undefined && { autoIncident }),
      ...(autoAck             !== undefined && { autoAck }),
      ...(autoPlaybook        !== undefined && { autoPlaybook }),
      ...(globalMinConfidence !== undefined && { globalMinConfidence }),
      ...(modelSettings       !== undefined && { modelSettings }),
    };

    await db
      .insert(aiSettings)
      .values(upsertData)
      .onConflictDoUpdate({ target: aiSettings.id, set: upsertData });

    invalidateSettingsCache();
    const updated = await getAiSettings();
    res.json(updated);
  } catch (err) {
    console.error("[ai-engine/settings patch]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/ai-engine/pending
router.get("/pending", async (_req, res) => {
  try {
    const rows = await db
      .select()
      .from(aiPendingActions)
      .where(eq(aiPendingActions.status, "pending"))
      .orderBy(desc(aiPendingActions.createdAt))
      .limit(50);
    res.json(rows);
  } catch (err) {
    console.error("[ai-engine/pending]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/ai-engine/pending  (create manual pending action)
router.post("/pending", async (req: AuthRequest, res) => {
  try {
    const { actionType, payload, reason, confidence } = req.body as {
      actionType: string;
      payload: Record<string, unknown>;
      reason: string;
      confidence: number;
    };
    if (!actionType || !reason) {
      return res.status(400).json({ error: "actionType and reason required" });
    }
    const [row] = await db
      .insert(aiPendingActions)
      .values({ actionType, payload, reason, confidence: confidence ?? 80, status: "pending" })
      .returning();
    res.json(row);
  } catch (err) {
    console.error("[ai-engine/pending post]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/ai-engine/history
router.get("/history", async (_req, res) => {
  try {
    const rows = await db
      .select()
      .from(aiPendingActions)
      .orderBy(desc(aiPendingActions.createdAt))
      .limit(100);
    res.json(rows);
  } catch (err) {
    console.error("[ai-engine/history]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/ai-engine/pending/:id/approve
router.post("/pending/:id/approve", async (req: AuthRequest, res) => {
  try {
    const resolvedBy = req.user?.name ?? "operator";
    await executePendingAction(req.params.id as string, resolvedBy);
    res.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Internal server error";
    res.status(400).json({ error: msg });
  }
});

// POST /api/ai-engine/pending/:id/reject
router.post("/pending/:id/reject", async (req: AuthRequest, res) => {
  try {
    const resolvedBy = req.user?.name ?? "operator";
    await rejectPendingAction(req.params.id as string, resolvedBy);
    res.json({ ok: true });
  } catch (err) {
    console.error("[ai-engine/reject]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/ai-engine/evaluate  (manual trigger)
router.post("/evaluate", async (_req, res) => {
  try {
    await periodicEvaluate();
    res.json({ ok: true, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error("[ai-engine/evaluate]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Fallback analysis (no LLM call) ──────────────────────────
// Used when Claude API is unreachable (no credits / network / rate limit).
// Built from the same live DB data, deterministic rule-based reasoning.
interface AnalysisResult {
  threatLevel: string;
  summary: string;
  observations: string[];
  recommendations: string[];
  actions: Array<{ type: string; priority: string; description: string; confidence: number }>;
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

interface FallbackDrone {
  callsign: string; model: string; threat: string; confidence: number;
  status: string; altitudeM: number; speedKmh: number; lat: number; lng: number;
}
interface FallbackDetection { callsign: string; threat: string; sensorId: string | null }
interface FallbackIncident { code: string; title: string; threat: string; status: string }

function buildFallbackAnalysis(
  activeDrones: FallbackDrone[],
  recentDets: FallbackDetection[],
  openIncs: FallbackIncident[],
): AnalysisResult {
  const critical = activeDrones.filter((d) => d.threat === "critical");
  const high     = activeDrones.filter((d) => d.threat === "high");
  const medium   = activeDrones.filter((d) => d.threat === "medium");
  const low      = activeDrones.filter((d) => d.threat === "low");

  const threatLevel = critical.length > 0 ? "critical"
    : high.length > 0 ? "high"
    : medium.length > 0 || openIncs.length > 0 ? "medium"
    : "low";

  const avgConf = activeDrones.length
    ? Math.round(activeDrones.reduce((s, d) => s + d.confidence, 0) / activeDrones.length * 100)
    : 0;
  const avgAlt = activeDrones.length
    ? Math.round(activeDrones.reduce((s, d) => s + d.altitudeM, 0) / activeDrones.length)
    : 0;
  const sensorsInvolved = [...new Set(recentDets.map((d) => d.sensorId).filter(Boolean))];

  // ── Summary ──
  let summary: string;
  if (activeDrones.length === 0) {
    summary = pick([
      "Активных контактов в зоне ответственности не зафиксировано. Сенсорная сеть работает в штатном режиме, признаков несанкционированного вторжения нет.",
      "Воздушное пространство чистое — ни один из развёрнутых сенсоров не фиксирует активных целей. Рекомендуется штатное продолжение мониторинга.",
    ]);
  } else {
    const headline = critical.length
      ? `обнаружено ${critical.length} контакт(ов) критического уровня угрозы — требуется немедленное реагирование`
      : high.length
        ? `${high.length} контакт(ов) классифицированы как высокая угроза и находятся под усиленным наблюдением`
        : `обстановка контролируется, контакты среднего/низкого приоритета сопровождаются в штатном режиме`;
    summary = `За текущий цикл оценки активны ${activeDrones.length} контакт(ов) (средняя достоверность классификации ${avgConf}%, средняя высота ${avgAlt} м): ${headline}. ` +
      (openIncs.length > 0
        ? `Параллельно открыто ${openIncs.length} инцидент(ов), требующих разбора оператором.`
        : `Открытых инцидентов на данный момент нет.`);
  }

  // ── Observations ──
  const observations: string[] = [];
  if (critical.length) {
    observations.push(`Критическая угроза по контакт${critical.length > 1 ? "ам" : "у"}: ${critical.map((d) => `${d.callsign} (${d.model}, ${Math.round(d.confidence * 100)}% достоверности, ${d.altitudeM} м)`).join("; ")}`);
  }
  if (high.length) {
    observations.push(`${high.length} контакт(ов) высокого приоритета: ${high.map((d) => `${d.callsign} (скорость ${Math.round(d.speedKmh)} км/ч)`).join(", ")} — траектория требует пересчёта на следующем цикле`);
  }
  if (medium.length) observations.push(`${medium.length} контакт(ов) среднего уровня угрозы продолжают сопровождаться пассивно, эскалации не зафиксировано`);
  if (low.length) observations.push(`${low.length} низкоприоритетных контакт(ов) (${low.map((d) => d.callsign).join(", ")}) классифицированы как вероятный фоновый трафик`);
  if (openIncs.length) observations.push(`Незакрытые инциденты: ${openIncs.map((i) => `${i.code} — ${i.title}`).join("; ")}`);
  if (sensorsInvolved.length) observations.push(`Обнаружения поступали с ${sensorsInvolved.length} сенсорных узлов (${sensorsInvolved.slice(0, 4).join(", ")}), всего ${recentDets.length} событий за анализируемый период`);
  if (observations.length === 0) observations.push("Аномалий в потоке телеметрии не выявлено, все сенсорные узлы в рабочем диапазоне");

  // ── Recommendations ──
  const recommendations: string[] = [];
  if (critical.length) recommendations.push(pick([
    "Немедленно активировать протокол CRITICAL INCURSION RESPONSE и запросить подтверждение визуальным каналом",
    "Перевести AI-CORE в режим повышенной готовности и подготовить расчёт на принятие решения по нейтрализации",
  ]));
  if (high.length) recommendations.push("Усилить визуальное и РЛ-наблюдение по контактам высокой угрозы, подготовить расчёт на перехват без эскалации до подтверждения");
  if (medium.length) recommendations.push("Продолжить пассивное сопровождение контактов среднего уровня, повторно оценить через следующий цикл");
  if (openIncs.length) recommendations.push("Назначить ответственного оператора по каждому открытому инциденту и зафиксировать решение в журнале");
  if (recommendations.length === 0) recommendations.push(pick([
    "Поддерживать текущий режим мониторинга, дополнительных действий не требуется",
    "Сохранять штатный режим работы сенсорной сети, плановых изменений конфигурации не требуется",
  ]));

  // ── Actions ──
  const actions: AnalysisResult["actions"] = [];
  for (const d of critical) {
    actions.push({ type: "CREATE_INCIDENT", priority: "high", description: `Открыть инцидент по контакту ${d.callsign} (критическая угроза, высота ${d.altitudeM} м)`, confidence: Math.round(d.confidence * 100) });
  }
  for (const d of high) {
    actions.push({ type: "RUN_PLAYBOOK", priority: "medium", description: `Запустить плейбук реагирования для ${d.callsign}`, confidence: Math.round(d.confidence * 100) });
  }
  if (medium.length && !critical.length && !high.length) {
    actions.push({ type: "INCREASE_MONITORING", priority: "low", description: `Усилить мониторинг контактов среднего приоритета (${medium.map((d) => d.callsign).join(", ")})`, confidence: 75 });
  }
  if (activeDrones.length === 0 && openIncs.length === 0) {
    actions.push({ type: "INCREASE_MONITORING", priority: "low", description: "Плановая проверка сенсорной сети", confidence: 70 });
  }

  return { threatLevel, summary, observations, recommendations, actions };
}

// POST /api/ai-engine/analyze  (Claude AI threat analysis)
router.post("/analyze", async (req: AuthRequest, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: "ANTHROPIC_API_KEY not configured" });
  }

  try {
    const [activeDrones, recentDets, openIncs] = await Promise.all([
      db.select().from(drones)
        .where(inArray(drones.status, ["tracked", "intercepted"]))
        .limit(20),
      db.select().from(detections)
        .orderBy(desc(detections.createdAt))
        .limit(20),
      db.select().from(incidents)
        .where(inArray(incidents.status, ["open", "investigating"]))
        .limit(10),
    ]);

    const droneLines = activeDrones.length === 0
      ? "Активных дронов нет."
      : activeDrones.map((d) =>
          `  - ${d.callsign} (${d.model}): угроза=${d.threat}, уверенность=${Math.round(d.confidence * 100)}%, высота=${d.altitudeM}м, скорость=${Math.round(d.speedKmh)}км/ч, статус=${d.status}`
        ).join("\n");

    const detLines = recentDets.length === 0
      ? "Недавних обнаружений нет."
      : recentDets.slice(0, 10).map((d) =>
          `  - ${d.callsign}: угроза=${d.threat}, уверенность=${Math.round(d.confidence * 100)}%`
        ).join("\n");

    const incLines = openIncs.length === 0
      ? "Открытых инцидентов нет."
      : openIncs.map((i) =>
          `  - [${i.code}] ${i.title}: угроза=${i.threat}, статус=${i.status}`
        ).join("\n");

    const systemPrompt = `Ты — AI-модуль системы Sky Guardian (дроновая система противодействия БПЛА). Анализируй тактическую обстановку и давай чёткие оперативные рекомендации на русском языке. Будь лаконичен и конкретен.`;

    const userMsg = `ТЕКУЩАЯ ТАКТИЧЕСКАЯ ОБСТАНОВКА (${new Date().toISOString()})

АКТИВНЫЕ ДРОНЫ (${activeDrones.length}):
${droneLines}

НЕДАВНИЕ ОБНАРУЖЕНИЯ (последние ${recentDets.length}):
${detLines}

ОТКРЫТЫЕ ИНЦИДЕНТЫ (${openIncs.length}):
${incLines}

Проведи анализ и ответь строго в JSON:
{
  "threatLevel": "low|medium|high|critical",
  "summary": "Краткая оценка обстановки (2-3 предложения)",
  "observations": ["наблюдение 1", "наблюдение 2", "наблюдение 3"],
  "recommendations": ["рекомендация 1", "рекомендация 2", "рекомендация 3"],
  "actions": [
    { "type": "CREATE_INCIDENT|ACK_ALERT|RUN_PLAYBOOK|INCREASE_MONITORING", "priority": "high|medium|low", "description": "краткое описание действия", "confidence": 85 }
  ]
}`;

    let parsed: AnalysisResult;
    let source: "claude" | "fallback" = "claude";

    try {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic({ apiKey });

      const message = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: "user", content: userMsg }],
      });

      const text = message.content[0].type === "text" ? message.content[0].text : "{}";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("Не удалось разобрать ответ AI");
      parsed = JSON.parse(jsonMatch[0]) as AnalysisResult;
    } catch (apiErr) {
      // Claude API unreachable (no credits / network / rate limit) —
      // fall back to a rule-based analysis built from the same live data.
      console.error("[ai-engine/analyze] Claude API call failed, using fallback:", apiErr);
      parsed = buildFallbackAnalysis(activeDrones, recentDets, openIncs);
      source = "fallback";
    }

    res.json({ ...parsed, source, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error("[ai-engine/analyze]", err);
    res.status(500).json({ error: "Ошибка анализа AI" });
  }
});

export default router;
