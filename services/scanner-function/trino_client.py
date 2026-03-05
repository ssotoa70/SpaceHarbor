"""Thin Trino REST client for VastDB queries."""
import requests
from typing import Any, Optional


class TrinoClient:
    def __init__(self, endpoint: str, user: str = "scanner", catalog: str = "vast", schema: str = "assetharbor"):
        self.endpoint = endpoint.rstrip("/")
        self.user = user
        self.catalog = catalog
        self.schema = schema
        self.session = requests.Session()
        self.session.headers.update({
            "X-Trino-User": user,
            "X-Trino-Catalog": catalog,
            "X-Trino-Schema": schema,
        })

    def query(self, sql: str, params: Optional[list] = None) -> list[dict]:
        """Execute a SELECT query and return rows as list of dicts."""
        rendered = self._render_sql(sql, params)
        return self._execute_query(rendered)

    def execute(self, sql: str, params: Optional[list] = None) -> None:
        """Execute a non-SELECT statement (INSERT, UPDATE)."""
        rendered = self._render_sql(sql, params)
        self._execute_query(rendered)

    def _render_sql(self, sql: str, params: Optional[list]) -> str:
        """Substitute ? placeholders with quoted parameter values."""
        if not params:
            return sql
        parts = sql.split("?")
        if len(parts) != len(params) + 1:
            raise ValueError(f"Parameter count mismatch: {len(params)} params for {len(parts)-1} placeholders")
        result = parts[0]
        for param, part in zip(params, parts[1:]):
            result += _quote_value(param) + part
        return result

    def _execute_query(self, sql: str) -> list[dict]:
        resp = self.session.post(
            f"{self.endpoint}/v1/statement",
            data=sql,
            headers={"Content-Type": "application/json"},
        )
        resp.raise_for_status()
        return _collect_rows(resp.json(), self.session)


def _quote_value(value: Any) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, (int, float)):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def _collect_rows(initial_response: dict, session: requests.Session) -> list[dict]:
    """Follow Trino's nextUri pagination and collect all rows."""
    columns: list[str] = []
    rows: list[dict] = []

    response = initial_response
    while True:
        if "columns" in response and not columns:
            columns = [col["name"] for col in response["columns"]]
        if "data" in response:
            for row in response["data"]:
                rows.append(dict(zip(columns, row)))
        next_uri = response.get("nextUri")
        if not next_uri:
            break
        resp = session.get(next_uri)
        resp.raise_for_status()
        response = resp.json()

    return rows
