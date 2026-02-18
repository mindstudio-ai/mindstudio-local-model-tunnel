import { useState, useEffect, useCallback } from 'react';
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
  refresh: () => Promise<void>;
}

export function useSetupProviders(): UseSetupProvidersResult {
  const [providers, setProviders] = useState<ProviderWithStatus[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const statuses = await detectAllProviderStatuses();
    setProviders(statuses);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { providers, loading, refresh };
}
