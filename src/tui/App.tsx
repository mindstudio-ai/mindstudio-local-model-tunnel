import React, { useEffect, useCallback, useState } from 'react';
import { Box, useApp, useStdout } from 'ink';
import { Header, NavigationMenu } from './components';
import type { MenuItem } from './components';
import {
  useConnection,
  useProviders,
  useModels,
  useRequests,
  useRegisteredModels,
} from './hooks';
import {
  DashboardPage,
  AuthPage,
  RegisterPage,
  SetupPage,
  OnboardingPage,
} from './pages';
import { TunnelRunner } from '../runner';
import { getApiKey, getConfigPath } from '../config';
import { getVersion } from '../helpers';
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
  const { providers, refresh: refreshProviders } = useProviders();
  const { models, loading: modelsLoading, refresh: refreshModels } = useModels();
  const { requests, activeCount } = useRequests();
  const { registeredNames, refresh: refreshRegistered } =
    useRegisteredModels(connectionStatus);
  const shouldOnboard = getApiKey() === undefined;
  const [page, setPage] = useState<Page>(shouldOnboard ? 'onboarding' : 'dashboard');

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
      refreshRegistered(),
    ]);
  }, [refreshProviders, refreshModels, refreshRegistered]);

  const handleAuthComplete = useCallback(() => {
    retryConnection();
    refreshRegistered();
    setPage('dashboard');
  }, [retryConnection, refreshRegistered]);

  const handleRegisterComplete = useCallback(() => {
    refreshRegistered();
    refreshModels();
    setPage('dashboard');
  }, [refreshRegistered, refreshModels]);

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
          setPage('auth');
          break;
        case 'register':
          setPage('register');
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
    [refreshModels, refreshRegistered, refreshAll, handleQuit],
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
        <OnboardingPage
          onComplete={handleOnboardingComplete}
        />
      ) : (
        <>
          <Header
            connection={connectionStatus}
            environment={environment}
            activeRequests={activeCount}
            page={page}
            version={getVersion()}
            configPath={getConfigPath()}
            connectionError={connectionError}
          />

          {page === 'dashboard' && (
            <DashboardPage
              providers={providers}
              requests={requests}
              models={models}
              registeredNames={registeredNames}
              modelsLoading={modelsLoading}
              onNavigate={handleNavigate}
            />
          )}
          {page === 'setup' && (
            <SetupPage
              onBack={() => setPage('dashboard')}
            />
          )}
          {page === 'auth' && <AuthPage onComplete={handleAuthComplete} />}
          {page === 'register' && (
            <RegisterPage onComplete={handleRegisterComplete} />
          )}

          {page !== 'dashboard' && page !== 'setup' && <Box flexGrow={1} />}

          {page !== 'dashboard' && page !== 'setup' && (
            <NavigationMenu items={subpageMenuItems} onSelect={handleSubpageNavigate} />
          )}
        </>
      )}
    </Box>
  );
}
