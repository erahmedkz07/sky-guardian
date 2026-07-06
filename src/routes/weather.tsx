import { createFileRoute } from "@tanstack/react-router";
import { HudPanel, PageHeader } from "@/components/HudPanel";
import {
  Cloud,
  Droplets,
  Eye,
  Sun,
  Thermometer,
  Wind,
  RefreshCw,
  Loader2,
  Zap,
  Snowflake,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";

export const Route = createFileRoute("/weather")({
  component: Weather,
  head: () => ({ meta: [{ title: "Tactical Weather // DDS" }] }),
});

// ─── WMO weather code helpers ────────────────────────────────
const WMO: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Freezing fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Heavy drizzle",
  61: "Light rain",
  63: "Moderate rain",
  65: "Heavy rain",
  71: "Light snow",
  73: "Moderate snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Rain showers",
  81: "Moderate showers",
  82: "Heavy showers",
  85: "Snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm + hail",
  99: "Severe thunderstorm",
};
const wmoDesc = (c: number) => WMO[c] ?? "Variable";
const isFog = (c: number) => c === 45 || c === 48;
const isStorm = (c: number) => c >= 95;
const isSnow = (c: number) => (c >= 71 && c <= 77) || c === 85 || c === 86;
const isPrecip = (c: number) => c >= 51 && c <= 86;

// ─── Types ───────────────────────────────────────────────────
interface CurrentWeather {
  temperature: number;
  feelsLike: number;
  windSpeed: number; // m/s
  windGusts: number; // m/s
  windDirection: number; // °
  humidity: number; // %
  visibility: number; // km
  cloudCover: number; // %
  precipProb: number; // %
  uvIndex: number;
  weatherCode: number;
  sunrise: string; // "HH:MM"
  sunset: string; // "HH:MM"
  daylight: string; // "Xh Ym"
  updatedAt: string; // "HH:MM"
}

interface HourlySlot {
  h: string;
  temp: number;
  wind: number;
  visibility: number;
}

// ─── Utils ───────────────────────────────────────────────────
const DIRS = [
  "N",
  "NNE",
  "NE",
  "ENE",
  "E",
  "ESE",
  "SE",
  "SSE",
  "S",
  "SSW",
  "SW",
  "WSW",
  "W",
  "WNW",
  "NW",
  "NNW",
];
const toCompass = (deg: number) => DIRS[Math.round(deg / 22.5) % 16];
const kmhToMs = (kmh: number) => Math.round((kmh / 3.6) * 10) / 10;

function sunTime(iso: string): string {
  return iso.slice(11, 16);
}

