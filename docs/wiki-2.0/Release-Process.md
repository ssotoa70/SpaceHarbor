# Release Process

## Versioning

- Use semantic tags: `vX.Y.Z`.

## Gates

- CI green on default branch.
- Contract tests pass.
- Compose config valid.

## Publish

- CD workflow publishes service images to GHCR on tag.
