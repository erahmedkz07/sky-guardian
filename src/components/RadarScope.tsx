// Cinematic tactical radar scope.
// - Sweep rotates exactly around (0,0) via native SVG <animateTransform>
//   (CSS transform-origin on SVG <g> is unreliable cross-browser).
// - Blip positions are smoothly interpolated to the latest store value
//   via requestAnimationFrame, so contacts glide instead of teleporting
//   between 1.2s store ticks.
// - When the sweep passes over a contact, the blip flashes brightly and
//   leaves a fading echo — classic "movie radar" feel.

import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { PATROL_CENTER } from "@/lib/mockData";

const VIEW = 320; // SVG viewBox is -160..160
const R_OUTER = 150;
const SWEEP_PERIOD_MS = 4000; // one full revolution

// At Astana (51.18°N): 1°lat ≈ 111km, 1°lng ≈ 69.7km.
// R_OUTER = 150px covers RANGE_KM = 35km.
const RANGE_KM = 35;
const COS_LAT = Math.cos((51.18 * Math.PI) / 180); // ≈ 0.628
const LAT_SCALE = (111 * R_OUTER) / RANGE_KM;          // px per °lat ≈ 476
const LNG_SCALE = (111 * COS_LAT * R_OUTER) / RANGE_KM; // px per °lng ≈ 299
const color = (t: string) =>
  t === "critical" || t === "high"
    ? "var(--threat)"
    : t === "medium"
      ? "var(--warning)"
      : "var(--hud)";

interface Blip {
  id: string;
  x: number;
  y: number;
  threat: string;
  callsign: string;
  /** angle of contact from radar centre, 0° = N, clockwise. */
  angle: number;
  /** wall-clock ms when sweep last crossed this blip. */
  lastHit: number;
}

