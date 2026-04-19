/**
 * ChannelPills — renders AOV channel pills from a frame-metadata-extractor
 * sidecar's `channels` array. Used by AssetDetail (per-channel mode) and
 * AssetDetailPanel (dedup-by-layer mode).
 *
 * Accepts an unknown `channels` value and defensively type-guards it —
 * returns null for malformed inputs (non-array, or array of objects
 * missing `channel_name`). Graceful degradation on schema drift.
 */

interface Channel {
  channel_name?: string;
  layer_name?: string;
  component_name?: string;
  channel_type?: string;
  part_index?: number;
}

export interface ChannelPillsProps {
  /** Raw `channels` value from `metadata.sidecar` — caller passes
   *  `metadata?.sidecar?.channels` without any prior type assertion. */
  channels: unknown;
  /** Display mode.
   *  - `per-channel`: one pill per channel. Pills with layer_name != "rgba"
   *    prefix the channel name with "layer.". Used by AssetDetail full page.
   *  - `dedup-by-layer`: one pill per unique layer_name (falling back to
   *    channel_name when layer is absent). Used by AssetDetailPanel sidebar. */
  mode: "per-channel" | "dedup-by-layer";
  /** Optional container className override (otherwise uses the default
   *  "flex flex-wrap gap-1" wrapper). */
  containerClassName?: string;
  /** Optional pill className override. */
  pillClassName?: string;
}

const DEFAULT_CONTAINER = "flex flex-wrap gap-1";
const DEFAULT_PILL =
  "px-1.5 py-0.5 rounded text-[10px] font-mono bg-gray-700 text-gray-300";

export function ChannelPills({
  channels: rawChannels,
  mode,
  containerClassName = DEFAULT_CONTAINER,
  pillClassName = DEFAULT_PILL,
}: ChannelPillsProps): JSX.Element | null {
  if (!Array.isArray(rawChannels)) return null;

  const valid = (rawChannels as Channel[]).filter(
    (ch): ch is Required<Pick<Channel, "channel_name">> & Channel =>
      typeof ch.channel_name === "string"
  );

  if (valid.length === 0) return null;

  if (mode === "dedup-by-layer") {
    const labels = Array.from(
      new Set(valid.map((ch) => ch.layer_name || ch.channel_name))
    );
    return (
      <div className={containerClassName}>
        {labels.map((label) => (
          <span key={label} className={pillClassName}>
            {label}
          </span>
        ))}
      </div>
    );
  }

  // per-channel mode
  return (
    <div className={containerClassName}>
      {valid.map((ch, i) => (
        <span
          key={`${ch.part_index ?? ""}-${ch.channel_name}-${i}`}
          className={pillClassName}
        >
          {ch.layer_name && ch.layer_name !== "rgba" ? `${ch.layer_name}.` : ""}
          {ch.channel_name}
        </span>
      ))}
    </div>
  );
}
