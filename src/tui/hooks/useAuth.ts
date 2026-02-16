import { useState, useCallback, useRef, useEffect } from 'react';
import open from 'open';
import { requestDeviceAuth, pollDeviceAuth } from '../../api.js';
import { setApiKey } from '../../config.js';

type AuthStatus = 'idle' | 'waiting' | 'success' | 'expired' | 'timeout';

interface UseAuthResult {
  status: AuthStatus;
  authUrl: string | null;
  timeRemaining: number;
  startAuth: () => void;
  cancel: () => void;
}

const POLL_INTERVAL = 2000;
const MAX_ATTEMPTS = 30;

export function useAuth(): UseAuthResult {
  const [status, setStatus] = useState<AuthStatus>('idle');
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const cancelledRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setStatus('idle');
    setAuthUrl(null);
    setTimeRemaining(0);
  }, []);

  const startAuth = useCallback(() => {
    cancelledRef.current = false;

    const run = async () => {
      try {
        const { url, token } = await requestDeviceAuth();
        if (cancelledRef.current) return;

        setAuthUrl(url);
        setStatus('waiting');

        const totalTime = (MAX_ATTEMPTS * POLL_INTERVAL) / 1000;
        setTimeRemaining(totalTime);

        // Countdown timer
        timerRef.current = setInterval(() => {
          setTimeRemaining((prev) => {
            const next = prev - 1;
            if (next <= 0 && timerRef.current) {
              clearInterval(timerRef.current);
              timerRef.current = null;
            }
            return Math.max(0, next);
          });
        }, 1000);

        await open(url);

        // Poll loop
        for (let i = 0; i < MAX_ATTEMPTS; i++) {
          await new Promise((r) => setTimeout(r, POLL_INTERVAL));
          if (cancelledRef.current) return;

          const result = await pollDeviceAuth(token);

          if (result.status === 'completed' && result.apiKey) {
            if (timerRef.current) clearInterval(timerRef.current);
            setApiKey(result.apiKey);
            setStatus('success');
            return;
          }

          if (result.status === 'expired') {
            if (timerRef.current) clearInterval(timerRef.current);
            setStatus('expired');
            return;
          }
        }

        if (!cancelledRef.current) {
          setStatus('timeout');
        }
      } catch {
        if (!cancelledRef.current) {
          setStatus('expired');
        }
      }
    };

    run();
  }, []);

  return {
    status,
    authUrl,
    timeRemaining,
    startAuth,
    cancel,
  };
}
