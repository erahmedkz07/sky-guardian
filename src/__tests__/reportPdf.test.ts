import { describe, it, expect, vi, beforeEach } from "vitest";
import { exportPdf, type ReportData } from "@/lib/reportPdf";

function makeData(overrides: Partial<ReportData> = {}): ReportData {
  return {
    drones: [],
    sensors: [],
    detections: [
      {
        id: "det1",
        droneId: "d1",
        callsign: "ALPHA-1",
        model: "DJI",
        threat: "high",
        sensorId: "s1",
        sensorName: "RF-North",
        timestamp: new Date("2025-01-01T12:00:00Z"),
        lat: 51.18,
        lng: 71.45,
        confidence: 0.95,
      },
    ],
    incidents: [
      {
        id: "inc1",
        code: "INC-001",
        title: "Test incident",
        threat: "medium",
        status: "open",
        assignee: "Op-1",
        createdAt: new Date("2025-01-01T10:00:00Z"),
        updatedAt: new Date("2025-01-01T11:00:00Z"),
        description: "Test description",
        detectionIds: ["det1"],
      },
    ],
    alerts: [
      {
        id: "alr1",
        level: "critical",
        title: "Threat detected",
        message: "Drone near perimeter",
        timestamp: new Date("2025-01-01T12:00:00Z"),
        source: "ALPHA-1",
        acknowledged: false,
      },
    ],
    ...overrides,
  };
}

describe("exportPdf", () => {
  let mockWin: {
    document: { write: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
  };

  beforeEach(() => {
    mockWin = { document: { write: vi.fn(), close: vi.fn() } };
    vi.stubGlobal("window", { ...globalThis.window, open: vi.fn(() => mockWin) });
  });

  it("opens a new window", () => {
    exportPdf("detections", makeData());
    expect(window.open).toHaveBeenCalledWith("", "_blank", expect.any(String));
  });

  it("writes HTML with detection data", () => {
    exportPdf("detections", makeData());
    const html: string = mockWin.document.write.mock.calls[0][0];
    expect(html).toContain("ALPHA-1");
    expect(html).toContain("Detection Log");
    expect(html).toContain("Sky Guardian");
  });

  it("writes HTML with incident data", () => {
    exportPdf("incidents", makeData());
    const html: string = mockWin.document.write.mock.calls[0][0];
    expect(html).toContain("INC-001");
    expect(html).toContain("Incident Report");
  });

  it("writes HTML for audit/alerts type", () => {
    exportPdf("audit", makeData());
    const html: string = mockWin.document.write.mock.calls[0][0];
    expect(html).toContain("Threat detected");
    expect(html).toContain("Audit");
  });

  it("calls document.close after write", () => {
    exportPdf("sensors", makeData());
    expect(mockWin.document.close).toHaveBeenCalled();
  });

  it("does nothing if window.open returns null", () => {
    vi.stubGlobal("window", { ...globalThis.window, open: vi.fn(() => null) });
    expect(() => exportPdf("detections", makeData())).not.toThrow();
  });
});
