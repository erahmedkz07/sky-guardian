import type { Drone, Sensor, Detection, Incident, AlertEvent } from "./mockData";

export type ReportType = "detections" | "incidents" | "sensors" | "audit";

export interface ReportData {
  drones: Drone[];
  sensors: Sensor[];
  detections: Detection[];
  incidents: Incident[];
  alerts: AlertEvent[];
}

function fmt(d: Date | string): string {
  return new Date(d).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function badge(level: string): string {
  const map: Record<string, string> = {
    critical: "#ef4444",
    high: "#f97316",
    medium: "#eab308",
    low: "#22c55e",
    open: "#ef4444",
    investigating: "#f97316",
    resolved: "#22c55e",
    closed: "#6b7280",
    online: "#22c55e",
    offline: "#ef4444",
    degraded: "#eab308",
  };
  const color = map[level] ?? "#6b7280";
  return `<span style="background:${color};color:#fff;padding:1px 6px;font-size:9px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;">${level}</span>`;
}

function tableHead(cols: string[]): string {
  return `<tr>${cols.map((c) => `<th>${c}</th>`).join("")}</tr>`;
}

function buildDetections(data: ReportData): string {
  const rows = data.detections
    .slice(0, 200)
    .map(
      (d) => `
    <tr>
      <td>${d.id.slice(0, 8)}</td>
      <td>${d.callsign}</td>
      <td>${d.model}</td>
      <td>${badge(d.threat)}</td>
      <td>${d.sensorName}</td>
      <td>${(d.confidence * 100).toFixed(0)}%</td>
      <td>${fmt(d.timestamp)}</td>
      <td>${d.lat.toFixed(4)}, ${d.lng.toFixed(4)}</td>
    </tr>`,
    )
    .join("");
  return `
    <h2>Detection Log <span class="count">${data.detections.length} records</span></h2>
    <table>
      <thead>${tableHead(["ID", "Callsign", "Model", "Threat", "Sensor", "Conf.", "Timestamp", "Coordinates"])}</thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function buildIncidents(data: ReportData): string {
  const rows = data.incidents
    .map(
      (i) => `
    <tr>
      <td>${i.code}</td>
      <td>${i.title}</td>
      <td>${badge(i.threat)}</td>
      <td>${badge(i.status)}</td>
      <td>${i.assignee}</td>
      <td>${fmt(i.createdAt)}</td>
      <td>${fmt(i.updatedAt)}</td>
    </tr>`,
    )
    .join("");
  return `
    <h2>Incident Report <span class="count">${data.incidents.length} records</span></h2>
    <table>
      <thead>${tableHead(["Code", "Title", "Threat", "Status", "Assignee", "Created", "Updated"])}</thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function buildSensors(data: ReportData): string {
  const rows = data.sensors
    .map(
      (s) => `
    <tr>
      <td>${s.id.slice(0, 8)}</td>
      <td>${s.name}</td>
      <td>${s.type}</td>
      <td>${badge(s.status)}</td>
      <td>${s.health}%</td>
      <td>${s.signal}%</td>
      <td>${s.range} m</td>
      <td>${fmt(s.lastPing)}</td>
    </tr>`,
    )
    .join("");
  return `
    <h2>Sensor Performance Audit <span class="count">${data.sensors.length} sensors</span></h2>
    <table>
      <thead>${tableHead(["ID", "Name", "Type", "Status", "Health", "Signal", "Range", "Last Ping"])}</thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function buildAlerts(data: ReportData): string {
  const rows = data.alerts
    .map(
      (a) => `
    <tr>
      <td>${a.id.slice(0, 8)}</td>
      <td>${badge(a.level)}</td>
      <td>${a.title}</td>
      <td>${a.message}</td>
      <td>${a.source}</td>
      <td>${a.acknowledged ? "Yes" : "No"}</td>
      <td>${fmt(a.timestamp)}</td>
    </tr>`,
    )
    .join("");
  return `
    <h2>Alert Log <span class="count">${data.alerts.length} alerts</span></h2>
    <table>
      <thead>${tableHead(["ID", "Level", "Title", "Message", "Source", "ACK", "Timestamp"])}</thead>
      <tbody>${rows}</tbody>
    </table>`;
}

const SECTION_MAP: Record<ReportType, (d: ReportData) => string> = {
  detections: buildDetections,
  incidents: buildIncidents,
  sensors: buildSensors,
  audit: buildAlerts,
};

const TITLES: Record<ReportType, string> = {
  detections: "Detection Log",
  incidents: "Incident Report",
  sensors: "Sensor Performance Audit",
  audit: "Audit / Alert Log",
};

export function exportPdf(type: ReportType, data: ReportData) {
  const section = SECTION_MAP[type](data);
  const now = new Date().toLocaleString("en-GB", { dateStyle: "full", timeStyle: "medium" });

  const html = `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8"/>
<title>Sky Guardian — ${TITLES[type]}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: "Courier New", "Courier", monospace;
    font-size: 10px;
    color: #111;
    background: #fff;
    padding: 24px 28px;
  }
  .header { border-bottom: 2px solid #111; padding-bottom: 10px; margin-bottom: 16px; }
  .header-title { font-size: 18px; font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase; }
  .header-sub { font-size: 9px; letter-spacing: 0.15em; color: #555; margin-top: 2px; }
  .meta { display: flex; gap: 32px; margin-bottom: 18px; }
  .meta-item label { font-size: 8px; letter-spacing: 0.2em; text-transform: uppercase; color: #888; display: block; }
  .meta-item span { font-size: 10px; font-weight: 700; }
  h2 { font-size: 11px; letter-spacing: 0.15em; text-transform: uppercase; margin-bottom: 8px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
  h2 .count { font-size: 9px; font-weight: 400; color: #666; margin-left: 8px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  th { background: #111; color: #fff; font-size: 8px; letter-spacing: 0.12em; text-transform: uppercase; padding: 4px 6px; text-align: left; }
  td { padding: 3px 6px; border-bottom: 1px solid #eee; font-size: 9px; vertical-align: middle; }
  tr:nth-child(even) td { background: #f7f7f7; }
  .footer { border-top: 1px solid #ccc; padding-top: 8px; font-size: 8px; color: #999; letter-spacing: 0.1em; text-transform: uppercase; margin-top: 16px; }
  @media print {
    body { padding: 12px; }
    @page { margin: 1cm; size: A4 landscape; }
  }
</style></head><body>
  <div class="header">
    <div class="header-title">SKY GUARDIAN — ${TITLES[type]}</div>
    <div class="header-sub">TACTICAL AIRSPACE MONITORING SYSTEM · CLASSIFIED</div>
  </div>
  <div class="meta">
    <div class="meta-item"><label>Generated</label><span>${now}</span></div>
    <div class="meta-item"><label>Report Type</label><span>${TITLES[type]}</span></div>
    <div class="meta-item"><label>Active Threats</label><span>${data.drones.filter((d) => d.threat === "critical" || d.threat === "high").length}</span></div>
    <div class="meta-item"><label>Open Incidents</label><span>${data.incidents.filter((i) => i.status === "open" || i.status === "investigating").length}</span></div>
  </div>
  ${section}
  <div class="footer">Sky Guardian Tactical Platform · Generated ${now} · RESTRICTED</div>
  <script>window.onload = () => { window.print(); }</script>
</body></html>`;

  const win = window.open("", "_blank", "width=1100,height=800");
  if (!win) return;
  win.document.write(html);
  win.document.close();
}
