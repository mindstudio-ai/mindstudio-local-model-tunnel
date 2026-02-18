import React from 'react';
import { Box, Text } from 'ink';

interface MarkdownTextProps {
  content: string;
}

function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*(.+?)\*\*|`(.+?)`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    if (match[2]) {
      parts.push(<Text key={match.index} bold>{match[2]}</Text>);
    } else if (match[3]) {
      parts.push(<Text key={match.index} color="cyan">{match[3]}</Text>);
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

export function MarkdownText({ content }: MarkdownTextProps) {
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];
  let codeKey = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    if (line.startsWith('```')) {
      if (inCodeBlock) {
        elements.push(
          <Box key={`code-${codeKey++}`} marginLeft={2} flexDirection="column">
            {codeLines.map((cl, j) => (
              <Text key={j} color="cyan">{cl}</Text>
            ))}
          </Box>,
        );
        codeLines = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    if (line.trim() === '') {
      elements.push(<Box key={`blank-${i}`} height={1} />);
      continue;
    }

    if (line.startsWith('### ')) {
      elements.push(
        <Text key={i} bold color="gray">{line.slice(4)}</Text>,
      );
      continue;
    }

    if (line.startsWith('## ')) {
      elements.push(
        <Box key={i} marginTop={1}>
          <Text bold underline>{line.slice(3)}</Text>
        </Box>,
      );
      continue;
    }

    if (line.startsWith('# ')) {
      elements.push(
        <Box key={i} marginBottom={1}>
          <Text bold color="white">{line.slice(2)}</Text>
        </Box>,
      );
      continue;
    }

    if (line.startsWith('- ')) {
      elements.push(
        <Text key={i} wrap="wrap">  {'\u2022'} {renderInline(line.slice(2))}</Text>,
      );
      continue;
    }

    elements.push(<Text key={i} wrap="wrap">{renderInline(line)}</Text>);
  }

  return <Box flexDirection="column">{elements}</Box>;
}
