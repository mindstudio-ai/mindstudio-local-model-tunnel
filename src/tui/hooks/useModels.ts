import { useState, useEffect, useCallback } from 'react';
import { discoverAllModels } from '../../providers/index.js';
import type { LocalModel } from '../../providers/types.js';

interface UseModelsResult {
  models: LocalModel[];
  loading: boolean;
  refresh: () => Promise<void>;
}

export function useModels(): UseModelsResult {
  const [models, setModels] = useState<LocalModel[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const discoveredModels = await discoverAllModels();
      setModels(discoveredModels);
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
    loading,
    refresh,
  };
}
