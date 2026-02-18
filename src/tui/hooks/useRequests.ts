import { useState, useEffect, useCallback, useRef } from 'react';
import { requestEvents } from '../../events';
import type { RequestLogEntry } from '../types';

interface UseRequestsResult {
  requests: RequestLogEntry[];
  activeCount: number;
  clear: () => void;
}

export function useRequests(maxHistory: number = 50): UseRequestsResult {
  const [requests, setRequests] = useState<RequestLogEntry[]>([]);
  const requestsRef = useRef<Map<string, RequestLogEntry>>(new Map());

  // Update timer for active request durations
  useEffect(() => {
    const interval = setInterval(() => {
      // Force re-render for active requests to update elapsed time
      setRequests((prev) => {
        const hasActive = prev.some((r) => r.status === 'processing');
        return hasActive ? [...prev] : prev;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const unsubStart = requestEvents.onStart((event) => {
      const entry: RequestLogEntry = {
        id: event.id,
        modelId: event.modelId,
        requestType: event.requestType,
        status: 'processing',
        startTime: event.timestamp,
      };

      requestsRef.current.set(event.id, entry);
      setRequests((prev) => [...prev, entry].slice(-maxHistory));
    });

    const unsubProgress = requestEvents.onProgress((event) => {
      const existing = requestsRef.current.get(event.id);
      if (existing && existing.status === 'processing' && event.content) {
        const updated: RequestLogEntry = {
          ...existing,
          content: event.content,
        };
        requestsRef.current.set(event.id, updated);
        setRequests((prev) =>
          prev.map((r) => (r.id === event.id ? updated : r)),
        );
      }
    });

    const unsubComplete = requestEvents.onComplete((event) => {
      const existing = requestsRef.current.get(event.id);
      if (existing) {
        const updated: RequestLogEntry = {
          ...existing,
          status: event.success ? 'completed' : 'failed',
          endTime: Date.now(),
          duration: event.duration,
          result: event.result,
          error: event.error,
        };

        requestsRef.current.set(event.id, updated);
        setRequests((prev) =>
          prev.map((r) => (r.id === event.id ? updated : r)),
        );
      }
    });

    return () => {
      unsubStart();
      unsubProgress();
      unsubComplete();
    };
  }, [maxHistory]);

  const activeCount = requests.filter((r) => r.status === 'processing').length;

  const clear = useCallback(() => {
    requestsRef.current.clear();
    setRequests([]);
  }, []);

  return {
    requests,
    activeCount,
    clear,
  };
}
