import { createFileRoute } from "@tanstack/react-router";
import { HudPanel, PageHeader, StatusDot } from "@/components/HudPanel";
import {
  Camera,
  Mic,
  MicOff,
  MoveDiagonal,
  Play,
  Pause,
  RadioTower,
  ZoomIn,
  ZoomOut,
  RefreshCw,
  Loader2,
  VideoOff,
  Eye,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { camerasApi, type ApiCamera } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";

export const Route = createFileRoute("/cameras")({
  component: Cameras,
  head: () => ({ meta: [{ title: "Camera Grid // DDS" }] }),
});

// ─── Visual modes for live webcam feeds ──────────────────────
type LiveMode = "eo" | "ir" | "thermal";

const LIVE_MODES: LiveMode[] = ["eo", "ir", "thermal"];

const MODE_LABEL: Record<LiveMode, string> = {
  eo: "EO",
  ir: "IR NIGHT",
  thermal: "THERMAL",
};

/** CSS filter applied to the <video> element per mode */
const MODE_FILTER: Record<LiveMode, string> = {
  eo: "brightness(1.05) contrast(1.1) saturate(1.1)",
  ir: "grayscale(1) brightness(1.25) contrast(1.15)",
  thermal: "sepia(1) saturate(9) hue-rotate(-20deg) brightness(0.9) contrast(1.35)",
};

/** Colour overlay div on top of the video */
const MODE_OVERLAY: Record<LiveMode, string> = {
  eo: "bg-transparent",
  ir: "bg-green-900/20",
  thermal: "bg-orange-900/10",
};

/** HUD accent colour class */
const MODE_HUD: Record<LiveMode, string> = {
  eo: "text-hud",
  ir: "text-green-400",
  thermal: "text-orange-400",
};

// ─── UiCam type ───────────────────────────────────────────────
interface UiCam {
  id: string;
  name: string;
  status: "online" | "degraded" | "offline";
  type: "EO" | "IR" | "PTZ";
  sector: string;
  recording: boolean;
  muted: boolean;
  zoom: number;
  bearing: number;
  hue: number;
  lat: number;
  lng: number;
  liveIndex: number | null; // index into LIVE_MODES, null = fake feed
}

const HUES = [145, 75, 25, 220, 145, 40, 190, 310];
const SECTORS = ["Sector A", "Sector B", "Sector C", "Sector D", "Sector E"];

function deriveType(name: string): "EO" | "IR" | "PTZ" {
  const u = name.toUpperCase();
  if (u.includes("IR") || u.includes("THERMAL") || u.includes("NIGHT")) return "IR";
  if (u.includes("PTZ") || u.includes("GATE") || u.includes("ARRAY") || u.includes("COMMS"))
    return "PTZ";
  return "EO";
}

function toUiCam(c: ApiCamera, idx: number, liveSlot: number): UiCam {
  const status = (["online", "degraded", "offline"] as const).includes(c.status as "online")
    ? (c.status as UiCam["status"])
    : "online";
  return {
    id: c.id,
    name: c.name,
    status,
    type: deriveType(c.name),
    sector: SECTORS[idx % SECTORS.length],
    recording: status === "online",
    muted: false,
    zoom: 1.0,
    bearing: (idx * 60 + 30) % 360,
    hue: HUES[idx % HUES.length],
    lat: c.lat,
    lng: c.lng,
    liveIndex: status === "online" && liveSlot < LIVE_MODES.length ? liveSlot : null,
  };
}

// ─── WebcamFeed ───────────────────────────────────────────────
function WebcamFeed({
  stream,
  mode,
  zoom,
  large,
}: {
  stream: MediaStream;
  mode: LiveMode;
  zoom: number;
  large?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream;
    el.play().catch(() => {});
    return () => {
      el.srcObject = null;
    };
  }, [stream]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      <video
        ref={ref}
        autoPlay
        playsInline
        muted
        className="h-full w-full object-cover"
        style={{
          filter: MODE_FILTER[mode],
          transform: `scale(${zoom})`,
          transformOrigin: "center center",
        }}
      />
      {/* colour overlay */}
      <div className={cn("pointer-events-none absolute inset-0", MODE_OVERLAY[mode])} />

      {/* scanline overlay */}
      <div
        className="pointer-events-none absolute inset-0 opacity-25"
        style={{
          background:
            "repeating-linear-gradient(0deg, transparent 0, transparent 2px, rgba(0,0,0,0.18) 2px, rgba(0,0,0,0.18) 3px)",
        }}
      />

      {/* mode badge */}
      <div
        className={cn(
          "pointer-events-none absolute left-2 top-2 border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.2em]",
          mode === "ir"
            ? "border-green-500/60 bg-green-900/40 text-green-400"
            : mode === "thermal"
              ? "border-orange-500/60 bg-orange-900/40 text-orange-400"
              : "border-hud/40 bg-black/40 text-hud",
        )}
      >
        {MODE_LABEL[mode]}
      </div>

      {/* IR crosshair on large view */}
      {large && (
        <svg
          viewBox="0 0 100 60"
          className="pointer-events-none absolute inset-0 h-full w-full"
          preserveAspectRatio="none"
        >
          <line
            x1="50"
            y1="0"
            x2="50"
            y2="60"
            stroke="currentColor"
            strokeOpacity="0.25"
            strokeDasharray="1 3"
            className={MODE_HUD[mode]}
          />
          <line
            x1="0"
            y1="30"
            x2="100"
            y2="30"
            stroke="currentColor"
            strokeOpacity="0.25"
            strokeDasharray="1 3"
            className={MODE_HUD[mode]}
          />
          <circle
            cx="50"
            cy="30"
            r="4"
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.45"
            className={MODE_HUD[mode]}
          />
          <circle
            cx="50"
            cy="30"
            r="0.8"
            fill="currentColor"
            strokeOpacity="0.8"
            className={MODE_HUD[mode]}
          />
        </svg>
      )}
    </div>
  );
}

