import { useState, useCallback, useRef, useEffect } from 'react';
import { getSyncedModels, syncLocalModel, updateLocalModel } from '../../api';
import { discoverAllModelsWithParameters } from '../../providers';

type SyncStatus = 'idle' | 'discovering' | 'syncing' | 'done' | 'error';

interface SyncProgress {
  current: number;
  total: number;
}

interface SyncedModel {
  name: string;
  provider: string;
  capability: string;
  isNew: boolean;
}

interface UseSyncResult {
  status: SyncStatus;
  progress: SyncProgress;
  syncedModels: SyncedModel[];
  error: string | null;
  startSync: () => void;
  cancel: () => void;
}

const MODEL_TYPE_MAP = {
  text: 'llm_chat',
  image: 'image_generation',
  video: 'video_generation',
} as const;

export function useSync(): UseSyncResult {
  const [status, setStatus] = useState<SyncStatus>('idle');
  const [progress, setProgress] = useState<SyncProgress>({
    current: 0,
    total: 0,
  });
  const [syncedModels, setSyncedModels] = useState<SyncedModel[]>(
    [],
  );
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    setStatus('idle');
  }, []);

  const startSync = useCallback(() => {
    cancelledRef.current = false;
    setError(null);
    setSyncedModels([]);

    const run = async () => {
      try {
        setStatus('discovering');

        const localModels = await discoverAllModelsWithParameters();
        if (cancelledRef.current) return;

        if (localModels.length === 0) {
          setError('No local models found.');
          setStatus('error');
          return;
        }

        const existingSynced = await getSyncedModels();
        if (cancelledRef.current) return;

        // Map remote model names to their IDs for updates
        const remoteByName = new Map(
          existingSynced.map((m) => [m.name, m.id]),
        );

        setStatus('syncing');
        setProgress({ current: 0, total: localModels.length });

        for (let i = 0; i < localModels.length; i++) {
          if (cancelledRef.current) return;

          const model = localModels[i]!;
          const modelType =
            MODEL_TYPE_MAP[model.capability as keyof typeof MODEL_TYPE_MAP];
          const existingId = remoteByName.get(model.name);

          if (existingId) {
            await updateLocalModel({
              modelId: existingId,
              modelName: model.name,
              provider: model.provider,
              modelType,
              parameters: model.parameters,
            });
          } else {
            await syncLocalModel({
              modelName: model.name,
              provider: model.provider,
              modelType,
              parameters: model.parameters,
            });
          }

          setProgress({ current: i + 1, total: localModels.length });
        }

        if (cancelledRef.current) return;

        const finalModels: SyncedModel[] = localModels.map((m) => ({
          name: m.name,
          provider: m.provider,
          capability: m.capability,
          isNew: !remoteByName.has(m.name),
        }));

        setSyncedModels(finalModels);
        setStatus('done');
      } catch (err) {
        if (!cancelledRef.current) {
          setError(err instanceof Error ? err.message : 'Sync failed');
          setStatus('error');
        }
      }
    };

    run();
  }, []);

  return {
    status,
    progress,
    syncedModels,
    error,
    startSync,
    cancel,
  };
}
