import { describe, expect, it } from "vitest";

import { buildStatusOptions, humanizeStatus } from "./AssetBrowser";

describe("humanizeStatus", () => {
  it("capitalizes single words", () => {
    expect(humanizeStatus("pending")).toBe("Pending");
    expect(humanizeStatus("failed")).toBe("Failed");
  });

  it("splits snake_case on underscores", () => {
    expect(humanizeStatus("needs_replay")).toBe("Needs Replay");
    expect(humanizeStatus("client_submitted")).toBe("Client Submitted");
  });

  it("renders QC (upper-case) rather than Qc", () => {
    expect(humanizeStatus("qc_pending")).toBe("QC Pending");
    expect(humanizeStatus("qc_approved")).toBe("QC Approved");
    expect(humanizeStatus("qc_in_review")).toBe("QC In Review");
  });
});

describe("buildStatusOptions", () => {
  it("returns an empty array when there are no assets", () => {
    expect(buildStatusOptions([])).toEqual([]);
  });

  it("counts occurrences per status", () => {
    const result = buildStatusOptions([
      { status: "pending" },
      { status: "pending" },
      { status: "qc_approved" },
    ]);
    expect(result).toEqual([
      { value: "pending", label: "Pending", count: 2 },
      { value: "qc_approved", label: "QC Approved", count: 1 },
    ]);
  });

  it("sorts by the canonical lifecycle order, not alphabetically", () => {
    const result = buildStatusOptions([
      { status: "qc_approved" },
      { status: "completed" },
      { status: "pending" },
      { status: "failed" },
    ]);
    expect(result.map((o) => o.value)).toEqual([
      "pending",
      "completed",
      "failed",
      "qc_approved",
    ]);
  });

  it("puts unknown statuses after known ones, sorted alphabetically", () => {
    const result = buildStatusOptions([
      { status: "pending" },
      { status: "zz_custom_state" },
      { status: "aa_custom_state" },
      { status: "completed" },
    ]);
    expect(result.map((o) => o.value)).toEqual([
      "pending",
      "completed",
      "aa_custom_state",
      "zz_custom_state",
    ]);
  });

  it("ignores assets with empty string status", () => {
    const result = buildStatusOptions([
      { status: "" },
      { status: "pending" },
    ]);
    expect(result).toEqual([{ value: "pending", label: "Pending", count: 1 }]);
  });

  it("includes every QC lifecycle state in its declared order when all are present", () => {
    const result = buildStatusOptions([
      { status: "qc_rejected" },
      { status: "qc_approved" },
      { status: "qc_in_review" },
      { status: "qc_pending" },
    ]);
    expect(result.map((o) => o.value)).toEqual([
      "qc_pending",
      "qc_in_review",
      "qc_approved",
      "qc_rejected",
    ]);
  });
});
