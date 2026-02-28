import { useState, useCallback, useRef, useEffect } from 'react';
import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {
  getLocalInterfacePath,
  setLocalInterfacePath,
  deleteLocalInterfacePath,
  getLocalInterfacesDir,
} from '../../../config';
import path from 'node:path';

const SCAFFOLD_REPO = 'https://github.com/mindstudio-ai/spa-bundle-scaffold';
const MAX_OUTPUT_LINES = 500;

export type LocalInterfacePhase =
  | 'idle'
  | 'cloning'
  | 'installing'
  | 'running'
  | 'error'
  | 'deleting';

interface UseLocalInterfaceOptions {
  appId: string;
  stepId: string;
  sessionId: string;
}

interface UseLocalInterfaceResult {
  phase: LocalInterfacePhase;
  hasLocalCopy: boolean;
  outputLines: string[];
  localPath: string | undefined;
  errorMessage: string | null;
  start: () => void;
  stop: () => void;
  deleteLocalCopy: () => void;
}

export function useLocalInterface({
  appId,
  stepId,
  sessionId,
}: UseLocalInterfaceOptions): UseLocalInterfaceResult {
  const key = `${appId}:${stepId}`;

  const [hasLocalCopy, setHasLocalCopy] = useState(() => {
    const existing = getLocalInterfacePath(key);
    if (!existing) return false;
    try {
      return fs.existsSync(existing);
    } catch {
      return false;
    }
  });

  const [phase, setPhase] = useState<LocalInterfacePhase>('idle');
  const [outputLines, setOutputLines] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const processRef = useRef<ChildProcess | null>(null);
  const mountedRef = useRef(true);
  const stoppedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (processRef.current) {
        processRef.current.kill('SIGTERM');
        processRef.current = null;
      }
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

  const runCommand = useCallback(
    (
      command: string,
      args: string[],
      options: { cwd?: string } = {},
    ): Promise<number> => {
      return new Promise((resolve, reject) => {
        const fullCommand = [command, ...args].join(' ');
        const proc = spawn(fullCommand, [], {
          cwd: options.cwd,
          shell: true,
          env: { ...process.env, FORCE_COLOR: '1' },
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
          resolve(code ?? 0);
        });

        proc.on('error', (err) => {
          processRef.current = null;
          reject(err);
        });
      });
    },
    [appendOutput],
  );

  const start = useCallback(() => {
    setErrorMessage(null);
    setOutputLines([]);
    stoppedRef.current = false;

    const run = async () => {
      const localPath = getLocalInterfacePath(key);
      const dirExists = localPath && fs.existsSync(localPath);

      try {
        if (!dirExists) {
          // Clone
          setPhase('cloning');
          const interfacesDir = getLocalInterfacesDir();
          fs.mkdirSync(interfacesDir, { recursive: true });

          const shortId = crypto.randomBytes(4).toString('hex');
          const dirName = `interface-${shortId}`;
          const targetDir = path.join(interfacesDir, dirName);

          appendOutput(`Cloning scaffold into ${targetDir}...`);
          const cloneCode = await runCommand('git', [
            'clone', '--depth', '1', SCAFFOLD_REPO, targetDir,
          ]);

          if (!mountedRef.current) return;
          if (cloneCode !== 0) {
            throw new Error(`git clone failed with exit code ${cloneCode}`);
          }

          // Install
          setPhase('installing');
          appendOutput('Installing dependencies...');
          const installCode = await runCommand('npm', ['install'], {
            cwd: targetDir,
          });

          if (!mountedRef.current) return;
          if (installCode !== 0) {
            throw new Error(`npm install failed with exit code ${installCode}`);
          }

          setLocalInterfacePath(key, targetDir);
          setHasLocalCopy(true);

          // Run
          setPhase('running');
          appendOutput(`Connecting to session ${sessionId}...`);
          const devCode = await runCommand(
            'npm', ['run', 'dev:local', '--', sessionId],
            { cwd: targetDir },
          );

          if (mountedRef.current) {
            setPhase('idle');
            setOutputLines([]);
          }
        } else {
          // Already cloned — just run
          setPhase('running');
          appendOutput(`Connecting to session ${sessionId}...`);
          const devCode = await runCommand(
            'npm', ['run', 'dev:local', '--', sessionId],
            { cwd: localPath },
          );

          if (mountedRef.current) {
            setPhase('idle');
            setOutputLines([]);
          }
        }
      } catch (err) {
        if (mountedRef.current) {
          setPhase('error');
          setErrorMessage(
            err instanceof Error ? err.message : 'Unknown error',
          );
        }
      }
    };

    run();
  }, [key, appId, stepId, sessionId, appendOutput, runCommand]);

  const stop = useCallback(() => {
    stoppedRef.current = true;
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
    setPhase('idle');
  }, []);

  const deleteLocalCopy = useCallback(() => {
    const localPath = getLocalInterfacePath(key);
    if (!localPath) return;

    setPhase('deleting');
    setOutputLines([]);
    appendOutput(`Deleting ${localPath}...`);

    try {
      fs.rmSync(localPath, { recursive: true, force: true });
      deleteLocalInterfacePath(key);
      setHasLocalCopy(false);
      appendOutput('Deleted successfully.');
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Failed to delete',
      );
    }
    setPhase('idle');
  }, [key, appendOutput]);

  return {
    phase,
    hasLocalCopy,
    localPath: getLocalInterfacePath(key),
    outputLines,
    errorMessage,
    start,
    stop,
    deleteLocalCopy,
  };
}
