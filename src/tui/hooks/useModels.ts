import { useState, useEffect, useCallback } from 'react';
import { discoverAllModels } from '../../providers';
import type { LocalModel } from '../../providers/types';

interface UseModelsResult {
  models: LocalModel[];
  warnings: LocalModel[];
  loading: boolean;
  refresh: () => Promise<void>;
}

export function useModels(): UseModelsResult {
  const [models, setModels] = useState<LocalModel[]>([]);
  const [warnings, setWarnings] = useState<LocalModel[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const discoveredModels = await discoverAllModels();
      setModels(discoveredModels.filter((m) => !m.statusHint));
      setWarnings(discoveredModels.filter((m) => !!m.statusHint));
    } catch {
      // Keep existing state on error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    models,
    warnings,
    loading,
    refresh,
  };
}
