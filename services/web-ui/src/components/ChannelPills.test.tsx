import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ChannelPills } from "./ChannelPills";

describe("ChannelPills", () => {
  const sample = [
    { channel_name: "R", layer_name: "rgba", part_index: 0 },
    { channel_name: "G", layer_name: "rgba", part_index: 0 },
    { channel_name: "R", layer_name: "diffuse", part_index: 0 },
    { channel_name: "G", layer_name: "diffuse", part_index: 0 },
  ];

  it("returns null when channels is not an array", () => {
    const { container } = render(
      <ChannelPills channels={{ rgba: ["R"] }} mode="per-channel" />
    );
    expect(container.firstChild).toBeNull();
  });

  it("returns null when channels is null/undefined", () => {
    const { container: c1 } = render(
      <ChannelPills channels={null} mode="per-channel" />
    );
    expect(c1.firstChild).toBeNull();
    const { container: c2 } = render(
      <ChannelPills channels={undefined} mode="per-channel" />
    );
    expect(c2.firstChild).toBeNull();
  });

  it("returns null when all channels lack channel_name", () => {
    const { container } = render(
      <ChannelPills
        channels={[{ layer_name: "rgba" }, { layer_name: "diffuse" }]}
        mode="per-channel"
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("per-channel mode: pills include layer prefix for non-rgba layers", () => {
    const { container } = render(
      <ChannelPills channels={sample} mode="per-channel" />
    );
    const pills = Array.from(container.querySelectorAll("span"));
    expect(pills.length).toBe(4);
    const labels = pills.map((p) => p.textContent);
    expect(labels).toContain("R");
    expect(labels).toContain("G");
    expect(labels).toContain("diffuse.R");
    expect(labels).toContain("diffuse.G");
  });

  it("dedup-by-layer mode: one pill per unique layer_name", () => {
    const { container } = render(
      <ChannelPills channels={sample} mode="dedup-by-layer" />
    );
    const pills = Array.from(container.querySelectorAll("span"));
    expect(pills.length).toBe(2);
    const labels = pills.map((p) => p.textContent);
    expect(labels).toEqual(expect.arrayContaining(["rgba", "diffuse"]));
  });

  it("dedup-by-layer mode: falls back to channel_name when layer is missing", () => {
    const input = [{ channel_name: "Z" }, { channel_name: "A" }];
    const { container } = render(
      <ChannelPills channels={input} mode="dedup-by-layer" />
    );
    const pills = Array.from(container.querySelectorAll("span"));
    const labels = pills.map((p) => p.textContent);
    expect(labels).toEqual(expect.arrayContaining(["Z", "A"]));
  });
});
