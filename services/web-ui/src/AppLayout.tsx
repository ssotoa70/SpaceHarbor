import { useCallback, useState, useEffect, useRef } from "react";
import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";

import { ConnectionIndicator } from "./hooks/ConnectionIndicator";
import { useEventStream } from "./hooks/useEventStream";
import { ShortcutProvider, ShortcutHelpModal, useRegisterShortcut } from "./providers/ShortcutProvider";
import { useAuth } from "./contexts/AuthContext";
import { useNavVisibility } from "./nav/useNavVisibility";
import { useSectionCollapse } from "./nav/useSectionCollapse";
import { useBadgeCounts } from "./nav/useBadgeCounts";
import { NAV_SECTIONS } from "./nav/registry";

function NavIcon({ d }: { d: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

function GlobalShortcuts({ onToggleHelp }: { onToggleHelp: () => void }) {
  const navigate = useNavigate();

  useRegisterShortcut("focus-search", {
    key: "a",
    description: "Focus Asset Browser search",
    action: () => {
      navigate("/library/assets");
      setTimeout(() => {
        const el = document.querySelector<HTMLInputElement>('[label="Search"], input[placeholder*="Filter"]');
        el?.focus();
      }, 100);
    },
  });

  useRegisterShortcut("open-review", {
    key: "r",
    description: "Open Review queue",
    action: () => navigate("/review/approvals"),
  });

  useRegisterShortcut("escape-close", {
    key: "Escape",
    description: "Close open dialogs",
    action: () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    },
  });

  useRegisterShortcut("shortcut-help", {
    key: "?",
    modifier: "shift",
    description: "Show keyboard shortcuts",
    action: onToggleHelp,
  });

  useRegisterShortcut("nav-hierarchy", {
    key: "h",
    description: "Open Hierarchy browser",
    action: () => navigate("/library/hierarchy"),
  });

  useRegisterShortcut("nav-timeline", {
    key: "t",
    description: "Open Timeline view",
    action: () => navigate("/production/timeline"),
  });

  useRegisterShortcut("section-library", {
    key: "1",
    description: "Jump to Library",
    action: () => navigate("/library/assets"),
  });

  useRegisterShortcut("section-work", {
    key: "2",
    description: "Jump to Work",
    action: () => navigate("/work/queue"),
  });

  useRegisterShortcut("section-review", {
    key: "3",
    description: "Jump to Review",
    action: () => navigate("/review/approvals"),
  });

  useRegisterShortcut("section-production", {
    key: "4",
    description: "Jump to Production",
    action: () => navigate("/production/shots"),
  });

  useRegisterShortcut("section-pipeline", {
    key: "5",
    description: "Jump to Pipeline",
    action: () => navigate("/pipeline/monitor"),
  });

  useRegisterShortcut("section-admin", {
    key: "6",
    description: "Jump to Admin",
    action: () => navigate("/admin/analytics"),
  });

  return null;
}

function LogoGlyph() {
  /* Crystal anchor from spaceharbor-navy.svg, cropped to icon region */
  return (
    <svg width="30" height="30" viewBox="28 26 104 88" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="lgFacetTop" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#67e8f9" />
          <stop offset="50%" stopColor="#22d3ee" />
          <stop offset="100%" stopColor="#0891b2" />
        </linearGradient>
        <linearGradient id="lgFacetShaft" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#0e7490" />
          <stop offset="50%" stopColor="#06b6d4" />
          <stop offset="100%" stopColor="#0e7490" />
        </linearGradient>
        <linearGradient id="lgFacetArm" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#0891b2" />
          <stop offset="100%" stopColor="#155e75" />
        </linearGradient>
        <linearGradient id="lgGoldAccent" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#0ea5e9" />
        </linearGradient>
        <linearGradient id="lgOrbitGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.05" />
          <stop offset="40%" stopColor="#67e8f9" stopOpacity="0.7" />
          <stop offset="60%" stopColor="#38bdf8" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.05" />
        </linearGradient>
      </defs>
      {/* Back orbital ring */}
      <ellipse cx="80" cy="80" rx="48" ry="14" fill="none" stroke="url(#lgOrbitGrad)" strokeWidth="1.2" opacity="0.8" />
      {/* Top ring */}
      <polygon points="80,32 86,35.5 86,41 80,44.5 74,41 74,35.5" fill="url(#lgFacetTop)" opacity="0.9" />
      <polygon points="80,36 83,37.8 83,40.2 80,42 77,40.2 77,37.8" fill="#020b18" />
      <line x1="80" y1="32" x2="86" y2="35.5" stroke="#a5f3fc" strokeWidth="0.8" opacity="0.9" />
      <polygon points="80,30 88,34 88,42 80,46 72,42 72,34" fill="none" stroke="#0891b2" strokeWidth="0.8" opacity="0.4" />
      {/* Shaft */}
      <polygon points="77,44 83,44 83,88 77,88" fill="url(#lgFacetShaft)" />
      <polygon points="75,45.5 77,44 77,88 75,89.5" fill="#164e63" opacity="0.9" />
      <polygon points="83,44 85,45.5 85,89.5 83,88" fill="#22d3ee" opacity="0.5" />
      {/* Crossbar */}
      <polygon points="55,62 77,62 77,68 55,68" fill="url(#lgFacetArm)" />
      <polygon points="55,68 77,68 77,70 55,70" fill="#164e63" />
      <polygon points="52,65 57,62 57,68 52,65" fill="#0891b2" />
      <polygon points="83,62 105,62 105,68 83,68" fill="url(#lgFacetArm)" />
      <polygon points="83,68 105,68 105,70 83,70" fill="#164e63" />
      <polygon points="108,65 103,62 103,68 108,65" fill="#0e7490" />
      {/* Bottom flukes */}
      <polygon points="77,88 80,98 62,106 60,94" fill="#0891b2" />
      <polygon points="77,88 80,98 62,106" fill="#22d3ee" opacity="0.6" />
      <polygon points="83,88 80,98 98,106 100,94" fill="#0e7490" />
      <polygon points="83,88 80,98 98,106" fill="#38bdf8" opacity="0.6" />
      {/* Bottom tip */}
      <polygon points="77,88 83,88 80,100" fill="url(#lgGoldAccent)" />
      {/* Accent dots */}
      <circle cx="52" cy="65" r="2.5" fill="#38bdf8" />
      <circle cx="108" cy="65" r="2.5" fill="#38bdf8" />
      <circle cx="62" cy="106" r="2" fill="#67e8f9" opacity="0.8" />
      <circle cx="98" cy="106" r="2" fill="#67e8f9" opacity="0.8" />
      {/* Front orbital ring */}
      <path d="M 48 87 A 48 14 0 0 0 112 87" fill="none" stroke="url(#lgOrbitGrad)" strokeWidth="1.2" opacity="0.8" />
    </svg>
  );
}

function Breadcrumb() {
  const location = useLocation();
  const segments = location.pathname.split("/").filter(Boolean);
  const current = segments.length === 0 ? "Assets" : segments[segments.length - 1];

  return (
    <div className="flex items-center gap-1.5 font-[var(--font-ah-mono)] text-xs text-[var(--color-ah-text-subtle)]">
      <span>app</span>
      {segments.map((seg, i) => (
        <span key={i}>
          <span className="text-[var(--color-ah-border)]">/</span>
          <span className={i === segments.length - 1 ? "text-[var(--color-ah-accent)]" : ""}>
            {seg}
          </span>
        </span>
      ))}
      {segments.length === 0 && (
        <>
          <span className="text-[var(--color-ah-border)]">/</span>
          <span className="text-[var(--color-ah-accent)]">{current}</span>
        </>
      )}
    </div>
  );
}

/* ── UserMenu ── */

function UserMenu() {
  const { user, authMode, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const initials = user
    ? user.displayName
        .split(" ")
        .map((w) => w[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : "??";

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const menuItem = "block w-full text-left px-3 py-1.5 text-sm text-[var(--color-ah-text-muted)] hover:text-[var(--color-ah-text)] hover:bg-[var(--color-ah-bg-overlay)] transition-colors";

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 cursor-pointer"
        aria-label="User menu"
        data-testid="user-menu-trigger"
      >
        <span className="text-xs text-[var(--color-ah-text-muted)] hidden sm:inline">
          {user?.displayName ?? "User"}
        </span>
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold tracking-wider"
          style={{ background: "linear-gradient(135deg, var(--color-ah-accent-muted), var(--color-ah-accent))" }}
          aria-label="User avatar"
        >
          {initials}
        </div>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-48 rounded-[var(--radius-ah-md)] bg-[var(--color-ah-bg-raised)] border border-[var(--color-ah-border-muted)] shadow-lg z-50 py-1" data-testid="user-menu-dropdown">
          <div className="px-3 py-2 border-b border-[var(--color-ah-border-muted)]">
            <p className="text-sm font-medium truncate">{user?.displayName}</p>
            <p className="text-xs text-[var(--color-ah-text-subtle)] truncate">{user?.email}</p>
          </div>
          <button className={menuItem} onClick={() => { setOpen(false); }}>
            My Profile
          </button>
          <button className={menuItem} onClick={() => { setOpen(false); navigate("/api-keys"); }}>
            API Keys
          </button>
          {/* Change Password: removed — no password change API implemented yet */}
          <div className="border-t border-[var(--color-ah-border-muted)] mt-1 pt-1">
            <button
              className={`${menuItem} text-[var(--color-ah-danger)]`}
              onClick={() => { setOpen(false); logout(); navigate("/login"); }}
              data-testid="sign-out-button"
            >
              Sign Out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Chevron for section collapse ── */

function SectionChevron({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`transition-transform duration-150 ${collapsed ? "-rotate-90" : ""}`}
    >
      <path d="M3 3.5l2 2 2-2" />
    </svg>
  );
}

export function AppLayout() {
  const [helpOpen, setHelpOpen] = useState(false);
  const onEvent = useCallback(() => {
    // SSE events handled by individual pages via their own subscriptions
  }, []);
  const { status: sseStatus } = useEventStream({
    url: "/api/v1/events/stream",
    onEvent,
  });

  const { visibleSections, itemsBySection } = useNavVisibility();
  const { isCollapsed, toggle } = useSectionCollapse(NAV_SECTIONS);
  const badgeCounts = useBadgeCounts();

  return (
    <ShortcutProvider>
      <GlobalShortcuts onToggleHelp={() => setHelpOpen((o) => !o)} />
      <ShortcutHelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />

      <div className="min-h-screen bg-[var(--color-ah-bg)] text-[var(--color-ah-text)]">
        {/* ── Topbar ── */}
        <header className="flex items-center justify-between px-5 h-12 border-b border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg-raised)]">
          <div className="flex items-center gap-2.5">
            <LogoGlyph />
            <span className="font-[var(--font-ah-display)] text-base tracking-tight">
              <span className="font-light text-[var(--color-ah-text)]">Space</span>
              <span className="font-bold bg-gradient-to-r from-[var(--color-ah-accent)] to-[var(--color-ah-info)] bg-clip-text text-transparent">Harbor</span>
            </span>
            <span className="ml-2 pl-2 border-l border-[var(--color-ah-border-muted)] text-[10px] tracking-wide text-[var(--color-ah-text-subtle)] font-[var(--font-ah-mono)]">
              Powered by <span className="font-semibold text-[var(--color-ah-text-muted)]">VAST Data</span>
            </span>
          </div>
          <div className="flex items-center gap-3">
            <ConnectionIndicator status={sseStatus} />
            <UserMenu />
          </div>
        </header>

        <div className="flex">
          {/* ── Sidebar ── */}
          <nav className="w-[232px] shrink-0 border-r border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg-raised)] min-h-[calc(100vh-3rem)]" aria-label="Main navigation" data-testid="main-nav">

            {/* Nav sections */}
            <div className="py-3">
              {visibleSections.map((section) => {
                const items = itemsBySection[section.id] ?? [];
                const collapsed = isCollapsed(section.id);
                return (
                  <div key={section.id} className="mb-2" data-testid={`nav-section-${section.id.toLowerCase()}`}>
                    <button
                      onClick={() => toggle(section.id)}
                      className="flex items-center justify-between w-full px-5 py-1.5 text-[10px] font-medium tracking-[0.12em] text-[var(--color-ah-text-subtle)] font-[var(--font-ah-mono)] uppercase hover:text-[var(--color-ah-text-muted)] transition-colors cursor-pointer"
                      aria-expanded={!collapsed}
                      data-testid={`nav-section-toggle-${section.id.toLowerCase()}`}
                    >
                      {section.label}
                      <SectionChevron collapsed={collapsed} />
                    </button>
                    {!collapsed && (
                      <ul className="space-y-0.5">
                        {items.map((item) => (
                          <li key={item.id}>
                            <NavLink
                              to={item.to}
                              end={item.exact}
                              className={({ isActive }) =>
                                `flex items-center gap-2.5 mx-2 px-3 py-1.5 rounded-[var(--radius-ah-sm)] text-sm transition-colors ${
                                  isActive
                                    ? "text-[var(--color-ah-accent)] bg-[var(--color-ah-accent)]/8 border-l-2 border-[var(--color-ah-accent)] pl-[10px] font-medium"
                                    : "text-[var(--color-ah-text-muted)] hover:text-[var(--color-ah-text)] hover:bg-[var(--color-ah-bg-overlay)] border-l-2 border-transparent pl-[10px]"
                                }`
                              }
                              data-testid={`nav-item-${item.id}`}
                            >
                              <NavIcon d={item.icon} />
                              <span className="flex-1">{item.label}</span>
                              {item.badgeKey && (badgeCounts as Record<string, number>)[item.badgeKey] > 0 && (
                                <span
                                  className={`ml-auto text-[10px] font-medium px-1.5 py-0.5 rounded-full min-w-[18px] text-center ${
                                    item.badgeKey === "dlq"
                                      ? "bg-[var(--color-ah-warning)]/20 text-[var(--color-ah-warning)]"
                                      : "bg-[var(--color-ah-accent)]/15 text-[var(--color-ah-accent)]"
                                  }`}
                                  data-testid={`nav-badge-${item.badgeKey}`}
                                >
                                  {(badgeCounts as Record<string, number>)[item.badgeKey]}
                                </span>
                              )}
                            </NavLink>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>

          </nav>

          {/* ── Main content ── */}
          <main className="flex-1 p-6 overflow-auto ah-grid-bg">
            <Outlet />
          </main>
        </div>
      </div>
    </ShortcutProvider>
  );
}
