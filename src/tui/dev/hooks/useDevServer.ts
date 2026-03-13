// Hook that manages the local dev server subprocess.

import { useState, useCallback, useRef, useEffect } from 'react';
import { spawn, type ChildProcess } from 'node:child_process';

const MAX_OUTPUT_LINES = 200;
const PORT_READY_TIMEOUT_MS = 30_000;
const PORT_CHECK_INTERVAL_MS = 500;

export type DevServerPhase =
  | 'idle'
  | 'starting'
  | 'running'
  | 'error';

export function useDevServer() {
  const [phase, setPhase] = useState<DevServerPhase>('idle');
  const [outputLines, setOutputLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const processRef = useRef<ChildProcess | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      killProcess();
    };
  }, []);

  const appendOutput = useCallback((line: string) => {
    if (!mountedRef.current) return;
    setOutputLines((prev) => {
      const next = [...prev, line];
      return next.length > MAX_OUTPUT_LINES
        ? next.slice(next.length - MAX_OUTPUT_LINES)
        : next;
    });
  }, []);

  const killProcess = useCallback(() => {
    if (processRef.current) {
      processRef.current.kill('SIGTERM');
      const proc = processRef.current;
      setTimeout(() => {
        if (proc && !proc.killed) {
          proc.kill('SIGKILL');
        }
      }, 2000);
      processRef.current = null;
    }
  }, []);

  const start = useCallback(
    async (opts: {
      command: string;
      cwd: string;
      port: number;
    }): Promise<void> => {
      setPhase('starting');
      setError(null);
      setOutputLines([]);

      appendOutput(`$ ${opts.command}`);

      const proc = spawn(opts.command, [], {
        cwd: opts.cwd,
        shell: true,
        env: { ...process.env, FORCE_COLOR: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      processRef.current = proc;

      const handleData = (data: Buffer) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
          if (line.length > 0) {
            appendOutput(line);
          }
        }
      };

      proc.stdout?.on('data', handleData);
      proc.stderr?.on('data', handleData);

      proc.on('close', (code) => {
        processRef.current = null;
        if (mountedRef.current && phase !== 'idle') {
          if (code !== 0 && code !== null) {
            setError(`Dev server exited with code ${code}`);
            setPhase('error');
          } else {
            setPhase('idle');
          }
        }
      });

      proc.on('error', (err) => {
        processRef.current = null;
        if (mountedRef.current) {
          setError(err.message);
          setPhase('error');
        }
      });

      // Wait for port to become available
      await waitForPort(opts.port, PORT_READY_TIMEOUT_MS);

      if (mountedRef.current && processRef.current) {
        setPhase('running');
      }
    },
    [appendOutput],
  );

  const stop = useCallback(() => {
    killProcess();
    if (mountedRef.current) {
      setPhase('idle');
    }
  }, [killProcess]);

  return {
    phase,
    outputLines,
    error,
    start,
    stop,
  };
}

async function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`http://localhost:${port}/`, {
        signal: AbortSignal.timeout(1000),
      });
      // Any response means the server is up
      return;
    } catch {
      // Not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, PORT_CHECK_INTERVAL_MS));
  }
  // Timeout is not fatal — the server might still be starting but we
  // proceed anyway. Index requests will fail gracefully if it's not ready.
}
