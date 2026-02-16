import React, { useEffect, useCallback, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { Header, StatusBar } from './components/index.js';
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
import type { Page, ConnectionStatus } from './types.js';

interface Shortcut {
  key: string;
  label: string;
}

function shortcutsForPage(
  page: Page,
  connectionStatus: ConnectionStatus,
): Shortcut[] {
  if (page === 'auth' || page === 'register') {
    return [
      { key: 'Esc', label: 'Back' },
      { key: 'q', label: 'Quit' },
    ];
  }

  if (page !== 'dashboard') {
    return [
      { key: 'Esc', label: 'Dashboard' },
      { key: 'q', label: 'Quit' },
    ];
  }

  // Dashboard shortcuts
  const shortcuts: Shortcut[] = [
    { key: 'm', label: 'Models' },
    { key: 'c', label: 'Config' },
  ];

  if (connectionStatus === 'not_authenticated') {
    shortcuts.push({ key: 'a', label: 'Auth' });
  } else if (connectionStatus === 'connected') {
    shortcuts.push({ key: 'a', label: 'Re-auth' });
    shortcuts.push({ key: 'g', label: 'Register' });
  }

  shortcuts.push({ key: 's', label: 'Setup' });
  shortcuts.push({ key: 'r', label: 'Refresh' });
  shortcuts.push({ key: 'q', label: 'Quit' });

  return shortcuts;
}

interface AppProps {
  runner: TunnelRunner;
  onExit?: (reason: 'quit' | 'setup') => void;
}

export function App({ runner, onExit }: AppProps) {
  const { exit } = useApp();
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

  // Keyboard shortcuts
  useInput((input, key) => {
    const lowerInput = input.toLowerCase();

    // Quit from any page
    if (lowerInput === 'q') {
      handleQuit();
      return;
    }

    // Escape: go back from subpages to dashboard
    if (key.escape) {
      if (page !== 'dashboard') {
        setPage('dashboard');
      } else {
        handleQuit();
      }
      return;
    }

    // Dashboard-only shortcuts
    if (page === 'dashboard') {
      if (lowerInput === 'm') {
        setPage('models');
      } else if (lowerInput === 'c') {
        setPage('config');
      } else if (lowerInput === 'a') {
        setPage('auth');
      } else if (lowerInput === 'g' && connectionStatus === 'connected') {
        setPage('register');
      } else if (lowerInput === 's') {
        handleSetup();
      } else if (lowerInput === 'r') {
        refreshAll();
      }
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Header
        connection={connectionStatus}
        environment={environment}
        activeRequests={activeCount}
        page={page}
      />

      {connectionError && page === 'dashboard' && (
        <Box marginBottom={1}>
          <Text color="red">{connectionError}</Text>
        </Box>
      )}

      {page === 'dashboard' && (
        <DashboardPage
          providers={providers}
          models={models}
          requests={requests}
          activeCount={activeCount}
        />
      )}
      {page === 'models' && (
        <ModelsPage models={models} registeredNames={registeredNames} />
      )}
      {page === 'config' && <ConfigPage />}
      {page === 'auth' && <AuthPage onComplete={handleAuthComplete} />}
      {page === 'register' && (
        <RegisterPage onComplete={handleRegisterComplete} />
      )}

      <StatusBar shortcuts={shortcutsForPage(page, connectionStatus)} />
    </Box>
  );
}
