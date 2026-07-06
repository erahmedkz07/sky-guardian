/**
 * AI Recommendations Engine — rule-based pseudo-intelligence.
 *
 * Architecture boundary: `generateRecommendations()` is the single entry point.
 * To replace with a real AI API, change the body of that function to an async
 * call and update the component from useMemo → useEffect + useState.
 *
 * The Recommendation interface and all consumers stay unchanged.
 */

import type { Drone, Sensor, Incident, AlertEvent } from "./mockData";

// ─── Public types ─────────────────────────────────────────────

export type RecommendationTone = "threat" | "warning" | "hud" | "muted";

export type RecommendationCategory =
  | "intercept"   // требуется немедленный перехват
  | "coverage"    // пробел в сенсорном покрытии
  | "incident"    // управление инцидентом
  | "tactical"    // тактическое позиционирование / верификация
  | "system"      // системные оповещения
  | "nominal";    // штатный режим

export interface Recommendation {
  id:       string;
  tone:     RecommendationTone;
  category: RecommendationCategory;
  badge:    string;   // короткий тег, ≤ 12 символов
  text:     string;   // полный текст рекомендации
  priority: number;   // 0 = максимальный приоритет
}

export interface SystemSnapshot {
  drones:    Drone[];
  sensors:   Sensor[];
  incidents: Incident[];
  alerts:    AlertEvent[];
}

// ─── Internal helpers ─────────────────────────────────────────

const CENTER = { lat: 51.18, lng: 71.446 }; // Астана