// ─── FakeFeed (for offline / non-webcam cameras) ──────────────
function FakeFeed({ cam, large = false }: { cam: UiCam; large?: boolean }) {
  const { t } = useT();
  const offline = cam.status === "offline";
  const c = cam.hue;
  return (
    <div
      className="relative h-full w-full overflow-hidden"
      style={
        offline
          ? { background: "#000" }
          : {
              background: `radial-gradient(ellipse at 60% 40%, oklch(0.35 0.12 ${c} / 0.6), oklch(0.12 0.05 ${c} / 0.95) 70%)`,
            }
      }
    >
      {offline ? (
        <div className="flex h-full items-center justify-center gap-2 text-[10px] uppercase tracking-[0.3em] text-threat">
          <VideoOff className="h-4 w-4" /> {t("No Signal")}
        </div>
      ) : (
        <>
          <div
            className="absolute inset-0 opacity-40"
            style={{
              background:
                "repeating-linear-gradient(0deg, transparent 0, transparent 2px, rgba(255,255,255,0.04) 2px, rgba(255,255,255,0.04) 3px)",
            }}
          />
          {cam.status === "degraded" && (
            <div className="absolute inset-0 flex items-center justify-center text-[10px] uppercase tracking-[0.2em] text-warning">
              {t("⚠ Degraded")}
            </div>
          )}
          {large && (
            <svg
              viewBox="0 0 100 60"
              className="absolute inset-0 h-full w-full pointer-events-none"
              preserveAspectRatio="none"
            >
              <line
                x1="50"
                y1="0"
                x2="50"
                y2="60"
                stroke="var(--hud)"
                strokeOpacity="0.3"
                strokeDasharray="1 2"
              />
              <line
                x1="0"
                y1="30"
                x2="100"
                y2="30"
                stroke="var(--hud)"
                strokeOpacity="0.3"
                strokeDasharray="1 2"
              />
              <circle cx="50" cy="30" r="3" fill="none" stroke="var(--hud)" strokeOpacity="0.6" />
            </svg>
          )}
        </>
      )}
    </div>
  );
}

