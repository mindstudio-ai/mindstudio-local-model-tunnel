import { useState, useEffect, useCallback } from 'react';
import { getSyncedModels, type SyncedModel } from '../../../api';
import type { ConnectionStatus } from '../../types';

interface UseSyncedModelsResult {
  syncedNames: Set<string>;
  syncedModels: SyncedModel[];
  refresh: () => Promise<void>;
}

export function useSyncedModels(
  connectionStatus: ConnectionStatus,
): UseSyncedModelsResult {
  const [syncedNames, setSyncedNames] = useState<Set<string>>(
    new Set(),
  );
  const [syncedModels, setSyncedModels] = useState<SyncedModel[]>([]);

  const refresh = useCallback(async () => {
    if (connectionStatus !== 'connected') {
      setSyncedNames(new Set());
      setSyncedModels([]);
      return;
    }

    try {
      const models = await getSyncedModels();
      setSyncedNames(new Set(models.map((m) => m.name)));
      setSyncedModels(models);
    } catch {
      // Keep existing state on error
    }
  }, [connectionStatus]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    syncedNames,
    syncedModels,
    refresh,
  };
}
