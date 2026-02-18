import { exec } from 'child_process';
import { promisify } from 'util';

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
