---
name: Screenshot capture workflow for Docker-sandboxed Playwright
description: How to capture and save screenshots when Playwright runs in Docker with no volume mounts
type: feedback
---

Use `page.screenshot({ path: '/tmp/name.png' })` in `browser_run_code`, then `docker cp <container>:/tmp/name.png <host_path>`.

**Why:** The MCP Playwright tool runs inside a Docker container. The allowed write paths (`/tmp/playwright-output`, `/app`) either don't exist on the host or the container writes don't appear on the host filesystem. `docker cp` is the reliable bridge.

**How to apply:**
1. In `browser_run_code`: `await page.screenshot({ path: '/tmp/name.png', fullPage: true });`
2. In Bash: `docker cp competent_kare:/tmp/name.png /host/destination/name.png`
3. Batch multiple screenshots in one `browser_run_code` call, then batch the `docker cp` commands.
4. The container name changes per session — always check with `docker ps` first.

Do NOT use `buffer.toString('base64')` return approach — outputs are truncated at token limits and base64 is difficult to reconstruct correctly from truncated files.
