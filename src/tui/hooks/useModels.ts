import { useState, useEffect, useCallback, useRef } from 'react';
import { discoverAllModelsWithParameters } from '../../providers';
import type { LocalModel } from '../../providers/types';

interface UseModelsResult {
  models: LocalModel[];
  warnings: LocalModel[];
  loading: boolean;
  refreshing: boolean;
  refresh: () => Promise<LocalModel[]>;
}

export function useModels(): UseModelsResult {
  const [models, setModels] = useState<LocalModel[]>([]);
  const [warnings, setWarnings] = useState<LocalModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const initialLoadDone = useRef(false);

  const refresh = useCallback(async (): Promise<LocalModel[]> => {
    if (!initialLoadDone.current) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    try {
      const discoveredModels = await discoverAllModelsWithParameters();
      setModels(discoveredModels.filter((m) => !m.statusHint));
      setWarnings(discoveredModels.filter((m) => !!m.statusHint));
      initialLoadDone.current = true;
      return discoveredModels;
    } catch {
      // Keep existing state on error
      return [];
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    models,
    warnings,
    loading,
    refreshing,
    refresh,
  };
}
