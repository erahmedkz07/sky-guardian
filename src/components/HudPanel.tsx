import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";

interface HudPanelProps {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}

export function HudPanel({
  title,
  subtitle,
  actions,
  children,
  className,
  bodyClassName,
}: HudPanelProps) {
  return (
    <section className={cn("hud-panel flex flex-col", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2 sm:px-4 sm:py-2.5">
          <div className="min-w-0">
            {title && (
              <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-hud hud-text-glow sm:text-xs sm:tracking-[0.25em]">
                {title}
              </h3>
            )}
            {subtitle && (
              <p className="text-[9px] uppercase tracking-[0.15em] text-muted-foreground sm:text-[10px] sm:tracking-[0.2em]">
                {subtitle}
              </p>
            )}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1 sm:gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn("flex-1", bodyClassName ?? "p-4")}>{children}</div>
    </section>
  );
}

export function ThreatBadge({ level }: { level: "low" | "medium" | "high" | "critical" }) {
  const { t } = useT();
  const map = {
    low: "border-info/40 bg-info/10 text-info",
    medium: "border-warning/40 bg-warning/10 text-warning",
    high: "border-threat/50 bg-threat/15 text-threat",
    critical: "border-threat bg-threat/30 text-threat blink-pulse",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em]",
        map[level],
      )}
    >
      {t(level)}
    </span>
  );
}

export function StatusDot({
  status,
}: {
  status: "online" | "degraded" | "offline" | "maintenance";
}) {
  const map = {
    online: "bg-hud",
    degraded: "bg-warning",
    offline: "bg-threat",
    maintenance: "bg-info",
  } as const;
  return <span className={cn("inline-block h-2 w-2 rounded-full", map[status])} />;
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border bg-panel/40 px-4 py-4 sm:px-6 sm:py-5">
      <div>
        <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
          DDS // MODULE
        </div>
        <h1 className="mt-1 text-2xl font-bold uppercase tracking-[0.2em] text-hud hud-text-glow">
          {title}
        </h1>
        {subtitle && <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
