import { useState, useEffect, useCallback } from 'react';
import { getSyncedModels } from '../../api';
import type { ConnectionStatus } from '../types';

interface UseSyncedModelsResult {
  syncedNames: Set<string>;
  refresh: () => Promise<void>;
}

export function useSyncedModels(
  connectionStatus: ConnectionStatus,
): UseSyncedModelsResult {
  const [syncedNames, setSyncedNames] = useState<Set<string>>(
    new Set(),
  );

  const refresh = useCallback(async () => {
    if (connectionStatus !== 'connected') {
      setSyncedNames(new Set());
      return;
    }

    try {
      const models = await getSyncedModels();
      setSyncedNames(new Set(models.map((m) => m.name)));
    } catch {
      // Keep existing state on error
    }
  }, [connectionStatus]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    syncedNames,
    refresh,
  };
}
