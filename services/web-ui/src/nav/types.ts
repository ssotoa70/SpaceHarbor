/** Navigation item definition for the registry. */
export interface NavItemDef {
  /** Unique identifier for this nav item. */
  id: string;
  /** Route path (e.g. "/library/assets"). */
  to: string;
  /** Display label. */
  label: string;
  /** Section this item belongs to (references SectionDef.id). */
  section: string;
  /** SVG path data for the 16x16 icon. */
  icon: string;
  /** Permission string required to see this item. If omitted, visible to all authenticated users. */
  permission?: string;
  /** Key for live badge count (matched against badge endpoint response). */
  badgeKey?: string;
  /** If true, use `end` matching on NavLink (exact path match). */
  exact?: boolean;
}

/** Navigation section definition. */
export interface SectionDef {
  /** Unique identifier (e.g. "LIBRARY", "WORK"). */
  id: string;
  /** Display label shown in the sidebar. */
  label: string;
  /** Permission required to see this entire section. If omitted, visible to all authenticated users. */
  permission?: string;
  /** If true, this section starts collapsed. */
  collapsedByDefault?: boolean;
}
