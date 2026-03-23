# Third-Party Notices

SpaceHarbor uses the following open-source components:

## JavaScript / TypeScript

| Component | License | URL |
|-----------|---------|-----|
| React | MIT | https://github.com/facebook/react |
| Fastify | MIT | https://github.com/fastify/fastify |
| Vite | MIT | https://github.com/vitejs/vite |
| Tailwind CSS | MIT | https://github.com/tailwindlabs/tailwindcss |
| @confluentinc/kafka-javascript | MIT | https://github.com/confluentinc/confluent-kafka-javascript |
| @aws-sdk/client-s3 | Apache-2.0 | https://github.com/aws/aws-sdk-js-v3 |

## Python

| Component | License | URL |
|-----------|---------|-----|
| OpenEXR (Python bindings) | BSD-3-Clause | https://github.com/AcademySoftwareFoundation/openexr |
| OpenImageIO | Apache-2.0 | https://github.com/AcademySoftwareFoundation/OpenImageIO |
| OpenTimelineIO | Apache-2.0 | https://github.com/AcademySoftwareFoundation/OpenTimelineIO |
| MaterialX | Apache-2.0 | https://github.com/AcademySoftwareFoundation/MaterialX |
| confluent-kafka (Python) | Apache-2.0 | https://github.com/confluentinc/confluent-kafka-python |
| boto3 | Apache-2.0 | https://github.com/boto/boto3 |
| trino (Python client) | Apache-2.0 | https://github.com/trinodb/trino-python-client |

## External Tools (used at runtime, not linked)

| Tool | License | Notes |
|------|---------|-------|
| FFmpeg | LGPL-2.1+ / GPL-2.0+ | Invoked as external subprocess for video transcoding. Not linked or bundled. |
| oiiotool | Apache-2.0 | OpenImageIO CLI tool invoked as external subprocess. |

## Academy Software Foundation (ASWF)

SpaceHarbor integrates with multiple ASWF projects for VFX industry interoperability:
- OpenEXR — EXR image format support
- OpenImageIO — Image I/O and color management
- OpenTimelineIO — Editorial timeline interchange
- MaterialX — Material/shader definition interchange
- OpenColorIO — Color management (via OIIO integration)

All ASWF projects are used under their respective Apache-2.0 or BSD-3-Clause licenses.
