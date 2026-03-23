import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi } from "vitest";

import { MaterialBrowser } from "./MaterialBrowser";

const MOCK_MATERIALS = vi.hoisted(() => [
  {
    id: "m1",
    name: "hero_mtl",
    versions: [
      {
        id: "mv1",
        label: "v001",
        looks: [
          { name: "default", renderContext: "arnold", previewColor: "#4a6741" },
          { name: "wet", renderContext: "arnold", previewColor: "#2c4a52" },
        ],
        dependencies: [
          { path: "/tex/hero_diffuse_4k.exr", type: "diffuse" },
          { path: "/tex/hero_normal_4k.exr", type: "normal" },
          { path: "/tex/hero_roughness_4k.exr", type: "roughness" },
        ],
      },
      {
        id: "mv2",
        label: "v002",
        looks: [{ name: "default", renderContext: "arnold", previewColor: "#5a7a4f" }],
        dependencies: [
          { path: "/tex/hero_diffuse_4k_v2.exr", type: "diffuse" },
          { path: "/tex/hero_normal_4k.exr", type: "normal" },
        ],
      },
    ],
    usedBy: [
      { shotId: "sh010", versionLabel: "v003" },
      { shotId: "sh020", versionLabel: "v001" },
    ],
  },
  {
    id: "m2",
    name: "env_ground",
    versions: [
      {
        id: "mv3",
        label: "v001",
        looks: [{ name: "default", renderContext: "karma", previewColor: "#8b7355" }],
        dependencies: [
          { path: "/tex/ground_diffuse_8k.exr", type: "diffuse" },
          { path: "/tex/ground_disp_8k.exr", type: "displacement" },
        ],
      },
    ],
    usedBy: [{ shotId: "sh010", versionLabel: "v003" }],
  },
]);

vi.mock("../api", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../api")>();
  return {
    ...orig,
    fetchMaterials: vi.fn().mockResolvedValue(MOCK_MATERIALS),
  };
});

function renderWithRouter() {
  return render(
    <MemoryRouter>
      <MaterialBrowser />
    </MemoryRouter>
  );
}

describe("MaterialBrowser", () => {
  it("renders materials heading", () => {
    renderWithRouter();
    expect(screen.getByText("Materials")).toBeInTheDocument();
  });

  it("renders empty state when no materials returned", async () => {
    const { fetchMaterials } = await import("../api");
    vi.mocked(fetchMaterials).mockResolvedValueOnce([]);
    renderWithRouter();
    await waitFor(() => {
      expect(screen.getByText("No materials")).toBeInTheDocument();
    });
  });

  it("renders material cards after loading", async () => {
    renderWithRouter();
    await waitFor(() => {
      expect(screen.getAllByText("hero_mtl").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("env_ground").length).toBeGreaterThanOrEqual(1);
    });
  });

  it("shows look count badges", async () => {
    renderWithRouter();
    await waitFor(() => {
      expect(screen.getByText("3 looks")).toBeInTheDocument();
      expect(screen.getByText("1 looks")).toBeInTheDocument();
    });
  });

  it("selects material and shows detail panel", async () => {
    renderWithRouter();
    await waitFor(() => screen.getAllByText("hero_mtl"));
    fireEvent.click(screen.getAllByText("hero_mtl")[0]);
    expect(screen.getByText("Look Variants")).toBeInTheDocument();
    expect(screen.getAllByText("default").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("wet")).toBeInTheDocument();
  });

  it("shows version selector", async () => {
    renderWithRouter();
    await waitFor(() => screen.getAllByText("hero_mtl"));
    fireEvent.click(screen.getAllByText("hero_mtl")[0]);
    expect(screen.getByText("Version")).toBeInTheDocument();
    expect(screen.getByDisplayValue("v001")).toBeInTheDocument();
  });

  it("switches version and updates looks", async () => {
    renderWithRouter();
    await waitFor(() => screen.getAllByText("hero_mtl"));
    fireEvent.click(screen.getAllByText("hero_mtl")[0]);
    fireEvent.change(screen.getByDisplayValue("v001"), { target: { value: "1" } });
    // v002 only has "default" look, not "wet"
    expect(screen.queryByText("wet")).not.toBeInTheDocument();
  });

  it("renders texture dependency tree", async () => {
    renderWithRouter();
    await waitFor(() => screen.getAllByText("hero_mtl"));
    fireEvent.click(screen.getAllByText("hero_mtl")[0]);
    expect(screen.getByText(/Texture Dependencies/)).toBeInTheDocument();
    expect(screen.getByText("/tex/hero_diffuse_4k.exr")).toBeInTheDocument();
  });

  it("renders where used panel", async () => {
    renderWithRouter();
    await waitFor(() => screen.getAllByText("hero_mtl"));
    fireEvent.click(screen.getAllByText("hero_mtl")[0]);
    expect(screen.getByText("Where Used?")).toBeInTheDocument();
    expect(screen.getAllByText("sh010").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("sh020").length).toBeGreaterThanOrEqual(1);
  });

  it("collapses dependency tree", async () => {
    renderWithRouter();
    await waitFor(() => screen.getAllByText("hero_mtl"));
    fireEvent.click(screen.getAllByText("hero_mtl")[0]);
    const toggle = screen.getByText(/Texture Dependencies/);
    fireEvent.click(toggle);
    expect(screen.queryByText("/tex/hero_diffuse_4k.exr")).not.toBeInTheDocument();
  });
});
