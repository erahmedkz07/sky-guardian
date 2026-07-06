import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { HudPanel, PageHeader } from "@/components/HudPanel";
import { Download, FileText, Loader2, CheckCircle, Printer } from "lucide-react";
import { reportsApi, type ApiReportsSummary } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useStore } from "@/lib/store";
import { exportPdf } from "@/lib/reportPdf";

export const Route = createFileRoute("/reports")({
  component: Reports,
  head: () => ({ meta: [{ title: "Reports // DDS" }] }),
});

type ReportType = "detections" | "incidents" | "sensors" | "audit";

interface GeneratedReport {
  id: string;
  title: string;
  type: ReportType;
  days: number;
  generatedAt: string;
}

const REPORT_TYPES: { type: ReportType; label: string; desc: string }[] = [
  {
    type: "detections",
    label: "Detection Log",
    desc: "All drone detection events with coordinates & threat level",
  },
  {
    type: "incidents",
    label: "Incident Report",
    desc: "Incident timeline, status, assignees and descriptions",
  },
  {
    type: "sensors",
    label: "Sensor Performance Audit",
    desc: "Health, signal strength and range for all sensor nodes",
  },
  {
    type: "audit",
    label: "Audit / Compliance Log",
    desc: "Full operator action trail for compliance review",
  },
];

const STORAGE_KEY = "dds_reports";

function loadReports(): GeneratedReport[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function saveReports(list: GeneratedReport[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, 20)));
}

