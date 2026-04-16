/**
 * Naming Template Engine — pure functions for studio file/version naming
 * conventions. Templates use `{token}` or `{token:format}` placeholders that
 * resolve against a context object at render time.
 *
 * Token names: identifier syntax, may use dot-paths for nested objects.
 *   {project}                         → ctx.project
 *   {shot.code}                       → ctx.shot.code
 *
 * Format specs:
 *   numeric pad   {n:03d}             → "007" when n = 7
 *   string pad    {label:pad:8}       → right-pad with spaces to width 8
 *                 {label:padleft:8}   → left-pad with spaces
 *   case          {name:upper}        → "BTH_010"
 *                 {name:lower}        → "bth_010"
 *                 {name:slug}         → diacritic-stripped, lowercased, hyphenated
 *   date          {date:YYYYMMDD}     → "20260416"
 *                 {date:YYYY-MM-DD}   → "2026-04-16"
 *                 {date:HHmmss}       → "143012"
 *   array join    {users:join:,}      → "alice,bob"
 *   literal {     {{                  → escapes opening brace
 *   literal }     }}                  → escapes closing brace
 *
 * Example:
 *   parseTemplate("{project}_{shot}_v{version:03d}_{date:YYYYMMDD}")
 *   renderTemplate(t, { project:"BTH", shot:"010", version:7, date:"2026-04-16" })
 *     → { rendered: "BTH_010_v007_20260416", errors: [] }
 *
 * Engine is a pure module (no I/O, no globals) — trivially unit-testable.
 * Persistence + REST live in adjacent modules.
 */

export type NamingTemplateScope =
  | "asset_filename"
  | "version_label"
  | "export_filename"
  | "shot_name";

export const NAMING_TEMPLATE_SCOPES: readonly NamingTemplateScope[] = [
  "asset_filename",
  "version_label",
  "export_filename",
  "shot_name",
];

export type TemplatePart =
  | { kind: "literal"; text: string }
  | { kind: "token"; name: string; format?: string };

export interface ParsedTemplate {
  parts: TemplatePart[];
}

export interface RenderError {
  token: string;
  message: string;
}

export interface RenderResult {
  rendered: string;
  errors: RenderError[];
}

const TOKEN_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*$/;

/**
 * Tokenize a template string into literal/token parts.
 * Forgiving: unmatched `{` is treated as literal text from that point on.
 * Use validateTemplate() to surface structural errors before save.
 */
export function parseTemplate(template: string): ParsedTemplate {
  const parts: TemplatePart[] = [];
  let buffer = "";
  let i = 0;
  while (i < template.length) {
    const c = template[i];
    const next = template[i + 1];
    if (c === "{" && next === "{") {
      buffer += "{";
      i += 2;
      continue;
    }
    if (c === "}" && next === "}") {
      buffer += "}";
      i += 2;
      continue;
    }
    if (c === "{") {
      const end = template.indexOf("}", i + 1);
      if (end === -1) {
        buffer += template.slice(i);
        i = template.length;
        continue;
      }
      if (buffer.length > 0) {
        parts.push({ kind: "literal", text: buffer });
        buffer = "";
      }
      const inside = template.slice(i + 1, end);
      const colonIdx = inside.indexOf(":");
      const name = (colonIdx === -1 ? inside : inside.slice(0, colonIdx)).trim();
      const format = colonIdx === -1 ? undefined : inside.slice(colonIdx + 1).trim();
      parts.push({ kind: "token", name, format });
      i = end + 1;
      continue;
    }
    buffer += c;
    i += 1;
  }
  if (buffer.length > 0) parts.push({ kind: "literal", text: buffer });
  return { parts };
}

export type ValidationResult = { ok: true } | { ok: false; errors: string[] };

