/**
 * oiio-proxy-generator — Generate JPEG thumbnails and H.264 proxies from EXR/DPX.
 *
 * In development (no VAST_DATA_ENGINE_URL), returns mock URIs.
 * In production, calls the VAST Data Engine REST API to trigger the
 * containerised oiio-proxy-generator function.
 */

import type { DataEngineFunction, JsonSchema } from "../types.js";

const inputSchema: JsonSchema = {
  type: "object",
  properties: {
    asset_id: { type: "string", description: "Asset UUID" },
    source_uri: { type: "string", description: "VAST element path (*.exr or *.dpx)" },
    event_type: { type: "string", description: "Triggering event type" },
  },
  required: ["asset_id", "source_uri"],
};

const outputSchema: JsonSchema = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["completed", "failed"] },
    thumbnail_uri: { type: "string", description: "VAST path to generated JPEG thumbnail" },
    proxy_uri: { type: "string", description: "VAST path to generated H.264 proxy" },
    error: { type: "string", description: "Error message if status is failed" },
  },
  required: ["status"],
};

export class OiioProxyFunction implements DataEngineFunction {
  readonly id = "oiio_proxy_generator";
  readonly version = "1.0.0";
  readonly description = "Generate JPEG thumbnails (256×256) and H.264 proxies (1920×1080) from EXR/DPX";
  readonly inputSchema = inputSchema;
  readonly outputSchema = outputSchema;

  async execute(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    const vastDataEngineUrl = process.env.VAST_DATA_ENGINE_URL;
    const assetId = input.asset_id as string;

    if (!vastDataEngineUrl) {
      // Dev mode: return mock result without calling VAST DataEngine
      return {
        status: "completed",
        thumbnail_uri: `mock://thumbnails/${assetId}_thumb.jpg`,
        proxy_uri: `mock://proxies/${assetId}_proxy.mp4`,
      };
    }

    // Production: invoke VAST DataEngine REST API.
    // TODO: Validate this endpoint path against the actual VAST DataEngine REST API documentation
    // before cluster integration testing. VAST DataEngine functions are primarily triggered by
    // element events/schedules; Mode B (HTTP invocation) endpoint must be confirmed.
    const response = await fetch(`${vastDataEngineUrl}/api/v1/functions/${this.id}/invoke`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.VAST_API_KEY ?? ""}`,
      },
      body: JSON.stringify({
        asset_id: assetId,
        source_uri: input.source_uri,
        event_type: input.event_type,
      }),
    });

    if (!response.ok) {
      return { status: "failed", error: `DataEngine returned ${response.status}` };
    }

    return (await response.json()) as Record<string, unknown>;
  }
}
