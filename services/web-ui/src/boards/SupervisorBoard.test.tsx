import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { AssetRow } from "../api";
import { SupervisorBoard } from "./SupervisorBoard";

type AssetOverrides = Partial<Omit<AssetRow, "productionMetadata">> & {
  productionMetadata?: Partial<AssetRow["productionMetadata"]>;
};

function buildAsset(overrides: AssetOverrides = {}): AssetRow {
  const baseAsset: AssetRow = {
    id: "asset-1",
    jobId: "job-1",
    title: "Show-A SH010 Comp",
    sourceUri: "s3://bucket/show-a/ep002/shot-010.mov",
    status: "pending",
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

describe("SupervisorBoard", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders summary cards with status, aging, and priority counts", () => {
    const assets: AssetRow[] = [
      buildAsset({
        id: "asset-pending-fresh",
        status: "pending",
        productionMetadata: {
          priority: "normal",
          dueDate: "2026-02-18T11:30:00.000Z"
        }
      }),
      buildAsset({
        id: "asset-processing-warning",
        status: "processing",
        productionMetadata: {
          priority: "high",
          dueDate: "2026-02-18T10:25:00.000Z"
        }
      }),
      buildAsset({
        id: "asset-failed-critical",
        status: "failed",
        productionMetadata: {
          priority: "urgent",
          dueDate: "2026-02-18T08:30:00.000Z"
        }
      })
    ];

    render(<SupervisorBoard assets={assets} nowMs={Date.parse("2026-02-18T12:00:00.000Z")} />);

    expect(screen.getByRole("heading", { name: "Supervisor Queue" })).toBeInTheDocument();
    expect(screen.getByText("Total assets")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();

    const statusCard = screen.getByTestId("supervisor-summary-status");
    expect(within(statusCard).getByText("pending: 1")).toBeInTheDocument();
    expect(within(statusCard).getByText("processing: 1")).toBeInTheDocument();
    expect(within(statusCard).getByText("failed: 1")).toBeInTheDocument();
    expect(within(statusCard).getByText("needs replay: 0")).toBeInTheDocument();

    const agingCard = screen.getByTestId("supervisor-summary-aging");
    expect(within(agingCard).getByText("fresh: 1")).toBeInTheDocument();
    expect(within(agingCard).getByText("warning: 1")).toBeInTheDocument();
    expect(within(agingCard).getByText("critical: 1")).toBeInTheDocument();

    const priorityCard = screen.getByTestId("supervisor-summary-priority");
    expect(within(priorityCard).getByText("normal: 1")).toBeInTheDocument();
    expect(within(priorityCard).getByText("high: 1")).toBeInTheDocument();
    expect(within(priorityCard).getByText("urgent: 1")).toBeInTheDocument();
  });

  it("shows critical aging rows with explicit text labels", () => {
    const assets: AssetRow[] = [
      buildAsset({
        id: "asset-critical",
        title: "Critical Clip",
        status: "failed",
        productionMetadata: {
          priority: "urgent",
          dueDate: "2026-02-18T08:00:00.000Z",
          owner: "casey"
        }
      }),
      buildAsset({
        id: "asset-fresh",
        title: "Fresh Clip",
        status: "pending",
        productionMetadata: {
          priority: "normal",
          dueDate: "2026-02-18T11:50:00.000Z",
          owner: "alex"
        }
      })
    ];

    render(<SupervisorBoard assets={assets} nowMs={Date.parse("2026-02-18T12:00:00.000Z")} />);

    const table = screen.getByRole("table", { name: "Supervisor compact queue" });
    const criticalRow = within(table).getByRole("row", { name: /Critical Clip/i });

    expect(within(criticalRow).getByText("aging: critical (180m+)")).toBeInTheDocument();
    expect(within(criticalRow).getByText("status: failed")).toBeInTheDocument();
    expect(within(criticalRow).getByText("priority: urgent")).toBeInTheDocument();
  });

  it("renders compact queue fields for escalation triage", () => {
    const assets: AssetRow[] = [
      buildAsset({
        id: "asset-1",
        title: "Escalation Candidate",
        status: "needs_replay",
        productionMetadata: {
          priority: "high",
          owner: "riley",
          dueDate: "2026-02-18T10:00:00.000Z"
        }
      })
    ];

    render(<SupervisorBoard assets={assets} nowMs={Date.parse("2026-02-18T12:00:00.000Z")} />);

    const table = screen.getByRole("table", { name: "Supervisor compact queue" });
    expect(within(table).getByRole("columnheader", { name: "Title" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Status" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Priority" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Owner" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Aging" })).toBeInTheDocument();

    expect(within(table).queryByRole("columnheader", { name: "Source" })).not.toBeInTheDocument();
    expect(within(table).queryByRole("columnheader", { name: "Actions" })).not.toBeInTheDocument();

    const row = within(table).getByRole("row", { name: /Escalation Candidate/i });
    expect(within(row).getByText("Escalation Candidate")).toBeInTheDocument();
    expect(within(row).getByText("riley")).toBeInTheDocument();
    expect(within(row).getByText("status: needs replay")).toBeInTheDocument();
    expect(within(row).getByText("aging: warning (90m+)")).toBeInTheDocument();
  });

  it("filters supervisor queue by search and status", () => {
    const assets: AssetRow[] = [
      buildAsset({
        id: "asset-1",
        title: "Vendor West Failed",
        status: "failed",
        productionMetadata: {
          owner: "alex",
          priority: "urgent"
        }
      }),
      buildAsset({
        id: "asset-2",
        title: "Vendor East Pending",
        status: "pending",
        productionMetadata: {
          owner: "casey",
          vendor: "vendor-east",
          priority: "normal"
        }
      })
    ];

    render(<SupervisorBoard assets={assets} nowMs={Date.parse("2026-02-18T12:00:00.000Z")} />);

    fireEvent.change(screen.getByRole("searchbox", { name: "Search queue" }), {
      target: { value: "vendor west" }
    });

    expect(screen.getByText("Vendor West Failed")).toBeInTheDocument();
    expect(screen.queryByText("Vendor East Pending")).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Status filter" }), {
      target: { value: "pending" }
    });

    expect(screen.queryByText("Vendor West Failed")).not.toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "No supervisor assets match the current filters." })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reset filters" }));

    expect(screen.getByRole("searchbox", { name: "Search queue" })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "Status filter" })).toHaveValue("all");
    expect(screen.getByText("Vendor West Failed")).toBeInTheDocument();
    expect(screen.getByText("Vendor East Pending")).toBeInTheDocument();
  });
});
