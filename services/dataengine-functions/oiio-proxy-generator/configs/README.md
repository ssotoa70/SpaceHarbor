# OCIO Config Directory

This directory is the mount point for OCIO configuration files in local development.

## Production (Docker)

The container image installs ACES 1.3 and other standard configs via the
`ocio-configs` system package:

```
/usr/share/color/opencolorio/aces_1.3/config.ocio
```

The `OCIO` and `OCIO_CONFIG_PATH` environment variables default to this path.
Override at runtime via:

```bash
docker run -e OCIO_CONFIG_PATH=/path/to/custom/config.ocio oiio-proxy-generator
```

## Local Development

For local dev, either:
1. Use `DEV_MODE=true` (default) — OCIO transforms are skipped entirely.
2. Download the ACES 1.3 config from:
   https://github.com/AcademySoftwareFoundation/OpenColorIO-Config-ACES/releases
   and place `config.ocio` here, then set:
   ```bash
   export OCIO_CONFIG_PATH=$(pwd)/configs/config.ocio
   ```

## macOS (MacPorts)

```bash
sudo port install opencolorio +python312
# ACES config location: /opt/local/share/OpenColorIO/
```
