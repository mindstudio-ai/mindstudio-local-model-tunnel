import React, { useEffect, useCallback, useState } from 'react';
import { Box, useApp, useStdout } from 'ink';
import { Header } from './components/Header';
import { NavigationMenu } from './components/NavigationMenu';
import type { MenuItem } from './components/NavigationMenu';
import { useConnection } from './hooks/useConnection';
import { useProviders } from './hooks/useProviders';
import { useModels } from './hooks/useModels';
import { useRequests } from './hooks/useRequests';
import { useSyncedModels } from './hooks/useRegisteredModels';
import { DashboardPage } from './pages/DashboardPage';
import { SyncPage } from './pages/RegisterPage';
import { SetupPage } from './pages/SetupPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { TunnelRunner } from '../runner';
import { getApiKey, getConfigPath } from '../config';
import type { Page } from './types';

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
  const { refresh: refreshProviders } = useProviders();
  const {
    models,
    warnings: modelWarnings,
    loading: modelsLoading,
    refresh: refreshModels,
  } = useModels();
  const { requests } = useRequests();
  const { syncedNames, refresh: refreshSynced } =
    useSyncedModels(connectionStatus);
  const shouldOnboard = getApiKey() === undefined;
  const [page, setPage] = useState<Page>(
    shouldOnboard ? 'onboarding' : 'dashboard',
  );

  // Refresh everything when returning to dashboard
  useEffect(() => {
    if (page === 'dashboard') {
      refreshAll();
    }
  }, [page]);

  // Start runner when connected with models
  useEffect(() => {
    if (connectionStatus === 'connected' && models.length > 0) {
      runner.start(models.map((m) => m.name));
    }
  }, [connectionStatus, models, runner]);

  // Stop only on unmount
  useEffect(() => () => runner.stop(), [runner]);

  // Refresh everything
  const refreshAll = useCallback(async () => {
    await Promise.all([
      refreshProviders(),
      refreshModels(),
      refreshSynced(),
    ]);
  }, [refreshProviders, refreshModels, refreshSynced]);

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
        case 'auth':
          setPage('onboarding');
          break;
        case 'register':
          setPage('sync');
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
    [refreshModels, refreshSynced, refreshAll, handleQuit],
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

  const termHeight = (stdout?.rows ?? 24) - 4;

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
          />

          {page === 'dashboard' && (
            <DashboardPage
              requests={requests}
              models={models}
              modelWarnings={modelWarnings}
              syncedNames={syncedNames}
              modelsLoading={modelsLoading}
              onNavigate={handleNavigate}
            />
          )}
          {page === 'setup' && (
            <SetupPage onBack={() => setPage('dashboard')} />
          )}
          {page === 'sync' && <SyncPage />}

          {page !== 'dashboard' && page !== 'setup' && <Box flexGrow={1} />}

          {page !== 'dashboard' && page !== 'setup' && (
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
