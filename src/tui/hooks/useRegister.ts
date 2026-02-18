import { useState, useCallback, useRef, useEffect } from 'react';
import {
  getRegisteredModels,
  registerLocalModel,
} from '../../api';
import {
  discoverAllModelsWithParameters,
} from '../../providers';
import { MODEL_TYPE_MAP } from '../../helpers';
import type { LocalModel } from '../../providers/types';

type RegisterStatus =
  | 'idle'
  | 'discovering'
  | 'registering'
  | 'done'
  | 'error';

interface RegisterProgress {
  current: number;
  total: number;
}

interface RegisteredModel {
  name: string;
  provider: string;
  capability: string;
  isNew: boolean;
}

interface UseRegisterResult {
  status: RegisterStatus;
  progress: RegisterProgress;
  registeredModels: RegisteredModel[];
  error: string | null;
  startRegister: () => void;
  cancel: () => void;
}

export function useRegister(): UseRegisterResult {
  const [status, setStatus] = useState<RegisterStatus>('idle');
  const [progress, setProgress] = useState<RegisterProgress>({
    current: 0,
    total: 0,
  });
  const [registeredModels, setRegisteredModels] = useState<RegisteredModel[]>(
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

  const startRegister = useCallback(() => {
    cancelledRef.current = false;
    setError(null);
    setRegisteredModels([]);

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

        const existingRegistered = await getRegisteredModels();
        if (cancelledRef.current) return;
        const registeredNames = new Set(existingRegistered);

        const unregisteredModels = localModels.filter(
          (m) => !registeredNames.has(m.name),
        );

        // Build the full list for display
        const allModels: RegisteredModel[] = localModels.map((m) => ({
          name: m.name,
          provider: m.provider,
          capability: m.capability,
          isNew: !registeredNames.has(m.name),
        }));

        if (unregisteredModels.length === 0) {
          setRegisteredModels(allModels);
          setProgress({ current: 0, total: 0 });
          setStatus('done');
          return;
        }

        setStatus('registering');
        setProgress({ current: 0, total: unregisteredModels.length });

        for (let i = 0; i < unregisteredModels.length; i++) {
          if (cancelledRef.current) return;

          const model = unregisteredModels[i]!;
          const modelType =
            MODEL_TYPE_MAP[
              model.capability as keyof typeof MODEL_TYPE_MAP
            ];

          await registerLocalModel({
            modelName: model.name,
            provider: model.provider,
            modelType,
            parameters: model.parameters,
          });

          setProgress({ current: i + 1, total: unregisteredModels.length });
        }

        if (cancelledRef.current) return;

        // Mark all as registered now
        const finalModels: RegisteredModel[] = localModels.map((m) => ({
          name: m.name,
          provider: m.provider,
          capability: m.capability,
          isNew: !registeredNames.has(m.name),
        }));

        setRegisteredModels(finalModels);
        setStatus('done');
      } catch (err) {
        if (!cancelledRef.current) {
          setError(err instanceof Error ? err.message : 'Registration failed');
          setStatus('error');
        }
      }
    };

    run();
  }, []);

  return {
    status,
    progress,
    registeredModels,
    error,
    startRegister,
    cancel,
  };
}
