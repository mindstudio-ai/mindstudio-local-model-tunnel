import { useState, useEffect, useCallback, useRef } from 'react';
import { getEditorSessions, type EditorSession } from '../../../api';

export type RefreshStatus = 'idle' | 'refreshing' | 'refreshed';

interface UseEditorSessionsResult {
  sessions: EditorSession[];
  loading: boolean;
  error: string | null;
  refreshStatus: RefreshStatus;
  refresh: () => Promise<void>;
}

export function useEditorSessions(): UseEditorSessionsResult {
  const [sessions, setSessions] = useState<EditorSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshStatus, setRefreshStatus] = useState<RefreshStatus>('idle');
  const initialLoadDone = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const pollRef = useRef<ReturnType<typeof setInterval>>();

  const refresh = useCallback(async () => {
    if (!initialLoadDone.current) {
      setLoading(true);
    } else {
      setRefreshStatus('refreshing');
    }
    setError(null);

    try {
      const data = await getEditorSessions();
      setSessions(data);
      initialLoadDone.current = true;
      setRefreshStatus('refreshed');
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setRefreshStatus('idle'), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch sessions');
      setRefreshStatus('idle');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Silent auto-poll every 5 seconds after initial load
  useEffect(() => {
    pollRef.current = setInterval(async () => {
      if (!initialLoadDone.current) return;
      try {
        const data = await getEditorSessions();
        setSessions(data);
      } catch {
        // Silently ignore — data stays stale until next poll or manual refresh
      }
    }, 5000);

    return () => clearInterval(pollRef.current);
  }, []);

  useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);

  return { sessions, loading, error, refreshStatus, refresh };
}
