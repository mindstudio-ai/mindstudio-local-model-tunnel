import React, { useEffect, useCallback, useState } from 'react';
import { Box, useApp, useStdout } from 'ink';
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
  const { models, loading: modelsLoading, refresh: refreshModels } = useModels();
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
    setPage('config');
  }, [retryConnection, refreshRegistered]);

  const handleRegisterComplete = useCallback(() => {
    refreshRegistered();
    refreshModels();
    setPage('models');
  }, [refreshRegistered, refreshModels]);

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
          refreshModels();
          refreshRegistered();
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
        case 'refresh-models':
          refreshAll();
          break;
        case 'quit':
          handleQuit();
          break;
      }
    },
    [handleSetup, refreshAll, refreshModels, refreshRegistered, handleQuit],
  );

  const commonMenuItems: MenuItem[] = [
    { id: 'back', label: 'Back', description: 'Return to dashboard' },
  ];

  const getSubpageMenuItems = useCallback((): MenuItem[] => {
    switch (page) {
      case 'models':
        return [
          { id: 'refresh-models', label: 'Refresh', description: 'Re-scan local model providers' },
          { id: 'register', label: 'Register Models', description: 'Register models with MindStudio' },
          ...commonMenuItems,
        ];
      case 'config':
        return [
          { id: 'auth', label: 'Re-authenticate', description: 'Re-authenticate with MindStudio' },
          ...commonMenuItems,
        ];
      default:
        return commonMenuItems;
    }
  }, [page]);

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
    <Box flexDirection="column" height={termHeight}>
      {page === 'dashboard' ? (
        <DashboardPage
          providers={providers}
          requests={requests}
          activeCount={activeCount}
          connectionStatus={connectionStatus}
          environment={environment}
          connectionError={connectionError}
          modelCount={models.length}
          onNavigate={handleNavigate}
        />
      ) : (
        <>
          <Header
            connection={connectionStatus}
            environment={environment}
            activeRequests={activeCount}
            page={page}
          />

          {page === 'models' && (
            <ModelsPage models={models} registeredNames={registeredNames} loading={modelsLoading} />
          )}
          {page === 'config' && <ConfigPage />}
          {page === 'auth' && <AuthPage onComplete={handleAuthComplete} />}
          {page === 'register' && (
            <RegisterPage onComplete={handleRegisterComplete} />
          )}

          <Box flexGrow={1} />

          <NavigationMenu items={getSubpageMenuItems()} onSelect={handleSubpageNavigate} />
        </>
      )}
    </Box>
  );
}
