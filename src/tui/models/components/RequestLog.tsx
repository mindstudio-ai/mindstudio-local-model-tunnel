import React from 'react';
import { Box, Text, useStdout } from 'ink';
import Spinner from 'ink-spinner';
import type { RequestLogEntry } from '../../types';

interface RequestLogProps {
  requests: RequestLogEntry[];
  maxVisible?: number;
  hasModels?: boolean;
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

function getRequestTypeLabel(type: string): { label: string; color: string } {
  switch (type) {
    case 'llm_chat':
      return { label: 'text', color: 'gray' };
    case 'image_generation':
      return { label: 'image', color: 'gray' };
    case 'video_generation':
      return { label: 'video', color: 'gray' };
    default:
      return { label: type, color: 'gray' };
  }
}

function snippetLine(content: string, maxWidth: number): string {
  // Collapse whitespace/newlines into single spaces
  const flat = content.replace(/\s+/g, ' ').trim();
  if (flat.length <= maxWidth) return flat;
  return '\u2026' + flat.slice(-(maxWidth - 1));
}

function RequestItem({
  request,
  width,
}: {
  request: RequestLogEntry;
  width: number;
}) {
  const time = formatTime(request.startTime);
  const typeLabel = getRequestTypeLabel(request.requestType);
  // indent for snippet: status(1) + space(1) + padding for alignment
  const snippetIndent = '   ';
  const snippetWidth = width - snippetIndent.length - 2; // 2 for paddingX

  if (request.status === 'processing') {
    const elapsed = Date.now() - request.startTime;
    const snippet =
      request.content && request.requestType === 'llm_chat'
        ? snippetLine(request.content, snippetWidth)
        : null;
    const stepProgress =
      request.step !== undefined && request.totalSteps
        ? `Step ${request.step}/${request.totalSteps}`
        : null;
    return (
      <Box flexDirection="column">
        <Box>
          <Text color="cyan">
            <Spinner type="dots" />
          </Text>
          <Text color="gray"> {time} </Text>
          <Text color="white">{request.modelId}</Text>
          <Text color="gray"> </Text>
          <Text color={typeLabel.color}>{typeLabel.label}</Text>
          <Text color="gray"> {formatDuration(elapsed)}...</Text>
        </Box>
        {snippet && (
          <Text color="gray" wrap="truncate-end">
            {snippetIndent}
            {snippet}
          </Text>
        )}
        {stepProgress && (
          <Text color="gray">
            {snippetIndent}
            {stepProgress}
          </Text>
        )}
      </Box>
    );
  }

  if (request.status === 'completed') {
    const duration = request.duration ? formatDuration(request.duration) : '';
    let resultInfo = '';
    if (request.result?.chars) {
      resultInfo = ` \u00B7 ${request.result.chars} chars`;
    } else if (request.result?.imageSize) {
      resultInfo = ` \u00B7 ${Math.round(request.result.imageSize / 1024)}KB`;
    } else if (request.result?.videoSize) {
      resultInfo = ` \u00B7 ${Math.round(request.result.videoSize / 1024 / 1024)}MB`;
    }

    const snippet =
      request.content && request.requestType === 'llm_chat'
        ? snippetLine(request.content, snippetWidth)
        : null;

    return (
      <Box flexDirection="column">
        <Box>
          <Text color="green">{'\u2713'}</Text>
          <Text color="gray"> {time} </Text>
          <Text color="white">{request.modelId}</Text>
          <Text color="gray"> </Text>
          <Text color={typeLabel.color}>{typeLabel.label}</Text>
          <Text color="gray">
            {' '}
            {duration}
            {resultInfo}
          </Text>
        </Box>
        {snippet && (
          <Text color="gray" wrap="truncate-end">
            {snippetIndent}
            {snippet}
          </Text>
        )}
      </Box>
    );
  }

  // Failed
  return (
    <Box flexDirection="column">
      <Box>
        <Text color="red">{'\u25CF'}</Text>
        <Text color="gray"> {time} </Text>
        <Text color="white">{request.modelId}</Text>
        <Text color="gray"> </Text>
        <Text color={typeLabel.color}>{typeLabel.label}</Text>
        <Text color="red"> {request.error || 'Failed'}</Text>
      </Box>
    </Box>
  );
}

export function RequestLog({
  requests,
  maxVisible = 8,
  hasModels = true,
}: RequestLogProps) {
  const { stdout } = useStdout();
  const width = stdout?.columns ?? 80;

  // Get the most recent requests, with active ones always shown
  const activeRequests = requests.filter((r) => r.status === 'processing');
  const completedRequests = requests.filter((r) => r.status !== 'processing');

  // Requests with a snippet or step progress take 2 lines, others take 1
  const itemLines = (r: RequestLogEntry) => {
    if (r.requestType === 'llm_chat' && r.content) return 2;
    if (r.status === 'processing' && r.step !== undefined) return 2;
    return 1;
  };

  let completedToShow: RequestLogEntry[] = [];
  let linesUsed = activeRequests.reduce((sum, r) => sum + itemLines(r), 0);
  for (
    let i = completedRequests.length - 1;
    i >= 0 && linesUsed < maxVisible;
    i--
  ) {
    const r = completedRequests[i]!;
    const lines = itemLines(r);
    if (linesUsed + lines <= maxVisible) {
      completedToShow.unshift(r);
      linesUsed += lines;
    } else {
      break;
    }
  }

  const visibleRequests = [...completedToShow, ...activeRequests];

  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      width="100%"
      paddingX={1}
      marginTop={1}
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
        <Box marginTop={1} flexDirection="column">
          <Text color="gray">
            {hasModels
              ? 'Tunnel is live — requests will appear here when models are used in MindStudio'
              : 'Start a model to begin receiving generation requests.'}
          </Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          {visibleRequests.map((request) => (
            <RequestItem key={request.id} request={request} width={width} />
          ))}
        </Box>
      )}
    </Box>
  );
}
