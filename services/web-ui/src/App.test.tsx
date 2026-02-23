import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import type { AssetRow } from "./api";
import type { MetricsSnapshot } from "./operator/types";

interface CoordinationState {
  guidedActions: {
    acknowledged: boolean;
    owner: string;
    escalated: boolean;
    nextUpdateEta: string | null;
    updatedAt: string | null;
  };
  handoff: {
    state: "none" | "handoff_requested" | "handoff_accepted";
    fromOwner: string;
    toOwner: string;
    summary: string;
    updatedAt: string | null;
  };
  notes: Array<{
    id: string;
    message: string;
    correlationId: string;
    author: string;
    at: string;
  }>;
}

function defaultCoordinationState(): CoordinationState {
  return {
    guidedActions: {
      acknowledged: false,
      owner: "",
      escalated: false,
      nextUpdateEta: null,
      updatedAt: null
    },
    handoff: {
      state: "none",
      fromOwner: "",
      toOwner: "",
      summary: "",
      updatedAt: null
    },
    notes: []
  };
}

interface AuditSignalFixture {
  type: "fallback";
  code: "VAST_FALLBACK";
  severity: "warning" | "critical";
}

interface AuditRowFixture {
  id: string;
  message: string;
  at: string;
  signal: AuditSignalFixture | null;
}

function buildMetricsSnapshot(fallbackEvents: number): MetricsSnapshot {
  return {
    assets: {
      total: 4
    },
    jobs: {
      total: 4,
      pending: 1,
      processing: 1,
      completed: 1,
      failed: 1,
      needsReplay: 0
    },
    queue: {
      pending: 2,
      leased: 1
    },
    outbox: {
      pending: 1,
      published: 10
    },
    dlq: {
      total: 0
    },
    degradedMode: {
      fallbackEvents
    }
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json"
    }
  });
}

function buildAsset(overrides: Partial<AssetRow> = {}): AssetRow {
  const baseAsset: AssetRow = {
    id: "asset-1",
    jobId: "job-1",
    title: "Show-A SH010 Comp",
    sourceUri: "s3://bucket/show-a/ep002/shot-010.mov",
    status: "failed",
    productionMetadata: {
      show: "show-a",
      episode: "ep002",
      sequence: "sq020",
      shot: "sh010",
      version: 3,
      vendor: "vendor-west",
      priority: "high",
      dueDate: "2026-02-18T11:30:00.000Z",
      owner: "alex"
    }
  };

  return {
    ...baseAsset,
    ...overrides,
    productionMetadata: {
      ...baseAsset.productionMetadata,
      ...overrides.productionMetadata
    }
  };
}

