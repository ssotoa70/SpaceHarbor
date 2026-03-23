import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { VersionCompareViewer } from "./VersionCompareViewer";

const versions = [
  { id: "v1", label: "v001", src: "/proxy/v001.mp4" },
  { id: "v2", label: "v002", src: "/proxy/v002.mp4" },
  { id: "v3", label: "v003", src: "/proxy/v003.mp4" },
];

function renderViewer(props: Partial<Parameters<typeof VersionCompareViewer>[0]> = {}) {
  return render(
    <VersionCompareViewer versions={props.versions ?? versions} {...props} />,
  );
}

describe("VersionCompareViewer", () => {
  it("renders with default flip mode", () => {
    renderViewer();
    expect(screen.getByTestId("version-compare-viewer")).toBeInTheDocument();
    expect(screen.getByLabelText("Compare mode: flip")).toHaveAttribute("aria-pressed", "true");
  });

  it("renders mode selector buttons", () => {
    renderViewer();
    expect(screen.getByLabelText("Compare mode: flip")).toBeInTheDocument();
    expect(screen.getByLabelText("Compare mode: wipe")).toBeInTheDocument();
    expect(screen.getByLabelText("Compare mode: overlay")).toBeInTheDocument();
  });

  it("renders version selectors", () => {
    renderViewer();
    expect(screen.getByLabelText("Version A selector")).toBeInTheDocument();
    expect(screen.getByLabelText("Version B selector")).toBeInTheDocument();
  });

  it("renders flip badge showing active version label", () => {
    renderViewer();
    const badge = screen.getByTestId("flip-badge");
    expect(badge.textContent).toContain("v001");
    expect(badge.textContent).toContain("(A)");
  });

  it("toggles flip between A and B on Space key", () => {
    renderViewer();
    const badge = screen.getByTestId("flip-badge");
    expect(badge.textContent).toContain("(A)");
    fireEvent.keyDown(window, { key: " " });
    expect(badge.textContent).toContain("(B)");
    fireEvent.keyDown(window, { key: " " });
    expect(badge.textContent).toContain("(A)");
  });

  it("switches to wipe mode and shows split handle", () => {
    renderViewer();
    fireEvent.click(screen.getByLabelText("Compare mode: wipe"));
    expect(screen.getByTestId("wipe-handle")).toBeInTheDocument();
    expect(screen.getByLabelText("Wipe split handle")).toBeInTheDocument();
  });

  it("adjusts wipe position with arrow keys", () => {
    renderViewer();
    fireEvent.click(screen.getByLabelText("Compare mode: wipe"));
    const handle = screen.getByTestId("wipe-handle");
    // Default is 50%
    expect(handle.getAttribute("aria-valuenow")).toBe("50");
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(handle.getAttribute("aria-valuenow")).toBe("48");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(handle.getAttribute("aria-valuenow")).toBe("50");
  });

  it("switches to overlay mode and shows opacity slider", () => {
    renderViewer();
    fireEvent.click(screen.getByLabelText("Compare mode: overlay"));
    expect(screen.getByLabelText("Overlay opacity")).toBeInTheDocument();
  });

  it("renders all version options in dropdown", () => {
    renderViewer();
    const selectA = screen.getByLabelText("Version A selector");
    const options = selectA.querySelectorAll("option");
    expect(options.length).toBe(3);
    expect(options[0].textContent).toBe("v001");
    expect(options[1].textContent).toBe("v002");
    expect(options[2].textContent).toBe("v003");
  });

  it("switches version A via dropdown", () => {
    renderViewer();
    fireEvent.change(screen.getByLabelText("Version A selector"), { target: { value: "v3" } });
    const badge = screen.getByTestId("flip-badge");
    expect(badge.textContent).toContain("v003");
  });
});
