// ---------------------------------------------------------------------------
// SettingsStore — file-backed key-value store for platform configuration.
//
// Provides persistent storage for settings that are NOT sourced from env vars
// (e.g., S3 endpoints, LDAP config, IAM runtime overrides). Persists to a JSON
// file on disk and loads into memory on construction for fast reads.
//
// Secrets on disk: The settings file may contain sensitive values (LDAP bind
// passwords, S3 secret keys). Protect the data directory with filesystem
// permissions (0700). Secrets are NEVER returned in GET responses — the route
// layer is responsible for stripping them.
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface SettingsStore {
  get(namespace: string): Record<string, unknown> | null;
  set(namespace: string, value: Record<string, unknown>): void;
  delete(namespace: string): void;
  listNamespaces(): string[];
}

export class FileSettingsStore implements SettingsStore {
  private data: Map<string, Record<string, unknown>>;
  private readonly filePath: string;

  constructor(filePath?: string) {
    this.filePath = resolve(filePath ?? "./data/settings.json");
    this.data = new Map();
    this.load();
  }

  get(namespace: string): Record<string, unknown> | null {
    return this.data.get(namespace) ?? null;
  }

  set(namespace: string, value: Record<string, unknown>): void {
    this.data.set(namespace, value);
    this.persist();
  }

  delete(namespace: string): void {
    this.data.delete(namespace);
    this.persist();
  }

  listNamespaces(): string[] {
    return [...this.data.keys()];
  }

  private load(): void {
    try {
      if (!existsSync(this.filePath)) return;
      const raw = readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [key, value] of Object.entries(parsed)) {
          if (value && typeof value === "object" && !Array.isArray(value)) {
            this.data.set(key, value as Record<string, unknown>);
          }
        }
      }
    } catch {
      // Corrupted or missing file — start empty (safe fallback).
    }
  }

  private persist(): void {
    const dir = dirname(this.filePath);
    mkdirSync(dir, { recursive: true });

    const obj: Record<string, unknown> = {};
    for (const [key, value] of this.data) {
      obj[key] = value;
    }

    // Atomic write: write to tmp, rename into place.
    const tmpPath = this.filePath + ".tmp";
    writeFileSync(tmpPath, JSON.stringify(obj, null, 2), "utf-8");
    renameSync(tmpPath, this.filePath);
  }
}
