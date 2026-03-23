#!/usr/bin/env python3
"""SpaceHarbor Deployment CLI — guided wizard for deploying the full stack.

Usage:
    python scripts/deploy.py                     # Interactive wizard
    python scripts/deploy.py --mode local        # Local mode (no VAST)
    python scripts/deploy.py --check             # Validate connectivity only
    python scripts/deploy.py --teardown          # Stop services
    python scripts/deploy.py --non-interactive   # CI/CD mode (env vars or config)

Requires Python 3.10+ (stdlib only, no pip dependencies).
"""

from __future__ import annotations

import argparse
import base64
import getpass
import json
import logging
import os
import signal
import socket
import stat
import subprocess
import sys
import textwrap
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

PROJECT_ROOT = Path(__file__).resolve().parent.parent

SERVICES = {
    "control-plane": {"port": 8080, "health": "/health"},
    "web-ui": {"port": 4173, "health": "/"},
    "openassetio-manager": {"port": 8001, "health": "/health"},
    "media-worker": {"port": None, "health": None},
}

INSTALLER_PATH = Path("services/control-plane/src/db/installer.ts")

DEPLOY_LOG = PROJECT_ROOT / "deploy.log"
ENV_FILE = PROJECT_ROOT / ".env"
COMPOSE_FILE = PROJECT_ROOT / "docker-compose.yml"

HEALTH_TIMEOUT = 90  # seconds
HEALTH_INTERVAL = 3  # seconds

# ---------------------------------------------------------------------------
# Terminal helpers
# ---------------------------------------------------------------------------


class Color:
    RESET = "\033[0m"
    BOLD = "\033[1m"
    DIM = "\033[2m"
    RED = "\033[31m"
    GREEN = "\033[32m"
    YELLOW = "\033[33m"
    BLUE = "\033[34m"
    CYAN = "\033[36m"

    @staticmethod
    def enabled() -> bool:
        return sys.stdout.isatty() and os.environ.get("NO_COLOR") is None


def _c(code: str, text: str) -> str:
    if Color.enabled():
        return f"{code}{text}{Color.RESET}"
    return text


def bold(text: str) -> str:
    return _c(Color.BOLD, text)


def green(text: str) -> str:
    return _c(Color.GREEN, text)


def red(text: str) -> str:
    return _c(Color.RED, text)


def yellow(text: str) -> str:
    return _c(Color.YELLOW, text)


def blue(text: str) -> str:
    return _c(Color.BLUE, text)


def cyan(text: str) -> str:
    return _c(Color.CYAN, text)


def dim(text: str) -> str:
    return _c(Color.DIM, text)


def step_header(step: int, total: int, title: str) -> None:
    print(f"\n{bold(blue(f'[{step}/{total}]'))} {bold(title)}")
    print(dim("─" * 50))


def check_mark() -> str:
    return green("✓")


def cross_mark() -> str:
    return red("✗")


def warn_mark() -> str:
    return yellow("!")


def mask(value: str, visible: int = 3) -> str:
    """Show first and last `visible` chars, mask the rest."""
    if len(value) <= visible * 2 + 4:
        return "***"
    return f"{value[:visible]}***{value[-visible:]}"


def banner() -> None:
    print(
        bold(
            cyan(
                textwrap.dedent("""\

        ╔══════════════════════════════════════╗
        ║     SpaceHarbor Deployment CLI       ║
        ╚══════════════════════════════════════╝
    """
                )
            )
        )
    )


# ---------------------------------------------------------------------------
# Logging with credential filtering
# ---------------------------------------------------------------------------

_SECRETS: list[str] = []


class CredentialFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        msg = record.getMessage()
        for secret in _SECRETS:
            if secret and len(secret) > 3:
                msg = msg.replace(secret, "***REDACTED***")
        record.msg = msg
        record.args = ()
        return True


def setup_logging(verbose: bool = False) -> logging.Logger:
    logger = logging.getLogger("deploy")
    logger.setLevel(logging.DEBUG)

    # File handler — always DEBUG, with credential filter
    fh = logging.FileHandler(DEPLOY_LOG, mode="w")
    fh.setLevel(logging.DEBUG)
    fh.setFormatter(
        logging.Formatter("%(asctime)s [%(levelname)s] %(message)s", "%H:%M:%S")
    )
    fh.addFilter(CredentialFilter())
    logger.addHandler(fh)

    if verbose:
        ch = logging.StreamHandler()
        ch.setLevel(logging.DEBUG)
        ch.setFormatter(logging.Formatter(f"{dim('%(asctime)s')} %(message)s", "%H:%M:%S"))
        ch.addFilter(CredentialFilter())
        logger.addHandler(ch)

    return logger


log = logging.getLogger("deploy")

# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------


@dataclass
class VastCredentials:
    trino_endpoint: str = ""
    access_key: str = ""
    secret_key: str = ""
    event_broker_url: str = ""
    dataengine_url: str = ""
    api_token: str = ""
    sasl_username: str = ""
    sasl_password: str = ""
    sasl_mechanism: str = "PLAIN"

    def secrets(self) -> list[str]:
        return [self.secret_key, self.api_token, self.access_key, self.sasl_password]


