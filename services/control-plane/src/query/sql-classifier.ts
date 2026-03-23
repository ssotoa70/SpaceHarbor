/**
 * SQL statement classifier for the ad-hoc query console.
 * Implements security controls to restrict queries to read-only operations.
 */

const BLOCKED_TABLES = [
  "iam_users",
  "iam_api_keys",
  "iam_global_roles",
  "iam_project_memberships",
  "iam_refresh_tokens",
  "schema_version",
];

const ALLOWED_STATEMENT_TYPES = ["SELECT", "SHOW", "DESCRIBE", "EXPLAIN"];

/**
 * Strip leading SQL comments (both -- and /* style).
 */
function stripLeadingComments(sql: string): string {
  let s = sql.trim();
  while (true) {
    if (s.startsWith("--")) {
      const nl = s.indexOf("\n");
      s = nl === -1 ? "" : s.slice(nl + 1).trim();
    } else if (s.startsWith("/*")) {
      const end = s.indexOf("*/");
      s = end === -1 ? "" : s.slice(end + 2).trim();
    } else {
      break;
    }
  }
  return s;
}

export interface ClassificationResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Classify a SQL statement. Only SELECT, SHOW, DESCRIBE, EXPLAIN are allowed.
 */
export function classifyStatement(sql: string): ClassificationResult {
  const stripped = stripLeadingComments(sql);
  if (!stripped) {
    return { allowed: false, reason: "Empty statement" };
  }

  // Detect multi-statement (semicolons outside quotes)
  const withoutStrings = stripped.replace(/'[^']*'/g, "''");
  const statementsCount = withoutStrings.split(";").filter((s) => s.trim().length > 0).length;
  if (statementsCount > 1) {
    return { allowed: false, reason: "Multi-statement queries are not allowed" };
  }

  const firstWord = stripped.split(/\s+/)[0].toUpperCase();
  if (!ALLOWED_STATEMENT_TYPES.includes(firstWord)) {
    return { allowed: false, reason: `Statement type '${firstWord}' is not allowed. Only ${ALLOWED_STATEMENT_TYPES.join(", ")} are permitted.` };
  }

  return { allowed: true };
}

/**
 * Check if SQL references any blocked IAM/system tables.
 */
export function referencesBlockedTable(sql: string): ClassificationResult {
  const normalized = sql.toLowerCase().replace(/["'`]/g, "");
  for (const table of BLOCKED_TABLES) {
    // Match table name as whole word (preceded by whitespace, dot, or start; followed by whitespace, dot, paren, or end)
    const regex = new RegExp(`(?:^|[\\s.,(")])${table}(?:[\\s.,()"\`]|$)`, "i");
    if (regex.test(normalized)) {
      return { allowed: false, reason: `Access to table '${table}' is restricted` };
    }
  }
  return { allowed: true };
}

/**
 * Ensure SQL has a LIMIT clause, inject or cap it if needed.
 */
export function ensureLimit(sql: string, maxLimit: number = 10000): string {
  const stripped = sql.replace(/;+\s*$/, "").trim();
  const limitMatch = stripped.match(/\bLIMIT\s+(\d+)\s*$/i);
  if (limitMatch) {
    const existing = parseInt(limitMatch[1], 10);
    if (existing > maxLimit) {
      return stripped.replace(/\bLIMIT\s+\d+\s*$/i, `LIMIT ${maxLimit}`);
    }
    return stripped;
  }
  return `${stripped} LIMIT ${maxLimit}`;
}

/**
 * Validate SQL length.
 */
export function validateLength(sql: string, maxBytes: number = 10240): ClassificationResult {
  const byteLength = Buffer.byteLength(sql, "utf-8");
  if (byteLength > maxBytes) {
    return { allowed: false, reason: `Query exceeds maximum length of ${maxBytes} bytes (got ${byteLength})` };
  }
  return { allowed: true };
}