export function RadarScope() {
  const drones = useStore((s) => s.drones);

  // Targets — recomputed from store on every render.
  const targets = drones.map((d) => {
    const x = (d.lng - PATROL_CENTER.lng) * LNG_SCALE;
    const y = (d.lat - PATROL_CENTER.lat) * -LAT_SCALE;
    // SVG: -y is up, +x is right. Convert to compass bearing (0 = N, CW).
    let angle = Math.atan2(x, -y) * (180 / Math.PI);
    if (angle < 0) angle += 360;
    return {
      id: d.id,
      tx: x,
      ty: y,
      threat: d.threat,
      callsign: d.callsign,
      angle,
    };
  });

  // Smoothly interpolated render positions.
  const stateRef = useRef<Map<string, Blip>>(new Map());
  const targetRef = useRef(targets);
  targetRef.current = targets;
  const startRef = useRef<number>(0);
  const [, force] = useState(0);

  useEffect(() => {
    let raf = 0;
    if (typeof performance !== "undefined") startRef.current = performance.now();

    const tick = () => {
      const now = performance.now();
      const sweepAngle = (((now - startRef.current) / SWEEP_PERIOD_MS) * 360) % 360;

      const map = stateRef.current;
      const seen = new Set<string>();

      targetRef.current.forEach((t) => {
        seen.add(t.id);
        const cur = map.get(t.id);
        if (!cur) {
          map.set(t.id, {
            id: t.id,
            x: t.tx,
            y: t.ty,
            threat: t.threat,
            callsign: t.callsign,
            angle: t.angle,
            lastHit: 0,
          });
          return;
        }
        // Ease toward target (15% per frame ≈ smooth glide)
        const k = 0.12;
        cur.x += (t.tx - cur.x) * k;
        cur.y += (t.ty - cur.y) * k;
        cur.threat = t.threat;
        cur.callsign = t.callsign;

        // Update angle from interpolated (rendered) position.
        let a = Math.atan2(cur.x, -cur.y) * (180 / Math.PI);
        if (a < 0) a += 360;
        cur.angle = a;

        // Detect sweep crossing — sweep rotates clockwise from N.
        // Crossing condition: sweep angle is within a small leading arc of the blip.
        const delta = (((sweepAngle - a) % 360) + 360) % 360;
        if (delta < 6) cur.lastHit = now;
      });

      // Drop stale blips
      map.forEach((_, id) => {
        if (!seen.has(id)) map.delete(id);
      });

      force((n) => (n + 1) % 1_000_000);
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const blips = Array.from(stateRef.current.values());
  const now = typeof performance !== "undefined" ? performance.now() : 0;

  return (
    <div className="relative aspect-square w-full max-w-[320px] mx-auto">
      <svg
        viewBox={`${-VIEW / 2} ${-VIEW / 2} ${VIEW} ${VIEW}`}
        className="absolute inset-0 h-full w-full"
      >
        <defs>
          <radialGradient id="rad-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--hud)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--hud)" stopOpacity="0" />
          </radialGradient>
          {/* Sweep gradient: bright at leading edge, fades to transparent
              going counter-clockwise (i.e. the trailing tail). */}
          <linearGradient id="rad-sweep" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--hud)" stopOpacity="0" />
            <stop offset="60%" stopColor="var(--hud)" stopOpacity="0.15" />
            <stop offset="95%" stopColor="var(--hud)" stopOpacity="0.55" />
            <stop offset="100%" stopColor="var(--hud)" stopOpacity="0.85" />
          </linearGradient>
          <filter id="rad-blur" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="0.6" />
          </filter>
        </defs>

        {/* Outer glow disc */}
        <circle cx="0" cy="0" r={R_OUTER} fill="url(#rad-glow)" />

        {/* Range rings */}
        {[
          { r: 40, label: "9km" },
          { r: 80, label: "18km" },
          { r: 120, label: "28km" },
          { r: R_OUTER, label: "35km" },
        ].map((ring) => (
          <g key={ring.r}>
            <circle
              cx="0"
              cy="0"
              r={ring.r}
              fill="none"
              stroke="var(--hud)"
              strokeOpacity="0.22"
              strokeWidth="0.6"
              strokeDasharray={ring.r === R_OUTER ? undefined : "2 3"}
            />
            <text
              x={ring.r - 2}
              y="-3"
              textAnchor="end"
              fill="var(--hud)"
              fillOpacity="0.5"
              fontSize="6"
              fontFamily="monospace"
            >
              {ring.label}
            </text>
          </g>
        ))}

        {/* Cardinal cross */}
        <line x1={-R_OUTER} y1="0" x2={R_OUTER} y2="0" stroke="var(--hud)" strokeOpacity="0.18" />
        <line x1="0" y1={-R_OUTER} x2="0" y2={R_OUTER} stroke="var(--hud)" strokeOpacity="0.18" />

        {/* Bearing tick marks every 30° */}
        {Array.from({ length: 12 }).map((_, i) => {
          const a = (i * 30 - 90) * (Math.PI / 180);
          const x1 = Math.cos(a) * (R_OUTER - 6);
          const y1 = Math.sin(a) * (R_OUTER - 6);
          const x2 = Math.cos(a) * R_OUTER;
          const y2 = Math.sin(a) * R_OUTER;
          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="var(--hud)"
              strokeOpacity="0.45"
              strokeWidth="0.8"
            />
          );
        })}

        {/* Sweep — native SVG rotation around (0,0) for pixel-perfect spin. */}
        <g filter="url(#rad-blur)">
          {/* Cone wedge: 90° pie. Starts at -90° (North) so its bright leading edge
               aligns with the scan line — trail fades CCW behind the line. */}
          <path
            d={`M0,0 L${R_OUTER},0 A${R_OUTER},${R_OUTER} 0 0,0 ${
              Math.cos(-Math.PI / 2) * R_OUTER
            },${Math.sin(-Math.PI / 2) * R_OUTER} Z`}
            fill="url(#rad-sweep)"
          >
            <animateTransform
              attributeName="transform"
              attributeType="XML"
              type="rotate"
              from="-90 0 0"
              to="270 0 0"
              dur={`${SWEEP_PERIOD_MS}ms`}
              repeatCount="indefinite"
            />
          </path>
          {/* Bright leading line of the sweep */}
          <line
            x1="0"
            y1="0"
            x2={R_OUTER}
            y2="0"
            stroke="var(--hud)"
            strokeWidth="0.9"
            strokeOpacity="0.85"
          >
            <animateTransform
              attributeName="transform"
              attributeType="XML"
              type="rotate"
              from="-90 0 0"
              to="270 0 0"
              dur={`${SWEEP_PERIOD_MS}ms`}
              repeatCount="indefinite"
            />
          </line>
        </g>

        {/* Centre dot + small reticle */}
        <circle cx="0" cy="0" r="2" fill="var(--hud)" />
        <circle
          cx="0"
          cy="0"
          r="6"
          fill="none"
          stroke="var(--hud)"
          strokeOpacity="0.5"
          strokeWidth="0.5"
        />

        {/* Compass labels — drawn AFTER sweep so they stay legible. */}
        <text
          x="0"
          y={-R_OUTER + -4}
          textAnchor="middle"
          fill="var(--hud)"
          fontSize="9"
          fontFamily="monospace"
          fontWeight="bold"
        >
          N
        </text>
        <text
          x="0"
          y={R_OUTER + 10}
          textAnchor="middle"
          fill="var(--hud)"
          fontSize="9"
          fontFamily="monospace"
          fontWeight="bold"
        >
          S
        </text>
        <text
          x={R_OUTER + 8}
          y="3"
          textAnchor="middle"
          fill="var(--hud)"
          fontSize="9"
          fontFamily="monospace"
          fontWeight="bold"
        >
          E
        </text>
        <text
          x={-R_OUTER - 8}
          y="3"
          textAnchor="middle"
          fill="var(--hud)"
          fontSize="9"
          fontFamily="monospace"
          fontWeight="bold"
        >
          W
        </text>

        {/* Blips — movie-radar style: invisible until sweep reveals them */}
        {blips.map((b) => {
          const dist = Math.hypot(b.x, b.y);
          if (dist > R_OUTER - 4) return null;
          // Never swept yet — stay hidden
          if (b.lastHit === 0) return null;

          const elapsed = now - b.lastHit;
          // Bright flash fades over 900 ms
          const echo = Math.max(0, 1 - elapsed / 900);
          // Dim phosphor afterglow persists for ~3.8 s (just under one revolution)
          const persist = Math.max(0, 1 - elapsed / (SWEEP_PERIOD_MS * 0.95));

          if (persist <= 0 && echo <= 0) return null;

          const c = color(b.threat);
          return (
            <g key={b.id}>
              {/* Expanding ring burst on sweep contact */}
              {echo > 0.02 && (
                <>
                  <circle cx={b.x} cy={b.y} r={4 + echo * 10} fill={c} fillOpacity={echo * 0.28} />
                  <circle
                    cx={b.x}
                    cy={b.y}
                    r={2 + echo * 14}
                    fill="none"
                    stroke={c}
                    strokeOpacity={echo * 0.7}
                    strokeWidth="0.7"
                  />
                </>
              )}
              {/* Contact dot: bright on echo, dim persistent afterglow */}
              <circle
                cx={b.x}
                cy={b.y}
                r="2.4"
                fill={c}
                fillOpacity={echo * 0.9 + persist * 0.18}
              />
              {/* Callsign only while echo is fresh */}
              {echo > 0.35 && (
                <text
                  x={b.x + 5}
                  y={b.y - 4}
                  fill={c}
                  fillOpacity={echo}
                  fontSize="6"
                  fontFamily="monospace"
                >
                  {b.callsign}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
