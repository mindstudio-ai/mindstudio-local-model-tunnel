import React, { useEffect, useCallback, useState, useRef } from 'react';
import { Box, useApp, useStdout } from 'ink';
import { Header } from './components/Header';
import { NavigationMenu } from './components/NavigationMenu';
import type { MenuItem } from './components/NavigationMenu';
import { useConnection } from './hooks/useConnection';
import { useEditorSessions } from './interfaces/hooks/useEditorSessions';
import { useSetupProviders } from './models/hooks/useSetupProviders';
import { useModels } from './models/hooks/useModels';
import { useRequests } from './models/hooks/useRequests';
import { useSyncedModels } from './models/hooks/useRegisteredModels';
import { DashboardPage } from './models/pages/DashboardPage';
import { SetupPage } from './models/pages/SetupPage';
import { InterfacesPage } from './interfaces/pages/InterfacesPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { TunnelRunner } from '../runner';
import { syncModels, type ModelTypeMindStudio } from '../api';
import { getApiKey, getUserId, getConfigPath } from '../config';
import type { Page } from './types';

const MODEL_TYPE_MAP: Record<string, ModelTypeMindStudio> = {
  text: 'llm_chat',
  image: 'image_generation',
  video: 'video_generation',
};

interface AppProps {
  runner: TunnelRunner;
}

