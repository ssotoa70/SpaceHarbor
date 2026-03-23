export interface GuidedActions {
  acknowledged: boolean;
  owner: string;
  escalated: boolean;
  updatedAt: string | null;
}

export const DEFAULT_GUIDED_ACTIONS: GuidedActions = {
  acknowledged: false,
  owner: "",
  escalated: false,
  updatedAt: null
};

const GUIDED_ACTIONS_STORAGE_KEY = "spaceharbor.operator.guided-actions.v1";

let fallbackStorageValue: string | null = null;

function getStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> | null {
  if (typeof window === "undefined") {
    return null;
  }

  if (window.localStorage && typeof window.localStorage.getItem === "function") {
    return window.localStorage;
  }

  return null;
}

function sanitizeGuidedActions(parsed: Partial<GuidedActions>): GuidedActions {
  return {
    acknowledged: parsed.acknowledged === true,
    owner: typeof parsed.owner === "string" ? parsed.owner : "",
    escalated: parsed.escalated === true,
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null
  };
}

export function loadGuidedActions(): GuidedActions {
  try {
    const storage = getStorage();
    const stored = storage ? storage.getItem(GUIDED_ACTIONS_STORAGE_KEY) : fallbackStorageValue;
    if (!stored) {
      return { ...DEFAULT_GUIDED_ACTIONS };
    }

    return sanitizeGuidedActions(JSON.parse(stored) as Partial<GuidedActions>);
  } catch {
    return { ...DEFAULT_GUIDED_ACTIONS };
  }
}

export function saveGuidedActions(actions: GuidedActions): void {
  const serialized = JSON.stringify(actions);

  try {
    const storage = getStorage();
    if (storage) {
      storage.setItem(GUIDED_ACTIONS_STORAGE_KEY, serialized);
      return;
    }
  } catch {
    // Ignore storage write failures; fallback is in-memory.
  }

  fallbackStorageValue = serialized;
}

export function clearGuidedActions(): void {
  try {
    const storage = getStorage();
    if (storage) {
      storage.removeItem(GUIDED_ACTIONS_STORAGE_KEY);
    }
  } catch {
    // Ignore storage clear failures.
  }

  fallbackStorageValue = null;
}
