import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import type { LifecycleProgressCallback } from './types.js';

const execAsync = promisify(exec);

/**
 * Check if a command exists in PATH
 */
export async function commandExists(command: string): Promise<boolean> {
  try {
    const checkCmd = process.platform === 'win32' ? 'where' : 'which';
    await execAsync(`${checkCmd} ${command}`);
    return true;
  } catch {
    return false;
  }
}

/** Minimum Python version required by Forge Neo */
const REQUIRED_PYTHON_MAJOR = 3;
const REQUIRED_PYTHON_MINOR = 13;

export type PythonInfo = {
  major: number;
  minor: number;
  patch: number;
  version: string;
  executable: string;
};

/**
 * Try to get Python version info from a specific command.
 */
async function tryPythonCommand(cmd: string): Promise<PythonInfo | null> {
  try {
    const { stdout: versionOut } = await execAsync(`${cmd} --version`);
    const match = versionOut.trim().match(/Python\s+(\d+)\.(\d+)\.(\d+)/);
    if (!match) return null;

    const major = parseInt(match[1]);
    const minor = parseInt(match[2]);
    const patch = parseInt(match[3]);
    const version = `${major}.${minor}.${patch}`;

    let executable = cmd;
    try {
      const { stdout: exeOut } = await execAsync(
        `${cmd} -c "import sys; print(sys.executable)"`,
      );
      executable = exeOut.trim();
    } catch {
      // Fall back to command name
    }

    return { major, minor, patch, version, executable };
  } catch {
    return null;
  }
}

/**
 * Get the best available Python version.
 * Checks multiple candidates and returns the newest one that meets
 * the minimum requirement, or the newest overall if none qualify.
 */
export async function getPythonVersion(): Promise<PythonInfo | null> {
  const candidates = [
    'python3.13',
    'python3.14',
    'python3.15',
    'python3',
    'python',
  ];

  const results: PythonInfo[] = [];

  for (const cmd of candidates) {
    const info = await tryPythonCommand(cmd);
    if (info) {
      if (isPythonVersionOk(info)) {
        return info;
      }
      results.push(info);
    }
  }

  if (results.length > 0) {
    results.sort((a, b) => {
      if (a.major !== b.major) return b.major - a.major;
      if (a.minor !== b.minor) return b.minor - a.minor;
      return b.patch - a.patch;
    });
    return results[0];
  }

  return null;
}

/**
 * Check if the installed Python version meets Forge Neo requirements (>= 3.13).
 */
export function isPythonVersionOk(info: {
  major: number;
  minor: number;
}): boolean {
  return (
    info.major > REQUIRED_PYTHON_MAJOR ||
    (info.major === REQUIRED_PYTHON_MAJOR &&
      info.minor >= REQUIRED_PYTHON_MINOR)
  );
}

/**
 * Detect the CUDA version supported by the installed NVIDIA driver.
 * Returns { major, minor, cuTag } or null if no NVIDIA GPU.
 */
export async function detectCudaVersion(): Promise<{
  major: number;
  minor: number;
  cuTag: string;
} | null> {
  try {
    const { stdout: smiFullOut } = await execAsync('nvidia-smi');
    const cudaMatch = smiFullOut.match(/CUDA Version:\s*(\d+)\.(\d+)/);
    if (!cudaMatch) return null;

    const major = parseInt(cudaMatch[1]);
    const minor = parseInt(cudaMatch[2]);

    let cuTag: string;
    if (major >= 13) {
      cuTag = 'cu130';
    } else if (major === 12 && minor >= 8) {
      cuTag = 'cu128';
    } else if (major === 12 && minor >= 6) {
      cuTag = 'cu126';
    } else if (major === 12 && minor >= 4) {
      cuTag = 'cu124';
    } else if (major === 12) {
      cuTag = 'cu121';
    } else {
      cuTag = 'cu118';
    }

    return { major, minor, cuTag };
  } catch {
    return null;
  }
}

/**
 * Run a command that may need elevated privileges (cross-platform).
 * Used to kill processes.
 */
export async function runKillCommand(command: string): Promise<boolean> {
  const isWindows = process.platform === 'win32';
  return new Promise((resolve) => {
    let proc: ReturnType<typeof spawn>;
    if (isWindows) {
      proc = spawn('cmd', ['/c', command], { stdio: 'inherit' });
    } else {
      proc = spawn('sudo', ['bash', '-c', command], { stdio: 'inherit' });
    }
    proc.on('close', (code) => {
      resolve(code === 0 || code === 1); // 1 = no process found, which is OK
    });
    proc.on('error', () => {
      resolve(false);
    });
  });
}

/**
 * Download a file using wget (preferred) or curl, with progress output to the terminal.
 * Supports resuming partial downloads with -c / -C flags.
 */
export async function downloadFile(
  url: string,
  destFile: string,
  onProgress: LifecycleProgressCallback,
): Promise<boolean> {
  const isWindows = process.platform === 'win32';

  // Ensure destination directory exists
  const destDir = destFile.substring(0, destFile.lastIndexOf('/'));
  if (destDir) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  // Check if already exists
  if (fs.existsSync(destFile)) {
    onProgress({ stage: 'download', message: `File already exists: ${destFile}` });
    return true;
  }

  const hasWget = await commandExists('wget');

  return new Promise((resolve) => {
    let proc: ReturnType<typeof spawn>;

    if (hasWget && !isWindows) {
      proc = spawn(
        'wget',
        ['-c', '--show-progress', '-O', destFile, url],
        { stdio: 'inherit' },
      );
    } else {
      proc = spawn(
        'curl',
        ['-L', '-C', '-', '--progress-bar', '-o', destFile, url],
        { stdio: 'inherit' },
      );
    }

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(true);
      } else {
        // Clean up partial file on failure
        try {
          fs.unlinkSync(destFile);
        } catch { /* ignore */ }
        resolve(false);
      }
    });

    proc.on('error', (err) => {
      onProgress({
        stage: 'error',
        message: 'Download failed',
        error: err.message,
      });
      resolve(false);
    });
  });
}
