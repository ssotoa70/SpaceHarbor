import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

export interface BreadcrumbSegment {
  label: string;
  href?: string;
}

interface BreadcrumbContextValue {
  segments: BreadcrumbSegment[];
  setSegments: (segments: BreadcrumbSegment[]) => void;
  push: (segment: BreadcrumbSegment) => void;
  reset: () => void;
}

const defaultSegments: BreadcrumbSegment[] = [{ label: "SpaceHarbor" }];

const BreadcrumbCtx = createContext<BreadcrumbContextValue>({
  segments: defaultSegments,
  setSegments: () => {},
  push: () => {},
  reset: () => {},
});

export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [segments, setSegments] = useState<BreadcrumbSegment[]>(defaultSegments);

  const push = useCallback((segment: BreadcrumbSegment) => {
    setSegments((prev) => [...prev, segment]);
  }, []);

  const reset = useCallback(() => {
    setSegments(defaultSegments);
  }, []);

  return (
    <BreadcrumbCtx.Provider value={{ segments, setSegments, push, reset }}>
      {children}
    </BreadcrumbCtx.Provider>
  );
}

export function useBreadcrumb() {
  return useContext(BreadcrumbCtx);
}

export function Breadcrumb() {
  const { segments } = useBreadcrumb();

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm">
      {segments.map((seg, i) => (
        <span key={`${seg.label}-${i}`} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-[var(--color-ah-text-subtle)]">/</span>}
          {seg.href ? (
            <a
              href={seg.href}
              className="text-[var(--color-ah-text-muted)] hover:text-[var(--color-ah-text)] transition-colors"
            >
              {seg.label}
            </a>
          ) : (
            <span className={i === segments.length - 1 ? "text-[var(--color-ah-text)] font-medium" : "text-[var(--color-ah-text-muted)]"}>
              {seg.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}