export function validateTemplate(template: string): ValidationResult {
  const errors: string[] = [];
  if (!template || template.trim().length === 0) {
    return { ok: false, errors: ["Template must not be empty"] };
  }

  // Brace balance check (escapes count as a single literal char).
  let depth = 0;
  for (let j = 0; j < template.length; j++) {
    const c = template[j];
    const next = template[j + 1];
    if ((c === "{" && next === "{") || (c === "}" && next === "}")) {
      j += 1;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      if (depth === 0) errors.push(`Unmatched '}' at position ${j}`);
      else depth--;
    }
  }
  if (depth > 0) errors.push(`Unmatched '{' (open count ${depth})`);

  const parsed = parseTemplate(template);
  for (const p of parsed.parts) {
    if (p.kind !== "token") continue;
    if (!p.name) {
      errors.push("Empty token name");
      continue;
    }
    if (!TOKEN_NAME_RE.test(p.name)) {
      errors.push(`Invalid token name: "${p.name}"`);
    }
    if (p.format !== undefined && p.format.length === 0) {
      errors.push(`Empty format spec for token "${p.name}"`);
    }
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/**
 * Return the unique token names referenced by the template.
 * Useful for UIs that want to drive a sample-context editor.
 */
export function tokenNames(template: string): string[] {
  const seen = new Set<string>();
  for (const p of parseTemplate(template).parts) {
    if (p.kind === "token" && p.name) seen.add(p.name);
  }
  return [...seen];
}

export function renderTemplate(
  template: string,
  context: Record<string, unknown>,
): RenderResult {
  const parsed = parseTemplate(template);
  const errors: RenderError[] = [];
  let rendered = "";
  for (const p of parsed.parts) {
    if (p.kind === "literal") {
      rendered += p.text;
      continue;
    }
    const value = resolvePath(context, p.name);
    if (value === undefined) {
      errors.push({ token: p.name, message: `unknown token: ${p.name}` });
      rendered += `<${p.name}?>`;
      continue;
    }
    try {
      rendered += applyFormat(value, p.format);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push({ token: p.name, message: msg });
      rendered += `<${p.name}!>`;
    }
  }
  return { rendered, errors };
}

function resolvePath(ctx: Record<string, unknown>, path: string): unknown {
  if (!path.includes(".")) return ctx[path];
  let cur: unknown = ctx;
  for (const seg of path.split(".")) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

function applyFormat(value: unknown, format?: string): string {
  if (!format) return defaultStringify(value);

  // Numeric zero-pad: 03d, 5d, etc.
  const numericMatch = /^0?(\d+)d$/.exec(format);
  if (numericMatch) {
    const width = parseInt(numericMatch[1], 10);
    const num = toNumber(value);
    if (num === undefined) {
      throw new Error(`numeric format "${format}" requires numeric value, got ${describe(value)}`);
    }
    const sign = num < 0 ? "-" : "";
    return sign + String(Math.trunc(Math.abs(num))).padStart(width, "0");
  }

  // String pad
  const padMatch = /^pad(left)?:(\d+)$/.exec(format);
  if (padMatch) {
    const left = padMatch[1] === "left";
    const width = parseInt(padMatch[2], 10);
    const s = defaultStringify(value);
    return left ? s.padStart(width, " ") : s.padEnd(width, " ");
  }

  // Date format detection: format string contains at least one date token
  if (/YYYY|YY|MM|DD|HH|mm|ss/.test(format)) {
    const d = toDate(value);
    if (!d) {
      throw new Error(`date format "${format}" requires Date/ISO string, got ${describe(value)}`);
    }
    return formatDate(d, format);
  }

  // Case helpers
  if (format === "upper") return defaultStringify(value).toUpperCase();
  if (format === "lower") return defaultStringify(value).toLowerCase();
  if (format === "slug") return slugify(defaultStringify(value));

  // Array join
  const joinMatch = /^join:(.*)$/s.exec(format);
  if (joinMatch) {
    if (!Array.isArray(value)) {
      throw new Error(`join format requires array, got ${describe(value)}`);
    }
    return value.map((v) => defaultStringify(v)).join(joinMatch[1]);
  }

  throw new Error(`unknown format spec: "${format}"`);
}

function defaultStringify(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString();
  return JSON.stringify(v);
}

function toNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const s = v.trim();
    if (s === "") return undefined;
    const n = Number(s);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function toDate(v: unknown): Date | undefined {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? undefined : v;
  if (typeof v === "string") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  if (typeof v === "number" && Number.isFinite(v)) return new Date(v);
  return undefined;
}

function formatDate(d: Date, fmt: string): string {
  const yyyy = d.getUTCFullYear();
  const mm = d.getUTCMonth() + 1;
  const dd = d.getUTCDate();
  const hh = d.getUTCHours();
  const mi = d.getUTCMinutes();
  const ss = d.getUTCSeconds();
  return fmt.replace(/YYYY|YY|MM|DD|HH|mm|ss/g, (tok) => {
    switch (tok) {
      case "YYYY": return String(yyyy).padStart(4, "0");
      case "YY":   return String(yyyy % 100).padStart(2, "0");
      case "MM":   return String(mm).padStart(2, "0");
      case "DD":   return String(dd).padStart(2, "0");
      case "HH":   return String(hh).padStart(2, "0");
      case "mm":   return String(mi).padStart(2, "0");
      case "ss":   return String(ss).padStart(2, "0");
      default:     return tok;
    }
  });
}

function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function describe(v: unknown): string {
  const t = typeof v;
  if (v === null) return "null";
  if (Array.isArray(v)) return `array(${v.length})`;
  return `${t}(${String(v).slice(0, 40)})`;
}