// ─── SmartFeed — picks webcam or fake ─────────────────────────
function SmartFeed({
  cam,
  stream,
  large,
}: {
  cam: UiCam;
  stream: MediaStream | null;
  large?: boolean;
}) {
  if (cam.liveIndex !== null && stream) {
    return (
      <WebcamFeed stream={stream} mode={LIVE_MODES[cam.liveIndex]} zoom={cam.zoom} large={large} />
    );
  }
  return <FakeFeed cam={cam} large={large} />;
}

// ─── Webcam permission banner ─────────────────────────────────
function WebcamBanner({ onRequest }: { onRequest: () => void }) {
  const { t } = useT();
  return (
    <div className="mx-6 mt-4 flex items-center justify-between gap-4 border border-hud/40 bg-hud/5 px-5 py-3">
      <div className="flex items-center gap-3">
        <Camera className="h-5 w-5 shrink-0 text-hud" />
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.2em] text-hud">
            {t("Live Video Available")}
          </div>
          <div className="text-[10px] text-muted-foreground">
            {t(
              "Grant webcam access to enable live EO / IR / Thermal feeds for the first 3 cameras.",
            )}
          </div>
        </div>
      </div>
      <button
        onClick={onRequest}
        className="shrink-0 border border-hud bg-hud/10 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-hud hover:bg-hud/20"
      >
        {t("Enable")}
      </button>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────
function Cameras() {
  const [cams, setCams] = useState<UiCam[]>([]);
  const [loading, setLoading] = useState(true);
  const [primary, setPrimary] = useState<UiCam | null>(null);
  const { t } = useT();

  // Webcam state
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [camState, setCamState] = useState<"idle" | "requesting" | "granted" | "denied">("idle");
  const streamRef = useRef<MediaStream | null>(null);

  function patchCam(id: string, patch: Partial<UiCam>) {
    setCams((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    setPrimary((prev) => (prev?.id === id ? { ...prev, ...patch } : prev));
  }

  async function load() {
    setLoading(true);
    try {
      const rows = await camerasApi.list();
      let liveSlot = 0;
      const mapped = rows.map((r, idx) => {
        const cam = toUiCam(r, idx, liveSlot);
        if (cam.liveIndex !== null) liveSlot++;
        return cam;
      });
      setCams(mapped);
      setPrimary((prev) =>
        prev ? (mapped.find((m) => m.id === prev.id) ?? mapped[0]) : mapped[0],
      );
    } catch {
      /* ignore */
    }
    setLoading(false);
  }

  async function requestWebcam() {
    setCamState("requesting");
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
        audio: false,
      });
      streamRef.current = s;
      setStream(s);
      setCamState("granted");
    } catch {
      setCamState("denied");
    }
  }

  useEffect(() => {
    load();
    // Auto-check if permission already granted (no prompt)
    navigator.permissions
      ?.query({ name: "camera" as PermissionName })
      .then((result) => {
        if (result.state === "granted") requestWebcam();
      })
      .catch(() => {});
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onlineCount = cams.filter((c) => c.status === "online").length;
  const liveCount = stream ? Math.min(onlineCount, LIVE_MODES.length) : 0;

  if (loading) {
    return (
      <div>
        <PageHeader title={t("Camera Grid")} subtitle={t("EO / IR / PTZ feeds · live multiplex")} />
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-hud" />
        </div>
      </div>
    );
  }

  if (!primary) {
    return (
      <div>
        <PageHeader title={t("Camera Grid")} subtitle={t("EO / IR / PTZ feeds · live multiplex")} />
        <div className="px-6 py-20 text-center text-xs text-muted-foreground uppercase tracking-[0.2em]">
          {t("No cameras in database")}
        </div>
      </div>
    );
  }

  const hudColor =
    primary.liveIndex !== null && stream ? MODE_HUD[LIVE_MODES[primary.liveIndex]] : "text-hud";

  return (
    <div>
      <PageHeader
        title={t("Camera Grid")}
        subtitle={t("EO / IR / PTZ feeds · live multiplex")}
        actions={
          <div className="flex items-center gap-3">
            {liveCount > 0 && (
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-hud">
                <Eye className="h-3.5 w-3.5 blink-pulse" />
                {liveCount} {t("LIVE")}
              </div>
            )}
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-hud">
              <RadioTower className="h-3.5 w-3.5 blink-pulse" />
              {onlineCount} / {cams.length} {t("ONLINE")}
            </div>
            <button
              onClick={load}
              disabled={loading}
              className="flex items-center gap-2 border border-border px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:border-hud hover:text-hud disabled:opacity-40"
            >
              <RefreshCw className="h-3 w-3" /> {t("Refresh")}
            </button>
          </div>
        }
      />

      {/* Webcam permission banner */}
      {camState === "idle" && <WebcamBanner onRequest={requestWebcam} />}
      {camState === "requesting" && (
        <div className="mx-6 mt-4 flex items-center gap-3 border border-hud/30 bg-hud/5 px-5 py-3 text-[11px] text-hud">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("Requesting camera access…")}
        </div>
      )}
      {camState === "denied" && (
        <div className="mx-6 mt-4 flex items-center gap-3 border border-warning/40 bg-warning/5 px-5 py-3 text-[11px] text-warning">
          <VideoOff className="h-4 w-4" />
          {t("Camera access denied — showing simulated feeds")}
        </div>
      )}

      <div className="grid gap-3 px-6 py-4 lg:grid-cols-[2fr_1fr]">
        {/* ── Primary feed ──────────────────────────────── */}
        <HudPanel
          title={`${primary.id} · ${primary.name}`}
          subtitle={`${primary.liveIndex !== null && stream ? MODE_LABEL[LIVE_MODES[primary.liveIndex]] : primary.type} · ${primary.sector}`}
          actions={
            <div
              className={cn(
                "flex items-center gap-2 text-[10px] uppercase tracking-[0.2em]",
                hudColor,
              )}
            >
              {primary.recording && (
                <span className="flex items-center gap-1 text-threat">
                  <span className="h-1.5 w-1.5 rounded-full bg-threat blink-pulse" /> REC
                </span>
              )}
              <span>x{primary.zoom.toFixed(1)}</span>
              <span className="text-muted-foreground hud-stat">
                BRG {primary.bearing.toString().padStart(3, "0")}°
              </span>
            </div>
          }
          bodyClassName="p-0 relative"
        >
          <div className="aspect-video w-full">
            <SmartFeed cam={primary} stream={stream} large />
          </div>

          {/* HUD overlay */}
          <div
            className={cn(
              "pointer-events-none absolute inset-0 flex flex-col justify-between p-3",
              hudColor,
            )}
          >
            <div className="flex justify-between text-[10px] uppercase tracking-[0.2em] font-bold">
              <span>
                {primary.id} // {primary.liveIndex !== null && stream ? "LIVE" : "FEED"}
              </span>
              <LiveClock />
            </div>
            <div className="flex justify-between text-[10px] uppercase tracking-[0.2em]">
              <span>
                LAT {primary.lat.toFixed(4)} · LNG {primary.lng.toFixed(4)}
              </span>
              <span className="text-muted-foreground">
                {primary.liveIndex !== null && stream ? "WEBCAM · LIVE" : "FPS 30 · 4.2 Mbps"}
              </span>
            </div>
          </div>

          {/* Controls */}
          <div
            className={cn(
              "absolute right-3 top-1/2 flex -translate-y-1/2 flex-col gap-2",
              hudColor,
            )}
          >
            <CtrlBtn
              title="Zoom in"
              onClick={() =>
                patchCam(primary.id, { zoom: Math.min(4.0, +(primary.zoom + 0.5).toFixed(1)) })
              }
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </CtrlBtn>
            <CtrlBtn
              title="Zoom out"
              onClick={() =>
                patchCam(primary.id, { zoom: Math.max(0.5, +(primary.zoom - 0.5).toFixed(1)) })
              }
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </CtrlBtn>
            <CtrlBtn
              title="Reset view"
              onClick={() => patchCam(primary.id, { zoom: 1.0, bearing: 0 })}
            >
              <MoveDiagonal className="h-3.5 w-3.5" />
            </CtrlBtn>
            <CtrlBtn
              title={primary.muted ? "Unmute" : "Mute"}
              onClick={() => patchCam(primary.id, { muted: !primary.muted })}
              warn={primary.muted}
            >
              {primary.muted ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
            </CtrlBtn>
            <CtrlBtn
              title={primary.recording ? "Pause" : "Resume"}
              onClick={() => patchCam(primary.id, { recording: !primary.recording })}
              warn={!primary.recording}
            >
              {primary.recording ? (
                <Pause className="h-3.5 w-3.5" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
            </CtrlBtn>
          </div>
        </HudPanel>

        {/* ── Feed roster ───────────────────────────────── */}
        <HudPanel
          title={t("Feed Roster")}
          subtitle={`${cams.length} ${t("cameras")}`}
          bodyClassName="p-0"
        >
          {cams.map((c) => (
            <button
              key={c.id}
              onClick={() => setPrimary(c)}
              className={cn(
                "flex w-full items-center gap-3 border-b border-border/40 px-3 py-2 text-left text-xs hover:bg-hud/5",
                primary.id === c.id && "bg-hud/10 border-l-2 border-l-hud",
              )}
            >
              <div className="relative h-12 w-20 shrink-0 overflow-hidden border border-border">
                <SmartFeed cam={c} stream={stream} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-bold uppercase tracking-wider truncate">{c.name}</div>
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  <StatusDot status={c.status} />
                  {c.liveIndex !== null && stream ? (
                    <span className="text-hud">{MODE_LABEL[LIVE_MODES[c.liveIndex]]}</span>
                  ) : (
                    c.type
                  )}
                  · {c.sector}
                </div>
              </div>
              <Camera className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </button>
          ))}
        </HudPanel>
      </div>

      {/* ── Wall · N-up multiplex ──────────────────────── */}
      <div className="px-4 pb-8 sm:px-6">
        <HudPanel title={`Wall · ${cams.length}-up multiplex`} bodyClassName="p-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
            {cams.map((c) => (
              <button
                key={c.id}
                onClick={() => setPrimary(c)}
                className="relative aspect-video overflow-hidden border border-border hover:border-hud"
              >
                <SmartFeed cam={c} stream={stream} />
                <div
                  className={cn(
                    "pointer-events-none absolute inset-0 flex flex-col justify-between p-2 text-[10px] uppercase tracking-[0.2em]",
                    c.liveIndex !== null && stream ? MODE_HUD[LIVE_MODES[c.liveIndex]] : "text-hud",
                  )}
                >
                  <div className="flex justify-between font-bold">
                    <span>{c.id}</span>
                    {c.recording && (
                      <span className="flex items-center gap-1 text-threat">
                        <span className="h-1.5 w-1.5 rounded-full bg-threat blink-pulse" />
                        REC
                      </span>
                    )}
                  </div>
                  <div className="flex justify-between">
                    <span>
                      {c.liveIndex !== null && stream
                        ? MODE_LABEL[LIVE_MODES[c.liveIndex]]
                        : c.type}
                    </span>
                    <span className="text-muted-foreground hud-stat">
                      {c.bearing.toString().padStart(3, "0")}°
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </HudPanel>
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────

function CtrlBtn({
  children,
  title,
  onClick,
  warn,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  warn?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={cn(
        "border bg-background/70 p-2 hover:bg-hud/20",
        warn ? "border-warning/50 text-warning" : "border-hud/50 text-hud",
      )}
    >
      {children}
    </button>
  );
}

function LiveClock() {
  const [time, setTime] = useState(() => new Date().toISOString().slice(11, 19));
  useEffect(() => {
    const id = setInterval(() => setTime(new Date().toISOString().slice(11, 19)), 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="hud-stat">{time} UTC</span>;
}
