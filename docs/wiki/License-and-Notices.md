# License and Notices

SpaceHarbor licensing and third-party attributions.

## SpaceHarbor License

SpaceHarbor is proprietary software. All rights reserved.

**Copyright** © 2026. All rights reserved.

### Permitted Use

SpaceHarbor may be used only:
- As authorized by a valid commercial license agreement
- For internal evaluation purposes (not in production)
- For development and testing in non-production environments

### Restrictions

Without a valid license, you may not:
- Deploy SpaceHarbor in production
- Use SpaceHarbor commercially
- Modify, reverse-engineer, or decompile SpaceHarbor
- Remove or obscure copyright notices
- Sublicense or redistribute SpaceHarbor

For licensing information, contact: [licensing contact]

## Third-Party Software

SpaceHarbor includes or depends on the following third-party software:

### Node.js Ecosystem

#### Core Dependencies

| Package | Version | License | Purpose |
|---------|---------|---------|---------|
| fastify | 4.24.0 | MIT | HTTP server framework |
| @fastify/jwt | 7.8.0 | MIT | JWT authentication |
| @fastify/cors | 8.4.2 | MIT | CORS middleware |
| @fastify/websocket | 1.0.0 | MIT | WebSocket support |
| @fastify/swagger | 8.10.0 | MIT | OpenAPI/Swagger UI |
| pino | 8.16.0 | MIT | Structured logging |
| uuid | 9.0.0 | MIT | UUID generation |
| date-fns | 2.30.0 | MIT | Date utilities |
| joi | 17.11.0 | BSD-3-Clause | Data validation |
| node-fetch | 3.3.2 | MIT | HTTP client |
| @confluentinc/kafka-javascript | 1.1.0 | Apache-2.0 | Kafka client |

#### Development Dependencies

| Package | License | Purpose |
|---------|---------|---------|
| typescript | MIT | Type checking |
| vitest | MIT | Unit testing |
| @types/node | MIT | Type definitions |
| tsx | MIT | TypeScript runtime |
| prettier | MIT | Code formatting |
| eslint | MIT | Code linting |

### React Web-UI

| Package | Version | License | Purpose |
|---------|---------|---------|---------|
| react | 18.2.0 | MIT | UI framework |
| react-dom | 18.2.0 | MIT | DOM rendering |
| vite | 4.5.0 | MIT | Build tool |
| typescript | 5.3.0 | MIT | Type system |
| tailwindcss | 3.3.0 | MIT | Utility CSS |
| zustand | 4.4.0 | MIT | State management |
| axios | 1.6.0 | MIT | HTTP client |
| react-router-dom | 6.20.0 | MIT | Routing |

### Python Media-Worker

| Package | Version | License | Purpose |
|---------|---------|---------|---------|
| asyncio | 3.11+ | PSF | Async runtime |
| aiohttp | 3.9.0 | Apache-2.0 | HTTP client |
| confluent-kafka | 2.4.0 | Apache-2.0 | Kafka client |
| opencv-python | 4.8.0 | Apache-2.0 | Image processing |
| Pillow | 10.0.0 | HPND | Image library |

### Container Base Images

| Image | License | Purpose |
|-------|---------|---------|
| node:18-alpine | MIT | Node.js runtime |
| python:3.11-slim | PSF | Python runtime |

## VAST Platform Dependencies

SpaceHarbor integrates with VAST platform services. VAST is subject to its own licensing terms.

See VAST documentation for:
- VAST Database (Trino) — Apache License 2.0
- VAST Event Broker (Kafka) — Confluent Community License + Enterprise options
- VAST DataEngine — VAST proprietary software
- VAST Element Store — VAST proprietary software

## Open Source Licenses

### MIT License

Copyright (c) 2024 [Original Authors]

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

### Apache License 2.0

[Full Apache 2.0 text: https://www.apache.org/licenses/LICENSE-2.0]

### BSD 3-Clause License

[Full BSD 3-Clause text: https://opensource.org/licenses/BSD-3-Clause]

## Attribution

This product includes software developed by:

- **Node.js** — OpenJS Foundation
- **React** — Meta Platforms, Inc.
- **Fastify** — Fastify Maintainers
- **Kafka** — Apache Software Foundation / Confluent
- **OpenTimelineIO** — Pixar Animation Studios
- **FFmpeg** — FFmpeg Contributors

## Trademark Notices

- "VAST" is a trademark of VAST Data
- "Fastify" is a trademark of the Fastify team
- "React" is a trademark of Meta Platforms, Inc.
- "Kubernetes" is a trademark of the Cloud Native Computing Foundation

## Compliance

### Export Control

SpaceHarbor may be subject to export control regulations. Redistribution or use outside authorized territories is prohibited.

### Data Protection

SpaceHarbor does not collect telemetry or personal data without explicit consent. All data remains on-premises in your VAST environment.

See [Privacy Policy](../../PRIVACY.md) for details.

## Support

For questions about licensing or third-party attributions:
- **Licensing**: [licensing-email]
- **Legal**: [legal-email]
- **Technical Support**: [support-email]

## License Verification

To verify SpaceHarbor licenses in your deployment:

```bash
# List bundled licenses
npm list --depth 0 --licensee

# Generate SBOM (Software Bill of Materials)
npm install -g cyclonedx-npm
cyclonedx-npm --spec 1.4 > sbom.json

# Check for GPL/incompatible licenses
npm list --depth 0 | grep -E "GPL|AGPL"
```

## Changes to This Notice

This license and notices document may be updated without notice. Check the GitHub repository for the latest version.

**Last Updated:** March 2026

---

For the full SpaceHarbor End User License Agreement (EULA), contact: [eula-contact]
