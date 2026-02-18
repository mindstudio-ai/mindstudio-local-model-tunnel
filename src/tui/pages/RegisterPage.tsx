import React, { useEffect } from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { useRegister } from '../hooks/useRegister';

export function RegisterPage() {
  const { status, progress, registeredModels, error, startRegister, cancel } =
    useRegister();

  // Start registration on mount
  useEffect(() => {
    startRegister();
    return () => cancel();
  }, []);

  if (status === 'idle') {
    return (
      <Box flexDirection="column" marginTop={1} paddingX={1}>
        <Box marginTop={1}>
          <Text color="gray">Starting model registration...</Text>
        </Box>
      </Box>
    );
  }

  if (status === 'error') {
    return (
      <Box flexDirection="column" marginTop={1} paddingX={1}>
        <Box marginTop={1}>
          <Text color="red">Registration failed: {error}</Text>
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

  if (status === 'registering') {
    return (
      <Box flexDirection="column" marginTop={1} paddingX={1}>
        <Box marginTop={1}>
          <Text color="cyan">
            <Spinner type="dots" />
          </Text>
          <Text>
            {' '}
            Registering {progress.current}/{progress.total} models...
          </Text>
        </Box>
      </Box>
    );
  }

  // Done
  const newModels = registeredModels.filter((m) => m.isNew);
  const existingModels = registeredModels.filter((m) => !m.isNew);

  return (
    <Box flexDirection="column" marginTop={1} paddingX={1}>
      {newModels.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color="green">
            Registered {newModels.length} new model
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
      ) : (
        <Box marginTop={1}>
          <Text color="green">All models already registered.</Text>
        </Box>
      )}

      {existingModels.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="gray">
            Already registered ({existingModels.length}):
          </Text>
          {existingModels.map((m) => (
            <Box key={m.name}>
              <Text color="gray">{'  ● '}</Text>
              <Text color="gray">
                {m.name} [{m.provider}]
              </Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
