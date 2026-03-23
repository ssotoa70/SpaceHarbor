import { useCallback, useState } from "react";
import type { SectionDef } from "./types";

const STORAGE_KEY = "ah_nav_collapse";

function loadCollapsed(sections: readonly SectionDef[]): Record<string, boolean> {
  const defaults: Record<string, boolean> = {};
  for (const s of sections) {
    defaults[s.id] = s.collapsedByDefault ?? false;
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Record<string, boolean>;
      return { ...defaults, ...parsed };
    }
  } catch {
    // ignore corrupt localStorage
  }
  return defaults;
}

/**
 * Manages section collapse state with localStorage persistence.
 */
export function useSectionCollapse(sections: readonly SectionDef[]) {
  const [collapsed, setCollapsed] = useState(() => loadCollapsed(sections));

  const toggle = useCallback((sectionId: string) => {
    setCollapsed((prev) => {
      const next = { ...prev, [sectionId]: !prev[sectionId] };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // quota exceeded — silently ignore
      }
      return next;
    });
  }, []);

  const isCollapsed = useCallback(
    (sectionId: string): boolean => collapsed[sectionId] ?? false,
    [collapsed],
  );

  return { isCollapsed, toggle };
}
