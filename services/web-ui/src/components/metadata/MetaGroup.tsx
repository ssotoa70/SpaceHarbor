import { Children, isValidElement, type ReactNode } from "react";

export interface MetaGroupProps {
  id: string;
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

/**
 * A collapsible metadata section that auto-hides when every child MetaRow
 * renders nothing. We do this by asking React to render children and then
 * inspecting the resulting React nodes: any child that returns `null` from
 * its render function is absent from the children array at parent level,
 * so we can't see it directly. Instead we rely on MetaRow's own null-return
 * behavior and check whether any non-null React element is present.
 *
 * The check runs on the children prop before rendering — empty groups are
 * dropped entirely, including their header, so Frame.io-style empty-section
 * hiding works without per-field plumbing.
 */
export function MetaGroup({ id, title, defaultOpen = true, children }: MetaGroupProps): ReactNode {
  const hasVisibleChild = Children.toArray(children).some((child) => {
    if (!isValidElement(child)) return false;
    // A MetaRow renders null when empty; filter those out by asking it
    // to evaluate. React's Children.toArray already drops nulls, so the
    // presence of an element here means MetaRow decided to render.
    const props = child.props as { value?: unknown };
    if ("value" in props) {
      const v = props.value;
      if (v === null || v === undefined || (typeof v === "string" && v.length === 0)) {
        return false;
      }
    }
    return true;
  });

  if (!hasVisibleChild) return null;

  return (
    <details open={defaultOpen} className="group" data-testid={`meta-group-${id}`}>
      <summary className="flex items-center gap-2 cursor-pointer py-2 px-1 text-xs font-medium text-[var(--color-ah-text-muted)] tracking-wide uppercase select-none hover:text-[var(--color-ah-text)]">
        <svg width="10" height="10" viewBox="0 0 10 10" className="shrink-0 transition-transform group-open:rotate-90" aria-hidden>
          <path d="M3 1l4 4-4 4" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
        {title}
      </summary>
      <dl className="px-1 pb-3 border-b border-[var(--color-ah-border-muted)]">
        {children}
      </dl>
    </details>
  );
}
