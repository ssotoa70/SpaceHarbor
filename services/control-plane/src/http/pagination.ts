/**
 * Cursor pagination contract.
 *
 * Wire format (query params):
 *   ?cursor=<opaque base64>   pointer to the next page, returned by server
 *   ?limit=<integer>          max rows per page (≤ SPACEHARBOR_MAX_LIST_LIMIT)
 *
 * Response envelope:
 *   {
 *     items: [...],
 *     nextCursor: "<opaque>" | null,   // null when no more rows
 *     total?: number,                   // optional — routes can omit when counting is expensive
 *   }
 *
 * Cursor design: opaque string holding the last row's sort key (e.g.
 * `${createdAt}|${id}`) base64-encoded. Clients MUST treat cursors as
 * black boxes; the server can change the scheme per release.
 *
 * Why not offset/limit? Offsets drift under concurrent inserts — a user
 * paging through a growing list sees duplicates and skips. Cursors are
 * stable: "rows strictly after (createdAt, id)" is monotonic.
 *
 * Backward compatibility:
 *   Routes continue to accept `offset` for existing clients. If both
 *   cursor and offset are present, cursor wins. New clients should only
 *   use cursor.
 */

const MAX_LIMIT_DEFAULT = 500;

export function getMaxListLimit(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.SPACEHARBOR_MAX_LIST_LIMIT;
  if (!raw) return MAX_LIMIT_DEFAULT;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 1) return MAX_LIMIT_DEFAULT;
  return parsed;
}

export interface PaginationParams {
  cursor: string | null;
  limit: number;
  offset?: number; // legacy — routes should prefer cursor
}

export interface CursorPayload<Key> {
  /** The sort key of the LAST row returned in the previous page. */
  key: Key;
}

/**
 * Parse `limit` and `cursor` (or legacy `offset`) from a querystring object.
 * Clamps limit to [1, max]. Invalid cursors fall through as null — never
 * throw, never 400; the caller can return a fresh first page.
 */
export function parsePaginationParams(
  query: { cursor?: string; limit?: string; offset?: string } | undefined,
  options: { defaultLimit?: number } = {},
): PaginationParams {
  const max = getMaxListLimit();
  const defaultLimit = options.defaultLimit ?? 50;
  const rawLimit = query?.limit ? parseInt(query.limit, 10) : defaultLimit;
  const limit = Math.min(
    max,
    Math.max(1, Number.isNaN(rawLimit) ? defaultLimit : rawLimit),
  );
  const cursor = query?.cursor && query.cursor.length > 0 ? query.cursor : null;
  const offset = query?.offset ? Math.max(0, parseInt(query.offset, 10) || 0) : undefined;
  return { cursor, limit, offset };
}

/**
 * Encode a cursor payload to base64url so it's safe in a URL without
 * escaping.
 */
export function encodeCursor<Key>(payload: CursorPayload<Key>): string {
  const json = JSON.stringify(payload);
  return Buffer.from(json, "utf8").toString("base64url");
}

/**
 * Decode a base64url cursor. Returns null on any parse failure so the
 * caller treats invalid cursors as "start from the beginning" rather than
 * raising 400.
 */
export function decodeCursor<Key>(cursor: string | null): CursorPayload<Key> | null {
  if (!cursor) return null;
  try {
    const json = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== "object" || !("key" in parsed)) return null;
    return parsed as CursorPayload<Key>;
  } catch {
    return null;
  }
}

/**
 * Apply offset/cursor slicing to an array in memory.
 * Returns { items, nextCursor } where nextCursor is null when we've
 * exhausted the input.
 *
 * Cursor key shape: the caller provides a `keyOf(item)` function that
 * extracts a comparable sort key (string, typically "createdAt|id").
 * Items MUST be pre-sorted by this key in DESC order (newest first).
 */
export function paginateSortedArray<T>(
  items: T[],
  params: PaginationParams,
  keyOf: (item: T) => string,
): { items: T[]; nextCursor: string | null } {
  let start = 0;

  const decoded = decodeCursor<string>(params.cursor);
  if (decoded) {
    // Find the row strictly AFTER the cursor key.
    // Items are DESC-sorted so we find the first whose key < cursor.key.
    for (let i = 0; i < items.length; i++) {
      if (keyOf(items[i]) < decoded.key) {
        start = i;
        break;
      }
      if (i === items.length - 1) start = items.length;
    }
  } else if (params.offset !== undefined && params.offset > 0) {
    // Legacy offset path
    start = params.offset;
  }

  const page = items.slice(start, start + params.limit);
  const nextCursor =
    start + params.limit < items.length && page.length > 0
      ? encodeCursor({ key: keyOf(page[page.length - 1]) })
      : null;

  return { items: page, nextCursor };
}

/**
 * Shared OpenAPI schema fragments for routes that adopt the contract.
 */
export const paginationQuerySchema = {
  cursor: { type: "string", description: "Opaque pagination cursor returned by the previous page." },
  limit: { type: "string", description: "Max rows per page (1–500, default varies per route)." },
  offset: { type: "string", description: "DEPRECATED — use cursor. Ignored when cursor is provided." },
} as const;

export const paginationEnvelopeSchema = {
  nextCursor: { type: ["string", "null"] },
  total: { type: "integer", description: "Total matching rows. May be omitted when counting is expensive." },
} as const;
