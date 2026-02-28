import { useState, useEffect, useCallback } from 'react';
import { verifyApiKey } from '../../api';
import { getApiKey, getUserId, getEnvironment } from '../../config';
import type { ConnectionStatus } from '../types';

interface UseConnectionResult {
  status: ConnectionStatus;
  environment: 'prod' | 'local';
  error: string | null;
  retry: () => void;
}

export function useConnection(): UseConnectionResult {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [error, setError] = useState<string | null>(null);
  const environment = getEnvironment();

  const connect = useCallback(async () => {
    setStatus('connecting');
    setError(null);

    const apiKey = getApiKey();
    const userId = getUserId();
    if (!apiKey || !userId) {
      setStatus('not_authenticated');
      return;
    }

    try {
      const isValid = await verifyApiKey();
      if (isValid) {
        setStatus('connected');
      } else {
        setStatus('not_authenticated');
      }
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Connection failed');
    }
  }, []);

  useEffect(() => {
    connect();
  }, [connect]);

  return {
    status,
    environment,
    error,
    retry: connect,
  };
}
