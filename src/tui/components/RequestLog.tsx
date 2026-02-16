import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type { RequestLogEntry } from '../types.js';

interface RequestLogProps {
  requests: RequestLogEntry[];
  maxVisible?: number;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function getRequestTypeIcon(type: string): string {
  switch (type) {
    case 'llm_chat':
      return '💬';
    case 'image_generation':
      return '🎨';
    case 'video_generation':
      return '🎬';
    default:
      return '📦';
  }
}

function RequestItem({ request }: { request: RequestLogEntry }) {
  const time = formatTime(request.startTime);
  const icon = getRequestTypeIcon(request.requestType);

  if (request.status === 'processing') {
    const elapsed = Date.now() - request.startTime;
    return (
      <Box>
        <Text color="cyan">
          <Spinner type="dots" />
        </Text>
        <Text color="gray"> {time} </Text>
        <Text>{icon} </Text>
        <Text color="cyan">{request.modelId}</Text>
        <Text color="gray"> - Generating... ({formatDuration(elapsed)})</Text>
      </Box>
    );
  }

  if (request.status === 'completed') {
    const duration = request.duration ? formatDuration(request.duration) : '';
    let resultInfo = '';
    if (request.result?.chars) {
      resultInfo = ` (${request.result.chars} chars)`;
    } else if (request.result?.imageSize) {
      resultInfo = ` (${Math.round(request.result.imageSize / 1024)}KB)`;
    } else if (request.result?.videoSize) {
      resultInfo = ` (${Math.round(request.result.videoSize / 1024 / 1024)}MB)`;
    }

    return (
      <Box>
        <Text color="green">✓</Text>
        <Text color="gray"> {time} </Text>
        <Text>{icon} </Text>
        <Text color="white">{request.modelId}</Text>
        <Text color="gray">
          {' '}
          - Completed in {duration}
          {resultInfo}
        </Text>
      </Box>
    );
  }

  // Failed
  return (
    <Box>
      <Text color="red">✗</Text>
      <Text color="gray"> {time} </Text>
      <Text>{icon} </Text>
      <Text color="white">{request.modelId}</Text>
      <Text color="red"> - {request.error || 'Failed'}</Text>
    </Box>
  );
}

export function RequestLog({ requests, maxVisible = 8 }: RequestLogProps) {
  // Get the most recent requests, with active ones always shown
  const activeRequests = requests.filter((r) => r.status === 'processing');
  const completedRequests = requests.filter((r) => r.status !== 'processing');

  // Show active requests + most recent completed, up to maxVisible total
  const completedToShow = completedRequests.slice(
    -(maxVisible - activeRequests.length),
  );
  const visibleRequests = [...completedToShow, ...activeRequests];

  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      width="100%"
      paddingX={1}
    >
      <Box>
        <Text bold underline color="white">
          Generation Requests
        </Text>
        {activeRequests.length > 0 && (
          <Text color="cyan"> ({activeRequests.length} active)</Text>
        )}
      </Box>

      {requests.length === 0 ? (
        <Box flexGrow={1} alignItems="center" justifyContent="center">
          <Text color="gray">No generation requests yet</Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          {visibleRequests.map((request) => (
            <RequestItem key={request.id} request={request} />
          ))}
        </Box>
      )}
    </Box>
  );
}
