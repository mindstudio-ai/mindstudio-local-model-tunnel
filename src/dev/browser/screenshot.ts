/**
 * CDP-based screenshot capture.
 *
 * Runs inside the tunnel (Node) against the puppeteer Page owned by the
 * BrowserSupervisor. Produces real pixels via Chrome's own rendering path
 * (replacing browser-agent's snapdom DOM→SVG→Canvas pipeline for headless
 * targets) and uploads the result to the same presigned S3 URL the WS
 * path uses, so callers see an identical result shape.
 *
 * Cost model, because it drives the timeouts here: the sandbox browser runs with
 * --disable-gpu, so a page that renders continuously rasterizes in software, and
 * every CDP step of a capture then costs roughly a frame — a `page.evaluate` has
 * to be scheduled on a main thread busy rasterizing, and the capture waits for a
 * committed frame. Measured on a WebGL page at 7fps: ~3s per evaluate, 3.6s to
 * capture the viewport, 8.0s to capture full-page. Nothing is wedged in that
 * situation, it is all just slow, so the deadlines below are a budget shared
 * across the steps rather than a hang detector: each step spends what it needs,
 * the optional ones drop out when the budget runs low, and the module's job is to
 * fail inside that budget without leaving work running in Chrome afterwards.
 */

import { ProtocolError } from 'puppeteer-core';
import type { Page, Viewport } from 'puppeteer-core';