@dataclass
class DeployConfig:
    mode: str = "local"  # local | cloud | onprem
    credentials: VastCredentials = field(default_factory=VastCredentials)
    api_key: str = ""
    skip_migrations: bool = False
    skip_build: bool = False
    force: bool = False
    verbose: bool = False
    non_interactive: bool = False
    config_file: str | None = None


# ---------------------------------------------------------------------------
# Validation functions
# ---------------------------------------------------------------------------


def check_command_exists(cmd: str) -> bool:
    """Check if a command is available on PATH."""
    try:
        subprocess.run(
            [cmd, "--version"],
            capture_output=True,
            timeout=10,
        )
        return True
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


def check_docker_installed() -> tuple[bool, str]:
    """Verify Docker and Docker Compose are available."""
    try:
        result = subprocess.run(
            ["docker", "version", "--format", "{{.Server.Version}}"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode != 0:
            return False, "Docker daemon is not running"
        version = result.stdout.strip()

        compose = subprocess.run(
            ["docker", "compose", "version", "--short"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if compose.returncode != 0:
            return False, "Docker Compose plugin not found"
        compose_ver = compose.stdout.strip()

        return True, f"Docker {version}, Compose {compose_ver}"
    except FileNotFoundError:
        return False, "Docker is not installed"
    except subprocess.TimeoutExpired:
        return False, "Docker command timed out"


def check_port_available(port: int) -> bool:
    """Check if a TCP port is available for binding."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def validate_trino_endpoint(url: str) -> tuple[bool, str]:
    """GET /v1/info to verify Trino is reachable."""
    info_url = url.rstrip("/") + "/v1/info"
    log.debug(f"Checking Trino endpoint: {info_url}")
    try:
        req = urllib.request.Request(info_url, method="GET")
        req.add_header("User-Agent", "SpaceHarbor-Deploy/1.0")
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            return True, f"Trino reachable (starting={data.get('starting', 'unknown')})"
    except urllib.error.HTTPError as e:
        return False, f"HTTP {e.code}: {e.reason}"
    except urllib.error.URLError as e:
        return False, f"Connection failed: {e.reason}"
    except Exception as e:
        return False, str(e)


def validate_trino_auth(
    url: str, access_key: str, secret_key: str
) -> tuple[bool, str]:
    """POST SELECT 1 to /v1/statement with Basic auth, follow nextUri chain."""
    stmt_url = url.rstrip("/") + "/v1/statement"
    creds = base64.b64encode(f"{access_key}:{secret_key}".encode()).decode()
    log.debug(f"Testing Trino auth: POST {stmt_url}")

    try:
        req = urllib.request.Request(stmt_url, data=b"SELECT 1", method="POST")
        req.add_header("Authorization", f"Basic {creds}")
        req.add_header("X-Trino-User", access_key)
        req.add_header("X-Trino-Schema", "public")
        req.add_header("Content-Type", "text/plain")
        req.add_header("User-Agent", "SpaceHarbor-Deploy/1.0")

        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read())

        # Follow nextUri chain until terminal state
        max_polls = 20
        for _ in range(max_polls):
            next_uri = data.get("nextUri")
            state = data.get("stats", {}).get("state", "")
            if not next_uri or state in ("FINISHED", "FAILED"):
                break
            time.sleep(0.3)
            req = urllib.request.Request(next_uri, method="GET")
            req.add_header("Authorization", f"Basic {creds}")
            req.add_header("User-Agent", "SpaceHarbor-Deploy/1.0")
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read())

        error = data.get("error")
        if error:
            return False, f"Query failed: {error.get('message', str(error))}"

        return True, "Authentication successful (SELECT 1 passed)"
    except urllib.error.HTTPError as e:
        if e.code == 401:
            return False, "Authentication failed (401 Unauthorized)"
        return False, f"HTTP {e.code}: {e.reason}"
    except urllib.error.URLError as e:
        return False, f"Connection failed: {e.reason}"
    except Exception as e:
        return False, str(e)


def validate_event_broker(url: str) -> tuple[bool, str]:
    """TCP socket connect to Kafka broker."""
    log.debug(f"Testing Event Broker connectivity: {url}")
    try:
        # Parse host:port from URL — broker URL may be host:port or scheme://host:port
        cleaned = url
        for prefix in ("kafka://", "https://", "http://"):
            if cleaned.startswith(prefix):
                cleaned = cleaned[len(prefix) :]
        cleaned = cleaned.rstrip("/").split("/")[0]

        if ":" in cleaned:
            host, port_str = cleaned.rsplit(":", 1)
            port = int(port_str)
        else:
            host = cleaned
            port = 9092

        with socket.create_connection((host, port), timeout=10):
            return True, f"Broker reachable at {host}:{port}"
    except (socket.timeout, ConnectionRefusedError, OSError) as e:
        return False, f"Cannot connect: {e}"
    except Exception as e:
        return False, str(e)


def validate_dataengine(url: str, token: str) -> tuple[bool, str]:
    """GET with Bearer auth to validate DataEngine endpoint."""
    log.debug(f"Testing DataEngine: {url}")
    try:
        req = urllib.request.Request(url.rstrip("/"), method="GET")
        req.add_header("Authorization", f"Bearer {token}")
        req.add_header("User-Agent", "SpaceHarbor-Deploy/1.0")
        with urllib.request.urlopen(req, timeout=10) as resp:
            return True, f"DataEngine reachable (HTTP {resp.status})"
    except urllib.error.HTTPError as e:
        # 404 or 405 still means reachable — just no default handler
        if e.code in (404, 405):
            return True, f"DataEngine reachable (HTTP {e.code}, endpoint active)"
        if e.code == 401:
            return False, "Authentication failed (401 Unauthorized)"
        return False, f"HTTP {e.code}: {e.reason}"
    except urllib.error.URLError as e:
        return False, f"Connection failed: {e.reason}"
    except Exception as e:
        return False, str(e)


# ---------------------------------------------------------------------------
# Interactive prompts
# ---------------------------------------------------------------------------


def prompt_choice(question: str, options: list[str], default: int = 0) -> int:
    """Display a numbered list and return the selected index."""
    print()
    for i, opt in enumerate(options):
        marker = bold(">") if i == default else " "
        label = bold(opt) if i == default else opt
        default_tag = dim(" (default)") if i == default else ""
        print(f"  {marker} {i + 1}. {label}{default_tag}")
    print()

    while True:
        raw = input(f"{question} [{default + 1}]: ").strip()
        if not raw:
            return default
        try:
            choice = int(raw)
            if 1 <= choice <= len(options):
                return choice - 1
        except ValueError:
            pass
        print(red(f"  Please enter 1-{len(options)}"))


def prompt_value(label: str, default: str = "", secret: bool = False) -> str:
    """Prompt for a single value, optionally masked."""
    default_hint = f" [{mask(default) if secret and default else default}]" if default else ""
    prompt_str = f"  {label}{default_hint}: "

    if secret:
        value = getpass.getpass(prompt_str)
    else:
        value = input(prompt_str)

    return value.strip() or default


def prompt_yes_no(question: str, default: bool = True) -> bool:
    hint = "[Y/n]" if default else "[y/N]"
    raw = input(f"  {question} {hint}: ").strip().lower()
    if not raw:
        return default
    return raw in ("y", "yes")


def prompt_deploy_mode() -> str:
    """Ask user for deployment mode."""
    idx = prompt_choice(
        "Select deployment mode",
        [
            "Local development (no VAST backend required)",
            "VAST Cloud (SaaS endpoints)",
            "VAST On-Prem (self-hosted cluster)",
        ],
        default=0,
    )
    return ["local", "cloud", "onprem"][idx]


def prompt_credentials() -> VastCredentials:
    """Collect VAST credentials interactively."""
    creds = VastCredentials()
    print()
    print(bold("  VAST Data Connection Details"))
    print(dim("  Enter your VAST cluster endpoints and credentials."))
    print()

    creds.trino_endpoint = prompt_value(
        "Trino endpoint URL",
        default="https://vastdb:443",
    )
    creds.access_key = prompt_value("Access Key ID")
    creds.secret_key = prompt_value("Secret Access Key", secret=True)
    creds.event_broker_url = prompt_value(
        "Event Broker URL",
        default="",
    )

    if creds.event_broker_url:
        print()
        print(dim("  SASL credentials for Event Broker (Kafka) authentication."))
        creds.sasl_username = prompt_value("SASL Username", default="")
        creds.sasl_password = prompt_value("SASL Password", secret=True)
        creds.sasl_mechanism = prompt_value("SASL Mechanism", default="PLAIN")

    creds.dataengine_url = prompt_value(
        "DataEngine URL",
        default="",
    )
    creds.api_token = prompt_value("VAST API Token", secret=True)

    return creds


def prompt_api_key() -> str:
    """Generate or accept an API key for SpaceHarbor."""
    print()
    idx = prompt_choice(
        "API Key",
        ["Auto-generate a secure key", "Enter manually"],
        default=0,
    )
    if idx == 0:
        key = base64.urlsafe_b64encode(os.urandom(32)).decode().rstrip("=")
        print(f"  Generated: {green(mask(key))}")
        return key
    return prompt_value("API Key")


# ---------------------------------------------------------------------------
# Env file generation
# ---------------------------------------------------------------------------


def generate_env(config: DeployConfig) -> str:
    """Build .env content from config."""
    lines: list[str] = []

    # NODE_ENV based on mode
    if config.mode == "local":
        lines.append("NODE_ENV=development")
        lines.append("SPACEHARBOR_PERSISTENCE_BACKEND=local")
        lines.append("SPACEHARBOR_VAST_STRICT=false")
    else:
        lines.append("NODE_ENV=production")
        lines.append("SPACEHARBOR_PERSISTENCE_BACKEND=vast")
        lines.append("SPACEHARBOR_VAST_STRICT=true")

    lines.append(f"SPACEHARBOR_API_KEY={config.api_key}")
    lines.append(f"CONTROL_PLANE_API_KEY={config.api_key}")
    lines.append(f"VITE_API_KEY={config.api_key}")

    creds = config.credentials
    if config.mode != "local":
        # Docker-compose env vars
        lines.append(f"VAST_DATABASE_URL={creds.trino_endpoint}")
        lines.append(f"VAST_EVENT_BROKER_URL={creds.event_broker_url}")
        lines.append(f"VAST_DATAENGINE_URL={creds.dataengine_url}")
        lines.append(f"VAST_API_TOKEN={creds.api_token}")
        # VAST S3-compatible auth (used by docker-compose and installer)
        lines.append(f"VAST_TRINO_ENDPOINT={creds.trino_endpoint}")
        lines.append(f"VAST_ACCESS_KEY={creds.access_key}")
        lines.append(f"VAST_SECRET_KEY={creds.secret_key}")
        # SASL credentials for Event Broker (Kafka)
        lines.append(f"VAST_EVENT_BROKER_SASL_USERNAME={creds.sasl_username}")
        lines.append(f"VAST_EVENT_BROKER_SASL_PASSWORD={creds.sasl_password}")
        lines.append(f"VAST_EVENT_BROKER_SASL_MECHANISM={creds.sasl_mechanism}")
    else:
        lines.append("VAST_DATABASE_URL=")
        lines.append("VAST_EVENT_BROKER_URL=")
        lines.append("VAST_DATAENGINE_URL=")
        lines.append("VAST_API_TOKEN=")
        lines.append("VAST_ACCESS_KEY=")
        lines.append("VAST_SECRET_KEY=")

    lines.append("")  # trailing newline
    return "\n".join(lines)


def write_env(config: DeployConfig) -> bool:
    """Write .env file, prompt before overwriting."""
    content = generate_env(config)

    if ENV_FILE.exists() and not config.force:
        if config.non_interactive:
            log.warning(".env exists; use --force to overwrite in non-interactive mode")
            print(f"  {warn_mark()} .env already exists. Use {bold('--force')} to overwrite.")
            return False
        print(f"  {warn_mark()} {bold('.env')} already exists.")
        if not prompt_yes_no("Overwrite?", default=False):
            print(f"  {dim('Skipped .env generation')}")
            return True

    ENV_FILE.write_text(content)
    ENV_FILE.chmod(stat.S_IRUSR | stat.S_IWUSR)  # 600
    log.info(f"Wrote .env ({len(content)} bytes, mode 600)")
    print(f"  {check_mark()} .env written ({bold('chmod 600')})")
    return True


# ---------------------------------------------------------------------------
# Migration runner
# ---------------------------------------------------------------------------


def run_migrations(config: DeployConfig) -> bool:
    """Run database migrations using the CLI installer (src/db/installer.ts)."""
    installer = PROJECT_ROOT / INSTALLER_PATH
    if not installer.exists():
        print(f"  {cross_mark()} Installer not found at {INSTALLER_PATH}")
        return False

    if not check_command_exists("npx"):
        print(f"  {cross_mark()} {bold('npx')} not found — install Node.js 18+ to run migrations")
        return False

    creds = config.credentials
    # Pass only the non-secret endpoint as a CLI arg.  Credentials are passed
    # via environment variables so they don't appear in `ps aux` output.
    cmd = [
        "npx", "tsx", str(installer),
        "--trino-endpoint", creds.trino_endpoint,
    ]

    # Build a child-process environment with secrets injected as env vars
    child_env = {**os.environ}
    child_env["VAST_TRINO_USERNAME"] = creds.access_key
    child_env["VAST_TRINO_PASSWORD"] = creds.secret_key

    print(f"  Running installer: {dim(str(INSTALLER_PATH))}")
    log.info(f"Running CLI installer: {INSTALLER_PATH}")

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=120,
            cwd=str(PROJECT_ROOT / "services" / "control-plane"),
            env=child_env,
        )
        if result.returncode == 0:
            # Print installer output (it logs per-migration progress)
            for line in result.stdout.strip().splitlines():
                print(f"  {dim(line)}")
            print(f"  {check_mark()} Migrations completed")
            log.info("CLI installer completed successfully")
            return True
        else:
            print(f"  {cross_mark()} Installer failed (exit code {result.returncode})")
            log.error(f"Installer stderr: {result.stderr}")
            for line in (result.stderr or result.stdout).strip().splitlines()[-5:]:
                print(f"    {dim(line)}")
            return False
    except subprocess.TimeoutExpired:
        print(f"  {cross_mark()} Installer timed out (120s)")
        log.error("CLI installer timed out")
        return False


# ---------------------------------------------------------------------------
# Docker operations
# ---------------------------------------------------------------------------


def docker_compose(*args: str, capture: bool = False, timeout: int = 300) -> subprocess.CompletedProcess:
    """Run docker compose with the project's compose file."""
    cmd = ["docker", "compose", "-f", str(COMPOSE_FILE), *args]
    log.debug(f"Running: {' '.join(cmd)}")
    return subprocess.run(
        cmd,
        capture_output=capture,
        text=True,
        timeout=timeout,
        cwd=str(PROJECT_ROOT),
    )


def docker_build() -> bool:
    """Build Docker images."""
    print(f"  Building images (this may take a few minutes)...")
    result = docker_compose("build", capture=True)
    if result.returncode != 0:
        print(f"  {cross_mark()} Build failed")
        log.error(f"Docker build failed: {result.stderr[:500]}")
        print(f"    {dim(result.stderr[:300])}")
        return False
    print(f"  {check_mark()} Images built successfully")
    log.info("Docker build completed")
    return True


def docker_up() -> bool:
    """Start containers in detached mode."""
    result = docker_compose("up", "-d", capture=True)
    if result.returncode != 0:
        print(f"  {cross_mark()} Failed to start containers")
        log.error(f"Docker up failed: {result.stderr[:500]}")
        print(f"    {dim(result.stderr[:300])}")
        return False
    print(f"  {check_mark()} Containers started")
    log.info("Docker containers started")
    return True


def docker_down(remove_volumes: bool = False) -> bool:
    """Stop and remove containers."""
    args = ["down"]
    if remove_volumes:
        args.append("-v")
    result = docker_compose(*args, capture=True)
    if result.returncode != 0:
        print(f"  {cross_mark()} Failed to stop containers")
        log.error(f"Docker down failed: {result.stderr[:300]}")
        return False
    print(f"  {check_mark()} Containers stopped")
    return True


def poll_health() -> bool:
    """Poll health endpoints until all services are healthy or timeout."""
    endpoints = {
        name: info
        for name, info in SERVICES.items()
        if info["health"] is not None
    }

    deadline = time.time() + HEALTH_TIMEOUT
    healthy: set[str] = set()

    print(f"  Waiting for services (timeout {HEALTH_TIMEOUT}s)...")

    while time.time() < deadline and len(healthy) < len(endpoints):
        for name, info in endpoints.items():
            if name in healthy:
                continue
            url = f"http://localhost:{info['port']}{info['health']}"
            try:
                req = urllib.request.Request(url, method="GET")
                req.add_header("User-Agent", "SpaceHarbor-Deploy/1.0")
                with urllib.request.urlopen(req, timeout=5) as resp:
                    if resp.status == 200:
                        healthy.add(name)
                        print(f"  {check_mark()} {name} — healthy")
                        log.info(f"{name} health check passed")
            except Exception:
                pass

        if len(healthy) < len(endpoints):
            remaining = HEALTH_TIMEOUT - (time.time() - (deadline - HEALTH_TIMEOUT))
            if remaining > 0:
                time.sleep(HEALTH_INTERVAL)

    if len(healthy) < len(endpoints):
        for name in endpoints:
            if name not in healthy:
                print(f"  {cross_mark()} {name} — not healthy")
                log.error(f"{name} health check failed after {HEALTH_TIMEOUT}s")
        return False

    return True


# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------


def print_summary(config: DeployConfig) -> None:
    print()
    print(bold(green("  Deployment Complete!")))
    print(dim("  " + "─" * 40))
    print()
    print(f"  Mode:        {bold(config.mode)}")
    print(f"  API Key:     {mask(config.api_key) if config.api_key else dim('(none)')}")
    print()
    print(bold("  Service URLs:"))
    print(f"    Web UI:         {cyan('http://localhost:4173')}")
    print(f"    Control Plane:  {cyan('http://localhost:8080')}")
    print(f"    Health:         {cyan('http://localhost:8080/health')}")
    print(f"    OpenAssetIO:    {cyan('http://localhost:8001')}")
    print()
    print(bold("  Next steps:"))
    print(f"    1. Open {cyan('http://localhost:4173')} in your browser")
    print(f"    2. Check logs: {dim('docker compose logs -f')}")
    print(f"    3. Stop:       {dim('python scripts/deploy.py --teardown')}")
    print(f"    4. Deploy log: {dim(str(DEPLOY_LOG))}")
    print()


# ---------------------------------------------------------------------------
# Config loading (non-interactive mode)
# ---------------------------------------------------------------------------


def load_config_file(path: str) -> dict[str, Any]:
    """Load deploy-config.json."""
    p = Path(path)
    if not p.exists():
        print(f"  {cross_mark()} Config file not found: {path}")
        sys.exit(1)
    try:
        return json.loads(p.read_text())
    except json.JSONDecodeError as e:
        print(f"  {cross_mark()} Invalid JSON in {path}: {e}")
        sys.exit(1)


def config_from_env_and_file(args: argparse.Namespace) -> DeployConfig:
    """Build config from environment variables and optional config file."""
    cfg = DeployConfig(
        mode=args.mode or os.environ.get("SPACEHARBOR_DEPLOY_MODE", "local"),
        skip_migrations=args.skip_migrations,
        skip_build=args.skip_build,
        force=args.force,
        verbose=args.verbose,
        non_interactive=True,
    )

    extra: dict[str, Any] = {}
    if args.config:
        extra = load_config_file(args.config)
        cfg.mode = extra.get("mode", cfg.mode)

    creds = cfg.credentials
    creds.trino_endpoint = extra.get("trino_endpoint", os.environ.get("VAST_TRINO_ENDPOINT", ""))
    creds.access_key = extra.get("access_key", os.environ.get("VAST_ACCESS_KEY", ""))
    creds.secret_key = extra.get("secret_key", os.environ.get("VAST_SECRET_KEY", ""))
    creds.event_broker_url = extra.get("event_broker_url", os.environ.get("VAST_EVENT_BROKER_URL", ""))
    creds.dataengine_url = extra.get("dataengine_url", os.environ.get("VAST_DATAENGINE_URL", ""))
    creds.api_token = extra.get("api_token", os.environ.get("VAST_API_TOKEN", ""))
    creds.sasl_username = extra.get("sasl_username", os.environ.get("VAST_EVENT_BROKER_SASL_USERNAME", ""))
    creds.sasl_password = extra.get("sasl_password", os.environ.get("VAST_EVENT_BROKER_SASL_PASSWORD", ""))
    creds.sasl_mechanism = extra.get("sasl_mechanism", os.environ.get("VAST_EVENT_BROKER_SASL_MECHANISM", "PLAIN"))

    cfg.api_key = extra.get("api_key", os.environ.get("SPACEHARBOR_API_KEY", ""))
    if not cfg.api_key:
        cfg.api_key = base64.urlsafe_b64encode(os.urandom(32)).decode().rstrip("=")

    return cfg


# ---------------------------------------------------------------------------
# Deployer class — orchestrates the 8-step flow
# ---------------------------------------------------------------------------

TOTAL_STEPS = 8


class Deployer:
    def __init__(self, config: DeployConfig):
        self.config = config

    def run(self) -> bool:
        """Execute the full deployment flow. Returns True on success."""
        banner()
        log.info(f"Starting deployment — mode={self.config.mode}")

        # Register secrets for log filtering
        if self.config.mode != "local":
            _SECRETS.extend(self.config.credentials.secrets())
        if self.config.api_key:
            _SECRETS.append(self.config.api_key)

        if not self._step_preflight():
            return False
        if not self._step_mode():
            return False
        if not self._step_credentials():
            return False
        if not self._step_validate():
            return False
        if not self._step_env():
            return False
        if not self._step_migrations():
            return False
        if not self._step_build():
            return False
        if not self._step_start():
            return False

        print_summary(self.config)
        return True

    # -- Step 1: Preflight checks --
    def _step_preflight(self) -> bool:
        step_header(1, TOTAL_STEPS, "Preflight checks")

        # Docker
        ok, detail = check_docker_installed()
        if ok:
            print(f"  {check_mark()} Docker: {detail}")
        else:
            print(f"  {cross_mark()} Docker: {detail}")
            return False

        # npx (needed for migrations)
        if check_command_exists("npx"):
            print(f"  {check_mark()} npx available")
        else:
            print(f"  {warn_mark()} npx not found — migrations will be skipped")
            self.config.skip_migrations = True

        # Ports
        ports_ok = True
        for name, info in SERVICES.items():
            port = info["port"]
            if port is None:
                continue
            if check_port_available(port):
                print(f"  {check_mark()} Port {port} ({name}) — available")
            else:
                print(f"  {cross_mark()} Port {port} ({name}) — in use")
                ports_ok = False

        if not ports_ok:
            print(f"\n  {red('Ports already in use.')} Stop conflicting services or run:")
            print(f"  {dim('python scripts/deploy.py --teardown')}")
            return False

        # Compose file
        if COMPOSE_FILE.exists():
            print(f"  {check_mark()} docker-compose.yml found")
        else:
            print(f"  {cross_mark()} docker-compose.yml not found at {COMPOSE_FILE}")
            return False

        log.info("Preflight checks passed")
        return True

    # -- Step 2: Deployment mode --
    def _step_mode(self) -> bool:
        step_header(2, TOTAL_STEPS, "Deployment mode")

        if self.config.non_interactive:
            print(f"  Mode: {bold(self.config.mode)}")
        else:
            if not self.config.mode or self.config.mode not in ("local", "cloud", "onprem"):
                self.config.mode = prompt_deploy_mode()
            print(f"\n  Selected: {bold(self.config.mode)}")

        log.info(f"Deployment mode: {self.config.mode}")
        return True

    # -- Step 3: VAST credentials --
    def _step_credentials(self) -> bool:
        step_header(3, TOTAL_STEPS, "VAST credentials")

        if self.config.mode == "local":
            print(f"  {dim('Skipped — local mode uses in-memory persistence')}")
            # Still need an API key
            if not self.config.api_key:
                if self.config.non_interactive:
                    self.config.api_key = base64.urlsafe_b64encode(os.urandom(32)).decode().rstrip("=")
                    print(f"  {check_mark()} API key auto-generated")
                else:
                    self.config.api_key = prompt_api_key()
            else:
                print(f"  {check_mark()} API key: {mask(self.config.api_key)}")
            return True

        if self.config.non_interactive:
            # Validate that required creds are present
            creds = self.config.credentials
            missing = []
            if not creds.trino_endpoint:
                missing.append("VAST_TRINO_ENDPOINT")
            if not creds.access_key:
                missing.append("VAST_ACCESS_KEY")
            if not creds.secret_key:
                missing.append("VAST_SECRET_KEY")
            if missing:
                print(f"  {cross_mark()} Missing required credentials: {', '.join(missing)}")
                return False
            print(f"  {check_mark()} Credentials loaded from environment/config")
        else:
            self.config.credentials = prompt_credentials()
            _SECRETS.extend(self.config.credentials.secrets())

        if not self.config.api_key:
            if self.config.non_interactive:
                self.config.api_key = base64.urlsafe_b64encode(os.urandom(32)).decode().rstrip("=")
                print(f"  {check_mark()} API key auto-generated")
            else:
                self.config.api_key = prompt_api_key()
        else:
            print(f"  {check_mark()} API key: {mask(self.config.api_key)}")

        if self.config.api_key:
            _SECRETS.append(self.config.api_key)

        log.info("Credentials collected")
        return True

    # -- Step 4: Validate connectivity --
    def _step_validate(self) -> bool:
        step_header(4, TOTAL_STEPS, "Validate connectivity")

        if self.config.mode == "local":
            print(f"  {dim('Skipped — local mode')}")
            return True

        creds = self.config.credentials
        all_ok = True

        # Trino endpoint
        ok, detail = validate_trino_endpoint(creds.trino_endpoint)
        print(f"  {'✓' if ok else '✗'} Trino endpoint: {detail}" if not Color.enabled() else
              f"  {check_mark() if ok else cross_mark()} Trino endpoint: {detail}")
        if ok:
            # Test auth
            ok2, detail2 = validate_trino_auth(creds.trino_endpoint, creds.access_key, creds.secret_key)
            print(f"  {check_mark() if ok2 else cross_mark()} Trino auth: {detail2}")
            if not ok2:
                all_ok = False
        else:
            all_ok = False

        # Event Broker (optional)
        if creds.event_broker_url:
            ok, detail = validate_event_broker(creds.event_broker_url)
            print(f"  {check_mark() if ok else cross_mark()} Event Broker: {detail}")
            if not ok:
                print(f"    {warn_mark()} {dim('Event Broker is optional — deployment can proceed')}")
        else:
            print(f"  {dim('─')} Event Broker: {dim('not configured (optional)')}")

        # DataEngine (optional)
        if creds.dataengine_url and creds.api_token:
            ok, detail = validate_dataengine(creds.dataengine_url, creds.api_token)
            print(f"  {check_mark() if ok else cross_mark()} DataEngine: {detail}")
            if not ok:
                print(f"    {warn_mark()} {dim('DataEngine is optional — deployment can proceed')}")
        else:
            print(f"  {dim('─')} DataEngine: {dim('not configured (optional)')}")

        if not all_ok:
            print(f"\n  {red('Required connectivity checks failed.')}")
            if not self.config.force:
                if self.config.non_interactive:
                    return False
                if not prompt_yes_no("Continue anyway?", default=False):
                    return False
            print(f"  {warn_mark()} Continuing with --force")

        log.info(f"Connectivity validation: {'PASS' if all_ok else 'PARTIAL'}")
        return True

    # -- Step 5: Generate .env --
    def _step_env(self) -> bool:
        step_header(5, TOTAL_STEPS, "Generate .env")
        return write_env(self.config)

    # -- Step 6: Run migrations --
    def _step_migrations(self) -> bool:
        step_header(6, TOTAL_STEPS, "Run migrations")

        if self.config.mode == "local":
            print(f"  {dim('Skipped — local mode uses in-memory persistence')}")
            return True

        if self.config.skip_migrations:
            print(f"  {dim('Skipped (--skip-migrations)')}")
            return True

        return run_migrations(self.config)

    # -- Step 7: Build Docker images --
    def _step_build(self) -> bool:
        step_header(7, TOTAL_STEPS, "Build Docker images")

        if self.config.skip_build:
            print(f"  {dim('Skipped (--skip-build)')}")
            return True

        return docker_build()

    # -- Step 8: Start + health check --
    def _step_start(self) -> bool:
        step_header(8, TOTAL_STEPS, "Start services")

        if not docker_up():
            return False

        print()
        if not poll_health():
            print(f"\n  {warn_mark()} Some services did not become healthy.")
            print(f"    Check logs: {dim('docker compose logs -f')}")
            # Don't fail — containers are running, user can debug
            return True

        return True


# ---------------------------------------------------------------------------
# Check-only mode
# ---------------------------------------------------------------------------


def run_check(args: argparse.Namespace) -> int:
    """Validate VAST connectivity without deploying."""
    banner()
    print(bold("  Connectivity Check Mode"))
    print(dim("  " + "─" * 40))
    print()

    config = DeployConfig(verbose=args.verbose)

    if args.non_interactive:
        config = config_from_env_and_file(args)
    else:
        mode = args.mode or prompt_deploy_mode()
        config.mode = mode
        if mode == "local":
            print(f"\n  {dim('Nothing to check in local mode.')}")
            return 0
        config.credentials = prompt_credentials()

    creds = config.credentials
    _SECRETS.extend(creds.secrets())

    results: list[tuple[str, bool, str]] = []

    ok, detail = validate_trino_endpoint(creds.trino_endpoint)
    results.append(("Trino endpoint", ok, detail))

    if ok:
        ok2, detail2 = validate_trino_auth(creds.trino_endpoint, creds.access_key, creds.secret_key)
        results.append(("Trino auth", ok2, detail2))

    if creds.event_broker_url:
        ok, detail = validate_event_broker(creds.event_broker_url)
        results.append(("Event Broker", ok, detail))

    if creds.dataengine_url and creds.api_token:
        ok, detail = validate_dataengine(creds.dataengine_url, creds.api_token)
        results.append(("DataEngine", ok, detail))

    print()
    print(bold("  Results:"))
    all_ok = True
    for name, ok, detail in results:
        print(f"  {check_mark() if ok else cross_mark()} {name}: {detail}")
        if not ok:
            all_ok = False

    print()
    if all_ok:
        print(f"  {green('All checks passed.')}")
    else:
        print(f"  {red('Some checks failed.')}")

    return 0 if all_ok else 1


# ---------------------------------------------------------------------------
# Teardown mode
# ---------------------------------------------------------------------------


def run_teardown(args: argparse.Namespace) -> int:
    """Stop services and optionally clean up."""
    banner()
    print(bold("  Teardown Mode"))
    print(dim("  " + "─" * 40))
    print()

    if not args.force and not args.non_interactive:
        if not prompt_yes_no("Stop all SpaceHarbor containers?", default=True):
            print(f"  {dim('Cancelled.')}")
            return 0

    if not docker_down():
        return 1

    if ENV_FILE.exists():
        if args.force:
            remove = True
        elif args.non_interactive:
            remove = False
        else:
            remove = prompt_yes_no("Remove .env file?", default=False)

        if remove:
            ENV_FILE.unlink()
            print(f"  {check_mark()} .env removed")
        else:
            print(f"  {dim('.env kept')}")

    print(f"\n  {green('Teardown complete.')}")
    return 0


# ---------------------------------------------------------------------------
# CLI parser
# ---------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="deploy",
        description="SpaceHarbor Deployment CLI — deploy the full stack with a guided wizard.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=textwrap.dedent("""\
            examples:
              python scripts/deploy.py                       Interactive wizard
              python scripts/deploy.py --mode local          Local dev (no VAST)
              python scripts/deploy.py --check               Validate VAST connectivity
              python scripts/deploy.py --teardown            Stop services
              python scripts/deploy.py --non-interactive     CI/CD mode (reads env vars)
        """),
    )

    parser.add_argument(
        "--mode",
        choices=["local", "cloud", "onprem"],
        help="Deployment mode (skip interactive prompt)",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Validate connectivity only, don't deploy",
    )
    parser.add_argument(
        "--teardown",
        action="store_true",
        help="Stop services and optionally remove .env",
    )
    parser.add_argument(
        "--non-interactive",
        action="store_true",
        help="Read from env vars or --config file",
    )
    parser.add_argument(
        "--config",
        metavar="FILE",
        help="JSON config file for non-interactive mode",
    )
    parser.add_argument(
        "--skip-migrations",
        action="store_true",
        help="Skip database migrations (step 6)",
    )
    parser.add_argument(
        "--skip-build",
        action="store_true",
        help="Skip Docker image build (step 7)",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Skip confirmation prompts",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Enable debug logging to console",
    )

    return parser


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    setup_logging(verbose=args.verbose)

    # Handle Ctrl+C gracefully
    def _sigint_handler(signum: int, frame: Any) -> None:
        print(f"\n\n  {yellow('Interrupted.')} Containers may still be running.")
        print(f"  Run {dim('python scripts/deploy.py --teardown')} to clean up.")
        sys.exit(130)

    signal.signal(signal.SIGINT, _sigint_handler)

    # Route to the right mode
    if args.check:
        return run_check(args)

    if args.teardown:
        return run_teardown(args)

    # Full deployment
    if args.non_interactive:
        config = config_from_env_and_file(args)
    else:
        config = DeployConfig(
            mode=args.mode or "",
            skip_migrations=args.skip_migrations,
            skip_build=args.skip_build,
            force=args.force,
            verbose=args.verbose,
        )

    deployer = Deployer(config)
    success = deployer.run()
    return 0 if success else 1


if __name__ == "__main__":
    sys.exit(main())
