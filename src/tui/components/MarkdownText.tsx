import React, { useMemo } from 'react';
import { Text, useStdout } from 'ink';
import chalk from 'chalk';
import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';

const codeStyle = chalk.cyan;
const identity = (s: string) => s;

interface MarkdownTextProps {
  content: string;
}

export function MarkdownText({ content }: MarkdownTextProps) {
  const { stdout } = useStdout();
  const width = (stdout?.columns ?? 80) - 8;

  const rendered = useMemo(() => {
    marked.use(markedTerminal({
      width,
      codespan: codeStyle,
      link: identity,
      href: identity,
    }, { languageSubset: [] }) as any);
    marked.use({
      renderer: {
        code({ text }: { text: string }) {
          const lines = text.split('\n').map((l) => '    ' + codeStyle(l)).join('\n');
          return '\n' + lines + '\n\n';
        },
        link({ href, text }: { href: string; text: string }) {
          // Plain text only — no OSC 8 hyperlink escapes that break Ink's width calc
          if (text && text !== href) {
            return `${text} (${href})`;
          }
          return href;
        },
      },
    });
    return (marked.parse(content) as string).trimEnd();
  }, [content, width]);

  return <Text wrap="wrap">{rendered}</Text>;
}
