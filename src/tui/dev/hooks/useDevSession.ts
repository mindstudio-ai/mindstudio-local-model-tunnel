// Orchestrates the full dev session lifecycle in TUI mode.
//
// Startup sequence (triggered by phase state machine):
//   detecting → detect web config from mindstudio.json
//   needs_port → prompt user for dev server port (if not in config)
//   ready → auto-triggers start()
//   starting → npm install (if needed) → start dev server → start platform
//              session → sync schema → start proxy
//   running → poll loop active, proxy serving, ready for requests
//
// On mindstudio.json change: fs.watch detects it, stops everything,
// re-enters 'ready' phase which re-runs start() with fresh config.
//
// This hook is the TUI equivalent of src/headless.ts — same pieces
// (DevRunner, DevProxy, schema sync) wired together with React state.

import { useState, useEffect, useRef, useCallback } from 'react';
import { spawn } from 'node:child_process';
import { watch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import { DevRunner } from '../../../dev/runner';
import { DevProxy } from '../../../dev/proxy';
import { devRequestEvents } from '../../../dev/events';
import {
  detectAppConfig,
  getWebInterfaceConfig,
  getWebProjectDir,
  readTableSources,
  findDirsNeedingInstall,
} from '../../../dev/app-config';
import { syncSchema } from '../../../dev/api';
import { initLoggerInteractive } from '../../../dev/logger';
import { stablePort, detectGitBranch } from '../../../dev/utils';
import { watchTableFiles } from '../../../dev/table-watcher';
import { useDevServer } from './useDevServer';
import type { AppConfig, DevSession, WebInterfaceConfig, SyncSchemaResponse } from '../../../dev/types';

function runNpmInstall(cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('npm', ['install'], {
      cwd,
      shell: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    proc.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`npm install failed in ${cwd}: ${stderr.slice(-200)}`));
    });
    proc.on('error', reject);
  });
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
  // Init logger once on first render (TUI mode → file-based)
  const logInitRef = useRef(false);
  if (!logInitRef.current) {
    initLoggerInteractive('error');
    logInitRef.current = true;
  }

  const [phase, setPhase] = useState<DevPhase>('detecting');
  const [session, setSession] = useState<DevSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [devPort, setDevPort] = useState<number | null>(null);
  const [proxyPort, setProxyPort] = useState<number | null>(null);
  const [webConfig, setWebConfig] = useState<WebInterfaceConfig | null>(null);
  const [syncResult, setSyncResult] = useState<SyncSchemaResponse | null>(null);
  const [scenarioResult, setScenarioResult] = useState<{ id: string; name?: string; success: boolean; duration: number; roles: string[]; error?: string } | null>(null);
  const [roleOverride, setRoleOverride] = useState<string[] | null>(null);
  const [installStatus, setInstallStatus] = useState<string | null>(null);
  const runnerRef = useRef<DevRunner | null>(null);
  const proxyRef = useRef<DevProxy | null>(null);
  const tableWatcherCleanupRef = useRef<() => void>(() => {});
  const mountedRef = useRef(true);

  const devServer = useDevServer();

  const cleanupTableWatchers = useCallback(() => {
    tableWatcherCleanupRef.current();
    tableWatcherCleanupRef.current = () => {};
  }, []);

  const setupTableWatchers = useCallback((config: AppConfig) => {
    cleanupTableWatchers();
    tableWatcherCleanupRef.current = watchTableFiles(
      config.tables,
      process.cwd(),
      () => { resyncRef.current?.(); },
    );
  }, [cleanupTableWatchers]);

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
    const unsubExpired = devRequestEvents.onSessionExpired(() => {
      if (mountedRef.current) {
        setPhase('expired');
        runnerRef.current = null;
      }
    });
    const unsubImpersonate = devRequestEvents.onImpersonate((event) => {
      if (mountedRef.current) {
        setRoleOverride(event.roles);
      }
    });
    return () => { unsubExpired(); unsubImpersonate(); };
  }, []);

  // Watch mindstudio.json for changes — restart session on edit
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    let watcher: FSWatcher | undefined;
    try {
      const configPath = join(process.cwd(), 'mindstudio.json');
      watcher = watch(configPath, () => {
        // Debounce — editors often write multiple times
        clearTimeout(restartTimerRef.current);
        restartTimerRef.current = setTimeout(async () => {
          if (!mountedRef.current || phase !== 'running') return;
          // Stop current session, re-enter ready phase (auto-starts)
          cleanupTableWatchers();
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
            setSyncResult(null);
            setPhase('ready');
          }
        }, 500);
      });
    } catch {
      // File might not exist yet
    }
    return () => {
      clearTimeout(restartTimerRef.current);
      watcher?.close();
    };
  }, [phase, devServer]);

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cleanupTableWatchers();
      runnerRef.current?.stop().catch(() => {});
      proxyRef.current?.stop();
      devServer.stop();
    };
  }, []);

  const start = useCallback(
    async (port?: number) => {
      // Re-read mindstudio.json in case it changed (e.g., restart after edit)
      const currentConfig = detectAppConfig() ?? appConfig;
      const actualPort = port ?? devPort;

      if (!currentConfig.appId) {
        setPhase('error');
        return;
      }

      if (actualPort !== undefined && actualPort !== null) {
        setDevPort(actualPort);
      }

      setPhase('starting');
      setError(null);

      try {
        // Install dependencies if needed
        const dirsToInstall = findDirsNeedingInstall(currentConfig);
        for (const dir of dirsToInstall) {
          const dirName = dir.split('/').slice(-2).join('/');
          if (mountedRef.current) {
            setInstallStatus(`Installing dependencies in ${dirName}...`);
          }
          await runNpmInstall(dir);
        }
        if (mountedRef.current) {
          setInstallStatus(null);
        }

        // Start local dev server if we have a web interface and a port
        if (actualPort != null) {
          const webProjectDir = getWebProjectDir(currentConfig);
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
        const proxyUrl = actualPort != null
          ? `http://localhost:${stablePort(currentConfig.appId!)}`
          : undefined;
        const runner = new DevRunner(
          currentConfig.appId,
          process.cwd(),
          {
            branch,
            proxyUrl,
            methods: currentConfig.methods.map((m) => ({ id: m.id, export: m.export, path: m.path })),
          },
        );
        runnerRef.current = runner;
        const devSession = await runner.start();

        // Sync table schema if the app has tables
        if (currentConfig.tables.length > 0) {
          try {
            const tableSources = readTableSources(currentConfig);
            if (tableSources.length > 0) {
              const result = await syncSchema(
                currentConfig.appId,
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
        if (actualPort != null && devSession.clientContext) {
          const proxy = new DevProxy(actualPort, devSession.clientContext);
          const preferredProxyPort = stablePort(currentConfig.appId!);
          const pPort = await proxy.start(preferredProxyPort);
          proxyRef.current = proxy;
          runner.setProxyUrl(`http://localhost:${pPort}`);
          runner.setProxy(proxy);
          if (mountedRef.current) {
            setProxyPort(pPort);
          }
        }

        // Watch table source directories for changes — auto-sync schema
        setupTableWatchers(currentConfig);

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
    [appConfig, devPort, webConfig, devServer, setupTableWatchers],
  );

  const stop = useCallback(async () => {
    cleanupTableWatchers();
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
  }, [devServer, cleanupTableWatchers]);

  // Ref to latest resync so table watchers don't capture a stale closure
  const resyncRef = useRef<() => Promise<void>>();

  const resync = useCallback(async () => {
    if (!session) return;
    const freshConfig = detectAppConfig() ?? appConfig;
    if (!freshConfig.appId) return;
    try {
      const tableSources = readTableSources(freshConfig);
      if (tableSources.length === 0) return;
      const result = await syncSchema(
        freshConfig.appId,
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
  resyncRef.current = resync;

  const setImpersonation = useCallback(async (roles: string[]) => {
    if (!runnerRef.current) return;
    await runnerRef.current.setImpersonation(roles);
  }, []);

  const clearImpersonation = useCallback(async () => {
    if (!runnerRef.current) return;
    await runnerRef.current.clearImpersonation();
  }, []);

  const runScenario = useCallback(async (scenarioId: string) => {
    if (!runnerRef.current) return;
    const freshConfig = detectAppConfig() ?? appConfig;
    const scenario = freshConfig.scenarios.find((s) => s.id === scenarioId);
    if (!scenario) return;

    const result = await runnerRef.current.runScenario(scenario);
    if (mountedRef.current) {
      setSession((prev) =>
        prev ? { ...prev, databases: result.databases } : prev,
      );
      setScenarioResult({
        id: scenario.id,
        name: scenario.name,
        success: result.success,
        duration: 0, // filled by event listener if needed
        roles: scenario.roles,
        error: result.error,
      });
    }
  }, [appConfig]);

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
    scenarioResult,
    roleOverride,
    installStatus,
    start,
    stop,
    resync,
    runScenario,
    setImpersonation,
    clearImpersonation,
    submitPort,
    skipFrontend,
  };
}
