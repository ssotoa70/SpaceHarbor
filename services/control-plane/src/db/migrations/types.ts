/**
 * Shared migration type used by migrations and the installer.
 */
export interface Migration {
  version: number;
  description: string;
  statements: string[];
}
