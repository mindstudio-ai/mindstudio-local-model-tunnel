import { useState, useEffect, useCallback } from 'react';
import {
  allProviders,
  detectAllProviderStatuses,
  type Provider,
  type ProviderSetupStatus,
  type ModelAction,
} from '../../providers/index.js';

interface ProviderWithStatus {
  provider: Provider;
  status: ProviderSetupStatus;
}

interface UseSetupProvidersResult {
  providers: ProviderWithStatus[];
  loading: boolean;
  modelActions: Map<string, ModelAction[]>;
  refresh: () => Promise<void>;
}

export function useSetupProviders(): UseSetupProvidersResult {
  const [providers, setProviders] = useState<ProviderWithStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [modelActions, setModelActions] = useState<Map<string, ModelAction[]>>(
    new Map(),
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    const statuses = await detectAllProviderStatuses();
    setProviders(statuses);

    // Gather model actions from all providers that support it
    const actionsMap = new Map<string, ModelAction[]>();
    await Promise.all(
      allProviders.map(async (provider) => {
        if (provider.getModelActions) {
          const actions = await provider.getModelActions();
          actionsMap.set(provider.name, actions);
        }
      }),
    );
    setModelActions(actionsMap);

    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { providers, loading, modelActions, refresh };
}
