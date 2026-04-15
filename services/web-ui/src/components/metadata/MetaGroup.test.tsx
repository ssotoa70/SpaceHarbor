import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { MetaGroup } from "./MetaGroup";
import { MetaRow } from "./MetaRow";

describe("MetaGroup", () => {
  afterEach(() => cleanup());

  it("renders title and children when at least one row has a value", () => {
    render(
      <MetaGroup id="g1" title="Container">
        <MetaRow label="Format" value="mov" />
        <MetaRow label="Size" value={null} />
      </MetaGroup>,
    );
    expect(screen.getByText("Container")).toBeInTheDocument();
    expect(screen.getByText("mov")).toBeInTheDocument();
  });

  it("hides the entire group when all rows are empty", () => {
    const { container } = render(
      <MetaGroup id="g2" title="Camera">
        <MetaRow label="Make" value={null} />
        <MetaRow label="Model" value={undefined} />
      </MetaGroup>,
    );
    expect(container.firstChild).toBeNull();
    expect(screen.queryByText("Camera")).toBeNull();
  });

  it("is collapsible via the details element", () => {
    render(
      <MetaGroup id="g3" title="Audio">
        <MetaRow label="Codec" value="pcm" />
      </MetaGroup>,
    );
    const details = screen.getByText("Audio").closest("details");
    expect(details).not.toBeNull();
    // Starts open by default
    expect(details?.hasAttribute("open")).toBe(true);
  });

  it("honors the defaultOpen=false prop", () => {
    render(
      <MetaGroup id="g4" title="Provenance" defaultOpen={false}>
        <MetaRow label="Extractor" value="v1.0.0" />
      </MetaGroup>,
    );
    const details = screen.getByText("Provenance").closest("details");
    expect(details?.hasAttribute("open")).toBe(false);
  });
});
