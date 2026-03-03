import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import * as api from "./api";

import { App } from "./App";

vi.mock("./api");

describe("App", () => {
  it("renders AppShell with topbar, sidebar, and main sections", () => {
    vi.mocked(api.fetchAssets).mockResolvedValue([]);
    vi.mocked(api.fetchAudit).mockResolvedValue([]);
    vi.mocked(api.fetchApprovalQueue).mockResolvedValue({ assets: [], total: 0 });

    render(<App />);

    expect(screen.getByText("AssetHarbor")).toBeInTheDocument();
    expect(screen.getByText("+ Ingest Asset")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Approval Queue" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "All Assets" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Recent Audit" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Asset Details" })).toBeInTheDocument();
  });
});
