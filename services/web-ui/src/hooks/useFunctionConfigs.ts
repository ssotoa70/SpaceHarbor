import { useCallback, useEffect, useState } from "react";
import { fetchFunctionConfigs, saveFunctionConfig, type FunctionConfigDTO } from "../api";

export interface UseFunctionConfigsResult {
  configs: FunctionConfigDTO[];
  loading: boolean;
  error: string | null;
  save: (key: string, value: unknown) => Promise<void>;
  reset: (key: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useFunctionConfigs(scope: string): UseFunctionConfigsResult {
  const [configs, setConfigs] = useState<FunctionConfigDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setConfigs(await fetchFunctionConfigs(scope));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(
    async (key: string, value: unknown) => {
      const updated = await saveFunctionConfig(scope, key, value);
      setConfigs((prev) => prev.map((c) => (c.key === key ? updated : c)));
    },
    [scope],
  );

  const reset = useCallback(
    async (key: string) => {
      const existing = configs.find((c) => c.key === key);
      if (!existing) return;
      const updated = await saveFunctionConfig(scope, key, existing.default);
      setConfigs((prev) => prev.map((c) => (c.key === key ? updated : c)));
    },
    [configs, scope],
  );

  return { configs, loading, error, save, reset, refresh: load };
}
