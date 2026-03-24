# Release Process

This document defines how SpaceHarbor releases are cut, tagged, and published.

## Versioning

SpaceHarbor follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html):

- **MAJOR** (1.0.0): Breaking API changes, incompatible schema migrations
- **MINOR** (0.2.0): New features, non-breaking API additions
- **PATCH** (0.2.1): Bug fixes, security patches, documentation corrections

During pre-1.0 development, minor versions may include breaking changes with documentation in the CHANGELOG.

## Release Checklist

Before tagging a release, verify all of the following:

1. **All sprint issues closed in Linear** — no open items in the target milestone
2. **All CI checks green** — including nightly reliability smoke test
3. **CHANGELOG.md updated** — move items from `[Unreleased]` to the new version section
4. **API contracts current** — `docs/api-contracts.md` reflects all routes
5. **Test counts verified** — run `npm run test:all` locally and confirm pass counts
6. **No critical Dependabot alerts** — review and resolve or acknowledge

## Tagging a Release

```bash
# Update CHANGELOG.md: move [Unreleased] items to [X.Y.Z] - YYYY-MM-DD
# Commit the changelog update
git add CHANGELOG.md
git commit -m "docs: update CHANGELOG for vX.Y.Z"

# Create annotated tag
git tag -a vX.Y.Z -m "Release vX.Y.Z"

# Push commit and tag
git push origin main
git push origin vX.Y.Z
```

## Creating a GitHub Release

After the tag is pushed:

```bash
gh release create vX.Y.Z \
  --title "vX.Y.Z — <short description>" \
  --notes "$(cat <<'EOF'
## Highlights

- Bullet point summary of major changes

## Full Changelog

See [CHANGELOG.md](CHANGELOG.md#xyz---yyyy-mm-dd) for the complete list.
EOF
)"
```

## Hotfix Procedure

For critical fixes that cannot wait for the next scheduled release:

1. **Branch from the release tag:**
   ```bash
   git checkout -b hotfix/vX.Y.Z+1 vX.Y.Z
   ```
2. **Apply the fix** — minimal, targeted changes only
3. **Add tests** covering the fix
4. **Update CHANGELOG.md** with the patch version
5. **Tag and push:**
   ```bash
   git tag -a vX.Y.Z+1 -m "Hotfix: <description>"
   git push origin hotfix/vX.Y.Z+1
   git push origin vX.Y.Z+1
   ```
6. **Create PR** to merge the hotfix branch back into `main`
7. **Create GitHub Release** for the hotfix

## v0.2.0 Definition of Done

The v0.2.0 release is ready to ship when all of the following are true:

- [ ] 29 unpushed commits pushed to `origin/main` (requires GitHub account restored)
- [ ] `v0.1.0` and `v0.2.0` tags pushed to origin
- [ ] GitHub Releases created for both v0.1.0 and v0.2.0
- [ ] All CI jobs passing (including nightly reliability smoke — 3 consecutive green runs)
- [ ] Track 1 Section A security fixes merged (S1: input validation, S2: rate limiting, S3: CORS)
- [ ] Track 1 Section B CloudEvent format fix merged (C2)
- [ ] CHANGELOG.md populated with v0.1.0 and v0.2.0 entries
- [ ] README.md and `docs/api-contracts.md` current
- [ ] No critical or high Dependabot alerts open
- [ ] 466 control-plane tests passing, 138 web-ui tests passing, 0 TypeScript errors

**Gate:** This checklist must be reviewed and confirmed by the Scrum Master and Product Owner before the release tag is created.

## Release History

| Version | Date | Highlights |
|---------|------|------------|
| v0.2.0 | 2026-03-11 | Phase 3 UI Overhaul, Phase 8 IAM, Sprint A/B/C backlog |
| v0.1.0 | 2026-03-10 | Audit baseline — P1 VAST Database persistence, P2 ASWF pipeline, CI/CD |
