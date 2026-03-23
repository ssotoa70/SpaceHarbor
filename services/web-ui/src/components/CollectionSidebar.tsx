import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { CollectionData } from "../api";

/* ── SVG icons ── */

function FolderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 4h4l2 2h6v7H2z" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 150ms" }}
    >
      <path d="M6 4l4 4-4 4" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 3h9M5 8h9M5 13h9M2 3h0M2 8h0M2 13h0" />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2l1.8 3.7L14 6.3l-3 2.9.7 4.1L8 11.4l-3.7 1.9.7-4.1-3-2.9 4.2-.6z" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4v4l3 2" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="5" r="3" />
      <path d="M3 14c0-2.8 2.2-5 5-5s5 2.2 5 5" />
    </svg>
  );
}

/* ── Smart collection definitions ── */

interface SmartCollection {
  label: string;
  icon: React.ReactNode;
  queryParams: string;
}

const SMART_COLLECTIONS: SmartCollection[] = [
  { label: "Needs Review", icon: <ListIcon />, queryParams: "/?status=qc_pending&sort=date" },
  { label: "Approved", icon: <StarIcon />, queryParams: "/?status=qc_approved" },
  { label: "Recently Updated", icon: <ClockIcon />, queryParams: "/?sort=date&dir=desc" },
  { label: "My Assignments", icon: <UserIcon />, queryParams: "/?assignee=me" },
];

/* ── Collection type badge colors ── */

function typeColor(type: CollectionData["collectionType"]): string {
  switch (type) {
    case "playlist": return "var(--color-ah-accent)";
    case "selection": return "var(--color-ah-purple)";
    case "deliverable": return "var(--color-ah-orange)";
    default: return "var(--color-ah-text-muted)";
  }
}

/* ── Main component ── */

interface CollectionSidebarProps {
  collections: CollectionData[];
  onRefresh?: () => void;
}

export function CollectionSidebar({ collections, onRefresh }: CollectionSidebarProps) {
  const navigate = useNavigate();
  const [smartOpen, setSmartOpen] = useState(true);
  const [userOpen, setUserOpen] = useState(true);

  return (
    <div className="flex flex-col gap-1 py-2">
      {/* ── Smart Collections ── */}
      <button
        type="button"
        onClick={() => setSmartOpen((o) => !o)}
        className="flex items-center gap-1.5 px-3 py-1 text-[10px] font-medium tracking-[0.12em] text-[var(--color-ah-text-subtle)] font-[var(--font-ah-mono)] uppercase hover:text-[var(--color-ah-text-muted)] transition-colors w-full text-left"
      >
        <ChevronIcon open={smartOpen} />
        Smart Collections
      </button>
      {smartOpen && (
        <ul className="space-y-0.5">
          {SMART_COLLECTIONS.map((sc) => (
            <li key={sc.label}>
              <button
                type="button"
                onClick={() => navigate(sc.queryParams)}
                className="flex items-center gap-2 mx-2 px-3 py-1.5 rounded-[var(--radius-ah-sm)] text-sm text-[var(--color-ah-text-muted)] hover:text-[var(--color-ah-text)] hover:bg-[var(--color-ah-bg-overlay)] transition-colors w-full text-left"
              >
                {sc.icon}
                {sc.label}
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* ── User Collections ── */}
      <button
        type="button"
        onClick={() => setUserOpen((o) => !o)}
        className="flex items-center gap-1.5 px-3 py-1 mt-2 text-[10px] font-medium tracking-[0.12em] text-[var(--color-ah-text-subtle)] font-[var(--font-ah-mono)] uppercase hover:text-[var(--color-ah-text-muted)] transition-colors w-full text-left"
      >
        <ChevronIcon open={userOpen} />
        Collections
      </button>
      {userOpen && (
        <ul className="space-y-0.5">
          {collections.length === 0 && (
            <li className="mx-2 px-3 py-1.5 text-xs text-[var(--color-ah-text-subtle)] italic">
              No collections yet
            </li>
          )}
          {collections.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => navigate(`/?collection=${c.id}`)}
                className="flex items-center gap-2 mx-2 px-3 py-1.5 rounded-[var(--radius-ah-sm)] text-sm text-[var(--color-ah-text-muted)] hover:text-[var(--color-ah-text)] hover:bg-[var(--color-ah-bg-overlay)] transition-colors w-full text-left group"
              >
                <FolderIcon />
                <span className="truncate flex-1">{c.name}</span>
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: typeColor(c.collectionType) }}
                  title={c.collectionType}
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
