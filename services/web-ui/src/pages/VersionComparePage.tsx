import { useEffect, useState } from "react";

import { fetchApprovalQueue } from "../api";
import type { AssetRow } from "../api";
import { Card } from "../design-system";
import { PermissionGate } from "../components/PermissionGate";
import { VersionCompareViewer } from "../components/VersionCompareViewer";

function VersionCompareContent() {
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void fetchApprovalQueue("created_at", "desc", 1, 50).then(({ assets: data }) => {
      setAssets(data);
      setLoading(false);
    });
  }, []);

  const versions = assets
    .filter((a) => a.proxy?.uri || a.sourceUri?.startsWith("http") || a.sourceUri?.startsWith("/"))
    .map((a) => ({
      id: a.id,
      label: a.version?.version_label ?? a.title,
      src: a.proxy?.uri ?? a.sourceUri,
    }));

  return (
    <section aria-label="Version compare" className="p-6 max-w-6xl mx-auto">
      <h1 className="text-xl font-semibold mb-4">Version Compare</h1>
      <p className="text-sm text-[var(--color-ah-text-muted)] mb-4">
        Compare versions side-by-side using flip, wipe, or overlay modes.
      </p>

      {loading ? (
        <p className="text-sm text-[var(--color-ah-text-muted)]">Loading versions...</p>
      ) : versions.length < 2 ? (
        <Card>
          <p className="text-sm text-[var(--color-ah-text-muted)] py-8 text-center">
            At least two versions are required for comparison.
          </p>
        </Card>
      ) : (
        <VersionCompareViewer versions={versions} />
      )}
    </section>
  );
}

export function VersionComparePage() {
  return (
    <PermissionGate
      permission="approval:approve"
      fallback={
        <section aria-label="Version compare" className="p-6 max-w-5xl mx-auto">
          <Card>
            <p className="text-sm text-[var(--color-ah-text-muted)] py-8 text-center">
              You do not have permission to access version comparison.
            </p>
          </Card>
        </section>
      }
    >
      <VersionCompareContent />
    </PermissionGate>
  );
}
