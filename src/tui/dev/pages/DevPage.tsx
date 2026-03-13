import React, { useState, useEffect, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import { NavigationMenu } from '../../components/NavigationMenu';
import type { MenuItem } from '../../components/NavigationMenu';
import { DevRequestLog } from '../components/DevRequestLog';
import { DevPortPrompt } from '../components/DevPortPrompt';
import { TabBar, type Tab } from '../components/TabBar';
import { useDevSession } from '../hooks/useDevSession';
import { useDevRequests } from '../hooks/useDevRequests';
import type { AppConfig } from '../../../dev/types';

const TABS: Tab[] = [
  { id: 'info', label: 'Info' },
  { id: 'requests', label: 'Requests' },
  { id: 'methods', label: 'Methods' },
  { id: 'server', label: 'Dev Server' },
];

interface DevPageProps {
  appConfig: AppConfig;
  onNavigate: (id: string) => void;
  termHeight?: number;
}

export function DevPage({ appConfig, onNavigate, termHeight }: DevPageProps) {
  const {
    phase,
    session,
    error,
    devPort,
    proxyPort,
    devServer,
    syncResult,
    installStatus,
    start,
    stop,
    resync,
    submitPort,
    skipFrontend,
  } = useDevSession(appConfig);
  const { requests, activeCount } = useDevRequests();
  const [activeTab, setActiveTab] = useState('info');

  const runningMenuItems: MenuItem[] = useMemo(
    () => [
      { id: 'sync', label: 'Sync Schema', description: 'Re-sync table definitions from disk' },
      { id: 'stop', label: 'Stop Session', description: 'Stop the dev session and clean up' },
      { id: 'dashboard', label: 'Local Models', description: 'Switch to local models view' },
      { id: 'quit', label: 'Quit', description: 'Exit the application' },
    ],
    [],
  );

  // Tab navigation with left/right arrows (only when running)
  useInput((_input, key) => {
    if (phase !== 'running') return;
    if (key.leftArrow) {
      const idx = TABS.findIndex((t) => t.id === activeTab);
      setActiveTab(TABS[(idx - 1 + TABS.length) % TABS.length].id);
    } else if (key.rightArrow) {
      const idx = TABS.findIndex((t) => t.id === activeTab);
      setActiveTab(TABS[(idx + 1) % TABS.length].id);
    }
  });

  // Auto-start when ready
  useEffect(() => {
    if (phase === 'ready') {
      start();
    }
  }, [phase, start]);

  // Detecting state
  if (phase === 'detecting') {
    return (
      <Box flexDirection="column" paddingX={1} marginTop={1}>
        <Text>
          <Spinner type="dots" /> Checking app configuration...
        </Text>
      </Box>
    );
  }

  // Needs port input
  if (phase === 'needs_port') {
    return (
      <Box flexDirection="column" flexGrow={1}>
        <AppInfoHeader appConfig={appConfig} />
        <DevPortPrompt onSubmit={submitPort} onSkip={skipFrontend} />
      </Box>
    );
  }

  // Starting
  if (phase === 'starting') {
    return (
      <Box flexDirection="column" flexGrow={1}>
        <AppInfoHeader appConfig={appConfig} />
        <Box paddingX={1} marginTop={1} flexDirection="column">
          <Text>
            <Spinner type="dots" /> Starting dev session...
          </Text>
          {installStatus && (
            <Text color="gray">
              <Spinner type="dots" /> {installStatus}
            </Text>
          )}
          {devServer.phase === 'starting' && (
            <Text color="gray">
              <Spinner type="dots" /> Waiting for dev server on port {devPort}...
            </Text>
          )}
          {devServer.outputLines.slice(-6).map((line, i) => (
            <Text key={i} color="gray" dimColor wrap="truncate">{line}</Text>
          ))}
        </Box>
      </Box>
    );
  }

  // Error state
  if (phase === 'error') {
    const errorMenuItems: MenuItem[] = [
      { id: 'retry', label: 'Retry', description: 'Try starting the session again' },
      { id: 'dashboard', label: 'Local Models', description: 'Switch to local models view' },
      { id: 'quit', label: 'Quit', description: 'Exit the application' },
    ];

    return (
      <Box flexDirection="column" flexGrow={1}>
        <AppInfoHeader appConfig={appConfig} />
        <Box flexDirection="column" paddingX={1} marginTop={1}>
          {error && <Text color="red">✖ {error}</Text>}
          {devServer.error && <Text color="red">Dev server: {devServer.error}</Text>}
          {devServer.outputLines.slice(-5).map((line, i) => (
            <Text key={i} color="gray" dimColor wrap="truncate">{line}</Text>
          ))}
        </Box>
        <Box flexGrow={1} />
        <NavigationMenu
          items={errorMenuItems}
          onSelect={(id) => {
            if (id === 'retry') start();
            else onNavigate(id);
          }}
        />
      </Box>
    );
  }

  // Stopped state
  if (phase === 'stopped') {
    const stoppedMenuItems: MenuItem[] = [
      { id: 'restart', label: 'Restart', description: 'Start a new dev session' },
      { id: 'dashboard', label: 'Local Models', description: 'Switch to local models view' },
      { id: 'quit', label: 'Quit', description: 'Exit the application' },
    ];

    return (
      <Box flexDirection="column" flexGrow={1}>
        <AppInfoHeader appConfig={appConfig} />
        <Box flexDirection="column" paddingX={1} marginTop={1}>
          <Text color="yellow">Session stopped.</Text>
        </Box>
        <Box flexGrow={1} />
        <NavigationMenu
          items={stoppedMenuItems}
          onSelect={(id) => {
            if (id === 'restart') start();
            else onNavigate(id);
          }}
        />
      </Box>
    );
  }

  // Expired state
  if (phase === 'expired') {
    const expiredMenuItems: MenuItem[] = [
      { id: 'restart', label: 'Restart', description: 'Start a new dev session' },
      { id: 'dashboard', label: 'Local Models', description: 'Switch to local models view' },
      { id: 'quit', label: 'Quit', description: 'Exit the application' },
    ];

    return (
      <Box flexDirection="column" flexGrow={1}>
        <AppInfoHeader appConfig={appConfig} />
        <Box flexDirection="column" paddingX={1} marginTop={1}>
          <Text color="yellow">
            ⚠ Dev session expired. The platform may have timed it out.
          </Text>
        </Box>
        <Box flexGrow={1} />
        <NavigationMenu
          items={expiredMenuItems}
          onSelect={(id) => {
            if (id === 'restart') start();
            else onNavigate(id);
          }}
        />
      </Box>
    );
  }

  // Running state — tabbed view
  const statusLines = 4; // status bar + tab bar
  const menuLines = 8;
  const contentHeight = Math.max(5, (termHeight ?? 30) - statusLines - menuLines);

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Persistent status bar */}
      <Box flexDirection="column" paddingX={1} paddingTop={1}>
        <Box gap={2}>
          <Text bold color="white">{appConfig.name}</Text>
          <Text color="green">● {session?.branch ?? 'main'}</Text>
          <Text color="cyan">{session?.previewUrl ?? session?.webInterfaceUrl ?? ''}</Text>
        </Box>
      </Box>

      {/* Tab content */}
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {activeTab === 'info' && (
          <InfoTab
            appConfig={appConfig}
            session={session}
            devPort={devPort}
            proxyPort={proxyPort}
            devServerPhase={devServer.phase}
            requests={requests}
            syncResult={syncResult}
            contentHeight={contentHeight}
          />
        )}
        {activeTab === 'requests' && (
          <DevRequestLog requests={requests} maxVisible={contentHeight} />
        )}
        {activeTab === 'methods' && (
          <MethodsTab appConfig={appConfig} contentHeight={contentHeight} />
        )}
        {activeTab === 'server' && (
          <DevServerTab
            devPort={devPort}
            phase={devServer.phase}
            outputLines={devServer.outputLines}
            error={devServer.error}
            contentHeight={contentHeight}
          />
        )}
      </Box>

      {/* Menu */}
      <NavigationMenu
        items={runningMenuItems}
        onSelect={(id) => {
          if (id === 'sync') resync();
          else if (id === 'stop') stop();
          else onNavigate(id);
        }}
      />

      {/* Tab bar */}
      <TabBar tabs={TABS} activeTab={activeTab} />
    </Box>
  );
}

