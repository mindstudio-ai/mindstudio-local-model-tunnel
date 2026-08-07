/**
 * CDP-based screenshot capture.
 *
 * Runs inside the tunnel (Node) against the puppeteer Page owned by the
 * BrowserSupervisor. Produces real pixels via Chrome's own rendering path
 * (replacing browser-agent's snapdom DOM→SVG→Canvas pipeline for headless
 * targets) and uploads the result to the same presigned S3 URL the WS
 * path uses, so callers see an identical result shape.
 */

import type { Page, Viewport } from 'puppeteer-core';

export interface CaptureOpts {
  fullPage: boolean;
  path?: string;
  uploadUrl: string;
  uploadFields: Record<string, string>;
  /** Viewport captures only: scroll this element into view (via CDP, in the
   * same context as the capture) immediately before shooting, so scroll and
   * capture are atomic and can't race. */
  scrollToSelector?: string;
  /** Viewport captures only: scroll to this absolute Y offset before shooting.
   * Used when no selector is available. */
  scrollY?: number;
  /** Exact-size capture: size the viewport to these dimensions and clip to it
   * (a fixed-size viewport shot, never a full-page stitch). Used for rendering
   * fixed-dimension artifacts like a 1200×630 Open Graph share card. Both must
   * be set together; the prior viewport is restored after the capture. */
  width?: number;
  height?: number;
  /** Output image format. Defaults to 'jpeg' (existing QA behavior). Use 'png'
   * for crisp flat graphics like share cards, where JPEG ringing shows on sharp
   * type and edges. */
  format?: 'png' | 'jpeg';
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
// Viewport captures: delay after a double-rAF to let the scrolled layout paint
// before the single-shot capture (closes the scroll→capture paint race).
const VIEWPORT_PAINT_SETTLE_MS = 32;

// Overall capture deadlines. The CDP steps (page.evaluate / page.screenshot) and
// the S3 upload below have no internal timeout, so a wedged renderer — e.g. under
// continuous HMR reloads or a busy animation/poll loop — makes them hang forever
// and the sidecar command never completes (every later screenshot then times out
// too). A single overall deadline turns a hang into a clean, fast failure. Kept
// under the callers' client-side budgets (viewport 30s, full-page 120s) so the
// tunnel fails first and the agent sees a real error, not an opaque client abort.
const VIEWPORT_CAPTURE_TIMEOUT_MS = 20_000;
const FULLPAGE_CAPTURE_TIMEOUT_MS = 90_000;
// Upload of the captured JPEG to the presigned S3 URL.
const UPLOAD_TIMEOUT_MS = 20_000;

/**
 * Reject if `p` doesn't settle within `ms`. The underlying work (a CDP call, a
 * fetch) keeps running but is abandoned — acceptable here: the alternative is an
 * unbounded hang. Rejections from `p` are always consumed, so a late failure
 * after the timeout can't surface as an unhandledRejection. `label` names the
 * operation in the timeout error.
 */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * Bounded entry point: caps the whole capture (navigation, settle, the CDP
 * screenshot, and upload) at one deadline so a wedged renderer can't hang the
 * sidecar command. The inner function is the actual capture.
 */
export async function captureViaCdp(
  page: Page,
  opts: CaptureOpts,
): Promise<CaptureResult> {
  // Exact-size capture (e.g. a 1200×630 Open Graph card): size the viewport to
  // the requested dimensions for the duration of the shot, then restore the
  // prior viewport so later QA screenshots keep the session's preset size. Set
  // here — before the inner goto — so the page lays out at the target size from
  // first paint. The supervisor's tracked previewMode is never touched, so its
  // state stays consistent. An exact size always implies a viewport clip, never
  // a full-page stitch.
  const exactSize =
    typeof opts.width === 'number' && typeof opts.height === 'number';
  const effectiveFullPage = exactSize ? false : opts.fullPage;

  let prevViewport: Viewport | null = null;
  if (exactSize) {
    prevViewport = page.viewport();
    await page.setViewport({
      width: opts.width!,
      height: opts.height!,
      deviceScaleFactor: 1,
    });
  }

  try {
    return await withTimeout(
      captureViaCdpInner(page, opts),
      effectiveFullPage
        ? FULLPAGE_CAPTURE_TIMEOUT_MS
        : VIEWPORT_CAPTURE_TIMEOUT_MS,
      `${effectiveFullPage ? 'Full-page' : 'Viewport'} screenshot capture`,
    );
  } finally {
    if (prevViewport) {
      await page.setViewport(prevViewport).catch(() => {});
    }
  }
}

async function captureViaCdpInner(
  page: Page,
  opts: CaptureOpts,
): Promise<CaptureResult> {
  // An exact width/height request is always a fixed-viewport clip, never a
  // full-page stitch (the caller sized the viewport itself). Format defaults to
  // jpeg to preserve existing QA-screenshot behavior byte-for-byte.
  const effectiveFullPage =
    typeof opts.width === 'number' && typeof opts.height === 'number'
      ? false
      : opts.fullPage;
  const type: 'png' | 'jpeg' = opts.format === 'png' ? 'png' : 'jpeg';

  if (opts.path) {
    // Puppeteer's page.goto requires an absolute URL — callers pass paths
    // like "/welcome", so resolve against the current page origin.
    const absolute = new URL(opts.path, page.url()).toString();
    // `load`, not `networkidle0`: long-lived connections keep the in-flight
    // count pinned above 0 forever, so `networkidle0` never settles and this
    // navigation always hits the 15s timeout. On a plain path (no
    // `?ms_sandbox=1`) the SDK's /_/telemetry/presence SSE reopens (the
    // telemetry-mock only 204s the sandbox marker), and instrumented pages add
    // a steady stream of analytics beacons on top. `load` fires regardless;
    // the bounded best-effort settle below still lets layout/fonts stabilize.
    // Mirrors launcher.ts / supervisor.ts, which already made this switch.
    await page.goto(absolute, {
      waitUntil: 'load',
      timeout: GOTO_TIMEOUT_MS,
    });
  }

  // Match browser-agent's in-page network-idle settle so layout/fonts are
  // stable at capture time. Swallow timeout — best-effort.
  await page
    .waitForNetworkIdle({
      timeout: SETTLE_TIMEOUT_MS,
      idleTime: SETTLE_IDLE_MS,
    })
    .catch(() => {});

  // Pre-roll for fullPage captures only. CDP's `fullPage: true` renders in a
  // single pass with the viewport logically at the top, so IntersectionObserver
  // callbacks, lazy-loaded images, and scroll-triggered animations never fire.
  // Scrolling to the bottom and back nudges them into their revealed state;
  // Chrome then captures the fully-revealed layout in one shot.
  if (effectiveFullPage) {
    await preRollScroll(page);
  } else {
    await settleViewport(page, opts.scrollToSelector, opts.scrollY);
  }

  let width: number;
  let height: number;
  if (effectiveFullPage) {
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
      const api = (
        window as unknown as {
          __MINDSTUDIO_BROWSER_AGENT__?: { computeStyleMap?: () => string };
        }
      ).__MINDSTUDIO_BROWSER_AGENT__;
      return api?.computeStyleMap?.() ?? null;
    });
    if (typeof result === 'string' && result.length > 0) styleMap = result;
  } catch {
    // Non-fatal — styleMap stays undefined.
  }

  const buf = (await page.screenshot(
    type === 'png'
      ? { type: 'png', fullPage: effectiveFullPage }
      : { type: 'jpeg', quality: JPEG_QUALITY, fullPage: effectiveFullPage },
  )) as Buffer;

  await uploadToPresigned(opts.uploadUrl, opts.uploadFields, buf, type);

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

