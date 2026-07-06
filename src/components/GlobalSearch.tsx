import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Search, X, ChevronRight } from "lucide-react";
import { useStore } from "@/lib/store";
import { useT } from "@/lib/i18n";

interface SearchResult {
  type: "drone" | "incident" | "sensor";
  id: string;
  title: string;
  subtitle: string;
  href: string;
  badge?: string;
  badgeColor?: string;
}

const THREAT_COLOR: Record<string, string> = {
  critical: "text-threat", high: "text-orange-400", medium: "text-warning", low: "text-hud",
};
const STATUS_COLOR: Record<string, string> = {
  online: "text-hud", degraded: "text-warning", offline: "text-threat", maintenance: "text-muted-foreground",
  open: "text-threat", investigating: "text-warning", resolved: "text-hud", dismissed: "text-muted-foreground",
  tracked: "text-hud", intercepted: "text-warning", lost: "text-muted-foreground", neutralized: "text-hud",
};

export function GlobalSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useT();
  const navigate = useNavigate();
  const drones = useStore((s) => s.drones);
  const sensors = useStore((s) => s.sensors);
  const incidents = useStore((s) => s.incidents);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const results: SearchResult[] = (() => {
    const q = query.toLowerCase().trim();
    if (!q) return [];
    const out: SearchResult[] = [];

    for (const d of drones) {
      if (
        d.callsign.toLowerCase().includes(q) ||
        d.id.toLowerCase().includes(q) ||
        d.model.toLowerCase().includes(q) ||
        d.status.toLowerCase().includes(q) ||
        d.threat.toLowerCase().includes(q)
      ) {
        out.push({
          type: "drone",
          id: d.id,
          title: d.callsign,
          subtitle: `${d.model} · ${d.status} · ${d.threat}`,
          href: "/command",
          badge: d.threat.toUpperCase(),
          badgeColor: THREAT_COLOR[d.threat],
        });
      }
    }

    for (const inc of incidents) {
      if (
        inc.code?.toLowerCase().includes(q) ||
        inc.title?.toLowerCase().includes(q) ||
        inc.status?.toLowerCase().includes(q) ||
        inc.threat?.toLowerCase().includes(q) ||
        (inc.assignee ?? "").toLowerCase().includes(q)
      ) {
        out.push({
          type: "incident",
          id: inc.id,
          title: `[${inc.code}] ${inc.title}`,
          subtitle: `${inc.status} · ${inc.threat}`,
          href: "/incidents",
          badge: inc.status.toUpperCase(),
          badgeColor: STATUS_COLOR[inc.status],
        });
      }
    }

    for (const s of sensors) {
      if (
        s.id.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        s.type.toLowerCase().includes(q) ||
        s.status.toLowerCase().includes(q)
      ) {
        out.push({
          type: "sensor",
          id: s.id,
          title: s.name,
          subtitle: `${s.type} · ${s.status} · ${s.id}`,
          href: "/sensors",
          badge: s.status.toUpperCase(),
          badgeColor: STATUS_COLOR[s.status],
        });
      }
    }

    return out.slice(0, 12);
  })();

  useEffect(() => { setSelected(0); }, [query]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter" && results[selected]) {
      e.preventDefault();
      navigate({ to: results[selected].href as "/" });
      onClose();
    }
  }

  const TYPE_LABEL: Record<string, string> = { drone: "DRONE", incident: "INC", sensor: "SENSOR" };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] bg-background/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl border border-hud/40 bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("Search drones, incidents, sensors…")}
            className="flex-1 bg-transparent text-sm focus:outline-none placeholder:text-muted-foreground"
          />
          {query && (
            <button onClick={() => setQuery("")} className="text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <kbd className="hidden sm:block border border-border px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-80 overflow-y-auto">
          {query && results.length === 0 && (
            <div className="px-4 py-6 text-center text-xs uppercase tracking-[0.2em] text-muted-foreground">
              {t("No results")}
            </div>
          )}
          {results.map((r, i) => (
            <button
              key={r.id}
              onClick={() => { navigate({ to: r.href as "/" }); onClose(); }}
              onMouseEnter={() => setSelected(i)}
              className={`flex w-full items-center gap-3 px-4 py-2.5 text-left ${
                i === selected ? "bg-hud/10" : "hover:bg-hud/5"
              }`}
            >
              <span className="w-12 shrink-0 border border-border/50 px-1 py-0.5 text-center text-[8px] font-bold uppercase tracking-wider text-muted-foreground">
                {TYPE_LABEL[r.type]}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-bold">{r.title}</div>
                <div className="text-[10px] text-muted-foreground truncate">{r.subtitle}</div>
              </div>
              {r.badge && (
                <span className={`shrink-0 text-[9px] font-bold uppercase tracking-wider ${r.badgeColor}`}>
                  {r.badge}
                </span>
              )}
              <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
            </button>
          ))}
        </div>

        {/* Footer hints */}
        {results.length > 0 && (
          <div className="flex items-center gap-4 border-t border-border px-4 py-2">
            <span className="text-[9px] uppercase tracking-[0.15em] text-muted-foreground">
              <kbd className="border border-border px-1">↑↓</kbd> {t("navigate")}
            </span>
            <span className="text-[9px] uppercase tracking-[0.15em] text-muted-foreground">
              <kbd className="border border-border px-1">↵</kbd> {t("open")}
            </span>
            <span className="text-[9px] uppercase tracking-[0.15em] text-muted-foreground">
              <kbd className="border border-border px-1">ESC</kbd> {t("close")}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
