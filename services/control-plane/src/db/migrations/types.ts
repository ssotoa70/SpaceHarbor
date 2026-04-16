/**
 * Shared migration type used by migrations and the installer.
 *
 * `downStatements` (optional) is the reverse of `statements` and is
 * executed by `installer.ts rollback <version>` in LIFO order. Safe
 * defaults for each migration:
 *
 *   - CREATE TABLE statement → add matching DROP TABLE to downStatements
 *   - ALTER TABLE ADD COLUMN → VAST does not support DROP COLUMN; leave
 *     column in place and document
 *   - INSERT into schema_version → add DELETE schema_version WHERE version=X
 *
 * When downStatements is undefined, rollback for that migration is
 * unsupported and installer will abort rather than leave the schema in
 * an unknown state.
 */
export interface Migration {
  version: number;
  description: string;
  statements: string[];
  downStatements?: string[];
}
