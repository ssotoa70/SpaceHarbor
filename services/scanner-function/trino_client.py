"""Trino client for VastDB queries using the official trino DBAPI driver.

Replaces the previous manual HTTP-based implementation with the official
`trino` Python package for native parameterized queries, eliminating
SQL injection risks from string interpolation.
"""
import re
from typing import Any, Optional
from urllib.parse import urlparse

import trino

# Pattern for valid SQL identifiers (schema, table, column names)
_IDENTIFIER_PATTERN = re.compile(r"^[a-zA-Z0-9_]+$")


def validate_identifier(name: str, label: str = "identifier") -> str:
    """Validate a SQL identifier (schema, table, column name).

    Only allows alphanumeric characters and underscores.
    Raises ValueError if the name contains unsafe characters.
    """
    if not name:
        raise ValueError(f"SQL {label} must not be empty")
    if len(name) > 128:
        raise ValueError(f"SQL {label} too long ({len(name)} chars, max 128)")
    if not _IDENTIFIER_PATTERN.match(name):
        raise ValueError(
            f"SQL {label} contains unsafe characters: {name!r} "
            f"(only alphanumeric and underscore allowed)"
        )
    return name


class TrinoClient:
    """Trino client using the official trino DBAPI driver.

    Uses parameterized queries via the DBAPI interface, preventing
    SQL injection by design. Replaces the previous manual HTTP client
    that relied on string escaping.
    """

    DEFAULT_TIMEOUT = 30  # seconds

    def __init__(
        self,
        endpoint: str,
        user: str = "scanner",
        catalog: str = "vast",
        schema: str = "spaceharbor",
        username: str | None = None,
        password: str | None = None,
        timeout: int | None = None,
    ):
        self.endpoint = endpoint.rstrip("/")
        self.user = user
        self.catalog = catalog
        self.schema = schema
        self.timeout = timeout or self.DEFAULT_TIMEOUT

        # Parse the endpoint URL to extract host and port
        parsed = urlparse(self.endpoint)
        if not parsed.hostname:
            raise ValueError(f"Invalid Trino endpoint URL: {endpoint!r}")

        self._host = parsed.hostname
        self._port = parsed.port or (443 if parsed.scheme == "https" else 8080)
        self._http_scheme = parsed.scheme or "http"

        # Auth: prefer explicit username/password, fall back to user header
        self._username = username or user
        self._password = password

    def _get_connection(self) -> trino.dbapi.Connection:
        """Create a new Trino DBAPI connection."""
        conn_kwargs: dict[str, Any] = {
            "host": self._host,
            "port": self._port,
            "user": self._username,
            "catalog": self.catalog,
            "schema": self.schema,
            "http_scheme": self._http_scheme,
            "request_timeout": self.timeout,
        }
        if self._password:
            conn_kwargs["auth"] = trino.auth.BasicAuthentication(
                self._username, self._password
            )
        return trino.dbapi.connect(**conn_kwargs)

    def query(self, sql: str, params: Optional[list] = None) -> list[dict]:
        """Execute a SELECT query and return rows as list of dicts.

        Uses DBAPI parameterized queries — parameters are sent safely
        to Trino without string interpolation.
        """
        conn = self._get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute(sql, params)
            columns = [desc[0] for desc in cursor.description] if cursor.description else []
            rows = cursor.fetchall()
            return [dict(zip(columns, row)) for row in rows]
        finally:
            conn.close()

    def execute(self, sql: str, params: Optional[list] = None) -> None:
        """Execute a non-SELECT statement (INSERT, UPDATE, DELETE).

        Uses DBAPI parameterized queries — parameters are sent safely
        to Trino without string interpolation.
        """
        conn = self._get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute(sql, params)
            # Consume all results to ensure the statement completes
            try:
                cursor.fetchall()
            except trino.exceptions.TrinoUserError:
                pass  # Some statements (e.g., INSERT) may not return rows
        finally:
            conn.close()
