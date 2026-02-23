import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError, replayJob } from "./api";

describe("api replayJob", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("replays a job when the API returns success", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 202 } as Response));
    vi.stubGlobal("fetch", fetchMock);

    await expect(replayJob("job-123")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/v1/jobs/job-123/replay",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("throws ApiRequestError with status on non-2xx responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503 } as Response)));

    const error = await replayJob("job-456").catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiRequestError);
    expect((error as ApiRequestError).status).toBe(503);
    expect((error as ApiRequestError).message).toContain("503");
  });
});
