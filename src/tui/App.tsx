import React, { useEffect, useCallback, useState } from 'react';
import { Box, Text, useApp, useStdout } from 'ink';
import { Header, NavigationMenu } from './components/index.js';
import type { MenuItem } from './components/index.js';
import {
  useConnection,
  useProviders,
  useModels,
  useRequests,
  useRegisteredModels,
} from './hooks/index.js';
import {
  DashboardPage,
  ModelsPage,
  ConfigPage,
  AuthPage,
  RegisterPage,
} from './pages/index.js';
import { TunnelRunner } from '../runner.js';
import type { Page } from './types.js';

interface AppProps {
  runner: TunnelRunner;
  onExit?: (reason: 'quit' | 'setup') => void;
}

export function App({ runner, onExit }: AppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const {
    status: connectionStatus,
    environment,
    error: connectionError,
    retry: retryConnection,
  } = useConnection();
  const { providers, refresh: refreshProviders } = useProviders();
  const { models, refresh: refreshModels } = useModels();
  const { requests, activeCount } = useRequests();
  const { registeredNames, refresh: refreshRegistered } =
    useRegisteredModels(connectionStatus);
  const [page, setPage] = useState<Page>('dashboard');

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
    setPage('dashboard');
  }, [refreshRegistered]);

  const handleQuit = useCallback(() => {
    runner.stop();
    onExit?.('quit');
    exit();
  }, [runner, onExit, exit]);

  const handleSetup = useCallback(() => {
    runner.stop();
    onExit?.('setup');
    exit();
  }, [runner, onExit, exit]);

  const handleNavigate = useCallback(
    (id: string) => {
      switch (id) {
        case 'models':
          setPage('models');
          break;
        case 'config':
          setPage('config');
          break;
        case 'auth':
          setPage('auth');
          break;
        case 'register':
          setPage('register');
          break;
        case 'setup':
          handleSetup();
          break;
        case 'refresh':
          refreshAll();
          break;
        case 'quit':
          handleQuit();
          break;
      }
    },
    [handleSetup, refreshAll, handleQuit],
  );

  const subpageMenuItems: MenuItem[] = [
    { id: 'back', label: 'Back', description: 'Return to dashboard' },
    { id: 'quit', label: 'Exit', description: 'Quit the application' },
  ];

  const handleSubpageNavigate = useCallback(
    (id: string) => {
      if (id === 'back') {
        setPage('dashboard');
      } else if (id === 'quit') {
        handleQuit();
      }
    },
    [handleQuit],
  );

  if (page === 'dashboard') {
    return (
      <Box flexDirection="column" height={(stdout?.rows ?? 24) - 4}>
        <DashboardPage
          providers={providers}
          requests={requests}
          activeCount={activeCount}
          connectionStatus={connectionStatus}
          environment={environment}
          connectionError={connectionError}
          onNavigate={handleNavigate}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Header
        connection={connectionStatus}
        environment={environment}
        activeRequests={activeCount}
        page={page}
      />

      {page === 'models' && (
        <ModelsPage models={models} registeredNames={registeredNames} />
      )}
      {page === 'config' && <ConfigPage />}
      {page === 'auth' && <AuthPage onComplete={handleAuthComplete} />}
      {page === 'register' && (
        <RegisterPage onComplete={handleRegisterComplete} />
      )}

      <NavigationMenu items={subpageMenuItems} onSelect={handleSubpageNavigate} />
    </Box>
  );
}
