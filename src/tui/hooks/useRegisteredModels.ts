import { useState, useEffect, useCallback } from 'react';
import { getRegisteredModels } from '../../api';
import type { ConnectionStatus } from '../types';

interface UseRegisteredModelsResult {
  registeredNames: Set<string>;
  refresh: () => Promise<void>;
}

export function useRegisteredModels(
  connectionStatus: ConnectionStatus,
): UseRegisteredModelsResult {
  const [registeredNames, setRegisteredNames] = useState<Set<string>>(
    new Set(),
  );

  const refresh = useCallback(async () => {
    if (connectionStatus !== 'connected') {
      setRegisteredNames(new Set());
      return;
    }

    try {
      const models = await getRegisteredModels();
      setRegisteredNames(new Set(models));
    } catch {
      // Keep existing state on error
    }
  }, [connectionStatus]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    registeredNames,
    refresh,
  };
}
