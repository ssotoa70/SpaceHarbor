import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "../api";

import { IngestPanel } from "./IngestPanel";

vi.mock("../api");
vi.mock("../hooks/useEventStream", () => ({
  useEventStream: () => {},
}));

const MOCK_ENDPOINTS: api.StorageEndpoint[] = [
  { id: "ep-1", label: "SpaceHarbor Media", endpoint: "http://172.200.201.67", bucket: "sergio-spaceharbor", region: "vast-1" },
  { id: "ep-2", label: "General Media", endpoint: "http://172.200.201.67", bucket: "sergio-bucket", region: "vast-1" },
];

describe("IngestPanel", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.mocked(api.fetchStorageEndpoints).mockResolvedValue(MOCK_ENDPOINTS);
  });

  it("shows bucket selector immediately on mount (before any file drop)", async () => {
    render(<IngestPanel onClose={vi.fn()} onAssetIngested={vi.fn()} />);

    // Bucket selector should appear without dropping a file
    await waitFor(() => {
      expect(screen.getByText(/SpaceHarbor Media/)).toBeInTheDocument();
    });

    const selector = screen.getByRole("combobox");
    expect(selector).toBeInTheDocument();
    expect(screen.getByText(/sergio-spaceharbor/)).toBeInTheDocument();
    expect(screen.getByText(/sergio-bucket/)).toBeInTheDocument();
  });

  it("shows drop zone with upload instructions", () => {
    render(<IngestPanel onClose={vi.fn()} onAssetIngested={vi.fn()} />);

    expect(screen.getByText(/Drop files here/)).toBeInTheDocument();
    expect(screen.getByText("EXR")).toBeInTheDocument();
    expect(screen.getByText("MOV")).toBeInTheDocument();
  });

  it("passes selected endpointId to generateUploadUrl", async () => {
    // Mock XHR for the S3 upload
    const xhrMock = {
      open: vi.fn(),
      send: vi.fn(),
      setRequestHeader: vi.fn(),
      upload: { onprogress: null as unknown },
      onload: null as unknown,
      onerror: null as unknown,
      status: 200,
    };
    vi.spyOn(window, "XMLHttpRequest").mockImplementation(() => xhrMock as unknown as XMLHttpRequest);

    vi.mocked(api.generateUploadUrl).mockResolvedValue({
      uploadUrl: "http://172.200.201.67/sergio-bucket/uploads/test.exr?X-Amz-Signature=abc",
      storageKey: "uploads/uuid/test.exr",
      expiresAt: new Date().toISOString(),
    });
    vi.mocked(api.ingestAsset).mockResolvedValue({
      asset: { id: "a1", title: "test.exr" } as api.IngestResult["asset"],
      job: { id: "j1" } as api.IngestResult["job"],
    });

    const user = userEvent.setup();
    render(<IngestPanel onClose={vi.fn()} onAssetIngested={vi.fn()} />);

    // Wait for endpoints to load and select the second one
    await waitFor(() => {
      expect(screen.getByRole("combobox")).toBeInTheDocument();
    });
    await user.selectOptions(screen.getByRole("combobox"), "ep-2");

    // Simulate file selection via the hidden input
    const file = new File(["pixels"], "test.exr", { type: "application/octet-stream" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);

    // Complete the XHR upload
    await waitFor(() => {
      expect(xhrMock.send).toHaveBeenCalled();
    });
    // Simulate successful response
    (xhrMock as Record<string, unknown>).status = 200;
    (xhrMock.onload as () => void)?.();

    // generateUploadUrl should have been called with the selected endpoint ID
    await waitFor(() => {
      expect(api.generateUploadUrl).toHaveBeenCalledWith(
        "test.exr",
        "application/octet-stream",
        undefined,
        "ep-2",
      );
    });

    // XHR should have been opened with the proxied URL (cross-origin rewrite)
    expect(xhrMock.open).toHaveBeenCalledWith(
      "PUT",
      "/s3-proxy/172.200.201.67/sergio-bucket/uploads/test.exr?X-Amz-Signature=abc",
    );
  });

  it("shows fallback message when no endpoints are configured", async () => {
    vi.mocked(api.fetchStorageEndpoints).mockResolvedValue([]);

    render(<IngestPanel onClose={vi.fn()} onAssetIngested={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/No storage endpoints configured/)).toBeInTheDocument();
    });
  });
});
