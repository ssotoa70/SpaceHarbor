import { useState, useEffect } from "react";
import { fetchRbacMatrix } from "../api";
import type { RbacMatrix } from "../api";

export default function RbacMatrixPage() {
  const [matrix, setMatrix] = useState<RbacMatrix | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchRbacMatrix()
      .then(setMatrix)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, []);

  if (error) return <div className="p-6 text-red-500">{error}</div>;
  if (!matrix) return <div className="p-6 text-sm">Loading RBAC matrix...</div>;

  // Group permissions by category (prefix before colon)
  const categories = new Map<string, string[]>();
  for (const perm of matrix.permissions) {
    const cat = perm.split(":")[0] || "other";
    if (!categories.has(cat)) categories.set(cat, []);
    categories.get(cat)!.push(perm);
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <h1 className="text-xl font-bold mb-1">RBAC Permission Matrix</h1>
      <p className="text-xs text-[var(--color-ah-text-muted)] mb-4">
        Shows which permissions each role inherits. Roles are cumulative — higher roles include all lower role permissions.
      </p>

      <div className="overflow-x-auto rounded border border-[var(--color-ah-border)]">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-[var(--color-ah-bg-secondary)]">
              <th className="text-left p-2 sticky left-0 bg-[var(--color-ah-bg-secondary)] z-10 min-w-[180px]">Permission</th>
              {matrix.roles.map((role) => (
                <th key={role} className="p-2 text-center whitespace-nowrap">{role}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...categories.entries()].map(([category, perms]) => (
              <>
                <tr key={`cat-${category}`}>
                  <td colSpan={matrix.roles.length + 1} className="px-2 py-1 font-semibold bg-[var(--color-ah-bg-tertiary)] text-[var(--color-ah-text-muted)] uppercase tracking-wider text-[10px]">
                    {category}
                  </td>
                </tr>
                {perms.map((perm) => (
                  <tr key={perm} className="border-t border-[var(--color-ah-border)]">
                    <td className="p-2 font-mono sticky left-0 bg-[var(--color-ah-bg-primary)] z-10">{perm}</td>
                    {matrix.roles.map((role) => (
                      <td key={`${role}-${perm}`} className="p-2 text-center">
                        {matrix.matrix[role]?.includes(perm) ? (
                          <span className="text-green-500">&#10003;</span>
                        ) : (
                          <span className="text-[var(--color-ah-text-subtle)]">-</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