export function App({ runner }: AppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const {
    status: connectionStatus,
    environment,
    error: connectionError,
    retry: retryConnection,
  } = useConnection();
  const editorSessions = useEditorSessions();
  const {
    providers,
    loading: providersLoading,
    refresh: refreshProviders,
  } = useSetupProviders();
  const {
    models,
    warnings: modelWarnings,
    loading: modelsLoading,
    refresh: refreshModels,
  } = useModels();
  const { requests, activeCount: activeRequestCount } = useRequests();
  const {
    syncedNames,
    syncedModels,
    refresh: refreshSynced,
  } = useSyncedModels(connectionStatus);
  const shouldOnboard = getApiKey() === undefined || getUserId() === undefined;
  const [page, setPage] = useState<Page>(
    shouldOnboard ? 'onboarding' : 'dashboard',
  );
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'synced'>(
    'idle',
  );
  const syncTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastSyncPayloadRef = useRef<string>('');

  // Redirect to onboarding when not authenticated
  useEffect(() => {
    if (connectionStatus === 'not_authenticated') {
      setPage('onboarding');
    }
  }, [connectionStatus]);

  // Refresh everything when returning to dashboard
  useEffect(() => {
    if (page === 'dashboard') {
      refreshAll();
    }
  }, [page]);

  // Start runner when connected with synced models
  useEffect(() => {
    if (connectionStatus === 'connected' && syncedModels.length > 0) {
      runner.start(syncedModels);
    }
  }, [connectionStatus, syncedModels, runner]);

  // Stop only on unmount
  useEffect(() => () => runner.stop(), [runner]);

  // Refresh everything: re-detect providers/models, sync to cloud, update synced state
  const refreshAll = useCallback(
    async (silent = false) => {
      if (!silent) setSyncStatus('syncing');

      const [discoveredModels] = await Promise.all([
        refreshModels(),
        refreshProviders(),
      ]);

      // Sync discovered models to cloud if anything changed
      const modelsToSync = discoveredModels
        .filter((m) => !m.statusHint)
        .map((m) => ({
          name: m.name,
          provider: m.provider,
          type: MODEL_TYPE_MAP[m.capability] || 'llm_chat',
          parameters: m.parameters,
        }));

      const payload = JSON.stringify(modelsToSync);
      if (payload !== lastSyncPayloadRef.current && modelsToSync.length > 0) {
        try {
          await syncModels(modelsToSync);
          lastSyncPayloadRef.current = payload;
        } catch {
          // Sync failure is non-critical
        }
      }

      await refreshSynced();

      if (!silent) {
        setSyncStatus('synced');
        clearTimeout(syncTimerRef.current);
        syncTimerRef.current = setTimeout(() => setSyncStatus('idle'), 1500);
      }
    },
    [refreshProviders, refreshModels, refreshSynced],
  );

  // Auto-sync every 3s while connected on dashboard
  useEffect(() => {
    if (connectionStatus !== 'connected' || page !== 'dashboard') return;
    const interval = setInterval(() => refreshAll(true), 1500);
    return () => clearInterval(interval);
  }, [connectionStatus, page, refreshAll]);

  const handleQuit = useCallback(() => {
    runner.stop();
    exit();
  }, [runner, exit]);

  const handleOnboardingComplete = useCallback(() => {
    retryConnection();
    refreshAll();
    setPage('dashboard');
  }, [retryConnection, refreshAll]);

  const handleNavigate = useCallback(
    (id: string) => {
      switch (id) {
        case 'interfaces':
          setPage('interfaces');
          break;
        case 'auth':
          setPage('onboarding');
          break;
        case 'setup':
          setPage('setup');
          break;
        case 'refresh':
          refreshAll();
          break;
        case 'quit':
          handleQuit();
          break;
      }
    },
    [refreshAll, handleQuit],
  );

  const subpageMenuItems: MenuItem[] = [
    { id: 'back', label: 'Back', description: 'Return to dashboard' },
  ];

  const handleSubpageNavigate = useCallback(
    (id: string) => {
      if (id === 'back') {
        setPage('dashboard');
      } else {
        handleNavigate(id);
      }
    },
    [handleNavigate],
  );

  const [termSize, setTermSize] = useState({
    rows: stdout?.rows ?? 24,
    columns: stdout?.columns ?? 80,
  });

  useEffect(() => {
    if (!stdout) return;
    const onResize = () => {
      stdout.write('\x1b[2J\x1b[H');
      setTermSize({ rows: stdout.rows, columns: stdout.columns });
    };
    stdout.on('resize', onResize);
    return () => {
      stdout.off('resize', onResize);
    };
  }, [stdout]);

  const termHeight = termSize.rows - 4;
  const compactHeader = termSize.rows <= 45 || termSize.columns <= 90;

  return (
    <Box flexDirection="column" height={termHeight} overflow="hidden">
      {page === 'onboarding' ? (
        <OnboardingPage onComplete={handleOnboardingComplete} />
      ) : (
        <>
          <Header
            connection={connectionStatus}
            environment={environment}
            configPath={getConfigPath()}
            connectionError={connectionError}
            compact={compactHeader}
            hasActiveRequest={activeRequestCount > 0}
          />

          {page === 'dashboard' && (
            <DashboardPage
              requests={requests}
              models={models}
              modelWarnings={modelWarnings}
              providers={providers}
              providersLoading={providersLoading}
              syncedNames={syncedNames}
              modelsLoading={modelsLoading}
              syncStatus={syncStatus}
              editorSessions={editorSessions.sessions}
              editorsLoading={editorSessions.loading}
              onNavigate={handleNavigate}
            />
          )}
          {page === 'setup' && (
            <SetupPage onBack={() => setPage('dashboard')} />
          )}
          {page === 'interfaces' && (
            <InterfacesPage
              onBack={() => setPage('dashboard')}
              sessions={editorSessions.sessions}
              refreshStatus={editorSessions.refreshStatus}
              refresh={editorSessions.refresh}
            />
          )}
          {page !== 'dashboard' &&
            page !== 'setup' &&
            page !== 'interfaces' && <Box flexGrow={1} />}

          {page !== 'dashboard' &&
            page !== 'setup' &&
            page !== 'interfaces' && (
              <NavigationMenu
                items={subpageMenuItems}
                onSelect={handleSubpageNavigate}
              />
            )}
        </>
      )}
    </Box>
  );
}
