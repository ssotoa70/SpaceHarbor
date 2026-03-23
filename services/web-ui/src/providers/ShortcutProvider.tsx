import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

export interface Shortcut {
  key: string;
  modifier?: "ctrl" | "meta" | "shift";
  action: () => void;
  description: string;
}

interface ShortcutContextValue {
  register: (id: string, shortcut: Shortcut) => void;
  unregister: (id: string) => void;
  shortcuts: Map<string, Shortcut>;
}

const ShortcutContext = createContext<ShortcutContextValue | null>(null);

export function useShortcutContext() {
  const ctx = useContext(ShortcutContext);
  if (!ctx) throw new Error("useShortcutContext must be used within ShortcutProvider");
  return ctx;
}

export function useRegisterShortcut(id: string, shortcut: Shortcut) {
  const { register, unregister } = useShortcutContext();
  const shortcutRef = useRef(shortcut);
  shortcutRef.current = shortcut;

  useEffect(() => {
    register(id, shortcutRef.current);
    return () => unregister(id);
  }, [id, register, unregister]);
}

function matchesShortcut(e: KeyboardEvent, s: Shortcut): boolean {
  if (s.modifier === "ctrl" && !e.ctrlKey) return false;
  if (s.modifier === "meta" && !e.metaKey) return false;
  if (s.modifier === "shift" && !e.shiftKey) return false;
  return e.key.toLowerCase() === s.key.toLowerCase();
}

function isInputFocused(): boolean {
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if ((document.activeElement as HTMLElement)?.isContentEditable) return true;
  return false;
}

export function ShortcutProvider({ children }: { children: ReactNode }) {
  const shortcutsRef = useRef(new Map<string, Shortcut>());
  const [, forceUpdate] = useState(0);

  const register = useCallback((id: string, shortcut: Shortcut) => {
    shortcutsRef.current.set(id, shortcut);
    forceUpdate((n) => n + 1);
  }, []);

  const unregister = useCallback((id: string) => {
    shortcutsRef.current.delete(id);
    forceUpdate((n) => n + 1);
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Allow shortcuts with modifiers even when input is focused
      if (isInputFocused() && !e.ctrlKey && !e.metaKey) return;

      for (const shortcut of shortcutsRef.current.values()) {
        if (matchesShortcut(e, shortcut)) {
          e.preventDefault();
          shortcut.action();
          return;
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <ShortcutContext.Provider value={{ register, unregister, shortcuts: shortcutsRef.current }}>
      {children}
    </ShortcutContext.Provider>
  );
}

export function ShortcutHelpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { shortcuts } = useShortcutContext();

  if (!open) return null;

  const entries = Array.from(shortcuts.entries());

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      role="dialog"
      aria-label="Keyboard shortcuts"
      onClick={onClose}
    >
      <div
        className="max-w-md w-full mx-4 bg-[var(--color-ah-bg-raised)] rounded-[var(--radius-ah-lg)] p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold mb-4">Keyboard Shortcuts</h2>
        <dl className="space-y-2">
          {entries.map(([id, s]) => (
            <div key={id} className="flex justify-between items-center">
              <dt className="text-sm text-[var(--color-ah-text-muted)]">{s.description}</dt>
              <dd className="font-mono text-xs bg-[var(--color-ah-bg)] px-2 py-1 rounded border border-[var(--color-ah-border)]">
                {s.modifier ? `${s.modifier}+` : ""}{s.key.toUpperCase()}
              </dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-[var(--color-ah-text-subtle)] mt-4">Press ? to toggle this dialog</p>
      </div>
    </div>
  );
}
