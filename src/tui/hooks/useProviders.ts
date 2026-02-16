import { useState, useEffect, useCallback } from 'react';
import { getProviderStatuses } from '../../providers/index.js';
import type { ProviderStatus } from '../types.js';

interface UseProvidersResult {
  providers: ProviderStatus[];
  loading: boolean;
  refresh: () => Promise<void>;
}

export function useProviders(pollInterval: number = 10000): UseProvidersResult {
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const statuses = await getProviderStatuses();
      setProviders(statuses);
    } catch {
      // Keep existing state on error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();

    // Poll for provider status changes
    const interval = setInterval(refresh, pollInterval);
    return () => clearInterval(interval);
  }, [refresh, pollInterval]);

  return {
    providers,
    loading,
    refresh,
  };
}
