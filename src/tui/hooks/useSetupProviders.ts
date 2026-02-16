import { useState, useEffect, useCallback } from 'react';
import { detectAllProviders, type ProviderInfo } from '../../quickstart/detect.js';
import { hasDefaultSdModel, getComfyUIModelStatus } from '../../quickstart/installers.js';

interface ComfyModelStatus {
  id: string;
  label: string;
  installed: boolean;
  totalSize: string;
}

interface UseSetupProvidersResult {
  providers: ProviderInfo[];
  loading: boolean;
  sdModelExists: boolean;
  comfyModelStatus: ComfyModelStatus[];
  refresh: () => Promise<void>;
}

export function useSetupProviders(): UseSetupProvidersResult {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [sdModelExists, setSdModelExists] = useState(false);
  const [comfyModelStatus, setComfyModelStatus] = useState<ComfyModelStatus[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [detected, modelExists] = await Promise.all([
      detectAllProviders(),
      hasDefaultSdModel(),
    ]);
    setProviders(detected);
    setSdModelExists(modelExists);
    setComfyModelStatus(getComfyUIModelStatus());
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { providers, loading, sdModelExists, comfyModelStatus, refresh };
}
