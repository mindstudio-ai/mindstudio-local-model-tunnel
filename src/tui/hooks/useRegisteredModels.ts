import { useState, useEffect, useCallback } from 'react';
import { getSyncedModels } from '../../api';
import type { ConnectionStatus } from '../types';

interface UseSyncedModelsResult {
  syncedNames: Set<string>;
  syncedModelIds: string[];
  refresh: () => Promise<void>;
}

export function useSyncedModels(
  connectionStatus: ConnectionStatus,
): UseSyncedModelsResult {
  const [syncedNames, setSyncedNames] = useState<Set<string>>(
    new Set(),
  );
  const [syncedModelIds, setSyncedModelIds] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    if (connectionStatus !== 'connected') {
      setSyncedNames(new Set());
      setSyncedModelIds([]);
      return;
    }

    try {
      const models = await getSyncedModels();
      setSyncedNames(new Set(models.map((m) => m.name)));
      setSyncedModelIds(models.map((m) => m.id));
    } catch {
      // Keep existing state on error
    }
  }, [connectionStatus]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    syncedNames,
    syncedModelIds,
    refresh,
  };
}
