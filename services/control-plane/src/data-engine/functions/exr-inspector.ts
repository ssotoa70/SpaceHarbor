/**
 * exrinspector — Extract technical metadata from EXR sequences.
 *
 * In development (no VAST_DATA_ENGINE_URL), returns realistic mock data.
 * In production, calls the VAST Data Engine REST API.
 */

import type { DataEngineFunction, JsonSchema } from "../types.js";
import { EXR_MOCK_METADATA } from "./__fixtures__/exr-mock-metadata.js";

const inputSchema: JsonSchema = {
  type: "object",
  properties: {
    asset_id: { type: "string", description: "Asset UUID" },
    file_path: { type: "string", description: "VAST element handle or file path" },
  },
  required: ["asset_id", "file_path"],
};

const outputSchema: JsonSchema = {
  type: "object",
  properties: {
    codec: { type: "string" },
    channels: { type: "array" },
    resolution: {
      type: "object",
      properties: {
        width: { type: "number" },
        height: { type: "number" },
      },
    },
    color_space: { type: "string" },
    frame_count: { type: "number" },
    bit_depth: { type: "number" },
    duration_ms: { type: "number" },
    frame_range: {
      type: "object",
      properties: {
        first: { type: "number" },
        last: { type: "number" },
      },
      description: "First and last frame numbers in sequence",
    },
    frame_rate: { type: "number", description: "Frames per second" },
    pixel_aspect_ratio: { type: "number" },
    display_window: {
      type: "object",
      properties: {
        x_min: { type: "number" },
        y_min: { type: "number" },
        x_max: { type: "number" },
        y_max: { type: "number" },
      },
      description: "Display window bounds",
    },
    data_window: {
      type: "object",
      properties: {
        x_min: { type: "number" },
        y_min: { type: "number" },
        x_max: { type: "number" },
        y_max: { type: "number" },
      },
      description: "Data window bounds",
    },
    compression_type: { type: "string", description: "EXR compression codec" },
    file_size_bytes: { type: "number" },
    checksum: { type: "string", description: "MD5 or xxHash for integrity" },
  },
};

function mockExecute(_input: Record<string, unknown>): Record<string, unknown> {
  return { ...EXR_MOCK_METADATA };
}

export class ExrInspectorFunction implements DataEngineFunction {
  readonly id = "exr_inspector";
  readonly version = "1.0.0";
  readonly description = "Extract technical metadata from EXR sequences";
  readonly inputSchema = inputSchema;
  readonly outputSchema = outputSchema;

  async execute(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    const vastDataEngineUrl = process.env.VAST_DATA_ENGINE_URL;

    if (!vastDataEngineUrl) {
      return mockExecute(input);
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
        asset_id: input.asset_id,
        file_path: input.file_path,
      }),
    });

    if (!response.ok) {
      throw new Error(`VAST Data Engine error: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as Record<string, unknown>;
  }
}
