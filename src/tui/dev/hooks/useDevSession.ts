// Hook managing the dev session lifecycle, including dev server and proxy.

import { useState, useEffect, useRef, useCallback } from 'react';
import { execSync } from 'node:child_process';
import { DevRunner } from '../../../dev/runner';
import { DevProxy } from '../../../dev/proxy';
import { devRequestEvents } from '../../../dev/events';
import {
  getWebInterfaceConfig,
  getWebProjectDir,
  readTableSources,
} from '../../../dev/app-config';
import { syncSchema } from '../../../dev/api';
import { useDevServer } from './useDevServer';
import type { AppConfig, DevSession, WebInterfaceConfig, SyncSchemaResponse } from '../../../dev/types';

/** Derive a stable port number (3100-3999) from the app ID so the proxy URL is consistent. */
function stablePort(appId: string): number {
  let hash = 0;
  for (let i = 0; i < appId.length; i++) {
    hash = ((hash << 5) - hash + appId.charCodeAt(i)) | 0;
  }
  return 3100 + (Math.abs(hash) % 900);
}

function detectGitBranch(): string | undefined {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || undefined;
  } catch {
    return undefined;
  }
}

export type DevPhase =
  | 'detecting'
  | 'needs_port'
  | 'ready'
  | 'starting'
  | 'running'
  | 'error'
  | 'stopped'
  | 'expired';

export function useDevSession(appConfig: AppConfig) {
  const [phase, setPhase] = useState<DevPhase>('detecting');
  const [session, setSession] = useState<DevSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [devPort, setDevPort] = useState<number | null>(null);
  const [proxyPort, setProxyPort] = useState<number | null>(null);
  const [webConfig, setWebConfig] = useState<WebInterfaceConfig | null>(null);
  const [syncResult, setSyncResult] = useState<SyncSchemaResponse | null>(null);
  const runnerRef = useRef<DevRunner | null>(null);
  const proxyRef = useRef<DevProxy | null>(null);
  const mountedRef = useRef(true);

  const devServer = useDevServer();

  // Detect web interface config on mount
  useEffect(() => {
    const config = getWebInterfaceConfig(appConfig);
    setWebConfig(config);

    if (config?.devPort) {
      setDevPort(config.devPort);
      setPhase('ready');
    } else if (
      !appConfig.interfaces.some(
        (i) => i.type === 'web' && i.enabled !== false,
      )
    ) {
      // No web interface at all — backend-only mode
      setDevPort(null);
      setPhase('ready');
    } else {
      // Web interface exists but no devPort configured
      setPhase('needs_port');
    }
  }, [appConfig]);

  // Listen for session expiry
  useEffect(() => {
    const unsub = devRequestEvents.onSessionExpired(() => {
      if (mountedRef.current) {
        setPhase('expired');
        runnerRef.current = null;
      }
    });
    return unsub;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      runnerRef.current?.stop().catch(() => {});
      proxyRef.current?.stop();
      devServer.stop();
    };
  }, []);

  const start = useCallback(
    async (port?: number) => {
      const actualPort = port ?? devPort;

      if (!appConfig.appId) {
        setPhase('error');
        return;
      }

      if (actualPort !== undefined && actualPort !== null) {
        setDevPort(actualPort);
      }

      setPhase('starting');
      setError(null);

      try {
        // Start local dev server if we have a web interface and a port
        if (actualPort !== null && actualPort !== undefined) {
          const webProjectDir = getWebProjectDir(appConfig);
          if (webProjectDir) {
            const devCommand = webConfig?.devCommand ?? 'npm run dev';
            await devServer.start({
              command: devCommand,
              cwd: webProjectDir,
              port: actualPort,
            });
          }
        }

        // Start the platform session
        const branch = detectGitBranch();
        const runner = new DevRunner(
          appConfig.appId,
          process.cwd(),
          branch,
        );
        runnerRef.current = runner;
        const devSession = await runner.start();

        // Sync table schema if the app has tables
        if (appConfig.tables.length > 0) {
          try {
            const tableSources = readTableSources(appConfig);
            if (tableSources.length > 0) {
              const result = await syncSchema(
                appConfig.appId,
                devSession.sessionId,
                tableSources,
              );
              devSession.databases = result.databases;
              if (mountedRef.current) {
                setSyncResult(result);
              }
            }
          } catch {
            // Schema sync failure is non-fatal — session still works
          }
        }

        // Start the local proxy if we have a frontend port and client context
        if (actualPort !== null && actualPort !== undefined && devSession.clientContext) {
          const proxy = new DevProxy(actualPort, devSession.clientContext);
          const preferredProxyPort = stablePort(appConfig.appId!);
          const pPort = await proxy.start(preferredProxyPort);
          proxyRef.current = proxy;
          runner.setProxyUrl(`http://localhost:${pPort}`);
          if (mountedRef.current) {
            setProxyPort(pPort);
          }
        }

        if (mountedRef.current) {
          setSession(devSession);
          setPhase('running');
        }
      } catch (err) {
        if (mountedRef.current) {
          setError(
            err instanceof Error ? err.message : 'Failed to start dev session',
          );
          setPhase('error');
        }
      }
    },
    [appConfig, devPort, webConfig, devServer],
  );

  const stop = useCallback(async () => {
    proxyRef.current?.stop();
    proxyRef.current = null;
    devServer.stop();
    if (runnerRef.current) {
      await runnerRef.current.stop().catch(() => {});
      runnerRef.current = null;
    }
    if (mountedRef.current) {
      setSession(null);
      setProxyPort(null);
      setPhase('stopped');
    }
  }, [devServer]);

  const resync = useCallback(async () => {
    if (!session || !appConfig.appId) return;
    try {
      const tableSources = readTableSources(appConfig);
      if (tableSources.length === 0) return;
      const result = await syncSchema(
        appConfig.appId,
        session.sessionId,
        tableSources,
      );
      if (mountedRef.current) {
        setSyncResult(result);
        setSession((prev) =>
          prev ? { ...prev, databases: result.databases } : prev,
        );
      }
    } catch (err) {
      if (mountedRef.current) {
        setSyncResult({
          created: [],
          altered: [],
          errors: [err instanceof Error ? err.message : 'Sync failed'],
          databases: session.databases,
        });
      }
    }
  }, [appConfig, session]);

  const submitPort = useCallback(
    (port: number) => {
      setDevPort(port);
      setPhase('ready');
    },
    [],
  );

  const skipFrontend = useCallback(() => {
    setDevPort(null);
    setPhase('ready');
  }, []);

  return {
    phase,
    session,
    error,
    devPort,
    proxyPort,
    webConfig,
    devServer,
    syncResult,
    start,
    stop,
    resync,
    submitPort,
    skipFrontend,
  };
}