/** Compact header showing app name for non-running states. */
function AppInfoHeader({ appConfig }: { appConfig: AppConfig }) {
  return (
    <Box
      flexDirection="column"
      paddingX={1}
      paddingY={1}
      borderStyle="round"
      borderColor="gray"
    >
      <Text bold color="white">
        {appConfig.name}
      </Text>
      {appConfig.description && (
        <Text color="gray">{appConfig.description}</Text>
      )}
      {!appConfig.appId && (
        <Text color="yellow">
          ⚠ No &quot;appId&quot; field in mindstudio.json — add your app ID to start a dev session
        </Text>
      )}
    </Box>
  );
}

/** Info tab — session details, databases, summary stats. */
function InfoTab({
  appConfig,
  session,
  devPort,
  proxyPort,
  devServerPhase,
  requests,
  syncResult,
  contentHeight,
}: {
  appConfig: AppConfig;
  session: ReturnType<typeof useDevSession>['session'];
  devPort: number | null;
  proxyPort: number | null;
  devServerPhase: string;
  requests: import('../../../dev/types').DevRequestLogEntry[];
  syncResult: import('../../../dev/types').SyncSchemaResponse | null;
  contentHeight: number;
}) {
  return (
    <Box flexDirection="column" paddingX={1} marginTop={1}>
      <Text bold color="white" underline>Session</Text>
      <Text>
        <Text color="gray">Session ID: </Text>
        <Text>{session?.sessionId ?? '...'}</Text>
      </Text>
      <Text>
        <Text color="gray">Release ID: </Text>
        <Text>{session?.releaseId ?? '...'}</Text>
      </Text>
      <Text>
        <Text color="gray">Branch:     </Text>
        <Text>{session?.branch ?? '...'}</Text>
      </Text>
      {session?.user && (
        <Text>
          <Text color="gray">User:       </Text>
          <Text>{session.user.name} ({session.user.email})</Text>
        </Text>
      )}

      <Box marginTop={1}><Text bold color="white" underline>App URL</Text></Box>
      <Text color="cyan" bold>
        {session?.previewUrl ?? session?.webInterfaceUrl ?? '...'}
      </Text>

      <Box marginTop={1}><Text bold color="white" underline>Dev Server</Text></Box>
      {devPort !== null ? (
        <Text>
          <Text>localhost:{devPort}</Text>
          {devServerPhase === 'running' ? (
            <Text color="green"> ● running</Text>
          ) : devServerPhase === 'starting' ? (
            <Text color="yellow"> ○ starting</Text>
          ) : (
            <Text color="gray"> ○ {devServerPhase}</Text>
          )}
        </Text>
      ) : (
        <Text color="gray" dimColor>Backend-only mode (no frontend)</Text>
      )}

      <Box marginTop={1}><Text bold color="white" underline>Databases</Text></Box>
      {(session?.databases ?? []).length === 0 ? (
        <Text color="gray" dimColor>No databases</Text>
      ) : (
        session?.databases.map((db) => (
          <Box key={db.id} flexDirection="column">
            <Text>  <Text color="cyan">{db.name}</Text></Text>
            {db.tables.map((table) => (
              <Text key={table.name} color="gray">    {table.name}</Text>
            ))}
          </Box>
        ))
      )}

      {syncResult && (
        <Box marginTop={1} flexDirection="column">
          <Text bold color="white" underline>Schema Sync</Text>
          {syncResult.created.length > 0 && (
            <Text color="green">  ✓ Created: {syncResult.created.join(', ')}</Text>
          )}
          {syncResult.altered.length > 0 && (
            <Text color="yellow">  ✓ Altered: {syncResult.altered.join(', ')}</Text>
          )}
          {syncResult.errors.map((err, i) => (
            <Text key={i} color="red">  ✖ {err}</Text>
          ))}
          {syncResult.created.length === 0 && syncResult.altered.length === 0 && syncResult.errors.length === 0 && (
            <Text color="gray" dimColor>  No changes</Text>
          )}
        </Box>
      )}

      <Box marginTop={1}><Text bold color="white" underline>Recent Requests</Text></Box>
      {requests.length === 0 ? (
        <Text color="gray" dimColor>No requests yet</Text>
      ) : (
        requests.slice(-5).map((req) => (
          <Box key={req.id} gap={1}>
            {req.status === 'completed' && <Text color="green">✓</Text>}
            {req.status === 'failed' && <Text color="red">✖</Text>}
            {req.status === 'processing' && <Text color="cyan">●</Text>}
            <Text>{req.method ?? 'unknown'}</Text>
            {req.duration != null && <Text color="gray">{req.duration}ms</Text>}
            {req.status === 'failed' && req.error && (
              <Text color="red" wrap="truncate">{req.error.split('\n')[0]}</Text>
            )}
          </Box>
        ))
      )}
    </Box>
  );
}