function Reports() {
  const { t } = useT();
  const [summary, setSummary] = useState<ApiReportsSummary | null>(null);
  const [history, setHistory] = useState<GeneratedReport[]>(loadReports);
  const [days, setDays] = useState(30);
  const [pending, setPending] = useState<ReportType | null>(null);
  const [success, setSuccess] = useState<ReportType | null>(null);
  const [redownload, setRedownload] = useState<string | null>(null);
  const [pdfPending, setPdfPending] = useState<ReportType | null>(null);

  const storeData = useStore((s) => ({
    drones: s.drones,
    sensors: s.sensors,
    detections: s.detections,
    incidents: s.incidents,
    alerts: s.alerts,
  }));

  function handleExportPdf(type: ReportType) {
    setPdfPending(type);
    exportPdf(type, storeData);
    setTimeout(() => setPdfPending(null), 800);
  }

  useEffect(() => {
    reportsApi
      .summary()
      .then(setSummary)
      .catch(() => {});
  }, []);

  async function handleGenerate(type: ReportType) {
    setPending(type);
    setSuccess(null);
    try {
      await reportsApi.download(type, days);
      const report: GeneratedReport = {
        id: `RPT-${Date.now()}`,
        title: `${REPORT_TYPES.find((r) => r.type === type)?.label} · ${new Date().toISOString().slice(0, 10)}`,
        type,
        days,
        generatedAt: new Date().toISOString(),
      };
      const next = [report, ...history];
      setHistory(next);
      saveReports(next);
      setSuccess(type);
      setTimeout(() => setSuccess(null), 2000);
    } catch {
      /* ignore */
    }
    setPending(null);
  }

  async function handleRedownload(r: GeneratedReport) {
    setRedownload(r.id);
    try {
      await reportsApi.download(r.type, r.days);
    } catch {
      /* ignore */
    }
    setRedownload(null);
  }

  return (
    <div>
      <PageHeader
        title={t("Reports")}
        subtitle={t("Generated artifacts · scheduled exports · compliance")}
        actions={
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            <span>{t("Period:")}</span>
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="border border-border bg-transparent px-2 py-1.5 text-[10px] uppercase tracking-[0.2em] text-muted-foreground focus:border-hud focus:outline-none"
            >
              <option value={7}>{t("7 days")}</option>
              <option value={30}>{t("30 days")}</option>
              <option value={90}>{t("90 days")}</option>
              <option value={365}>{t("1 year")}</option>
            </select>
          </div>
        }
      />

      {/* DB summary stats */}
      {summary && (
        <div className="grid grid-cols-1 gap-3 px-4 pb-2 pt-1 sm:grid-cols-3 sm:px-6">
          {[
            { label: t("Total detections in DB"), value: summary.detections },
            { label: t("Total incidents in DB"), value: summary.incidents },
            { label: t("Audit actions in DB"), value: summary.auditActions },
          ].map((s) => (
            <div key={s.label} className="hud-panel flex items-center gap-3 px-4 py-3">
              <div>
                <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
                  {s.label}
                </div>
                <div className="hud-stat mt-0.5 text-2xl font-bold text-hud">
                  {s.value.toLocaleString()}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-3 px-4 py-4 sm:px-6 lg:grid-cols-[2fr_1fr]">
        {/* Generated history */}
        <HudPanel
          title={t("Generated Reports")}
          subtitle={`${history.length} ${t("reports · stored locally")}`}
          bodyClassName="p-0"
        >
          {history.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-muted-foreground uppercase tracking-[0.2em]">
              {t("No reports yet — generate one from the panel on the right")}
            </div>
          ) : (
            history.map((r) => (
              <div
                key={r.id}
                className="flex items-center gap-4 border-b border-border/40 px-4 py-3 hover:bg-hud/5"
              >
                <FileText className="h-5 w-5 shrink-0 text-hud" />
                <div className="flex-1 min-w-0">
                  <div className="truncate text-sm font-bold">{r.title}</div>
                  <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground hud-stat">
                    {r.id} · CSV · Last {r.days}d ·{" "}
                    {new Date(r.generatedAt).toLocaleString("ru-KZ", { timeZone: "Asia/Almaty" })}
                  </div>
                </div>
                <button
                  onClick={() => handleRedownload(r)}
                  disabled={redownload === r.id}
                  className="flex shrink-0 items-center gap-1 border border-hud/50 px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] text-hud hover:bg-hud/10 disabled:opacity-40"
                >
                  {redownload === r.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Download className="h-3 w-3" />
                  )}
                  {t("Download")}
                </button>
              </div>
            ))
          )}
        </HudPanel>

        {/* Generate panel */}
        <HudPanel title={t("Generate New Report")} bodyClassName="p-4">
          <div className="mb-3 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            {t("Period: last")}{" "}
            <span className="text-hud font-bold">
              {days} {t("days")}
            </span>
          </div>
          <div className="space-y-2">
            {REPORT_TYPES.map(({ type, label, desc }) => {
              const isLoading = pending === type;
              const isDone = success === type;
              const isPdf = pdfPending === type;
              return (
                <div
                  key={type}
                  className="border border-border bg-panel/30 hover:border-hud transition-colors"
                >
                  <button
                    onClick={() => handleGenerate(type)}
                    disabled={!!pending}
                    className="w-full px-3 pt-2.5 pb-1.5 text-left disabled:opacity-50"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold uppercase tracking-wider">{t(label)}</span>
                      {isLoading && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-hud shrink-0" />
                      )}
                      {isDone && <CheckCircle className="h-3.5 w-3.5 text-hud shrink-0" />}
                      {!isLoading && !isDone && (
                        <Download className="h-3 w-3 text-muted-foreground shrink-0" />
                      )}
                    </div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground">{t(desc)}</div>
                  </button>
                  <div className="px-3 pb-2">
                    <button
                      onClick={() => handleExportPdf(type)}
                      disabled={isPdf}
                      className="flex items-center gap-1 text-[9px] uppercase tracking-[0.15em] text-muted-foreground hover:text-hud disabled:opacity-40"
                    >
                      {isPdf ? (
                        <Loader2 className="h-2.5 w-2.5 animate-spin" />
                      ) : (
                        <Printer className="h-2.5 w-2.5" />
                      )}
                      {t("Export PDF")}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 border-t border-border pt-4 space-y-1.5 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            <div>{t("CSV: server · requires connection")}</div>
            <div>{t("PDF: client-side · works offline")}</div>
            <div>{t("Auth: JWT token required for CSV")}</div>
          </div>
        </HudPanel>
      </div>
    </div>
  );
}
