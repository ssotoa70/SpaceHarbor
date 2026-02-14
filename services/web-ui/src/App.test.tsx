import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { App } from "./App";

afterEach(() => {
  cleanup();
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
});