function mockApiResponses(options?: {
  assets?: AssetRow[];
  metricsSnapshots?: MetricsSnapshot[];
  auditRows?: AuditRowFixture[];
  auditMessages?: string[];
  failAfterRequestCount?: number;
  coordination?: CoordinationState;
}): void {
  const metricsSnapshots = options?.metricsSnapshots ?? [buildMetricsSnapshot(0)];
  const auditRows =
    options?.auditRows ??
    (options?.auditMessages ?? []).map((message, index) => ({
      id: `audit-${index}`,
      message,
      at: new Date().toISOString(),
      signal: null
    }));

  let requestCount = 0;
  let metricsIndex = 0;
  let coordination = options?.coordination ?? defaultCoordinationState();
  const assets = options?.assets ?? [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestCount += 1;

      if (options?.failAfterRequestCount !== undefined && requestCount > options.failAfterRequestCount) {
        throw new Error("network unavailable");
      }

      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method = init?.method ?? "GET";

      if (url.endsWith("/api/v1/assets")) {
        return jsonResponse({ assets });
      }

      if (url.endsWith("/api/v1/audit")) {
        return jsonResponse({ events: auditRows });
      }

      if (url.endsWith("/api/v1/metrics")) {
        const snapshot = metricsSnapshots[Math.min(metricsIndex, metricsSnapshots.length - 1)];
        metricsIndex += 1;
        return jsonResponse(snapshot);
      }

      if (url.endsWith("/api/v1/assets/ingest")) {
        return new Response(null, { status: 201 });
      }

      if (url.endsWith("/api/v1/incident/coordination") && method === "GET") {
        return jsonResponse(coordination);
      }

      if (url.endsWith("/api/v1/incident/coordination/actions") && method === "PUT") {
        const body = JSON.parse(String(init?.body)) as {
          acknowledged: boolean;
          owner: string;
          escalated: boolean;
          nextUpdateEta: string | null;
          expectedUpdatedAt: string | null;
        };

        if (body.expectedUpdatedAt !== coordination.guidedActions.updatedAt) {
          return new Response(
            JSON.stringify({
              code: "COORDINATION_CONFLICT",
              message: "guided actions changed; refresh and retry",
              requestId: "req-conflict-guided-actions",
              details: {
                expectedUpdatedAt: body.expectedUpdatedAt,
                currentUpdatedAt: coordination.guidedActions.updatedAt
              }
            }),
            {
              status: 409,
              headers: { "content-type": "application/json" }
            }
          );
        }

        const { expectedUpdatedAt: _expectedUpdatedAt, ...nextGuidedActions } = body;

        coordination = {
          ...coordination,
          guidedActions: {
            ...coordination.guidedActions,
            ...nextGuidedActions,
            updatedAt: new Date().toISOString()
          }
        };

        return jsonResponse({ guidedActions: coordination.guidedActions });
      }

      if (url.endsWith("/api/v1/incident/coordination/notes") && method === "POST") {
        const body = JSON.parse(String(init?.body)) as {
          message: string;
          correlationId: string;
          author: string;
        };
        const note = {
          id: `note-${coordination.notes.length + 1}`,
          message: body.message,
          correlationId: body.correlationId,
          author: body.author,
          at: new Date().toISOString()
        };
        coordination = {
          ...coordination,
          notes: [...coordination.notes, note]
        };
        return new Response(JSON.stringify({ note }), { status: 201, headers: { "content-type": "application/json" } });
      }

      if (url.endsWith("/api/v1/incident/coordination/handoff") && method === "PUT") {
        const body = JSON.parse(String(init?.body)) as {
          state: "none" | "handoff_requested" | "handoff_accepted";
          fromOwner: string;
          toOwner: string;
          summary: string;
          expectedUpdatedAt: string | null;
        };

        if (body.expectedUpdatedAt !== coordination.handoff.updatedAt) {
          return new Response(
            JSON.stringify({
              code: "COORDINATION_CONFLICT",
              message: "incident handoff changed; refresh and retry",
              requestId: "req-conflict-handoff",
              details: {
                expectedUpdatedAt: body.expectedUpdatedAt,
                currentUpdatedAt: coordination.handoff.updatedAt
              }
            }),
            {
              status: 409,
              headers: { "content-type": "application/json" }
            }
          );
        }

        const { expectedUpdatedAt: _expectedUpdatedAt, ...nextHandoff } = body;

        coordination = {
          ...coordination,
          handoff: {
            ...nextHandoff,
            updatedAt: new Date().toISOString()
          }
        };
        return jsonResponse({ handoff: coordination.handoff });
      }

      if (/\/api\/v1\/jobs\/.+\/replay$/.test(url)) {
        return new Response(null, { status: 202 });
      }

      return new Response(null, { status: 404 });
    })
  );
}

beforeEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  mockApiResponses();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("App", () => {
  it("renders queue-first workspace elements", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "Assets Queue" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ingest" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Status" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Recent Audit" })).toBeInTheDocument();
  });

  it("renders operational health section", async () => {
    render(<App />);

    expect(await screen.findByRole("heading", { name: /operational health/i })).toBeInTheDocument();
  });

  it("shows degraded health state when fallback events increase", async () => {
    mockApiResponses({
      metricsSnapshots: [buildMetricsSnapshot(3)]
    });

    render(<App />);

    expect(await screen.findByText(/degraded/i)).toBeInTheDocument();
  });

  it("shows degraded state when recent fallback signal exists", async () => {
    const now = Date.now();

    mockApiResponses({
      metricsSnapshots: [buildMetricsSnapshot(0)],
      auditRows: [
        {
          id: "audit-recent-signal",
          message: "storage fallback observed",
          at: new Date(now - 2 * 60_000).toISOString(),
          signal: {
            type: "fallback",
            code: "VAST_FALLBACK",
            severity: "warning"
          }
        }
      ]
    });

    render(<App />);

    await screen.findByText(/storage fallback observed/i);
    expect(screen.getByText(/health state:\s*degraded/i)).toBeInTheDocument();
  });

  it("does not show degraded state for stale fallback signals", async () => {
    const now = Date.now();

    mockApiResponses({
      metricsSnapshots: [buildMetricsSnapshot(0)],
      auditRows: [
        {
          id: "audit-old-signal",
          message: "vast fallback historical event",
          at: new Date(now - 30 * 60_000).toISOString(),
          signal: {
            type: "fallback",
            code: "VAST_FALLBACK",
            severity: "warning"
          }
        }
      ]
    });

    render(<App />);

    await screen.findByText(/historical event/i);
    expect(screen.queryByText(/health state:\s*degraded/i)).not.toBeInTheDocument();
  });

  it("shows stale marker when health data is outdated", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-14T10:00:00.000Z"));

    mockApiResponses({
      metricsSnapshots: [buildMetricsSnapshot(0)],
      failAfterRequestCount: 4
    });

    render(<App />);

    vi.setSystemTime(new Date("2026-02-14T10:01:30.000Z"));
    await vi.advanceTimersByTimeAsync(90_000);

    expect(screen.getByText(/stale/i)).toBeInTheDocument();
  });

  it("keeps degraded state while data is stale after fallback signal", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-14T10:00:00.000Z"));

    mockApiResponses({
      metricsSnapshots: [buildMetricsSnapshot(0)],
      auditRows: [
        {
          id: "audit-recent-signal-stale",
          message: "storage fallback observed",
          at: new Date("2026-02-14T09:58:00.000Z").toISOString(),
          signal: {
            type: "fallback",
            code: "VAST_FALLBACK",
            severity: "warning"
          }
        }
      ],
      failAfterRequestCount: 4
    });

    render(<App />);
    await vi.advanceTimersByTimeAsync(1);
    expect(screen.getByText(/health state:\s*degraded/i)).toBeInTheDocument();

    vi.setSystemTime(new Date("2026-02-14T10:06:00.000Z"));
    await vi.advanceTimersByTimeAsync(6 * 60_000);

    expect(screen.getByText(/stale/i)).toBeInTheDocument();
    expect(screen.getByText(/health state:\s*degraded/i)).toBeInTheDocument();
  });

  it("shows fallback impact count and trend", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-14T10:00:00.000Z"));

    mockApiResponses({
      metricsSnapshots: [buildMetricsSnapshot(1), buildMetricsSnapshot(4)]
    });

    render(<App />);

    await vi.advanceTimersByTimeAsync(15_000);

    expect(screen.getByText(/fallback events/i)).toBeInTheDocument();
    expect(screen.getByText(/rising|stable|falling/i)).toBeInTheDocument();
  });

  it("highlights fallback-correlated audit events by signal code", async () => {
    mockApiResponses({
      auditRows: [
        {
          id: "audit-signal-based",
          message: "storage write fallback triggered",
          at: "2026-02-14T10:00:00.000Z",
          signal: {
            type: "fallback",
            code: "VAST_FALLBACK",
            severity: "warning"
          }
        },
        {
          id: "audit-text-only",
          message: "vast fallback string without signal",
          at: "2026-02-14T10:00:10.000Z",
          signal: null
        }
      ]
    });

    render(<App />);

    const fallbackMessage = await screen.findByText(/storage write fallback triggered/i);
    expect(fallbackMessage).toBeInTheDocument();
    expect(fallbackMessage.closest("li")).toHaveClass("timeline-fallback");

    const textOnlyFallbackMessage = screen.getByText(/string without signal/i);
    expect(textOnlyFallbackMessage.closest("li")).not.toHaveClass("timeline-fallback");
  });

  it("loads shared guided actions from incident coordination", async () => {
    mockApiResponses({
      coordination: {
        ...defaultCoordinationState(),
        guidedActions: {
          acknowledged: true,
          owner: "operator-a",
          escalated: true,
          nextUpdateEta: "2026-02-14T11:00:00.000Z",
          updatedAt: "2026-02-14T10:55:00.000Z"
        },
        notes: [
          {
            id: "note-1",
            message: "Fallback correlated with worker saturation",
            correlationId: "corr-1",
            author: "operator-a",
            at: "2026-02-14T10:45:00.000Z"
          }
        ]
      }
    });

    render(<App />);

    const acknowledgeToggle = await screen.findByRole("checkbox", { name: /acknowledge incident/i });
    const ownerInput = screen.getByRole("textbox", { name: /incident owner/i });
    const escalateToggle = screen.getByRole("checkbox", { name: /escalate response/i });

    await waitFor(() => {
      expect(acknowledgeToggle).toBeChecked();
      expect(ownerInput).toHaveValue("operator-a");
      expect(escalateToggle).toBeChecked();
    });
    expect(screen.queryByText(/local only/i)).not.toBeInTheDocument();
    expect(screen.getByText(/fallback correlated with worker saturation/i)).toBeInTheDocument();
  });

  it("updates shared guided actions through the coordination API", async () => {
    render(<App />);

    const ownerInput = await screen.findByRole("textbox", { name: /incident owner/i });
    fireEvent.change(ownerInput, { target: { value: "operator-b" } });

    const acknowledgeToggle = screen.getByRole("checkbox", { name: /acknowledge incident/i });
    fireEvent.click(acknowledgeToggle);

    const fetchCalls = vi.mocked(fetch).mock.calls;
    const updateCalls = fetchCalls
      .map((call) => ({ url: String(call[0]), init: call[1] as RequestInit | undefined }))
      .filter((call) => call.url.endsWith("/api/v1/incident/coordination/actions"));

    const ownerCall = updateCalls.find((call) => {
      const body = JSON.parse(String(call.init?.body)) as {
        acknowledged: boolean;
        owner: string;
        escalated: boolean;
        nextUpdateEta: string | null;
        expectedUpdatedAt: string | null;
      };
      return body.owner === "operator-b";
    });

    expect(ownerCall).toBeDefined();
    expect(ownerCall?.init?.method).toBe("PUT");
    expect(JSON.parse(String(ownerCall?.init?.body))).toEqual({
      acknowledged: false,
      owner: "operator-b",
      escalated: false,
      nextUpdateEta: null,
      expectedUpdatedAt: null
    });
  });

  it("keeps the latest incident owner when guided action responses resolve out of order", async () => {
    let updateSequence = 0;
    const pendingOwnerUpdates: Array<{
      owner: string;
      resolve: () => void;
    }> = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        const method = init?.method ?? "GET";

        if (url.endsWith("/api/v1/assets")) {
          return jsonResponse({ assets: [] });
        }

        if (url.endsWith("/api/v1/audit")) {
          return jsonResponse({ events: [] });
        }

        if (url.endsWith("/api/v1/metrics")) {
          return jsonResponse(buildMetricsSnapshot(0));
        }

        if (url.endsWith("/api/v1/incident/coordination") && method === "GET") {
          return jsonResponse(defaultCoordinationState());
        }

        if (url.endsWith("/api/v1/incident/coordination/actions") && method === "PUT") {
          const body = JSON.parse(String(init?.body)) as {
            owner: string;
          };
          updateSequence += 1;
          const updatedAt = `2026-02-14T10:00:0${updateSequence}.000Z`;

          return await new Promise<Response>((resolve) => {
            pendingOwnerUpdates.push({
              owner: body.owner,
              resolve: () => {
                resolve(
                  jsonResponse({
                    guidedActions: {
                      ...defaultCoordinationState().guidedActions,
                      owner: body.owner,
                      updatedAt
                    }
                  })
                );
              }
            });
          });
        }

        return new Response(null, { status: 404 });
      })
    );

    render(<App />);

    const ownerInput = screen.getByRole("textbox", { name: /incident owner/i });
    fireEvent.change(ownerInput, { target: { value: "operator-a" } });
    fireEvent.change(ownerInput, { target: { value: "operator-b" } });

    await waitFor(() => {
      expect(pendingOwnerUpdates).toHaveLength(2);
    });

    pendingOwnerUpdates.find((update) => update.owner === "operator-b")?.resolve();
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: /incident owner/i })).toHaveValue("operator-b");
    });

    pendingOwnerUpdates.find((update) => update.owner === "operator-a")?.resolve();

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: /incident owner/i })).toHaveValue("operator-b");
    });
  });

  it("supports shared notes and handoff controls", async () => {
    render(<App />);

    fireEvent.change(await screen.findByRole("textbox", { name: /note message/i }), {
      target: { value: "Investigating queue backlog" }
    });
    fireEvent.change(screen.getByRole("textbox", { name: /correlation id/i }), {
      target: { value: "corr-vast-fallback-123" }
    });
    fireEvent.change(screen.getByRole("textbox", { name: /note author/i }), {
      target: { value: "operator-a" }
    });
    fireEvent.click(screen.getByRole("button", { name: /add note/i }));

    expect(await screen.findByText(/investigating queue backlog/i)).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: /handoff state/i }), {
      target: { value: "handoff_requested" }
    });
    fireEvent.change(screen.getByRole("textbox", { name: /handoff from owner/i }), {
      target: { value: "operator-a" }
    });
    fireEvent.change(screen.getByRole("textbox", { name: /handoff to owner/i }), {
      target: { value: "operator-b" }
    });
    fireEvent.change(screen.getByRole("textbox", { name: /handoff summary/i }), {
      target: { value: "Shift change at 19:00 UTC" }
    });
    fireEvent.click(screen.getByRole("button", { name: /save handoff/i }));

    const fetchCalls = vi.mocked(fetch).mock.calls;
    const noteCall = fetchCalls
      .map((call) => ({ url: String(call[0]), init: call[1] as RequestInit | undefined }))
      .find((call) => call.url.endsWith("/api/v1/incident/coordination/notes"));
    const handoffCall = fetchCalls
      .map((call) => ({ url: String(call[0]), init: call[1] as RequestInit | undefined }))
      .find((call) => call.url.endsWith("/api/v1/incident/coordination/handoff"));

    expect(noteCall?.init?.method).toBe("POST");
    expect(JSON.parse(String(noteCall?.init?.body))).toEqual({
      message: "Investigating queue backlog",
      correlationId: "corr-vast-fallback-123",
      author: "operator-a"
    });
    expect(handoffCall?.init?.method).toBe("PUT");
    expect(JSON.parse(String(handoffCall?.init?.body))).toEqual({
      state: "handoff_requested",
      fromOwner: "operator-a",
      toOwner: "operator-b",
      summary: "Shift change at 19:00 UTC",
      expectedUpdatedAt: null
    });
  });

  it("preserves unsaved handoff draft edits during periodic refresh", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-14T10:00:00.000Z"));

    render(<App />);

    const summaryInput = screen.getByRole("textbox", { name: /handoff summary/i });
    fireEvent.change(summaryInput, { target: { value: "Waiting for coordinator confirmation" } });

    await vi.advanceTimersByTimeAsync(15_000);

    expect(screen.getByRole("textbox", { name: /handoff summary/i })).toHaveValue(
      "Waiting for coordinator confirmation"
    );
  });

  it("announces health state updates through a polite live region", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-14T10:00:00.000Z"));

    mockApiResponses({
      metricsSnapshots: [buildMetricsSnapshot(0), buildMetricsSnapshot(2)]
    });

    render(<App />);

    await vi.advanceTimersByTimeAsync(15_000);

    const liveRegion = screen.getByRole("status", { name: /health state updates/i });
    expect(liveRegion).toHaveAttribute("aria-live", "polite");
    expect(liveRegion).toHaveTextContent(/health state: degraded/i);
  });

  it("renders explicit text labels for health badges and keeps guided controls keyboard focusable", async () => {
    render(<App />);

    expect(await screen.findByText(/health state:/i)).toBeInTheDocument();

    const clearButton = screen.getByRole("button", { name: /clear guided actions/i });
    clearButton.focus();
    expect(clearButton).toHaveFocus();

    const acknowledgeToggle = screen.getByRole("checkbox", { name: /acknowledge incident/i });
    acknowledgeToggle.focus();
    expect(acknowledgeToggle).toHaveFocus();
  });

  it("switches between operator, coordinator, and supervisor role views", async () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "Assets Queue" })).toBeInTheDocument();

    const roleGroup = screen.getByRole("radiogroup", { name: /role view/i });
    expect(within(roleGroup).getByRole("radio", { name: "Operator" })).toBeChecked();

    fireEvent.click(within(roleGroup).getByRole("radio", { name: "Coordinator" }));
    expect(screen.getByRole("heading", { name: "Coordinator Queue" })).toBeInTheDocument();

    fireEvent.click(within(roleGroup).getByRole("radio", { name: "Supervisor" }));
    expect(screen.getByRole("heading", { name: "Supervisor Queue" })).toBeInTheDocument();
  });

  it("initializes and persists selected role in query string", () => {
    window.history.replaceState({}, "", "?role=coordinator&trace=abc");

    render(<App />);

    const roleGroup = screen.getByRole("radiogroup", { name: /role view/i });
    expect(within(roleGroup).getByRole("radio", { name: "Coordinator" })).toBeChecked();
    expect(window.location.search).toBe("?role=coordinator&trace=abc");

    fireEvent.click(within(roleGroup).getByRole("radio", { name: "Supervisor" }));
    expect(window.location.search).toBe("?role=supervisor&trace=abc");

    fireEvent.click(within(roleGroup).getByRole("radio", { name: "Operator" }));
    expect(window.location.search).toBe("?role=operator&trace=abc");
  });

  it("keeps operator baseline working after switching away and back", () => {
    render(<App />);

    const roleGroup = screen.getByRole("radiogroup", { name: /role view/i });
    fireEvent.click(within(roleGroup).getByRole("radio", { name: "Coordinator" }));
    expect(screen.getByRole("heading", { name: "Coordinator Queue" })).toBeInTheDocument();

    fireEvent.click(within(roleGroup).getByRole("radio", { name: "Operator" }));
    expect(screen.getByRole("heading", { name: "Ingest" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Assets Queue" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Register Asset" })).toBeInTheDocument();
  });

  it("routes coordinator bulk replay through App callback and refreshes after replay", async () => {
    mockApiResponses({
      assets: [
        buildAsset({
          id: "asset-coordinator",
          jobId: "job-coordinator",
          title: "Coordinator Replay Asset",
          productionMetadata: {
            dueDate: "2099-02-18T11:30:00.000Z"
          }
        })
      ]
    });

    render(<App />);

    const roleGroup = screen.getByRole("radiogroup", { name: /role view/i });
    fireEvent.click(within(roleGroup).getByRole("radio", { name: "Coordinator" }));

    fireEvent.click(await screen.findByRole("checkbox", { name: /select coordinator replay asset/i }));
    fireEvent.click(screen.getByRole("button", { name: "Run replay for eligible" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm replay" }));

    await waitFor(() => {
      const replayCalls = vi
        .mocked(fetch)
        .mock.calls.filter((call) => String(call[0]).endsWith("/api/v1/jobs/job-coordinator/replay"));
      expect(replayCalls).toHaveLength(1);
    });

    await waitFor(() => {
      const assetCalls = vi.mocked(fetch).mock.calls.filter((call) => String(call[0]).endsWith("/api/v1/assets"));
      expect(assetCalls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("routes supervisor bulk replay through App callback and refreshes after replay", async () => {
    mockApiResponses({
      assets: [
        buildAsset({
          id: "asset-supervisor",
          jobId: "job-supervisor",
          title: "Supervisor Replay Asset",
          productionMetadata: {
            dueDate: "2099-02-18T11:30:00.000Z"
          }
        })
      ]
    });

    render(<App />);

    const roleGroup = screen.getByRole("radiogroup", { name: /role view/i });
    fireEvent.click(within(roleGroup).getByRole("radio", { name: "Supervisor" }));

    fireEvent.click(await screen.findByRole("checkbox", { name: /select supervisor replay asset/i }));
    fireEvent.click(screen.getByRole("button", { name: "Run replay for eligible" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm replay" }));

    await waitFor(() => {
      const replayCalls = vi
        .mocked(fetch)
        .mock.calls.filter((call) => String(call[0]).endsWith("/api/v1/jobs/job-supervisor/replay"));
      expect(replayCalls).toHaveLength(1);
    });

    await waitFor(() => {
      const assetCalls = vi.mocked(fetch).mock.calls.filter((call) => String(call[0]).endsWith("/api/v1/assets"));
      expect(assetCalls.length).toBeGreaterThanOrEqual(2);
    });
  });
});