/** Methods tab — list all methods from mindstudio.json. */
function MethodsTab({
  appConfig,
  contentHeight,
}: {
  appConfig: AppConfig;
  contentHeight: number;
}) {
  return (
    <Box flexDirection="column" paddingX={1} marginTop={1}>
      <Text bold color="white" underline>
        Methods ({appConfig.methods.length})
      </Text>
      {appConfig.methods.slice(0, contentHeight - 2).map((method) => (
        <Box key={method.id} gap={1}>
          <Text color="cyan">{method.export}</Text>
          <Text color="gray" dimColor>→ {method.id}</Text>
          <Text color="gray" dimColor>({method.path})</Text>
        </Box>
      ))}
      {appConfig.methods.length === 0 && (
        <Text color="gray" dimColor>No methods defined</Text>
      )}
    </Box>
  );
}

/** Dev Server tab — full-height output log. */
function DevServerTab({
  devPort,
  phase,
  outputLines,
  error,
  contentHeight,
}: {
  devPort: number | null;
  phase: string;
  outputLines: string[];
  error: string | null;
  contentHeight: number;
}) {
  const visibleLines = contentHeight - 3; // header + port line + padding

  return (
    <Box flexDirection="column" paddingX={1} marginTop={1}>
      <Text bold color="white" underline>
        Dev Server
        {phase === 'running' ? (
          <Text color="green"> ● running</Text>
        ) : phase === 'starting' ? (
          <Text color="yellow"> ○ starting</Text>
        ) : phase === 'error' ? (
          <Text color="red"> ✖ error</Text>
        ) : (
          <Text color="gray"> ○ {phase}</Text>
        )}
      </Text>
      {devPort !== null && (
        <Text color="gray" dimColor>localhost:{devPort}</Text>
      )}
      {devPort === null && (
        <Text color="gray" dimColor>Backend-only mode (no frontend)</Text>
      )}
      {error && <Text color="red">{error}</Text>}
      {outputLines.slice(-visibleLines).map((line, i) => (
        <Text key={i} color="gray" wrap="truncate">
          {line}
        </Text>
      ))}
      {outputLines.length === 0 && phase !== 'idle' && !error && (
        <Text color="gray" dimColor>Waiting for output...</Text>
      )}
      {outputLines.length === 0 && phase === 'idle' && !error && (
        <Text color="gray" dimColor>Dev server not started</Text>
      )}
    </Box>
  );
}