/**
 * Prepare a non-fullPage (viewport) capture. Optionally scrolls a target
 * element — or an absolute Y offset — into view via CDP `page.evaluate`, i.e.
 * the *same* context the screenshot is taken in, so the scroll and the capture
 * can't race (unlike a scroll issued over the WebSocket browser-agent and a
 * separate CDP capture). Then waits for at least one composited frame so the
 * scrolled layout has painted before the shot.
 *
 * Best-effort — all errors swallowed. With no target it's just the paint
 * settle, which is harmless for current-viewport captures.
 */
async function settleViewport(
  page: Page,
  scrollToSelector?: string,
  scrollY?: number,
): Promise<void> {
  try {
    if (scrollToSelector || typeof scrollY === 'number') {
      await page.evaluate(
        (sel: string | null, y: number | null) => {
          if (sel) {
            const el = document.querySelector(sel);
            if (el) {
              el.scrollIntoView({
                block: 'start',
                inline: 'nearest',
                behavior: 'instant' as ScrollBehavior,
              });
              return;
            }
          }
          if (y !== null) {
            const el = document.scrollingElement || document.documentElement;
            el.scrollTo({
              top: y,
              left: 0,
              behavior: 'instant' as ScrollBehavior,
            });
          }
        },
        scrollToSelector ?? null,
        typeof scrollY === 'number' ? scrollY : null,
      );
    }

    // Wait for a painted frame (double rAF) plus a short delay so a freshly
    // scrolled layout is composited before the capture.
    await page.evaluate(
      (delayMs: number) =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() =>
            requestAnimationFrame(() => setTimeout(resolve, delayMs)),
          ),
        ),
      VIEWPORT_PAINT_SETTLE_MS,
    );
  } catch {
    // Non-fatal — proceed to capture regardless.
  }
}

async function uploadToPresigned(
  uploadUrl: string,
  uploadFields: Record<string, string>,
  buf: Buffer,
  type: 'png' | 'jpeg' = 'jpeg',
): Promise<void> {
  const contentType = type === 'png' ? 'image/png' : 'image/jpeg';
  const filename = type === 'png' ? 'screenshot.png' : 'screenshot.jpg';
  const form = new FormData();
  for (const [k, v] of Object.entries(uploadFields)) form.append(k, v);
  form.append(
    'file',
    new Blob([buf as unknown as BlobPart], { type: contentType }),
    filename,
  );
  const res = await fetch(uploadUrl, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Screenshot upload failed: ${res.status}`);
  }
}
