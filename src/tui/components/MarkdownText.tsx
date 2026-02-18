import React, { useMemo } from 'react';
import { Text, useStdout } from 'ink';
import chalk from 'chalk';
import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';

const codeStyle = chalk.cyan;
const identity = (s: string) => s;

interface MarkdownTextProps {
  content: string;
  width?: number;
}

/**
 * Render markdown to an ANSI string.
 * Each line is self-contained (no cross-line ANSI escapes).
 */
export function renderMarkdown(content: string, width: number): string {
  marked.use(
    markedTerminal({
      width,
      codespan: codeStyle,
      link: identity,
      href: identity,
    }) as any,
  );
  marked.use({
    renderer: {
      code({ text }: { text: string }) {
        const lines = text
          .trim()
          .split('\n')
          .map((l) => '    ' + codeStyle(l))
          .join('\n');
        return lines + '\n\n';
      },
      link({ href, text }: { href: string; text: string }) {
        if (text && text !== href) {
          return `${text} (${href})`;
        }
        return href;
      },
    },
  });
  return (marked.parse(content) as string).trimEnd();
}

export function MarkdownText({ content, width: widthProp }: MarkdownTextProps) {
  const { stdout } = useStdout();
  const width = widthProp ?? (stdout?.columns ?? 80) - 4;

  const rendered = useMemo(
    () => renderMarkdown(content, width),
    [content, width],
  );

  return <Text wrap="wrap">{rendered}</Text>;
}
