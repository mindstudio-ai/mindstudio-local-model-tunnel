import React, { useEffect } from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { useSync } from '../hooks/useRegister';

export function SyncPage() {
  const { status, progress, syncedModels, error, startSync, cancel } =
    useSync();

  // Start sync on mount
  useEffect(() => {
    startSync();
    return () => cancel();
  }, []);

  if (status === 'idle') {
    return (
      <Box flexDirection="column" marginTop={1} paddingX={1}>
        <Box marginTop={1}>
          <Text color="gray">Starting model sync...</Text>
        </Box>
      </Box>
    );
  }

  if (status === 'error') {
    return (
      <Box flexDirection="column" marginTop={1} paddingX={1}>
        <Box marginTop={1}>
          <Text color="red">Sync failed: {error}</Text>
        </Box>
      </Box>
    );
  }

  if (status === 'discovering') {
    return (
      <Box flexDirection="column" marginTop={1} paddingX={1}>
        <Box marginTop={1}>
          <Text color="cyan">
            <Spinner type="dots" />
          </Text>
          <Text> Discovering local models...</Text>
        </Box>
      </Box>
    );
  }

  if (status === 'syncing') {
    return (
      <Box flexDirection="column" marginTop={1} paddingX={1}>
        <Box marginTop={1}>
          <Text color="cyan">
            <Spinner type="dots" />
          </Text>
          <Text>
            {' '}
            Syncing {progress.current}/{progress.total} models...
          </Text>
        </Box>
      </Box>
    );
  }

  // Done
  const newModels = syncedModels.filter((m) => m.isNew);
  const resyncedModels = syncedModels.filter((m) => !m.isNew);

  return (
    <Box flexDirection="column" marginTop={1} paddingX={1}>
      {newModels.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="green">
            Synced {newModels.length} new model
            {newModels.length !== 1 ? 's' : ''}:
          </Text>
          {newModels.map((m) => (
            <Box key={m.name}>
              <Text color="green">{'  ✓ '}</Text>
              <Text>{m.name} </Text>
              <Text color="gray">[{m.provider}]</Text>
            </Box>
          ))}
        </Box>
      )}

      {resyncedModels.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="green">
            Resynced {resyncedModels.length} existing model
            {resyncedModels.length !== 1 ? 's' : ''}:
          </Text>
          {resyncedModels.map((m) => (
            <Box key={m.name}>
              <Text color="green">{'  ✓ '}</Text>
              <Text>{m.name} </Text>
              <Text color="gray">[{m.provider}]</Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
