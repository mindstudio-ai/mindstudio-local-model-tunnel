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
  SettingsPage,
  AuthPage,
  RegisterPage,
  SetupPage,
  OnboardingPage,
} from './pages/index.js';
import { TunnelRunner } from '../runner.js';
import { getApiKey } from '../config.js';
import type { Page } from './types.js';

interface AppProps {
  runner: TunnelRunner;
  initialPage?: Page;
  onExit?: (reason: string) => void;
}

export function App({ runner, initialPage, onExit }: AppProps) {
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
  const shouldOnboard = !initialPage && getApiKey() === undefined;
  const [page, setPage] = useState<Page>(initialPage ?? (shouldOnboard ? 'onboarding' : 'dashboard'));

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
    setPage('settings');
  }, [retryConnection, refreshRegistered]);

  const handleRegisterComplete = useCallback(() => {
    refreshRegistered();
    refreshModels();
    setPage('settings');
  }, [refreshRegistered, refreshModels]);

  const handleQuit = useCallback(() => {
    runner.stop();
    onExit?.('quit');
    exit();
  }, [runner, onExit, exit]);

  const handleExternalSetupAction = useCallback((action: string) => {
    runner.stop();
    onExit?.('setup:' + action);
    exit();
  }, [runner, onExit, exit]);

  const handleOnboardingComplete = useCallback(() => {
    retryConnection();
    refreshAll();
    setPage('dashboard');
  }, [retryConnection, refreshAll]);

  const handleNavigate = useCallback(
    (id: string) => {
      switch (id) {
        case 'settings':
          setPage('settings');
          refreshModels();
          refreshRegistered();
          break;
        case 'auth':
          setPage('auth');
          break;
        case 'register':
          setPage('register');
          break;
        case 'setup':
          setPage('setup');
          break;
        case 'quit':
          handleQuit();
          break;
      }
    },
    [refreshModels, refreshRegistered, handleQuit],
  );

  const commonMenuItems: MenuItem[] = [
    { id: 'back', label: 'Back', description: 'Return to dashboard' },
  ];

  const getSubpageMenuItems = useCallback((): MenuItem[] => {
    switch (page) {
      case 'settings':
        return [
          { id: 'register', label: 'Register Models', description: 'Register models with MindStudio' },
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
    <Box flexDirection="column" height={termHeight} overflow="hidden">
      {page === 'onboarding' ? (
        <OnboardingPage
          onComplete={handleOnboardingComplete}
        />
      ) : page === 'dashboard' ? (
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
      ) : page === 'setup' ? (
        <SetupPage
          connectionStatus={connectionStatus}
          environment={environment}
          activeRequests={activeCount}
          onExternalAction={handleExternalSetupAction}
          onBack={() => setPage('dashboard')}
        />
      ) : (
        <>
          <Header
            connection={connectionStatus}
            environment={environment}
            activeRequests={activeCount}
            page={page}
          />

          {page === 'settings' && (
            <SettingsPage
              connectionStatus={connectionStatus}
              environment={environment}
              models={models}
              registeredNames={registeredNames}
              modelsLoading={modelsLoading}
              providers={providers}
            />
          )}
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
