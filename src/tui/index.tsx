import React from 'react';
import { render } from 'ink';
import { execFileSync, execSync } from 'node:child_process';
import { createWriteStream, renameSync, unlinkSync, existsSync } from 'node:fs';
import { get as httpsGet } from 'node:https';
import { get as httpGet } from 'node:http';
import { App } from './App';
import { TunnelRunner } from '../runner';
import { detectAppConfig } from '../dev/app-config';
import { checkForUpdate, getInstallMethod, getBinaryDownloadUrl } from '../update';
import { UpdatePrompt } from './components/UpdatePrompt';

async function promptForUpdate(
  currentVersion: string,
  latestVersion: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    const { unmount } = render(
      <UpdatePrompt
        currentVersion={currentVersion}
        latestVersion={latestVersion}
        onChoice={(shouldUpdate) => {
          unmount();
          resolve(shouldUpdate);
        }}
      />,
      { exitOnCtrlC: true },
    );
  });
}

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const get = url.startsWith('https') ? httpsGet : httpGet;
    get(url, (res) => {
      // Follow redirects
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        downloadFile(res.headers.location, dest).then(resolve, reject);
        return;
      }
      if (!res.statusCode || res.statusCode >= 400) {
        reject(new Error(`Download failed: HTTP ${res.statusCode}`));
        return;
      }
      const file = createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
      file.on('error', reject);
    }).on('error', reject);
  });
}

export async function startTUI(): Promise<void> {
  // Clean up leftover .old binary from a previous Windows update
  if (process.platform === 'win32') {
    try { unlinkSync(process.execPath + '.old'); } catch {}
  }

  // Clear the screen
  console.clear();

  // Check for updates before launching the main app
  const update = await checkForUpdate();
  if (update) {
    const shouldUpdate = await promptForUpdate(
      update.currentVersion,
      update.latestVersion,
    );
    if (shouldUpdate) {
      console.log('\nUpdating to v' + update.latestVersion + '...\n');
      try {
        if (getInstallMethod() === 'binary') {
          const url = getBinaryDownloadUrl();
          const dest = process.execPath;
          if (process.platform === 'win32') {
            // Windows locks running executables — rename-then-replace trick
            await downloadFile(url, dest + '.new');
            try { unlinkSync(dest + '.old'); } catch {}
            renameSync(dest, dest + '.old');
            renameSync(dest + '.new', dest);
          } else {
            execSync(`curl -fsSL "${url}" -o "${dest}.tmp" && chmod +x "${dest}.tmp" && mv "${dest}.tmp" "${dest}"`, {
              stdio: 'inherit',
            });
          }
        } else {
          execSync('npm install -g @mindstudio-ai/local-model-tunnel@latest', {
            stdio: 'inherit',
          });
        }
        console.log('\nRestarting...\n');
        execFileSync(process.execPath, process.argv.slice(1), {
          stdio: 'inherit',
        });
      } catch {
        console.error('\nUpdate failed. Continuing with current version.\n');
      }
      return;
    }
    console.clear();
  }

  // Detect v2 app project in CWD
  const appConfig = detectAppConfig(process.cwd());

  // Create the runner instance
  const runner = new TunnelRunner();

  // Render the TUI with stdin configured for keyboard input
  const { waitUntilExit } = render(
    <App runner={runner} appConfig={appConfig ?? undefined} />,
    { exitOnCtrlC: true },
  );

  // Wait for the app to exit
  await waitUntilExit();

  // Ensure clean shutdown
  runner.stop();
}
