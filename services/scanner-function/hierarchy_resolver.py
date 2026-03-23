import uuid
from typing import Optional


class HierarchyNotFoundError(Exception):
    pass


def resolve_hierarchy(parsed: dict, trino_client) -> dict:
    """
    Given parsed path codes, look up UUIDs from VastDB.
    Raises HierarchyNotFoundError if project cannot be resolved.
    Auto-creates missing sequence/shot rows (idempotent).
    """
    schema = 'vast."spaceharbor/production"'

    # 1. Resolve project (must exist — we don't auto-create projects)
    rows = trino_client.query(
        f"SELECT id FROM {schema}.projects WHERE code = ?",
        [parsed["project_code"]]
    )
    if not rows:
        raise HierarchyNotFoundError(f"Project not found: {parsed['project_code']}")
    project_id = rows[0]["id"]

    # 2. Resolve or create sequence
    seq_rows = trino_client.query(
        f"SELECT id FROM {schema}.sequences WHERE project_id = ? AND code = ?",
        [project_id, parsed["sequence_code"]]
    )
    if seq_rows:
        sequence_id = seq_rows[0]["id"]
    else:
        sequence_id = _auto_create_sequence(project_id, parsed, trino_client, schema)

    # 3. Resolve or create shot
    shot_rows = trino_client.query(
        f"SELECT id FROM {schema}.shots WHERE sequence_id = ? AND code = ?",
        [sequence_id, parsed["shot_code"]]
    )
    if shot_rows:
        shot_id = shot_rows[0]["id"]
    else:
        shot_id = _auto_create_shot(project_id, sequence_id, parsed, trino_client, schema)

    return {
        "project_id":    project_id,
        "sequence_id":   sequence_id,
        "shot_id":       shot_id,
        "version_label": parsed["version_label"],
    }


def _auto_create_sequence(project_id: str, parsed: dict, trino_client, schema: str) -> str:
    new_id = str(uuid.uuid4())
    trino_client.execute(
        f"INSERT INTO {schema}.sequences (id, project_id, code, name) VALUES (?, ?, ?, ?)",
        [new_id, project_id, parsed["sequence_code"], parsed["sequence_code"]]
    )
    return new_id


def _auto_create_shot(
    project_id: str, sequence_id: str, parsed: dict, trino_client, schema: str
) -> str:
    new_id = str(uuid.uuid4())
    trino_client.execute(
        f"INSERT INTO {schema}.shots (id, project_id, sequence_id, code, name) VALUES (?, ?, ?, ?, ?)",
        [new_id, project_id, sequence_id, parsed["shot_code"], parsed["shot_code"]]
    )
    return new_id
