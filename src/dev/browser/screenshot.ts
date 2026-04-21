/**
 * CDP-based screenshot capture.
 *
 * Runs inside the tunnel (Node) against the puppeteer Page owned by the
 * BrowserSupervisor. Produces real pixels via Chrome's own rendering path
 * (replacing browser-agent's snapdom DOM→SVG→Canvas pipeline for headless
 * targets) and uploads the result to the same presigned S3 URL the WS
 * path uses, so callers see an identical result shape.
 */

import type { Page } from 'puppeteer-core';

export interface CaptureOpts {
  fullPage: boolean;
  path?: string;
  uploadUrl: string;
  uploadFields: Record<string, string>;
}

export interface CaptureResult {
  uploaded: true;
  width: number;
  height: number;
  styleMap?: string;
}

const GOTO_TIMEOUT_MS = 15_000;
const SETTLE_TIMEOUT_MS = 3_000;
const SETTLE_IDLE_MS = 200;
const JPEG_QUALITY = 85;

export async function captureViaCdp(
  page: Page,
  opts: CaptureOpts,
): Promise<CaptureResult> {
  if (opts.path) {
    await page.goto(opts.path, {
      waitUntil: 'networkidle0',
      timeout: GOTO_TIMEOUT_MS,
    });
  }

  // Match browser-agent's in-page network-idle settle so layout/fonts are
  // stable at capture time. Swallow timeout — best-effort.
  await page
    .waitForNetworkIdle({ timeout: SETTLE_TIMEOUT_MS, idleTime: SETTLE_IDLE_MS })
    .catch(() => {});

  let width: number;
  let height: number;
  if (opts.fullPage) {
    const dims = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    }));
    width = dims.width;
    height = dims.height;
  } else {
    const vp = page.viewport();
    width = vp?.width ?? 0;
    height = vp?.height ?? 0;
  }

  // Best-effort styleMap via the already-loaded browser-agent. The browser
  // agent is injected into every page the proxy serves, so it's running in
  // this Chrome instance too. Silently skipped if the served version
  // predates the exposed API.
  let styleMap: string | undefined;
  try {
    const result = await page.evaluate(() => {
      const api = (window as unknown as {
        __MINDSTUDIO_BROWSER_AGENT__?: { computeStyleMap?: () => string };
      }).__MINDSTUDIO_BROWSER_AGENT__;
      return api?.computeStyleMap?.() ?? null;
    });
    if (typeof result === 'string' && result.length > 0) styleMap = result;
  } catch {
    // Non-fatal — styleMap stays undefined.
  }

  const buf = (await page.screenshot({
    type: 'jpeg',
    quality: JPEG_QUALITY,
    fullPage: opts.fullPage,
  })) as Buffer;

  await uploadToPresigned(opts.uploadUrl, opts.uploadFields, buf);

  return {
    uploaded: true,
    width,
    height,
    ...(styleMap ? { styleMap } : {}),
  };
}

async function uploadToPresigned(
  uploadUrl: string,
  uploadFields: Record<string, string>,
  buf: Buffer,
): Promise<void> {
  const form = new FormData();
  for (const [k, v] of Object.entries(uploadFields)) form.append(k, v);
  form.append(
    'file',
    new Blob([buf as unknown as BlobPart], { type: 'image/jpeg' }),
    'screenshot.jpg',
  );
  const res = await fetch(uploadUrl, { method: 'POST', body: form });
  if (!res.ok) {
    throw new Error(`Screenshot upload failed: ${res.status}`);
  }
}