function daylightStr(rise: string, set: string): string {
  const [rh, rm] = rise.split(":").map(Number);
  const [sh, sm] = set.split(":").map(Number);
  const min = sh * 60 + sm - rh * 60 - rm;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

function uvLabel(uv: number) {
  if (uv >= 11) return "Extreme";
  if (uv >= 8) return "Very High";
  if (uv >= 6) return "High";
  if (uv >= 3) return "Moderate";
  return "Low";
}

function uvTone(uv: number): "threat" | "warning" | "hud" {
  if (uv >= 6) return "warning";
  if (uv >= 8) return "threat";
  return "hud";
}

// ─── API fetch ───────────────────────────────────────────────
async function fetchWeather(): Promise<{ current: CurrentWeather; hourly: HourlySlot[] }> {
  const url =
    "https://api.open-meteo.com/v1/forecast" +
    "?latitude=51.18&longitude=71.45" +
    "&current=temperature_2m,apparent_temperature,wind_speed_10m,wind_direction_10m" +
    ",relative_humidity_2m,weather_code,cloud_cover,precipitation" +
    "&hourly=temperature_2m,wind_speed_10m,wind_gusts_10m,visibility" +
    ",cloud_cover,precipitation_probability,uv_index" +
    "&daily=sunrise,sunset,uv_index_max,precipitation_sum" +
    "&timezone=Asia%2FAlmaty&forecast_days=2";

  const res = await fetch(url);
  if (!res.ok) throw new Error("Open-Meteo error " + res.status);
  const d = await res.json();

  const nowH = parseInt(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Almaty", hour: "2-digit", hour12: false }),
    10,
  );

  const sunrise = sunTime(d.daily.sunrise[0]);
  const sunset = sunTime(d.daily.sunset[0]);

  const current: CurrentWeather = {
    temperature: Math.round(d.current.temperature_2m),
    feelsLike: Math.round(d.current.apparent_temperature),
    windSpeed: kmhToMs(d.current.wind_speed_10m),
    windGusts: kmhToMs(d.hourly.wind_gusts_10m[nowH] ?? d.current.wind_speed_10m),
    windDirection: d.current.wind_direction_10m,
    humidity: d.current.relative_humidity_2m,
    visibility: Math.round((d.hourly.visibility[nowH] ?? 10000) / 100) / 10,
    cloudCover: d.current.cloud_cover,
    precipProb: d.hourly.precipitation_probability[nowH] ?? 0,
    uvIndex: Math.round((d.hourly.uv_index[nowH] ?? d.daily.uv_index_max[0] ?? 0) * 10) / 10,
    weatherCode: d.current.weather_code,
    sunrise,
    sunset,
    daylight: daylightStr(sunrise, sunset),
    updatedAt: new Date().toLocaleString("en-US", {
      timeZone: "Asia/Almaty",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }),
  };

  const hourly: HourlySlot[] = Array.from({ length: 12 }, (_, i) => {
    const idx = nowH + i;
    return {
      h: `${(idx % 24).toString().padStart(2, "0")}:00`,
      temp: Math.round(d.hourly.temperature_2m[idx] ?? current.temperature),
      wind: Math.round(kmhToMs(d.hourly.wind_speed_10m[idx] ?? d.current.wind_speed_10m)),
      visibility: Math.round((d.hourly.visibility[idx] ?? 10000) / 1000),
    };
  });

  return { current, hourly };
}

function opStatus(w: CurrentWeather) {
  if (w.windSpeed >= 15 || isStorm(w.weatherCode))
    return { label: "GROUNDED", color: "text-threat", dot: "bg-threat" };
  if (w.windSpeed >= 10 || w.precipProb > 60 || w.visibility < 2)
    return { label: "CAUTIONARY", color: "text-warning", dot: "bg-warning" };
  return { label: "ALL CLEAR", color: "text-hud", dot: "bg-hud" };
}

// ─── Component ───────────────────────────────────────────────
function Weather() {
  const { t } = useT();
  const [current, setCurrent] = useState<CurrentWeather | null>(null);
  const [hourly, setHourly] = useState<HourlySlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  async function load() {
    setLoading(true);
    setError(false);
    try {
      const { current: c, hourly: h } = await fetchWeather();
      setCurrent(c);
      setHourly(h);
    } catch {
      setError(true);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const c = current;
  const ops = c
    ? opStatus(c)
    : { label: "LOADING", color: "text-muted-foreground", dot: "bg-muted-foreground" };

  return (
    <div>
      <PageHeader
        title={t("Tactical Weather")}
        subtitle={`${t("Atmospheric conditions · drone flight envelope · Astana, KZ")}${c ? ` · ${t("Updated")} ${c.updatedAt}` : ""}`}
        actions={
          <div className="flex items-center gap-2">
            {c && (
              <span className="border border-border px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                {t(wmoDesc(c.weatherCode))}
              </span>
            )}
            <button
              onClick={load}
              disabled={loading}
              className="flex items-center gap-2 border border-border px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:border-hud hover:text-hud disabled:opacity-40"
            >
              {loading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              {loading ? t("Loading…") : error ? t("Retry") : t("Refresh")}
            </button>
          </div>
        }
      />

      {error && (
        <div className="mx-6 mb-3 border border-warning/40 bg-warning/5 px-4 py-2 text-[11px] text-warning">
          {t("Weather API unavailable — check connectivity")}
        </div>
      )}

      {/* KPI tiles */}
      <div className="grid gap-3 px-4 py-4 sm:px-6 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          icon={Thermometer}
          label={t("Temperature")}
          value={c ? `${c.temperature}°C` : "…"}
          sub={c ? `${t("Feels like")} ${c.feelsLike}°C` : "—"}
          tone="hud"
        />
        <Tile
          icon={Wind}
          label={t("Wind")}
          value={c ? `${c.windSpeed} m/s` : "…"}
          sub={
            c
              ? `${toCompass(c.windDirection)} ${c.windDirection}° · ${t("gusts")} ${c.windGusts} m/s`
              : "—"
          }
          tone={c && c.windSpeed >= 10 ? "warning" : "hud"}
        />
        <Tile
          icon={Eye}
          label={t("Visibility")}
          value={c ? `${c.visibility} km` : "…"}
          sub={
            c
              ? c.visibility < 1
                ? t("Dense fog")
                : c.visibility < 3
                  ? t("Reduced visibility")
                  : c.visibility < 5
                    ? t("Moderate haze")
                    : t("Good")
              : "—"
          }
          tone={c && c.visibility < 3 ? "warning" : "hud"}
        />
        <Tile
          icon={Droplets}
          label={t("Humidity")}
          value={c ? `${c.humidity} %` : "…"}
          sub={c ? `${t("Dew ≈")} ${Math.round(c.temperature - (100 - c.humidity) / 5)}°C` : "—"}
          tone="hud"
        />
      </div>

      <div className="grid gap-3 px-6 pb-4 lg:grid-cols-[2fr_1fr]">
        {/* 12h forecast */}
        <HudPanel
          title={t("12h Forecast")}
          subtitle={hourly[0] ? `${t("From")} ${hourly[0].h} · Astana (GMT+5)` : "—"}
          bodyClassName="p-0"
        >
          {loading && !hourly.length ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-hud" />
            </div>
          ) : (
            <div className="grid grid-cols-12 divide-x divide-border/40">
              {hourly.map((f) => (
                <div key={f.h} className="px-1.5 py-3 text-center">
                  <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
                    {f.h}
                  </div>
                  <div className="hud-stat mt-2 text-base font-bold text-hud">{f.temp}°</div>
                  <Wind className="mx-auto mt-2 h-3 w-3 text-info" />
                  <div className="hud-stat text-[9px] text-info">{f.wind}</div>
                  <Eye className="mx-auto mt-1.5 h-3 w-3 text-muted-foreground" />
                  <div className="hud-stat text-[9px] text-muted-foreground">{f.visibility}k</div>
                </div>
              ))}
            </div>
          )}
        </HudPanel>

        {/* Flight Envelope */}
        <HudPanel title={t("Flight Envelope")} bodyClassName="p-4">
          <div className="space-y-3">
            <Envelope
              label={t("Wind Tolerance")}
              value={c ? Math.min(100, (c.windSpeed / 20) * 100) : 0}
              max="20 m/s"
              current={c ? `${c.windSpeed} m/s` : "…"}
              tone={c && c.windSpeed >= 10 ? "warning" : "hud"}
            />
            <Envelope
              label={t("Visibility")}
              value={c ? Math.min(100, (c.visibility / 10) * 100) : 0}
              max="10 km"
              current={c ? `${c.visibility} km` : "…"}
              tone={c && c.visibility < 3 ? "warning" : "hud"}
            />
            <Envelope
              label={t("Cloud Cover")}
              value={c ? c.cloudCover : 0}
              max="100%"
              current={c ? `${c.cloudCover}%` : "…"}
              tone={c && c.cloudCover > 80 ? "warning" : "hud"}
            />
            <Envelope
              label={t("Precipitation")}
              value={c ? c.precipProb : 0}
              max="100%"
              current={c ? `${c.precipProb}%` : "…"}
              tone={c && c.precipProb > 60 ? "warning" : "hud"}
            />
          </div>
          <div className="mt-4 border-t border-border pt-3">
            <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
              {t("Operational Status")}
            </div>
            <div className="mt-1 flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${ops.dot} blink-pulse`} />
              <span className={`text-sm font-bold hud-text-glow tracking-widest ${ops.color}`}>
                {t(ops.label)}
              </span>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              {c
                ? isStorm(c.weatherCode)
                  ? t("All UAV operations suspended — active thunderstorm.")
                  : c.windSpeed >= 15
                    ? t("All UAV operations suspended — wind exceeds safe limit.")
                    : c.windSpeed >= 10 || c.precipProb > 60
                      ? t("Heavy quadrotors clear for flight. Light FPV restricted.")
                      : c.visibility < 2
                        ? t("Low visibility — IFR conditions only.")
                        : t("Full operational envelope. All classes cleared for flight.")
                : t("Awaiting weather data…")}
            </p>
          </div>
        </HudPanel>
      </div>

      <div className="grid gap-3 px-4 pb-8 sm:px-6 lg:grid-cols-3">
        {/* Wind Rose */}
        <HudPanel
          title={t("Wind Rose")}
          bodyClassName="p-4 flex flex-col items-center justify-center gap-2"
        >
          <svg viewBox="-100 -100 200 200" className="h-52 w-52">
            <defs>
              <marker
                id="arrowhead"
                markerWidth="6"
                markerHeight="6"
                refX="3"
                refY="3"
                orient="auto"
              >
                <path d="M0,0 L6,3 L0,6 Z" fill="var(--warning)" />
              </marker>
            </defs>
            {[20, 40, 60, 80].map((r) => (
              <circle
                key={r}
                cx="0"
                cy="0"
                r={r}
                fill="none"
                stroke="var(--border)"
                strokeDasharray="2 4"
              />
            ))}
            {Array.from({ length: 8 }).map((_, i) => {
              const a = (i / 8) * Math.PI * 2;
              return (
                <line
                  key={i}
                  x1="0"
                  y1="0"
                  x2={Math.cos(a) * 80}
                  y2={Math.sin(a) * 80}
                  stroke="var(--border)"
                  strokeWidth="0.5"
                />
              );
            })}
            {Array.from({ length: 8 }).map((_, i) => {
              const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
              const len = 25 + Math.abs(Math.sin(i * 1.7)) * 45;
              const x = Math.cos(a) * len;
              const y = Math.sin(a) * len;
              return (
                <path
                  key={i}
                  d={`M0,0 L${x - 5},${y - 5} L${x},${y} L${x + 5},${y + 5} Z`}
                  fill="var(--hud)"
                  fillOpacity={0.2 + (i % 3) * 0.12}
                  stroke="var(--hud)"
                  strokeWidth="0.5"
                />
              );
            })}
            {c &&
              (() => {
                const rad = ((c.windDirection - 90) * Math.PI) / 180;
                const x = Math.cos(rad) * 64;
                const y = Math.sin(rad) * 64;
                return (
                  <line
                    x1="0"
                    y1="0"
                    x2={x}
                    y2={y}
                    stroke="var(--warning)"
                    strokeWidth="2.5"
                    markerEnd="url(#arrowhead)"
                  />
                );
              })()}
            <text
              x="0"
              y="-86"
              textAnchor="middle"
              fill="var(--hud)"
              fontSize="9"
              fontFamily="monospace"
            >
              N
            </text>
            <text
              x="0"
              y="94"
              textAnchor="middle"
              fill="var(--hud)"
              fontSize="9"
              fontFamily="monospace"
            >
              S
            </text>
            <text
              x="87"
              y="3"
              textAnchor="middle"
              fill="var(--hud)"
              fontSize="9"
              fontFamily="monospace"
            >
              E
            </text>
            <text
              x="-87"
              y="3"
              textAnchor="middle"
              fill="var(--hud)"
              fontSize="9"
              fontFamily="monospace"
            >
              W
            </text>
          </svg>
          {c && (
            <div className="text-center text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              {toCompass(c.windDirection)} · {c.windDirection}° · {c.windSpeed} m/s
            </div>
          )}
        </HudPanel>

        {/* Solar Conditions */}
        <HudPanel title={t("Solar Conditions")} bodyClassName="p-4">
          <div className="flex items-center gap-4">
            <Sun className={`h-12 w-12 ${c && c.uvIndex >= 6 ? "text-warning" : "text-hud"}`} />
            <div>
              <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
                {t("UV Index")}
              </div>
              <div
                className={`hud-stat text-3xl font-bold ${c && c.uvIndex >= 6 ? "text-warning" : "text-hud"}`}
              >
                {c ? c.uvIndex : "…"}
              </div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                {c ? t(uvLabel(c.uvIndex)) : "—"}
              </div>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 text-[11px]">
            <Field label={t("Sunrise")} value={c?.sunrise ?? "—"} />
            <Field label={t("Sunset")} value={c?.sunset ?? "—"} />
            <Field label={t("Daylight")} value={c?.daylight ?? "—"} />
            <Field label={t("Cloud")} value={c ? `${c.cloudCover}%` : "—"} />
          </div>
        </HudPanel>

        {/* Atmospheric Risks */}
        <HudPanel title={t("Atmospheric Risks")} bodyClassName="p-4 space-y-2">
          {c ? (
            buildRisks(c, t).map((r, i) => (
              <div
                key={i}
                className={`border-l-2 px-3 py-2 text-[11px] ${
                  r.tone === "threat"
                    ? "border-threat  bg-threat/5"
                    : r.tone === "warning"
                      ? "border-warning bg-warning/5"
                      : r.tone === "info"
                        ? "border-info    bg-info/5"
                        : "border-hud     bg-hud/5"
                }`}
              >
                <div className="text-[10px] font-bold uppercase tracking-[0.2em]">{t(r.label)}</div>
                <div className="text-muted-foreground">{r.body}</div>
              </div>
            ))
          ) : (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-hud" />
            </div>
          )}
        </HudPanel>
      </div>
    </div>
  );
}

function buildRisks(c: CurrentWeather, t: (s: string) => string) {
  type Tone = "threat" | "warning" | "info" | "hud";
  const risks: { tone: Tone; label: string; body: string }[] = [];

  // Wind
  risks.push(
    c.windSpeed >= 15
      ? {
          tone: "threat",
          label: "Wind",
          body: `${t("Strong wind")} ${c.windSpeed} m/s — ${t("gusts up to")} ${c.windGusts} m/s. ${t("Operations suspended.")}`,
        }
      : c.windSpeed >= 10
        ? {
            tone: "warning",
            label: "Crosswind",
            body: `${t("Moderate gusts up to")} ${c.windGusts} m/s. ${t("Light UAVs restricted.")}`,
          }
        : {
            tone: "hud",
            label: "Wind",
            body: `${c.windSpeed} m/s ${t("from")} ${toCompass(c.windDirection)}. ${t("Within safe limits.")}`,
          },
  );

  // Fog / Visibility
  if (isFog(c.weatherCode) || c.visibility < 1) {
    risks.push({
      tone: "threat",
      label: "Fog",
      body: `${t("Dense fog — visibility")} ${c.visibility} km. ${t("IFR conditions only.")}`,
    });
  } else if (c.visibility < 3) {
    risks.push({
      tone: "warning",
      label: "Visibility",
      body: `${t("Reduced visibility")} ${c.visibility} km. ${t("Caution advised for BVLOS ops.")}`,
    });
  } else {
    risks.push({
      tone: "hud",
      label: "Visibility",
      body: `${c.visibility} ${t("km — clear for all flight classes.")}`,
    });
  }

  // Icing / Temperature
  if (c.temperature <= 0) {
    risks.push({
      tone: "warning",
      label: "Icing",
      body: `${t("Temp")} ${c.temperature}°C — ${t("ice accumulation risk on rotors and sensors.")}`,
    });
  } else if (c.temperature < 4) {
    risks.push({
      tone: "info",
      label: "Cold",
      body: `${t("Near-freezing")} ${c.temperature}°C. ${t("Battery performance reduced ~20%.")}`,
    });
  } else {
    risks.push({
      tone: "hud",
      label: "Icing",
      body: `${t("Temp")} ${c.temperature}°C — ${t("below-freezing zone above 2,400 m only.")}`,
    });
  }

  // Lightning / Precipitation
  if (isStorm(c.weatherCode)) {
    risks.push({
      tone: "threat",
      label: "Lightning",
      body: t("Active thunderstorm. All UAV operations grounded immediately."),
    });
  } else if (isPrecip(c.weatherCode) || c.precipProb > 60) {
    const label = isSnow(c.weatherCode) ? "Snow" : "Precipitation";
    risks.push({
      tone: "warning",
      label,
      body: `${c.precipProb}% ${t("chance of precipitation")} — ${t(wmoDesc(c.weatherCode)).toLowerCase()}.`,
    });
  } else if (c.precipProb > 20) {
    risks.push({
      tone: "info",
      label: "Precipitation",
      body: `${c.precipProb}% ${t("chance")} — ${t(wmoDesc(c.weatherCode))}. ${t("Monitor closely.")}`,
    });
  } else {
    risks.push({
      tone: "hud",
      label: "Precipitation",
      body: `${c.precipProb}% ${t("chance — no significant precipitation expected.")}`,
    });
  }

  return risks;
}

// ─── Sub-components ───────────────────────────────────────────
function Tile({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: typeof Cloud;
  label: string;
  value: string;
  sub: string;
  tone: "hud" | "warning";
}) {
  const t = tone === "warning" ? "text-warning" : "text-hud";
  return (
    <div className="hud-panel flex items-center gap-3 px-4 py-3">
      <Icon className={`h-6 w-6 shrink-0 ${t}`} />
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">{label}</div>
        <div className={`hud-stat text-2xl font-bold ${t}`}>{value}</div>
        <div className="truncate text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
          {sub}
        </div>
      </div>
    </div>
  );
}

function Envelope({
  label,
  value,
  max,
  current,
  tone,
}: {
  label: string;
  value: number;
  max: string;
  current: string;
  tone: "hud" | "warning";
}) {
  const color = tone === "warning" ? "bg-warning" : "bg-hud";
  const text = tone === "warning" ? "text-warning" : "text-hud";
  return (
    <div>
      <div className="flex justify-between text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        <span>{label}</span>
        <span className={`hud-stat font-bold ${text}`}>
          {current} / {max}
        </span>
      </div>
      <div className="mt-1 h-1 w-full bg-muted">
        <div
          className={`h-full transition-all duration-700 ${color}`}
          style={{ width: `${Math.min(100, value)}%` }}
        />
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{label}</div>
      <div className="hud-stat font-bold text-foreground">{value}</div>
    </div>
  );
}
