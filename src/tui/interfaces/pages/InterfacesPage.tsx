import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import type { RefreshStatus } from '../hooks/useEditorSessions';
import { useLocalInterface } from '../hooks/useLocalInterface';
import { InterfaceSessionView } from './InterfaceSessionView';
import { InterfaceRunningView } from './InterfaceRunningView';
import type {
  EditorSession,
  CustomInterfaceStepInfo,
  ScriptStepInfo,
} from '../../../api';

interface InterfacesPageProps {
  onBack: () => void;
  sessions: EditorSession[];
  refreshStatus: RefreshStatus;
  refresh: () => Promise<void>;
}

export interface InterfaceItem {
  kind: 'interface';
  appId: string;
  appName: string;
  step: CustomInterfaceStepInfo;
}

export interface ScriptItem {
  kind: 'script';
  appId: string;
  appName: string;
  step: ScriptStepInfo;
}

type ListItem = InterfaceItem | ScriptItem;

type SessionStatus = 'running' | 'starting' | 'stopped' | 'compiling';

function getSessionStatus(item: ListItem): SessionStatus {
  if (item.kind === 'script') return 'running';
  const status = item.step.spaEditorSession?.status;
  if (status === 'running' || status === 'compiling') return status;
  if (status === 'starting') return 'starting';
  return 'stopped';
}

function isItemSelectable(item: ListItem): boolean {
  const status = getSessionStatus(item);
  return status === 'running' || status === 'compiling';
}

function getStatusLabel(status: SessionStatus): {
  text: string;
  color: string;
} {
  switch (status) {
    case 'running':
    case 'compiling':
      return { text: 'Online', color: 'green' };
    case 'starting':
      return { text: 'Starting', color: 'yellow' };
    case 'stopped':
      return { text: 'Offline', color: 'gray' };
  }
}

function getRefreshSuffix(status: RefreshStatus): string | null {
  switch (status) {
    case 'refreshing':
      return 'Refreshing...';
    case 'refreshed':
      return '\u2713 Refreshed';
    case 'idle':
      return null;
  }
}

function formatCount(interfaces: number, scripts: number): string {
  const parts: string[] = [];
  if (interfaces > 0) {
    parts.push(`${interfaces} Interface${interfaces !== 1 ? 's' : ''}`);
  }
  if (scripts > 0) {
    parts.push(`${scripts} Script${scripts !== 1 ? 's' : ''}`);
  }
  return parts.join(', ');
}

// --- Offline view (level 3) ---

function OfflineView({ item, onBack }: { item: ListItem; onBack: () => void }) {
  useInput((input, key) => {
    if (input === 'q' || key.escape || key.return) {
      onBack();
    }
  });

  const name =
    item.kind === 'interface'
      ? `${item.step.workflowName} - ${item.step.displayName}`
      : `${item.step.workflowName} - ${item.step.displayName}`;

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="column" paddingX={1} marginTop={1}>
        <Text bold color="white" underline>
          {name}
        </Text>

        <Box marginTop={1} flexDirection="column">
          <Text color="yellow">This interface is offline.</Text>
          <Text color="gray">
            Start the interface designer in MindStudio to connect to it.
          </Text>
        </Box>

        <Box marginTop={1}>
          <Text color="cyan" bold>
            {'\u276F'} Back
          </Text>
        </Box>

        <Box marginTop={1}>
          <Text color="gray">Enter/q/Esc Back</Text>
        </Box>
      </Box>
    </Box>
  );
}

// --- Agent list (level 1) ---

