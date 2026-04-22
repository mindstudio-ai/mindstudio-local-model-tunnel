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
// Pre-roll timings: used only for fullPage captures to trigger
// IntersectionObservers, lazy-loaded images, and scroll-linked animations
// before the single-shot CDP capture.
const PREROLL_BOTTOM_DWELL_MS = 300;
const PREROLL_NETWORK_IDLE_MS = 1_500;
const PREROLL_TOP_DWELL_MS = 100;

export async function captureViaCdp(
  page: Page,
  opts: CaptureOpts,
): Promise<CaptureResult> {
  if (opts.path) {
    // Puppeteer's page.goto requires an absolute URL — callers pass paths
    // like "/welcome", so resolve against the current page origin.
    const absolute = new URL(opts.path, page.url()).toString();
    await page.goto(absolute, {
      waitUntil: 'networkidle0',
      timeout: GOTO_TIMEOUT_MS,
    });
  }

  // Match browser-agent's in-page network-idle settle so layout/fonts are
  // stable at capture time. Swallow timeout — best-effort.
  await page
    .waitForNetworkIdle({ timeout: SETTLE_TIMEOUT_MS, idleTime: SETTLE_IDLE_MS })
    .catch(() => {});

  // Pre-roll for fullPage captures only. CDP's `fullPage: true` renders in a
  // single pass with the viewport logically at the top, so IntersectionObserver
  // callbacks, lazy-loaded images, and scroll-triggered animations never fire.
  // Scrolling to the bottom and back nudges them into their revealed state;
  // Chrome then captures the fully-revealed layout in one shot.
  if (opts.fullPage) {
    await preRollScroll(page);
  }

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

/**
 * Scroll the document to the bottom, wait for observer callbacks and any
 * lazy-loaded content to settle, then scroll back to the top. Gives
 * fullPage captures a chance to include scroll-triggered fade-ins, lazy
 * images, and windowed-list items.
 *
 * Best-effort — all timeouts swallowed. If the page can't be scrolled
 * (short content, scroll-locked body) the function is effectively a no-op.
 */
async function preRollScroll(page: Page): Promise<void> {
  try {
    const scrolled = await page.evaluate(() => {
      const el = document.scrollingElement || document.documentElement;
      const max = Math.max(
        document.documentElement.scrollHeight,
        document.body.scrollHeight,
      );
      if (max <= window.innerHeight + 10) return false; // nothing to scroll
      el.scrollTo({ top: max, left: 0, behavior: 'instant' as ScrollBehavior });
      return true;
    });

    if (!scrolled) return;

    // Let IntersectionObservers fire and any triggered animations settle.
    await new Promise((r) => setTimeout(r, PREROLL_BOTTOM_DWELL_MS));

    // If the observers kicked off image/data loads, wait for them briefly.
    await page
      .waitForNetworkIdle({
        timeout: PREROLL_NETWORK_IDLE_MS,
        idleTime: SETTLE_IDLE_MS,
      })
      .catch(() => {});

    await page.evaluate(() => {
      const el = document.scrollingElement || document.documentElement;
      el.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
    });

    await new Promise((r) => setTimeout(r, PREROLL_TOP_DWELL_MS));
  } catch {
    // Non-fatal — proceed to capture regardless.
  }
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
