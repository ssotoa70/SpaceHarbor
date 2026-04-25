import { useEffect, useRef, useState } from "react";
import { fetchAssetStats, type AssetStatsResponse } from "../api";

const STALE_MS = 30_000;

interface CacheEntry { data: AssetStatsResponse; at: number }
let cache: CacheEntry | null = null;

export function __resetAssetStatsCacheForTests(): void { cache = null; }

export type AssetStatsState =
  | { status: "loading" }
  | { status: "ready"; data: AssetStatsResponse }
  | { status: "error"; error: string };

export function useAssetStats(): AssetStatsState & { refresh: () => void } {
  const [state, setState] = useState<AssetStatsState>(() =>
    cache && Date.now() - cache.at < STALE_MS
      ? { status: "ready", data: cache.data }
      : { status: "loading" }
  );
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const run = async () => {
      try {
        const data = await fetchAssetStats();
        cache = { data, at: Date.now() };
        if (mountedRef.current) setState({ status: "ready", data });
      } catch (err) {
        if (mountedRef.current) setState({ status: "error", error: err instanceof Error ? err.message : String(err) });
      }
    };
    void run();

    const onFocus = () => { void run(); };
    window.addEventListener("focus", onFocus);
    return () => {
      mountedRef.current = false;
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  return { ...state, refresh: () => { cache = null; setState({ status: "loading" }); } };
}
