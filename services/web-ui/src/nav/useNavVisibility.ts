import { useMemo } from "react";
import { useAuth } from "../contexts/AuthContext";
import { NAV_SECTIONS, NAV_ITEMS } from "./registry";
import type { NavItemDef, SectionDef } from "./types";

export interface NavVisibility {
  /** Sections the current user can see. */
  visibleSections: SectionDef[];
  /** Items grouped by section id, filtered by permission. */
  itemsBySection: Record<string, NavItemDef[]>;
}

/**
 * Filters nav sections and items based on the current user's permissions.
 * Sections with no visible items are excluded even if the section itself is permitted.
 */
export function useNavVisibility(): NavVisibility {
  const { permissions } = useAuth();

  return useMemo(() => {
    const permSet = new Set(permissions);

    const hasPermission = (perm?: string): boolean => {
      if (!perm) return true;
      return permSet.has(perm);
    };

    // Filter items first
    const itemsBySection: Record<string, NavItemDef[]> = {};
    for (const item of NAV_ITEMS) {
      if (!hasPermission(item.permission)) continue;
      if (!itemsBySection[item.section]) {
        itemsBySection[item.section] = [];
      }
      itemsBySection[item.section].push(item);
    }

    // Filter sections: must be permitted AND have at least one visible item
    const visibleSections = NAV_SECTIONS.filter(
      (s) => hasPermission(s.permission) && (itemsBySection[s.id]?.length ?? 0) > 0
    );

    return { visibleSections, itemsBySection };
  }, [permissions]);
}
