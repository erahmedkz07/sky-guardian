/**
 * useLiveAlerts — real-time alert feed for the Command Center.
 *
 * Sources:
 *  1. store.alerts  — persisted DB records (may be stale, shown after live events)
 *  2. liveEvents    — generated here from state-change detection:
 *       • new tracked drone with high/critical threat
 *       • drone threat level escalated
 *       • drone status changed by operator
 *       • sensor goes offline / degraded / restored
 *       • new incident opened
 *
 * store.ts separately injects `feed:event` WebSocket events into store.alerts
 * (they arrive with new Date() timestamps and always surface at the top).
 */

import { useEffect, useRef, useState, useMemo } from "react";
import { useStore } from "./store";
import type { AlertEvent, Drone, Sensor, Incident } from "./mockData";

export interface LiveAlert extends AlertEvent {
  _live: boolean; // true = generated now, false = from DB
}

const THREAT_RANK: Record<string, number> = {
  critical: 0, high: 1, medium: 2, low: 3,
};

let _liveSeq = Date.now();
function uid() { return `live-${++_liveSeq}`; }

export function useLiveAlerts(max = 40): LiveAlert[] {
  const drones       = useStore((s) => s.drones);
  const sensors      = useStore((s) => s.sensors);
  const incidents    = useStore((s) => s.incidents);
  const stored       = useStore((s) => s.alerts);
  const apiConnected = useStore((s) => s.apiConnected);

  const prevDrones       = useRef(new Map<string, Drone>());
  const prevSensors      = useRef(new Map<string, Sensor>());
  const prevIncidents    = useRef(new Set<string>());
  const initialized      = useRef(false);
  // Tracks last known apiConnected value to detect mock→API source switch
  const prevApiConnected = useRef(false);

  const [live, setLive] = useState<LiveAlert[]>([]);

  // ── Detect state changes → emit live events ─────────────────
  useEffect(() => {
    if (!initialized.current) {
      // First load: seed refs silently, no alerts generated
      drones.forEach((d) => prevDrones.current.set(d.id, d));
      sensors.forEach((s) => prevSensors.current.set(s.id, s));
      incidents.forEach((i) => prevIncidents.current.add(i.id));
      prevApiConnected.current = apiConnected;
      initialized.current = true;
      return;
    }

    // When API connects for the first time, real data replaces mock data.
    // Re-seed refs silently to avoid spurious events from mock→API state diff.
    if (apiConnected && !prevApiConnected.current) {
      prevApiConnected.current = true;
      const nextDMap = new Map<string, Drone>();
      drones.forEach((d) => nextDMap.set(d.id, d));
      prevDrones.current = nextDMap;
      const nextSMap = new Map<string, Sensor>();
      sensors.forEach((s) => nextSMap.set(s.id, s));
      prevSensors.current = nextSMap;
      prevIncidents.current = new Set(incidents.map((i) => i.id));
      return;
    }
    prevApiConnected.current = apiConnected;

    const events: LiveAlert[] = [];
    const now = new Date();

    // ── Drones ────────────────────────────────────────────────
    const prevD = prevDrones.current;
    for (const d of drones) {
      const prev = prevD.get(d.id);

      if (!prev) {
        // New drone just appeared
        if (d.status === "tracked" && (d.threat === "critical" || d.threat === "high")) {
          events.push({
            id:           uid(),
            level:        d.threat,
            title:        `Новый контакт: ${d.callsign}`,
            message:      `Обнаружен ${d.model} — угроза ${d.threat.toUpperCase()}, уверенность ${Math.round(d.confidence * 100)}%`,
            source:       d.callsign,
            acknowledged: false,
            timestamp:    now,
            _live:        true,
          });
        }
      } else {
        // Threat escalated (e.g. medium → high or high → critical)
        const prevRank = THREAT_RANK[prev.threat] ?? 9;
        const currRank = THREAT_RANK[d.threat]  ?? 9;
        if (currRank < prevRank && (d.threat === "critical" || d.threat === "high")) {
          events.push({
            id:           uid(),
            level:        d.threat,
            title:        `Угроза усилилась: ${d.callsign}`,
            message:      `${prev.threat.toUpperCase()} → ${d.threat.toUpperCase()} · высота ${d.altitude} м, скорость ${Math.round(d.speed)} км/ч`,
            source:       d.callsign,
            acknowledged: false,
            timestamp:    now,
            _live:        true,
          });
        }

        // Operator changed status
        if (prev.status !== d.status && d.status !== "tracked") {
          const labels: Record<string, string> = {
            intercepted: "Перехвачен",
            neutralized: "Нейтрализован",
            lost:        "Потерян",
          };
          events.push({
            id:           uid(),
            level:        d.status === "neutralized" ? "low" : "medium",
            title:        `${labels[d.status] ?? d.status}: ${d.callsign}`,
            message:      `Статус изменён оператором: ${prev.status.toUpperCase()} → ${d.status.toUpperCase()}`,
            source:       d.callsign,
            acknowledged: false,
            timestamp:    now,
            _live:        true,
          });
        }
      }
    }
    const nextDMap = new Map<string, Drone>();
    drones.forEach((d) => nextDMap.set(d.id, d));
    prevDrones.current = nextDMap;

    // ── Sensors ───────────────────────────────────────────────
    const prevS = prevSensors.current;
    for (const s of sensors) {
      const prev = prevS.get(s.id);
      if (!prev || prev.status === s.status) continue;

      if (s.status === "offline") {
        events.push({
          id:           uid(),
          level:        "high",
          title:        `Сенсор отключён: ${s.name}`,
          message:      `${s.name} (${s.type}) перешёл в OFFLINE — зона покрытия не защищена`,
          source:       s.id,
          acknowledged: false,
          timestamp:    now,
          _live:        true,
        });
      } else if (s.status === "degraded") {
        events.push({
          id:           uid(),
          level:        "medium",
          title:        `Деградация: ${s.name}`,
          message:      `${s.name} (${s.type}) — сигнал ${s.signal}%, работоспособность ${s.health}%`,
          source:       s.id,
          acknowledged: false,
          timestamp:    now,
          _live:        true,
        });
      } else if (s.status === "online" && (prev.status === "offline" || prev.status === "degraded")) {
        events.push({
          id:           uid(),
          level:        "low",
          title:        `Сенсор восстановлен: ${s.name}`,
          message:      `${s.name} (${s.type}) вернулся в ONLINE — покрытие восстановлено`,
          source:       s.id,
          acknowledged: false,
          timestamp:    now,
          _live:        true,
        });
      }
    }
    const nextSMap = new Map<string, Sensor>();
    sensors.forEach((s) => nextSMap.set(s.id, s));
    prevSensors.current = nextSMap;

    // ── Incidents ─────────────────────────────────────────────
    const prevI = prevIncidents.current;
    if (prevI.size > 0) {
      for (const inc of incidents) {
        if (!prevI.has(inc.id)) {
          events.push({
            id:           uid(),
            level:        inc.threat,
            title:        `Инцидент открыт: [${inc.code}]`,
            message:      inc.title,
            source:       inc.code,
            acknowledged: false,
            timestamp:    now,
            _live:        true,
          });
        }
      }
    }
    prevIncidents.current = new Set(incidents.map((i) => i.id));

    if (events.length > 0) {
      setLive((prev) => [...events, ...prev].slice(0, 30));
    }
  }, [drones, sensors, incidents, apiConnected]);

  // ── Merge live + stored, sort by timestamp desc ──────────────
  return useMemo(() => {
    const all: LiveAlert[] = [
      ...live,
      ...stored.map((a) => ({ ...a, _live: false as const })),
    ];
    const seen = new Set<string>();
    return all
      .filter((a) => !seen.has(a.id) && seen.add(a.id))
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, max);
  }, [live, stored, max]);
}
