# ffmpeg-transcoder — Delivery Transcoding DataEngine Function

## Purpose

The `ffmpeg-transcoder` is a VAST DataEngine function that converts source media files into delivery formats for VFX pipelines. It handles:

- **Dailies** — ProRes 422 HQ for review and editorial
- **Editorial delivery** — ProRes 4444 (with alpha), DNxHR for Avid
- **Client review** — H.264 (LGPL-safe via OpenH264), AV1 (via SVT-AV1)
- **Archival** — FFV1 lossless for bit-perfect preservation

## Available Profiles

| Profile | Codec | Container | Pixel Format | Use Case |
|---|---|---|---|---|
| `prores_422_hq` | prores_ks (profile 3) | MOV | yuv422p10le | Dailies, editorial |
| `prores_4444` | prores_ks (profile 4) | MOV | yuva444p10le | VFX plates with alpha |
| `dnxhr_sq` | dnxhd (DNxHR SQ) | MXF | yuv422p | Avid editorial 1080p |
| `dnxhr_hqx` | dnxhd (DNxHR HQX) | MXF | yuv422p10le | Avid 10-bit |
| `h264_review` | libopenh264 | MP4 | yuv420p | Client review (LGPL-safe) |
| `av1_archive` | libsvtav1 | MP4 | yuv420p10le | Modern compressed archive |
| `ffv1_lossless` | ffv1 | MKV | yuv444p16le | Pixel-exact lossless archive |

## Codec Licensing

SpaceHarbor ships an **LGPL-safe FFmpeg build** by default. All included codecs use permissive licenses:

| Codec | License | Notes |
|---|---|---|
| ProRes (prores_ks) | LGPL (FFmpeg native) | Apple-compatible encoder |
| DNxHR/DNxHD (dnxhd) | LGPL (FFmpeg native) | Avid-compatible encoder |
| FFV1 | LGPL (FFmpeg native) | Open lossless standard |
| OpenH264 (libopenh264) | BSD (Cisco) | H.264 baseline + main profile |
| SVT-AV1 (libsvtav1) | BSD (Alliance for Open Media) | Modern efficient codec |

**To add libx264/libx265:** Rebuild FFmpeg with `--enable-gpl --enable-libx264 --enable-libx265`. This changes the FFmpeg binary license to GPL. This is the user's responsibility — SpaceHarbor does not ship GPL codecs.

## Environment Variables

### Required (set by VAST DataEngine)

| Variable | Description |
|---|---|
| `VAST_SOURCE_PATH` | NFS path to the source media file |
| `VAST_ASSET_ID` | SpaceHarbor asset ID |
| `VAST_OUTPUT_PATH` | NFS path for the transcoded output |
| `TRANSCODE_PROFILE` | Profile name (default: `h264_review`) |

### Optional

| Variable | Description |
|---|---|
| `LUT_PATH` | Path to a 3D LUT file (.cube) for baked color transforms |
| `AUDIO_SOURCE_PATH` | Path to a separate audio file for dual-system audio mux |
| `TIMECODE_START` | Starting timecode (HH:MM:SS:FF) |
| `BURN_IN_TEXT` | Text to burn into the video (e.g., "INTERNAL REVIEW ONLY") |
| `FRAMERATE` | Frame rate for image sequences (default: 24.0) |
| `KAFKA_BROKER` | Kafka broker for completion events (skips publish if unset) |
| `ENVIRONMENT` | `development` or `production` |

## Custom Profiles

Create a JSON file in the `profiles/` directory:

```json
{
  "name": "my_custom_profile",
  "description": "Custom delivery format",
  "codec": "prores_ks",
  "container": "mov",
  "pixel_format": "yuv422p10le",
  "codec_params": {
    "profile:v": "3",
    "vendor": "apl0"
  },
  "default_resolution": null,
  "audio_codec": "pcm_s24le",
  "audio_params": {}
}
```

Required fields: `name`, `codec`, `container`, `pixel_format`.

## VAST DataEngine Trigger Configuration

### Single video files (MOV, MXF, MP4)

Configure a VAST DataEngine trigger with suffix filters:

```
Suffix filter: .mov, .mxf, .mp4
Action: Run ffmpeg-transcoder container
```

### Image sequences (EXR, DPX)

Image sequences require a sentinel-file pattern. When the last frame is written, create a `.transcode_ready` marker file:

```
Suffix filter: .transcode_ready
Action: Run ffmpeg-transcoder container
```

The `VAST_SOURCE_PATH` should point to a representative frame (e.g., `render.1001.exr`). The transcoder auto-detects the sequence pattern and frame range.

## Integration with Other Functions

- **exr-inspector** — Provides frame range and timecode metadata that can be passed to ffmpeg-transcoder via `TIMECODE_START` and `FRAMERATE`
- **otio-parser** — Parses editorial cut lists (OpenTimelineIO) to determine which segments need transcoding
- **oiio-proxy-generator** — Generates QC browsing proxies (1080p H.264); ffmpeg-transcoder handles delivery-grade transcoding

## Running Locally

```bash
cd services/dataengine-functions/ffmpeg-transcoder

# Install dev dependencies
pip install -e ".[dev]"

# Run tests
python -m pytest tests/ -v

# Run manually
VAST_SOURCE_PATH=/path/to/input.mov \
VAST_ASSET_ID=test-123 \
VAST_OUTPUT_PATH=/path/to/output.mov \
TRANSCODE_PROFILE=prores_422_hq \
python -m src.function
```
