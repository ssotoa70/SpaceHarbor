import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { AssetRow } from "../api";
import { CoordinatorBoard } from "./CoordinatorBoard";

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

describe("CoordinatorBoard", () => {
  afterEach(() => {
    cleanup();
  });

  it("filters by search query and sorts oldest rows first", () => {
    const assets: AssetRow[] = [
      buildAsset({
        id: "asset-young",
        title: "Fresh Clip",
        productionMetadata: {
          dueDate: "2026-02-18T11:30:00.000Z",
          owner: "owner-a",
          vendor: "vendor-east",
          priority: "normal"
        }
      }),
      buildAsset({
        id: "asset-old",
        title: "Older Vendor West Clip",
        productionMetadata: {
          dueDate: "2026-02-18T08:00:00.000Z",
          owner: "owner-b",
          vendor: "vendor-west",
          priority: "urgent"
        }
      })
    ];

    render(<CoordinatorBoard assets={assets} nowMs={Date.parse("2026-02-18T12:00:00.000Z")} />);

    const rowsBeforeFilter = within(screen.getByRole("table")).getAllByRole("row");
    expect(rowsBeforeFilter[1]).toHaveTextContent("Older Vendor West Clip");
    expect(rowsBeforeFilter[2]).toHaveTextContent("Fresh Clip");

    fireEvent.change(screen.getByRole("searchbox", { name: "Search queue" }), {
      target: { value: "vendor-west" }
    });

    expect(screen.getByText("Older Vendor West Clip")).toBeInTheDocument();
    expect(screen.queryByText("Fresh Clip")).not.toBeInTheDocument();
  });

  it("applies status, priority, owner, and vendor filters", () => {
    const assets: AssetRow[] = [
      buildAsset({
        id: "asset-match",
        title: "Needs Match",
        status: "failed",
        productionMetadata: {
          priority: "urgent",
          owner: "coord-a",
          vendor: "vendor-east"
        }
      }),
      buildAsset({
        id: "asset-status-miss",
        title: "Status Miss",
        status: "pending",
        productionMetadata: {
          priority: "urgent",
          owner: "coord-a",
          vendor: "vendor-east"
        }
      }),
      buildAsset({
        id: "asset-owner-miss",
        title: "Owner Miss",
        status: "failed",
        productionMetadata: {
          priority: "urgent",
          owner: "coord-b",
          vendor: "vendor-east"
        }
      })
    ];

    render(<CoordinatorBoard assets={assets} nowMs={Date.parse("2026-02-18T12:00:00.000Z")} />);

    fireEvent.change(screen.getByRole("combobox", { name: "Status filter" }), {
      target: { value: "failed" }
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Priority filter" }), {
      target: { value: "urgent" }
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Owner filter" }), {
      target: { value: "coord-a" }
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Vendor filter" }), {
      target: { value: "vendor-east" }
    });

    expect(screen.getByText("Needs Match")).toBeInTheDocument();
    expect(screen.queryByText("Status Miss")).not.toBeInTheDocument();
    expect(screen.queryByText("Owner Miss")).not.toBeInTheDocument();
  });

  it("resets all filters and restores rows", () => {
    const assets: AssetRow[] = [
      buildAsset({ id: "asset-1", title: "First Clip", status: "pending" }),
      buildAsset({ id: "asset-2", title: "Second Clip", status: "failed" })
    ];

    render(<CoordinatorBoard assets={assets} nowMs={Date.parse("2026-02-18T12:00:00.000Z")} />);

    fireEvent.change(screen.getByRole("searchbox", { name: "Search queue" }), {
      target: { value: "second" }
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Status filter" }), {
      target: { value: "failed" }
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Priority filter" }), {
      target: { value: "high" }
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Owner filter" }), {
      target: { value: "alex" }
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Vendor filter" }), {
      target: { value: "vendor-west" }
    });

    expect(screen.getByText("Second Clip")).toBeInTheDocument();
    expect(screen.queryByText("First Clip")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reset all filters" }));

    expect(screen.getByRole("searchbox", { name: "Search queue" })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "Status filter" })).toHaveValue("all");
    expect(screen.getByRole("combobox", { name: "Priority filter" })).toHaveValue("all");
    expect(screen.getByRole("combobox", { name: "Owner filter" })).toHaveValue("all");
    expect(screen.getByRole("combobox", { name: "Vendor filter" })).toHaveValue("all");
    expect(screen.getByText("First Clip")).toBeInTheDocument();
    expect(screen.getByText("Second Clip")).toBeInTheDocument();
  });

  it("shows empty-state message when filters have no matches", () => {
    const assets: AssetRow[] = [
      buildAsset({ id: "asset-1", title: "Only Clip", productionMetadata: { vendor: "vendor-west" } })
    ];

    render(<CoordinatorBoard assets={assets} nowMs={Date.parse("2026-02-18T12:00:00.000Z")} />);

    fireEvent.change(screen.getByRole("searchbox", { name: "Search queue" }), {
      target: { value: "not-present" }
    });

    const emptyCell = screen.getByRole("cell", {
      name: "No assets match the current filters."
    });
    expect(emptyCell).toHaveAttribute("aria-live", "polite");
    expect(screen.queryByText("Only Clip")).not.toBeInTheDocument();
  });
});