function distKm(lat: number, lng: number): number {
  const dLat = lat - CENTER.lat;
  const dLng = (lng - CENTER.lng) * Math.cos((CENTER.lat * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng) * 111;
}

function bearingSector(deg: number): string {
  const s = ["С", "СВ", "В", "ЮВ", "Ю", "ЮЗ", "З", "СЗ"];
  return s[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}

function ageMin(date: Date | string): number {
  return (Date.now() - new Date(date).getTime()) / 60_000;
}

function fmtAge(min: number): string {
  if (min < 60) return `${Math.round(min)} мин`;
  return `${(min / 60).toFixed(1)} ч`;
}

// ─── Rule engine ──────────────────────────────────────────────

/**
 * Generates prioritised recommendations from a system snapshot.
 *
 * ── Future AI integration ──────────────────────────────────────
 * Replace the body with:
 *   const resp = await fetch("/api/ai/recommendations", {
 *     method: "POST",
 *     body: JSON.stringify(snapshot),
 *   });
 *   return resp.json() as Recommendation[];
 *
 * All callers receive the same shape — zero component changes needed.
 */
export function generateRecommendations(snap: SystemSnapshot): Recommendation[] {
  const recs: Recommendation[] = [];
  let seq = 0;
  const uid = (tag: string) => `${tag}-${++seq}`;

  // ── Pre-computed subsets ─────────────────────────────────────
  const active     = snap.drones.filter((d) => d.status === "tracked");
  const critical   = active.filter((d) => d.threat === "critical");
  const high       = active.filter((d) => d.threat === "high");
  const degraded   = snap.sensors.filter((s) => s.status === "degraded");
  const offline    = snap.sensors.filter((s) => s.status === "offline");
  const openInc    = snap.incidents.filter((i) => i.status === "open" || i.status === "investigating");
  const unackedCrit = snap.alerts.filter((a) => !a.acknowledged && a.level === "critical");

  // ── Rule 1 · Критические угрозы — немедленный перехват ──────
  for (const d of critical.slice(0, 2)) {
    const dist    = distKm(d.lat, d.lng).toFixed(1);
    const sector  = bearingSector(d.heading);
    const conf    = Math.round(d.confidence * 100);
    recs.push({
      id:       uid("intercept"),
      tone:     "threat",
      category: "intercept",
      badge:    "ПЕРЕХВАТ",
      text:     `${d.callsign} (${d.model}) — критическая угроза в ${dist} км, курс ${sector}, уверенность ${conf}%. Требуется немедленный перехват.`,
      priority: 0,
    });
  }

  // ── Rule 2 · Насыщение — ≥ 3 угрозы высокого уровня ────────
  const totalHighPlus = critical.length + high.length;
  if (totalHighPlus >= 3) {
    recs.push({
      id:       uid("saturation"),
      tone:     "threat",
      category: "tactical",
      badge:    "НАСЫЩЕНИЕ",
      text:     `Обнаружено ${totalHighPlus} активных угроз высокого уровня. Рекомендуется активировать Auto-Response и задействовать все доступные сценарии.`,
      priority: 1,
    });
  }

  // ── Rule 3 · Цели вблизи периметра (< 4 км) ─────────────────
  const near = active.filter(
    (d) => distKm(d.lat, d.lng) < 4 && (d.threat === "critical" || d.threat === "high"),
  );
  for (const d of near.slice(0, 1)) {
    if (recs.some((r) => r.text.includes(d.callsign))) continue;
    recs.push({
      id:       uid("proximity"),
      tone:     "threat",
      category: "intercept",
      badge:    "КРИТИЧНО",
      text:     `${d.callsign} вошёл в зону ближнего периметра (${distKm(d.lat, d.lng).toFixed(1)} км). Немедленная реакция.`,
      priority: 0,
    });
  }

  // ── Rule 4 · Высокие угрозы — усиленное наблюдение ──────────
  for (const d of high.slice(0, 2)) {
    const conf = Math.round(d.confidence * 100);
    recs.push({
      id:       uid("high-track"),
      tone:     "warning",
      category: "tactical",
      badge:    "ВНИМАНИЕ",
      text:     `${d.callsign}: высокий приоритет, уверенность ${conf}%, высота ${d.altitude} м. Установить сопровождение.`,
      priority: 2,
    });
  }

  // ── Rule 5 · Пробел покрытия — offline-сенсоры ──────────────
  for (const s of offline.slice(0, 2)) {
    recs.push({
      id:       uid("offline"),
      tone:     "warning",
      category: "coverage",
      badge:    "ПРОБЕЛ",
      text:     `Сенсор ${s.name} (${s.type}) отключён — зона покрытия в секторе не защищена. Требуется диагностика или замена.`,
      priority: 2,
    });
  }

  // ── Rule 6 · Деградация сенсора ─────────────────────────────
  for (const s of degraded.slice(0, 1)) {
    recs.push({
      id:       uid("degraded"),
      tone:     "hud",
      category: "coverage",
      badge:    "ДЕГРАДАЦИЯ",
      text:     `Сенсор ${s.name} (${s.type}) деградирован — сигнал ${s.signal}%, работоспособность ${s.health}%. Рекомендуется перезапуск.`,
      priority: 3,
    });
  }

  // ── Rule 7 · Долго открытые инциденты ───────────────────────
  for (const inc of openInc.slice(0, 2)) {
    const age     = ageMin(inc.createdAt);
    const noOwner = !inc.assignee;
    if (age > 20 || inc.threat === "critical" || noOwner) {
      recs.push({
        id:       uid("incident"),
        tone:     inc.threat === "critical" ? "threat" : "warning",
        category: "incident",
        badge:    age > 30 ? "ЭСКАЛАЦИЯ" : "ИНЦИДЕНТ",
        text:     `[${inc.code}] ${inc.title} — открыт ${fmtAge(age)}` +
                  (noOwner ? ", ответственный не назначен" : "") +
                  ". Требует обновления статуса.",
        priority: inc.threat === "critical" ? 1 : 3,
      });
    }
  }

  // ── Rule 8 · Низкая уверенность — требует верификации ───────
  const lowConf = active.filter(
    (d) => d.confidence < 0.55 && d.threat !== "low",
  );
  for (const d of lowConf.slice(0, 1)) {
    recs.push({
      id:       uid("verify"),
      tone:     "hud",
      category: "tactical",
      badge:    "ВЕРИФИКАЦИЯ",
      text:     `${d.callsign}: уверенность ИИ ${Math.round(d.confidence * 100)}% — недостаточно для классификации. Требуется подтверждение вторым сенсором.`,
      priority: 4,
    });
  }

  // ── Rule 9 · Много непрочитанных критических алертов ────────
  if (unackedCrit.length >= 4) {
    recs.push({
      id:       uid("alerts"),
      tone:     "warning",
      category: "system",
      badge:    "АЛЕРТЫ",
      text:     `${unackedCrit.length} критических оповещений не подтверждены. Рекомендуется групповое подтверждение.`,
      priority: 4,
    });
  }

  // ── Rule 10 · Штатный режим ──────────────────────────────────
  if (recs.length === 0) {
    recs.push({
      id:       uid("nominal"),
      tone:     "hud",
      category: "nominal",
      badge:    "НОРМА",
      text:     "Активных угроз не обнаружено. Сенсорная сеть в штатном режиме. Система ожидает контакт.",
      priority: 10,
    });
    if (offline.length === 0 && degraded.length === 0) {
      recs.push({
        id:       uid("maintenance"),
        tone:     "muted",
        category: "system",
        badge:    "ПЛАНОВОЕ",
        text:     `Все ${snap.sensors.length} сенсоров онлайн. Рекомендуется плановая калибровка каждые 24 часа.`,
        priority: 11,
      });
    }
  }

  // Sort by priority, cap at 5
  return recs.sort((a, b) => a.priority - b.priority).slice(0, 5);
}
