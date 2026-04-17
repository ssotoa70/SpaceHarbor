"""
SpaceHarbor scanner-function — VAST DataEngine thin forwarder.

This function does ONE thing: extract the S3 fields from a DataEngine
ElementCreated event, HMAC-sign the normalized body, and POST it to the
SpaceHarbor control-plane's `/api/v1/scanner/ingest` endpoint. All path
parsing, hierarchy resolution, and ingest logic lives in the TypeScript
control-plane (services/control-plane/src/scanner/ + routes/scanner-ingest.ts).

Why a thin forwarder?
  - One language for business logic (TypeScript). Tests + types follow.
  - Function image stays deps-stable — only `requests` plus stdlib —
    so Dependabot stops paging on rebuilds it can't trigger.
  - Auth model is identical to inbound webhooks: HMAC over the request
    body, secret in an env var.

Required env vars (set in the VAST DataEngine pipeline config):
  SPACEHARBOR_CONTROL_PLANE_URL  e.g. http://control-plane.spaceharbor.svc:8080
  SPACEHARBOR_SCANNER_SECRET     shared secret with the control-plane

Optional:
  SCANNER_HTTP_TIMEOUT_S         request timeout (default 10)

Event compatibility:
  - AWS-S3-style: {"Records":[{"s3":{"bucket":{"name":...},"object":{"key":...,"eTag":...,"size":...}}}]}
  - VAST CloudEvents-style: top-level `elementpath: "<bucket>/<key>"` with
    optional `s3_bucket`, `s3_key`, `etag`, `size` extension fields.

Build/deploy: see services/scanner-function/trigger-config.md and the
authoritative VAST guide at:
  /Users/sergio.soto/projects/RAG/serverless-functions/BUILD_AND_DEPLOY_GUIDE.md
"""

import hashlib
import hmac
import json
import logging
import os
from typing import Any, Optional

import requests

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT_S = int(os.environ.get("SCANNER_HTTP_TIMEOUT_S", "10"))


def init(_ctx: Any) -> None:
    """One-time pod init. Empty for the thin forwarder — no clients to set up
    beyond the per-call requests session created in handler()."""
    return None


def handler(_ctx: Any, event: dict) -> dict:
    """Forward an ElementCreated event to the control-plane."""
    base_url = os.environ.get("SPACEHARBOR_CONTROL_PLANE_URL")
    if not base_url:
        raise RuntimeError("SPACEHARBOR_CONTROL_PLANE_URL is not set")
    secret = os.environ.get("SPACEHARBOR_SCANNER_SECRET")
    if not secret:
        raise RuntimeError("SPACEHARBOR_SCANNER_SECRET is not set")

    fields = _extract_s3_fields(event)
    if fields is None:
        logger.info("Skipping event with no recognizable S3 fields")
        return {"status": "skipped", "reason": "no S3 fields in event"}

    # Canonical body — exact bytes the control-plane will HMAC-verify.
    body = json.dumps(fields, sort_keys=True, separators=(",", ":"))
    signature = hmac.new(secret.encode("utf-8"), body.encode("utf-8"), hashlib.sha256).hexdigest()

    url = f"{base_url.rstrip('/')}/api/v1/scanner/ingest"
    resp = requests.post(
        url,
        data=body,
        headers={
            "content-type": "application/json",
            "x-scanner-signature": signature,
        },
        timeout=DEFAULT_TIMEOUT_S,
    )
    resp.raise_for_status()
    result = resp.json()
    logger.info("Forwarded %s → %s", fields.get("key"), result.get("status"))
    return result


def _extract_s3_fields(event: dict) -> Optional[dict]:
    """Normalize the event into {bucket, key, etag?, size?, actor?}.

    Handles both AWS S3-style envelope (Records[0].s3) and the VAST
    CloudEvents extension shape (`elementpath` + `s3_*` fields). Returns
    None if neither pattern matches — the function silently skips so the
    DataEngine pipeline doesn't keep retrying a malformed payload.
    """
    # AWS S3-style — what the legacy scanner-function consumed.
    records = event.get("Records") if isinstance(event, dict) else None
    if isinstance(records, list) and records:
        rec = records[0]
        s3 = rec.get("s3") or {}
        bucket = (s3.get("bucket") or {}).get("name")
        obj = s3.get("object") or {}
        key = obj.get("key")
        if bucket and key:
            actor = ((rec.get("userIdentity") or {}).get("principalId")) or "scanner"
            return {
                "bucket": bucket,
                "key": key,
                "etag": obj.get("eTag", ""),
                "size": int(obj.get("size", 0)) if obj.get("size") is not None else 0,
                "actor": actor,
            }

    # VAST CloudEvents-style: elementpath = "<bucket>/<key>"
    elementpath = event.get("elementpath") if isinstance(event, dict) else None
    if isinstance(elementpath, str) and "/" in elementpath:
        bucket, _, key = elementpath.partition("/")
        if bucket and key:
            return {
                "bucket": bucket,
                "key": key,
                "etag": event.get("etag", "") or "",
                "size": int(event.get("size", 0) or 0),
                "actor": event.get("actor", "scanner") or "scanner",
            }
    if isinstance(event, dict) and event.get("s3_bucket") and event.get("s3_key"):
        return {
            "bucket": event["s3_bucket"],
            "key": event["s3_key"],
            "etag": event.get("etag", "") or "",
            "size": int(event.get("size", 0) or 0),
            "actor": event.get("actor", "scanner") or "scanner",
        }

    return None
