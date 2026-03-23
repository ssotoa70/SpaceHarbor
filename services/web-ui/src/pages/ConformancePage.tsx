import { useEffect, useState } from "react";

import { fetchTimelines } from "../api";
import type { TimelineData } from "../api";
import { Badge, Card } from "../design-system";

interface ConformSummary {
  timelineId: string;
  timelineName: string;
  totalClips: number;
  matched: number;
  unmatched: number;
  conflicts: number;
}

export function ConformancePage() {
  const [summaries, setSummaries] = useState<ConformSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void fetchTimelines().then((timelines) => {
      const results: ConformSummary[] = timelines.map((tl: TimelineData) => {
        const allClips = tl.tracks.flatMap((t) => t.clips);
        return {
          timelineId: tl.id,
          timelineName: tl.name,
          totalClips: allClips.length,
          matched: allClips.filter((c) => c.conformStatus === "matched").length,
          unmatched: allClips.filter((c) => c.conformStatus === "unmatched").length,
          conflicts: allClips.filter((c) => c.conformStatus === "conflict").length,
        };
      });
      setSummaries(results);
      setLoading(false);
    });
  }, []);

  const totalClips = summaries.reduce((s, r) => s + r.totalClips, 0);
  const totalMatched = summaries.reduce((s, r) => s + r.matched, 0);
  const totalUnmatched = summaries.reduce((s, r) => s + r.unmatched, 0);
  const totalConflicts = summaries.reduce((s, r) => s + r.conflicts, 0);

  return (
    <section aria-label="Conformance" className="p-6 max-w-6xl mx-auto">
      <h1 className="text-xl font-semibold mb-4">Conformance</h1>
      <p className="text-sm text-[var(--color-ah-text-muted)] mb-4">
        OTIO timeline conform status across all editorial timelines.
      </p>

      {/* Summary */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <Card className="p-4 text-center">
          <p className="text-2xl font-bold">{totalClips}</p>
          <p className="text-xs text-[var(--color-ah-text-muted)]">Total Clips</p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-2xl font-bold text-[var(--color-ah-success)]">{totalMatched}</p>
          <p className="text-xs text-[var(--color-ah-text-muted)]">Matched</p>
        </Card>
        <Card className="p-4 text-center">
          <p className={`text-2xl font-bold ${totalUnmatched > 0 ? "text-[var(--color-ah-warning)]" : ""}`}>
            {totalUnmatched}
          </p>
          <p className="text-xs text-[var(--color-ah-text-muted)]">Unmatched</p>
        </Card>
        <Card className="p-4 text-center">
          <p className={`text-2xl font-bold ${totalConflicts > 0 ? "text-[var(--color-ah-danger)]" : ""}`}>
            {totalConflicts}
          </p>
          <p className="text-xs text-[var(--color-ah-text-muted)]">Conflicts</p>
        </Card>
      </div>

      {loading ? (
        <p className="text-sm text-[var(--color-ah-text-muted)]">Loading conformance data...</p>
      ) : summaries.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--color-ah-text-muted)] py-8 text-center">
            No timelines found.
          </p>
        </Card>
      ) : (
        <div className="grid gap-1">
          <div className="grid grid-cols-[1fr_80px_80px_80px_80px] gap-4 px-4 py-2 text-xs font-medium text-[var(--color-ah-text-muted)] uppercase tracking-wide">
            <span>Timeline</span>
            <span>Clips</span>
            <span>Matched</span>
            <span>Unmatched</span>
            <span>Conflicts</span>
          </div>
          {summaries.map((s) => (
            <Card key={s.timelineId} className="grid grid-cols-[1fr_80px_80px_80px_80px] gap-4 items-center px-4 py-3">
              <span className="text-sm font-medium truncate">{s.timelineName}</span>
              <span className="text-xs">{s.totalClips}</span>
              <Badge variant="success">{s.matched}</Badge>
              <Badge variant={s.unmatched > 0 ? "warning" : "default"}>{s.unmatched}</Badge>
              <Badge variant={s.conflicts > 0 ? "danger" : "default"}>{s.conflicts}</Badge>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
