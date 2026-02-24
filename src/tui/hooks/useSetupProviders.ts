import { useState, useEffect, useCallback, useRef } from 'react';
import {
  detectAllProviderStatuses,
  type Provider,
  type ProviderSetupStatus,
} from '../../providers';

interface ProviderWithStatus {
  provider: Provider;
  status: ProviderSetupStatus;
}

interface UseSetupProvidersResult {
  providers: ProviderWithStatus[];
  loading: boolean;
  refreshing: boolean;
  refresh: () => Promise<void>;
}

export function useSetupProviders(): UseSetupProvidersResult {
  const [providers, setProviders] = useState<ProviderWithStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const initialLoadDone = useRef(false);

  const refresh = useCallback(async () => {
    if (!initialLoadDone.current) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    const statuses = await detectAllProviderStatuses();
    setProviders(statuses);
    initialLoadDone.current = true;
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { providers, loading, refreshing, refresh };
}