function AgentListView({
  sessions,
  onBack,
  onSelectAgent,
  onRefresh,
  refreshStatus,
}: {
  sessions: EditorSession[];
  onBack: () => void;
  onSelectAgent: (appId: string) => void;
  onRefresh: () => void;
  refreshStatus: RefreshStatus;
}) {
  // Items: [sessions..., refresh, back]
  const refreshIndex = sessions.length;
  const backIndex = sessions.length + 1;
  const totalItems = sessions.length + 2;
  const [cursorIndex, setCursorIndex] = useState(0);

  useEffect(() => {
    setCursorIndex(sessions.length > 0 ? 0 : backIndex);
  }, [sessions.length, backIndex]);

  useInput((input, key) => {
    if (input === 'q' || key.escape) {
      onBack();
      return;
    }
    if (key.upArrow) {
      setCursorIndex((prev) => Math.max(0, prev - 1));
    } else if (key.downArrow) {
      setCursorIndex((prev) => Math.min(totalItems - 1, prev + 1));
    } else if (key.return) {
      if (cursorIndex === backIndex) {
        onBack();
      } else if (cursorIndex === refreshIndex) {
        onRefresh();
      } else if (sessions[cursorIndex]) {
        onSelectAgent(sessions[cursorIndex]!.appId);
      }
    }
  });

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="column" paddingX={1} marginTop={1}>
        <Text bold color="white" underline>
          Choose an Agent
        </Text>
        <Text color="gray">
          Don't see your agent? Make sure it's open in the MindStudio editor.
        </Text>

        {sessions.length === 0 ? (
          <Box marginTop={1} flexDirection="column">
            <Text color="yellow">No active editor sessions.</Text>
          </Box>
        ) : (
          <Box flexDirection="column" marginTop={1}>
            {sessions.map((session, i) => {
              const isSelected = i === cursorIndex;
              const stats = formatCount(
                session.customInterfaceSteps.length,
                session.scriptSteps.length,
              );
              return (
                <Box
                  key={session.appId}
                  flexDirection="column"
                  marginTop={i > 0 ? 1 : 0}
                >
                  <Box>
                    <Text
                      color={isSelected ? 'cyan' : 'white'}
                      bold={isSelected}
                    >
                      {isSelected ? '\u276F' : ' '} {session.appName}
                    </Text>
                    {isSelected && (
                      <Text color="gray">{' - Connect to this Agent'}</Text>
                    )}
                  </Box>
                  <Text color="gray">
                    {'  '}https://app.mindstudio.ai/agents/{session.appId}/edit
                  </Text>
                  {stats !== '' && (
                    <Text color="gray">
                      {'  '}
                      {stats}
                    </Text>
                  )}
                </Box>
              );
            })}
          </Box>
        )}

        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Text
              color={cursorIndex === refreshIndex ? 'cyan' : 'white'}
              bold={cursorIndex === refreshIndex}
            >
              {cursorIndex === refreshIndex ? '\u276F' : ' '} Refresh
            </Text>
            {getRefreshSuffix(refreshStatus) && (
              <Text color="gray"> {getRefreshSuffix(refreshStatus)}</Text>
            )}
          </Box>
          <Text
            color={cursorIndex === backIndex ? 'cyan' : 'white'}
            bold={cursorIndex === backIndex}
          >
            {cursorIndex === backIndex ? '\u276F' : ' '} Back
          </Text>
        </Box>

        <Box marginTop={1}>
          <Text color="gray">
            Up/Down Navigate {'\u2022'} Enter Select {'\u2022'} q/Esc Back
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

// --- Agent detail (level 2) ---

function AgentDetailView({
  session,
  onBack,
  onSelect,
  onRefresh,
  refreshStatus,
}: {
  session: EditorSession;
  onBack: () => void;
  onSelect: (item: InterfaceItem | ScriptItem) => void;
  onRefresh: () => void;
  refreshStatus: RefreshStatus;
}) {
  const [offlineItem, setOfflineItem] = useState<ListItem | null>(null);

  // Auto-polling handles background refresh, no need to trigger on mount

  const interfaces = useMemo(
    (): InterfaceItem[] =>
      session.customInterfaceSteps.map((step) => ({
        kind: 'interface',
        appId: session.appId,
        appName: session.appName,
        step,
      })),
    [session],
  );

  const scripts = useMemo(
    (): ScriptItem[] =>
      session.scriptSteps.map((step) => ({
        kind: 'script',
        appId: session.appId,
        appName: session.appName,
        step,
      })),
    [session],
  );

  const allItems = useMemo(
    (): ListItem[] => [...interfaces, ...scripts],
    [interfaces, scripts],
  );

  // Items: [allItems..., refresh, back]
  const refreshIndex = allItems.length;
  const backIndex = allItems.length + 1;
  const totalItems = allItems.length + 2;
  const [cursorIndex, setCursorIndex] = useState(0);

  useEffect(() => {
    setCursorIndex(0);
  }, [allItems.length]);

  useInput((input, key) => {
    if (offlineItem) return;
    if (input === 'q' || key.escape) {
      onBack();
      return;
    }
    if (key.upArrow) {
      setCursorIndex((prev) => Math.max(0, prev - 1));
    } else if (key.downArrow) {
      setCursorIndex((prev) => Math.min(totalItems - 1, prev + 1));
    } else if (key.return) {
      if (cursorIndex === backIndex) {
        onBack();
      } else if (cursorIndex === refreshIndex) {
        onRefresh();
      } else {
        const item = allItems[cursorIndex];
        if (item) {
          if (isItemSelectable(item)) {
            onSelect(item);
          } else {
            setOfflineItem(item);
          }
        }
      }
    }
  });

  if (offlineItem) {
    return (
      <OfflineView item={offlineItem} onBack={() => setOfflineItem(null)} />
    );
  }

  const scriptsOffset = interfaces.length;

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="column" paddingX={1} marginTop={1}>
        <Text bold color="white" underline>
          {session.appName}
        </Text>
        <Text color="gray">
          https://app.mindstudio.ai/agents/{session.appId}/edit
        </Text>
        <Text color="gray">
          Select an interface or script to connect your local editor.
        </Text>

        <Box flexDirection="column" marginTop={1}>
          <Text bold color="white">
            Interfaces
          </Text>
          {interfaces.length > 0 ? (
            <Box flexDirection="column" marginTop={1}>
              {interfaces.map((item, i) => {
                const isSelected = i === cursorIndex;
                const status = getSessionStatus(item);
                const statusLabel = getStatusLabel(status);

                return (
                  <Box
                    key={`${item.step.workflowId}:${item.step.stepId}`}
                    flexDirection="column"
                    marginTop={i > 0 ? 1 : 0}
                  >
                    <Text
                      color={isSelected ? 'cyan' : 'white'}
                      bold={isSelected}
                    >
                      {isSelected ? '\u276F' : ' '} {item.step.workflowName} -{' '}
                      {item.step.displayName}
                    </Text>
                    <Box>
                      <Text color={statusLabel.color}>
                        {'  '}
                        {statusLabel.text}
                      </Text>
                    </Box>
                  </Box>
                );
              })}
            </Box>
          ) : (
            <Text color="gray"> No interfaces in this agent.</Text>
          )}

          <Box flexDirection="column" marginTop={1}>
            <Text bold color="white">
              Scripts
            </Text>
            {scripts.length > 0 ? (
              <Box flexDirection="column" marginTop={1}>
                {scripts.map((item, i) => {
                  const index = scriptsOffset + i;
                  const isSelected = index === cursorIndex;

                  return (
                    <Box
                      key={`${item.step.workflowId}:${item.step.stepId}`}
                      flexDirection="column"
                      marginTop={i > 0 ? 1 : 0}
                    >
                      <Text
                        color={isSelected ? 'cyan' : 'white'}
                        bold={isSelected}
                      >
                        {isSelected ? '\u276F' : ' '} {item.step.workflowName} -{' '}
                        {item.step.displayName}
                      </Text>
                      <Text color="gray">
                        {'  '}
                        {item.step.entryFile}
                      </Text>
                    </Box>
                  );
                })}
              </Box>
            ) : (
              <Text color="gray"> No scripts in this agent.</Text>
            )}
          </Box>

          <Box flexDirection="column" marginTop={1}>
            <Box>
              <Text
                color={cursorIndex === refreshIndex ? 'cyan' : 'white'}
                bold={cursorIndex === refreshIndex}
              >
                {cursorIndex === refreshIndex ? '\u276F' : ' '} Refresh
              </Text>
              {getRefreshSuffix(refreshStatus) && (
                <Text color="gray"> {getRefreshSuffix(refreshStatus)}</Text>
              )}
            </Box>
            <Text
              color={cursorIndex === backIndex ? 'cyan' : 'white'}
              bold={cursorIndex === backIndex}
            >
              {cursorIndex === backIndex ? '\u276F' : ' '} Back
            </Text>
          </Box>
        </Box>

        <Box marginTop={1}>
          <Text color="gray">
            Up/Down Navigate {'\u2022'} Enter Select {'\u2022'} q/Esc Back
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

// --- Local dev view (level 3, interfaces and scripts) ---

function LocalDevView({
  item,
  onBack,
}: {
  item: InterfaceItem | ScriptItem;
  onBack: () => void;
}) {
  const mode = item.kind === 'script' ? 'script' : 'interface';

  let sessionId = '';
  if (item.kind === 'interface') {
    const hotUpdateDomain = item.step.spaEditorSession?.hotUpdateDomain ?? '';
    sessionId = hotUpdateDomain.replace(/^https?:\/\//, '').split('.')[0] || '';
  }

  const {
    phase,
    hasLocalCopy,
    localPath,
    outputLines,
    errorMessage,
    start,
    stop,
    deleteLocalCopy,
  } = useLocalInterface({
    mode,
    appId: item.appId,
    stepId: item.step.stepId,
    workflowId: item.step.workflowId,
    sessionId,
  });

  const name = `${item.step.workflowName} - ${item.step.displayName}`;

  const isActive =
    phase === 'cloning' ||
    phase === 'installing' ||
    phase === 'running' ||
    phase === 'deleting';

  // If the dev server exits (phase goes from active back to idle), go back to the list
  const wasActiveRef = useRef(false);
  useEffect(() => {
    if (isActive) {
      wasActiveRef.current = true;
    } else if (wasActiveRef.current && phase === 'idle') {
      wasActiveRef.current = false;
      onBack();
    }
  }, [phase, isActive, onBack]);

  if (isActive || phase === 'error') {
    return (
      <InterfaceRunningView
        name={name}
        phase={phase}
        outputLines={outputLines}
        errorMessage={errorMessage}
        localPath={localPath}
        onStop={stop}
        onBack={onBack}
      />
    );
  }

  return (
    <InterfaceSessionView
      item={item}
      onStart={start}
      onDelete={deleteLocalCopy}
      onBack={onBack}
      hasLocalCopy={hasLocalCopy}
      localPath={localPath}
    />
  );
}

// --- Main page ---

export function InterfacesPage({
  onBack,
  sessions,
  refreshStatus,
  refresh,
}: InterfacesPageProps) {
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<
    InterfaceItem | ScriptItem | null
  >(null);

  if (selectedItem) {
    return (
      <LocalDevView item={selectedItem} onBack={() => setSelectedItem(null)} />
    );
  }

  if (selectedAppId) {
    const session = sessions.find((s) => s.appId === selectedAppId);
    if (session) {
      return (
        <AgentDetailView
          session={session}
          onBack={() => setSelectedAppId(null)}
          onSelect={(item) => {
            setSelectedItem(item);
          }}
          onRefresh={refresh}
          refreshStatus={refreshStatus}
        />
      );
    }
  }

  return (
    <AgentListView
      sessions={sessions}
      onBack={onBack}
      onSelectAgent={setSelectedAppId}
      onRefresh={refresh}
      refreshStatus={refreshStatus}
    />
  );
}
