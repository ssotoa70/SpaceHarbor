import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { MetaRow } from "./MetaRow";

describe("MetaRow", () => {
  afterEach(() => cleanup());

  it("renders label and value", () => {
    render(<MetaRow label="Codec" value="prores" />);
    expect(screen.getByText("Codec")).toBeInTheDocument();
    expect(screen.getByText("prores")).toBeInTheDocument();
  });

  it("renders nothing when value is null", () => {
    const { container } = render(<MetaRow label="Missing" value={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when value is undefined", () => {
    const { container } = render(<MetaRow label="Missing" value={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when value is empty string", () => {
    const { container } = render(<MetaRow label="Empty" value="" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders a copy button when copyable", () => {
    render(<MetaRow label="Asset ID" value="abc123" copyable />);
    expect(screen.getByRole("button", { name: /copy/i })).toBeInTheDocument();
  });

  it("does not render a copy button by default", () => {
    render(<MetaRow label="Codec" value="prores" />);
    expect(screen.queryByRole("button", { name: /copy/i })).toBeNull();
  });
});
