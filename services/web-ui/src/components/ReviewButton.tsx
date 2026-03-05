import { useState } from "react";

interface ReviewButtonProps {
  assetId: string | undefined;
  apiBase?: string;
}

export function ReviewButton({ assetId, apiBase = "/api/v1" }: ReviewButtonProps) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!assetId) return null;

  const handleClick = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/assets/${assetId}/review-uri`);
      if (!res.ok) {
        setError("Failed to open in RV");
        return;
      }
      const { uri } = await res.json();
      window.open(uri, "_blank");
    } catch {
      setError("Failed to open in RV");
    } finally {
      setLoading(false);
    }
  };

  return (
    <span>
      <button
        onClick={handleClick}
        disabled={loading}
        title="Open in RV player"
        aria-label="Open in RV"
        style={{ cursor: loading ? "wait" : "pointer" }}
      >
        {loading ? "Opening..." : "Open in RV"}
      </button>
      {error && (
        <span role="alert" style={{ color: "red", marginLeft: 8 }}>
          {error}
        </span>
      )}
    </span>
  );
}
