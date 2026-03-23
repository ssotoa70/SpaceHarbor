import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DashboardCard } from "./DashboardCard";
import { VerticalBarChart } from "./VerticalBarChart";
import { HorizontalBarChart } from "./HorizontalBarChart";
import { Sparkline } from "./Sparkline";
import { StatCard } from "./StatCard";
import { DonutChart } from "./DonutChart";
import { LineChart } from "./LineChart";
import { formatBytes, formatHours, formatDuration } from "./utils";

describe("Chart components", () => {
  describe("DashboardCard", () => {
    it("renders title and children", () => {
      render(<DashboardCard title="Test Card">Content here</DashboardCard>);
      expect(screen.getByText("Test Card")).toBeDefined();
      expect(screen.getByText("Content here")).toBeDefined();
    });
  });

  describe("StatCard", () => {
    it("renders label and value", () => {
      render(<StatCard label="Total" value="1,234" />);
      expect(screen.getByText("Total")).toBeDefined();
      expect(screen.getByText("1,234")).toBeDefined();
    });
  });

  describe("VerticalBarChart", () => {
    it("renders bars", () => {
      const data = [
        { label: "A", value: 100, color: "red" },
        { label: "B", value: 200, color: "blue" },
      ];
      const { container } = render(<VerticalBarChart data={data} />);
      const bars = container.querySelectorAll("[role='img']");
      expect(bars.length).toBe(2);
    });
  });

  describe("HorizontalBarChart", () => {
    it("renders bars", () => {
      const data = [
        { label: "X", value: 500 },
        { label: "Y", value: 300 },
      ];
      const { container } = render(<HorizontalBarChart data={data} />);
      const bars = container.querySelectorAll("[role='img']");
      expect(bars.length).toBe(2);
    });
  });

  describe("Sparkline", () => {
    it("renders SVG polyline", () => {
      const { container } = render(<Sparkline data={[10, 20, 30, 40]} />);
      expect(container.querySelector("polyline")).not.toBeNull();
    });

    it("returns null for < 2 data points", () => {
      const { container } = render(<Sparkline data={[10]} />);
      expect(container.querySelector("svg")).toBeNull();
    });
  });

  describe("DonutChart", () => {
    it("renders circle segments", () => {
      const segments = [
        { label: "A", value: 60, color: "red" },
        { label: "B", value: 40, color: "blue" },
      ];
      const { container } = render(<DonutChart segments={segments} />);
      const circles = container.querySelectorAll("circle");
      expect(circles.length).toBe(2);
    });

    it("segments sum to 100%", () => {
      const segments = [
        { label: "A", value: 30, color: "red" },
        { label: "B", value: 70, color: "blue" },
      ];
      const { container } = render(<DonutChart segments={segments} />);
      const circles = container.querySelectorAll("circle");
      expect(circles.length).toBe(2);
      // Both circles should have aria-label with percentage
      const labels = Array.from(circles).map((c) => c.getAttribute("aria-label"));
      expect(labels).toContain("A: 30.0%");
      expect(labels).toContain("B: 70.0%");
    });

    it("returns null for empty segments", () => {
      const { container } = render(<DonutChart segments={[]} />);
      expect(container.querySelector("svg")).toBeNull();
    });
  });

  describe("LineChart", () => {
    it("renders polylines for each series", () => {
      const series = [
        { label: "S1", data: [10, 20, 30], color: "red" },
        { label: "S2", data: [30, 20, 10], color: "blue" },
      ];
      const { container } = render(<LineChart series={series} />);
      const polylines = container.querySelectorAll("polyline");
      expect(polylines.length).toBe(2);
    });

    it("returns null for empty series", () => {
      const { container } = render(<LineChart series={[]} />);
      expect(container.querySelector("svg")).toBeNull();
    });
  });

  describe("Utility functions", () => {
    it("formatBytes", () => {
      expect(formatBytes(1.5e12)).toBe("1.5 TB");
      expect(formatBytes(2.3e9)).toBe("2.3 GB");
      expect(formatBytes(4.1e6)).toBe("4.1 MB");
      expect(formatBytes(800)).toBe("0.8 KB");
    });

    it("formatHours", () => {
      expect(formatHours(1500)).toBe("1.5k");
      expect(formatHours(42)).toBe("42");
    });

    it("formatDuration", () => {
      expect(formatDuration(7200)).toBe("2.0h");
      expect(formatDuration(90)).toBe("2m");
      expect(formatDuration(45)).toBe("45s");
    });
  });
});
