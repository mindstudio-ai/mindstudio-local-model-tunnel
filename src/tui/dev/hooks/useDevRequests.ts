// Hook for tracking dev request events in the TUI.
// Follows the same pattern as src/tui/models/hooks/useRequests.ts.

import { useState, useEffect, useRef } from 'react';
import { devRequestEvents } from '../../../dev/events';
import type { DevRequestLogEntry } from '../../../dev/types';

const MAX_HISTORY = 50;

export function useDevRequests() {
  const requestsRef = useRef<Map<string, DevRequestLogEntry>>(new Map());
  const [requests, setRequests] = useState<DevRequestLogEntry[]>([]);

  useEffect(() => {
    const unsubStart = devRequestEvents.onStart((event) => {
      const entry: DevRequestLogEntry = {
        id: event.id,
        type: event.type,
        method: event.method,
        status: 'processing',
        startTime: event.timestamp,
      };

      requestsRef.current.set(event.id, entry);
      setRequests(
        Array.from(requestsRef.current.values()).slice(-MAX_HISTORY),
      );
    });

    const unsubComplete = devRequestEvents.onComplete((event) => {
      const existing = requestsRef.current.get(event.id);
      if (existing) {
        existing.status = event.success ? 'completed' : 'failed';
        existing.endTime = existing.startTime + event.duration;
        existing.duration = event.duration;
        existing.error = event.error;

        setRequests(
          Array.from(requestsRef.current.values()).slice(-MAX_HISTORY),
        );
      }
    });

    return () => {
      unsubStart();
      unsubComplete();
    };
  }, []);

  // Periodic re-render to update elapsed time for active requests
  useEffect(() => {
    const hasActive = requests.some((r) => r.status === 'processing');
    if (!hasActive) return;

    const interval = setInterval(() => {
      setRequests(
        Array.from(requestsRef.current.values()).slice(-MAX_HISTORY),
      );
    }, 1000);

    return () => clearInterval(interval);
  }, [requests]);

  const activeCount = requests.filter(
    (r) => r.status === 'processing',
  ).length;

  return { requests, activeCount };
}