export interface CaptureOpts {
  fullPage: boolean;
  /** Cap the capture's deadline at this instead of the default for its kind.
   * Used when the capture is one step of a larger command that has its own
   * envelope: a 90s full-page shot must not be started with 5s of the caller's
   * budget left. The effective deadline is the smaller of the two. */
  budgetMs?: number;
  path?: string;
  /** Proxy port for resolving `path` against the sandbox origin
   * (http://127.0.0.1:<proxyPort>) instead of the page's current URL — which may
   * be chrome-error:// or cross-origin. See the goto in captureViaCdpInner. */
  proxyPort?: number;
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
// How many in-flight requests still count as "idle". Zero — puppeteer's default
// — is unreachable for any app that polls or holds a stream open: the in-flight
// count never touches 0, so the settle always runs its full timeout and buys
// nothing. Remy-built apps poll routinely (live dashboards refetching every
// second or so, with requests that overlap when the backend is slow). A small
// allowance lets steady-state polling read as idle while a real request cascade,
// where each response kicks off more work, still holds the gate.
const SETTLE_CONCURRENCY = 2;
const JPEG_QUALITY = 85;
// Pre-roll timings: used only for fullPage captures to trigger
// IntersectionObservers, lazy-loaded images, and scroll-linked animations
// before the single-shot CDP capture.
const PREROLL_BOTTOM_DWELL_MS = 300;
const PREROLL_NETWORK_IDLE_MS = 1_500;
const PREROLL_RESTORE_DWELL_MS = 100;
// Viewport captures: delay after a double-rAF to let the scrolled layout paint
// before the single-shot capture (closes the scroll→capture paint race).
const VIEWPORT_PAINT_SETTLE_MS = 32;

// Overall capture deadlines. Kept under the callers' client-side budgets
// (viewport 30s, full-page 120s) so the tunnel fails first and the agent sees a
// real error, not an opaque client abort. Exported so launcher.ts can derive the
// connection-wide protocolTimeout backstop from them.
export const VIEWPORT_CAPTURE_TIMEOUT_MS = 20_000;
export const FULLPAGE_CAPTURE_TIMEOUT_MS = 90_000;
// Upload of the captured JPEG to the presigned S3 URL.
const UPLOAD_TIMEOUT_MS = 20_000;
// styleMap is best-effort decoration on the result. On a slow page it costs
// about a frame (~1s at 7fps), so it is skipped rather than spent when the
// deadline is already close — the image matters, the style dump doesn't.
const STYLEMAP_MIN_BUDGET_MS = 5_000;

/**
 * Capture failed against its deadline, or was refused because a previous one is
 * still running. Carries `code` so the stdin router reports `BROWSER_TIMEOUT`
 * instead of the catch-all `INFRASTRUCTURE`: a page too slow to photograph is
 * not broken infrastructure, and the agent acts differently on the two.
 */
export class ScreenshotTimeoutError extends Error {
  readonly code = 'BROWSER_TIMEOUT';
  constructor(message: string) {
    super(message);
    this.name = 'ScreenshotTimeoutError';
  }
}

const CAPTURE_IN_FLIGHT_MESSAGE =
  'A previous screenshot capture of this page has not finished — it passed its deadline and Chrome is still working through it. Starting another now would stack work on an already-saturated renderer, which is what makes the sandbox browser drop its connection. Wait a few seconds and retry.';

function timedOutMessage(label: string, ms: number): string {
  return `${label} screenshot capture timed out after ${ms}ms — Chrome did not return a frame in time. This is not a connection or infrastructure failure: the page is simply still rendering. A page that animates continuously (a requestAnimationFrame or WebGL loop) rasterizes in software in the sandbox browser, so every frame, and every capture, is slow. Retry once after a few seconds; if it fails again, verify the page another way (accessibility snapshot, DOM assertions) instead of retrying further.`;
}

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
      () => reject(new ScreenshotTimeoutError(timedOutMessage(label, ms))),
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
 * The capture currently running against a page, if any.
 *
 * A capture that passes its deadline is abandoned, not cancelled: `withTimeout`
 * stops waiting, but the CDP commands it issued keep running inside Chrome. Any
 * capture started in that window stacks more compositor work on a renderer that
 * is already too slow to produce a frame. In the session that prompted this,
 * five captures stacked up over six minutes and Chrome dropped its connection,
 * turning a slow page into a dead browser and a nine-minute detour.
 *
 * So this tracks the *inner* promise — which settles when the last CDP call
 * actually returns, however long after we gave up on it — and captures are
 * refused until it does. Keyed on Page, so a supervisor relaunch starts clean.
 */
const inFlight = new WeakMap<Page, Promise<CaptureResult>>();

/**
 * Bounded entry point: caps the whole capture (navigation, settle, the CDP
 * screenshot, and upload) at one deadline, and enforces that deadline on the
 * capture command itself rather than only on our side of it. The inner function
 * is the actual capture.
 *
 * The deadline is a budget shared across the steps (see the cost model at the top
 * of this file): each reads what's left of it, the optional ones drop out when it
 * runs low, and the capture command carries the remainder as its own protocol
 * timeout so it dies with us instead of outliving us by puppeteer's 180s default.
 */
export async function captureViaCdp(
  page: Page,
  opts: CaptureOpts,
): Promise<CaptureResult> {
  if (inFlight.has(page)) {
    throw new ScreenshotTimeoutError(CAPTURE_IN_FLIGHT_MESSAGE);
  }

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
  const budgetMs = Math.min(
    effectiveFullPage
      ? FULLPAGE_CAPTURE_TIMEOUT_MS
      : VIEWPORT_CAPTURE_TIMEOUT_MS,
    opts.budgetMs ?? Infinity,
  );

  let prevViewport: Viewport | null = null;
  if (exactSize) {
    prevViewport = page.viewport();
    await page.setViewport({
      width: opts.width!,
      height: opts.height!,
      deviceScaleFactor: 1,
    });
  }

  const inner = captureViaCdpInner(page, opts, budgetMs);
  inFlight.set(page, inner);

  // Restore and release when the work truly finishes, not when we stop waiting
  // for it: resizing the viewport out from under a capture that is still running
  // would add another relayout to the renderer we're already starving.
  void inner
    .catch(() => {})
    .then(async () => {
      if (prevViewport) {
        await page.setViewport(prevViewport).catch(() => {});
      }
      if (inFlight.get(page) === inner) {
        inFlight.delete(page);
      }
    });

  return withTimeout(
    inner,
    budgetMs,
    effectiveFullPage ? 'Full-page' : 'Viewport',
  );
}

async function captureViaCdpInner(
  page: Page,
  opts: CaptureOpts,
  budgetMs: number,
): Promise<CaptureResult> {
  // What's left of the shared budget. Floored at 1s: a step given a
  // non-positive timeout would fail before it started, and a step that only just
  // overran should report its own timeout rather than a spurious one.
  const deadline = Date.now() + budgetMs;
  const remaining = () => Math.max(1_000, deadline - Date.now());

  // An exact width/height request is always a fixed-viewport clip, never a
  // full-page stitch (the caller sized the viewport itself). Format defaults to
  // jpeg to preserve existing QA-screenshot behavior byte-for-byte.
  const effectiveFullPage =
    typeof opts.width === 'number' && typeof opts.height === 'number'
      ? false
      : opts.fullPage;
  const type: 'png' | 'jpeg' = opts.format === 'png' ? 'png' : 'jpeg';

  if (opts.path) {
    // Puppeteer's page.goto requires an absolute URL — callers pass paths like
    // "/welcome". Resolve against the known proxy origin
    // (http://127.0.0.1:<proxyPort>), NOT page.url(): if the page is parked on
    // chrome-error://chromewebdata/ (after an aborted nav) resolving against it
    // yields chrome-error://.../<path> → net::ERR_ABORTED, wedging every later
    // path capture. Basing on the proxy origin self-heals (the next goto lands
    // on a real URL). Falls back to page.url() only if the port is unknown.
    const base = opts.proxyPort
      ? `http://127.0.0.1:${opts.proxyPort}`
      : page.url();
    const absolute = new URL(opts.path, base).toString();
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
      timeout: Math.min(GOTO_TIMEOUT_MS, remaining()),
    });
  }

  // Match browser-agent's in-page network-idle settle so layout/fonts are
  // stable at capture time. Swallow timeout — best-effort.
  await page
    .waitForNetworkIdle({
      timeout: Math.min(SETTLE_TIMEOUT_MS, remaining()),
      idleTime: SETTLE_IDLE_MS,
      concurrency: SETTLE_CONCURRENCY,
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
  // predates the exposed API, or if the budget is too thin to spend a frame on
  // it — an image with no styleMap beats a deadline with neither.
  let styleMap: string | undefined;
  if (remaining() > STYLEMAP_MIN_BUDGET_MS) {
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
  }

  // Hand-rolled instead of page.screenshot() for one reason: CDPSession.send
  // takes a per-command timeout, and page.screenshot() has no way to pass one.
  // Without it the command runs under puppeteer's connection-wide 180s
  // protocolTimeout, so a capture we already reported as timed out at 20s keeps
  // working inside Chrome for another 160. These params are what
  // page.screenshot() sends for the same options: it defaults
  // captureBeyondViewport to true, then forces it false for non-fullPage shots,
  // and omits quality for png. Verified byte-identical for all three modes.
  const client = await page.createCDPSession();
  let buf: Buffer;
  try {
    const { data } = await client.send(
      'Page.captureScreenshot',
      {
        format: type,
        ...(type === 'jpeg' ? { quality: JPEG_QUALITY } : {}),
        captureBeyondViewport: effectiveFullPage,
      },
      { timeout: remaining() },
    );
    buf = Buffer.from(data, 'base64');
  } catch (err) {
    // Puppeteer phrases its own protocol timeout as "Increase the
    // 'protocolTimeout' setting in launch/connect calls", which reaches the agent
    // verbatim: an internal knob it can't touch, and the wrong advice anyway —
    // a longer timeout would only stall the turn further. Say what happened
    // instead. Other ProtocolErrors (target closed, navigated away) pass through.
    if (err instanceof ProtocolError && /timed out/i.test(err.message)) {
      throw new ScreenshotTimeoutError(
        timedOutMessage(effectiveFullPage ? 'Full-page' : 'Viewport', budgetMs),
      );
    }
    throw err;
  } finally {
    await client.detach().catch(() => {});
  }

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
 * lazy-loaded content to settle, then scroll back where it started. Gives
 * fullPage captures a chance to include scroll-triggered fade-ins, lazy
 * images, and windowed-list items.
 *
 * Restores the caller's scroll offset rather than assuming it was 0: a capture
 * reads the page, so it shouldn't move it. Scrolling to top unconditionally
 * meant an agent that had scrolled to a section and then took a full-page shot
 * silently lost its position, and the next viewport capture framed the wrong
 * part of the page.
 *
 * Best-effort — all timeouts swallowed. If the page can't be scrolled
 * (short content, scroll-locked body) the function is effectively a no-op.
 */
async function preRollScroll(page: Page): Promise<void> {
  try {
    const origin = await page.evaluate(() => {
      const el = document.scrollingElement || document.documentElement;
      const max = Math.max(
        document.documentElement.scrollHeight,
        document.body.scrollHeight,
      );
      if (max <= window.innerHeight + 10) return null; // nothing to scroll
      const from = { top: el.scrollTop, left: el.scrollLeft };
      el.scrollTo({ top: max, left: 0, behavior: 'instant' as ScrollBehavior });
      return from;
    });

    if (!origin) return;

    // Let IntersectionObservers fire and any triggered animations settle.
    await new Promise((r) => setTimeout(r, PREROLL_BOTTOM_DWELL_MS));

    // If the observers kicked off image/data loads, wait for them briefly.
    await page
      .waitForNetworkIdle({
        timeout: PREROLL_NETWORK_IDLE_MS,
        idleTime: SETTLE_IDLE_MS,
        concurrency: SETTLE_CONCURRENCY,
      })
      .catch(() => {});

    await page.evaluate((from: { top: number; left: number }) => {
      const el = document.scrollingElement || document.documentElement;
      el.scrollTo({ ...from, behavior: 'instant' as ScrollBehavior });
    }, origin);

    await new Promise((r) => setTimeout(r, PREROLL_RESTORE_DWELL_MS));
  } catch {
    // Non-fatal — proceed to capture regardless.
  }
}

/**
 * Prepare a non-fullPage (viewport) capture by scrolling a target element — or
 * an absolute Y offset — into view via CDP `page.evaluate`, i.e. the *same*
 * context the screenshot is taken in, so the scroll and the capture can't race
 * (unlike a scroll issued over the WebSocket browser-agent and a separate CDP
 * capture). Then waits for at least one composited frame so the scrolled layout
 * has painted before the shot.
 *
 * No scroll target means nothing to settle, so it returns immediately. The paint
 * wait used to run unconditionally, on the theory that it was harmless for
 * current-viewport captures — on a page rendering in software it costs about 3s,
 * because a `page.evaluate` has to be scheduled on a main thread that is busy
 * rasterizing (the round trip dominates; capping the wait *inside* the page
 * changes nothing, measured). There is no scroll to race with in that case, and
 * `Page.captureScreenshot` waits for a committed frame on its own.
 *
 * Best-effort — all errors swallowed.
 */
async function settleViewport(
  page: Page,
  scrollToSelector?: string,
  scrollY?: number,
): Promise<void> {
  if (!scrollToSelector && typeof scrollY !== 'number') return;

  try {
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

    // Wait for a painted frame (double rAF) plus a short delay so the freshly
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
