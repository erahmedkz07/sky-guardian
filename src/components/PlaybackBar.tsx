import { useEffect, useRef, useState, useCallback } from "react";
import { Play, Pause, Square, SkipBack } from "lucide-react";
import { getFrames, isRecording, type Snapshot } from "@/lib/recorder";
import { cn } from "@/lib/utils";

interface Props {
  onFrame: (snap: Snapshot | null) => void; // null → live mode
}

const SPEEDS = [0.5, 1, 2, 5] as const;
type Speed = (typeof SPEEDS)[number];

export function PlaybackBar({ onFrame }: Props) {
  const frames = getFrames();
  const total = frames.length;
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);
  const [active, setActive] = useState(false); // playback mode on/off
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setPlaying(false);
    setActive(false);
    onFrame(null); // back to live
  }, [onFrame]);

  const pause = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setPlaying(false);
  }, []);

  const play = useCallback(() => {
    if (total === 0) return;
    setActive(true);
    setPlaying(true);
  }, [total]);

  // Advance cursor on interval when playing
  useEffect(() => {
    if (!playing) return;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setCursor((c) => {
        if (c >= total - 1) {
          pause();
          return c;
        }
        return c + 1;
      });
    }, 1000 / speed);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [playing, speed, total, pause]);

  // Push frame to parent when cursor changes in active mode
  useEffect(() => {
    if (!active) return;
    const snap = frames[cursor] ?? null;
    onFrame(snap);
  }, [cursor, active, frames, onFrame]);

  if (total < 2) return null;

  const currentTs = frames[cursor]?.ts;
  const startTs = frames[0]?.ts;
  const elapsed = currentTs && startTs ? Math.round((currentTs - startTs) / 1000) : 0;
  const progress = total > 1 ? cursor / (total - 1) : 0;

  return (
    <div
      className={cn(
        "absolute bottom-10 left-1/2 -translate-x-1/2 z-[1000]",
        "flex items-center gap-2 border border-border bg-panel/90 backdrop-blur px-3 py-2",
        active ? "border-warning/60" : "border-hud/40",
      )}
    >
      {active && (
        <span className="text-[9px] uppercase tracking-[0.15em] text-warning font-bold shrink-0 blink-pulse">
          REPLAY
        </span>
      )}
      {!active && isRecording() && (
        <span className="text-[9px] uppercase tracking-[0.15em] text-hud font-bold shrink-0 flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-threat blink-pulse" />
          REC
        </span>
      )}

      {/* Scrubber */}
      <input
        type="range"
        min={0}
        max={total - 1}
        value={cursor}
        onChange={(e) => {
          const v = Number(e.target.value);
          setCursor(v);
          setActive(true);
          pause();
          onFrame(frames[v] ?? null);
        }}
        className="w-36 h-0.5 cursor-pointer accent-hud"
      />

      <span className="text-[9px] font-mono text-muted-foreground shrink-0 w-10 text-right">
        {`-${String(Math.max(0, Math.round((frames[total - 1]?.ts ?? 0) - (currentTs ?? 0)) / 1000)).padStart(2, "0")}s`}
      </span>

      {/* Controls */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => {
            setCursor(0);
            setActive(true);
            pause();
            onFrame(frames[0] ?? null);
          }}
          className="text-muted-foreground hover:text-hud"
          title="Back to start"
        >
          <SkipBack className="h-3 w-3" />
        </button>
        {playing ? (
          <button onClick={pause} className="text-warning hover:text-hud" title="Pause">
            <Pause className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button onClick={play} className="text-hud hover:text-hud/80" title="Play">
            <Play className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          onClick={stop}
          className="text-muted-foreground hover:text-threat"
          title="Stop (back to live)"
        >
          <Square className="h-3 w-3" />
        </button>
      </div>

      {/* Speed selector */}
      <div className="flex items-center gap-0.5">
        {SPEEDS.map((s) => (
          <button
            key={s}
            onClick={() => setSpeed(s)}
            className={cn(
              "px-1 text-[9px] font-mono",
              speed === s ? "text-hud font-bold" : "text-muted-foreground hover:text-hud",
            )}
          >
            {s}×
          </button>
        ))}
      </div>

      <span className="text-[9px] font-mono text-muted-foreground shrink-0 hidden sm:block">
        {elapsed > 0 ? `+${elapsed}s` : "live"}
      </span>
    </div>
  );
}
