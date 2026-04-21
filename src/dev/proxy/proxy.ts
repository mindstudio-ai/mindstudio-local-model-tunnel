// Local dev proxy — sits between the browser and the upstream dev server.
//
// Why: the MindStudio frontend SDK needs window.__MINDSTUDIO__ (session
// token, API URL, method mappings) to function. In production, the platform
// injects this into HTML served from S3. In dev mode, the proxy does it
// locally so the browser gets the same context without a platform round-trip.
//
// How it works:
// - HTML responses: buffered, __MINDSTUDIO__ injected before </head>, served
// - Everything else (JS, CSS, images, fonts): piped through unmodified
// - WebSocket upgrades: /__mindstudio_dev__/ws handled locally (browser agent),
//   all others forwarded transparently (enables HMR for any framework)
// - CORS/PNA headers: added so the proxy works inside iframes from app.mindstudio.ai
// - Caching disabled on all responses (this is local dev, always fresh)
// - /__mindstudio_dev__/*: intercepted locally for browser agent communication

import http from 'node:http';
import https from 'node:https';
import { randomBytes } from 'node:crypto';
import type { Socket } from 'node:net';
import { WebSocketServer, WebSocket } from 'ws';
import { log } from '../logging/logger';
import { appendBrowserLogEntries } from '../logging/browser-log';
import { ClientRegistry } from './ws-clients';
import { CommandError } from '../stdin-commands/types';
import { getApiBaseUrl } from '../../config';

interface PendingResult {
  resolve: (result: Record<string, unknown>) => void;
  reject: (err: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
  clientId: string;
}

interface QueuedCommand {
  id: string;
  steps: Array<Record<string, unknown>>;
  timeoutMs: number;
  resolve: (result: Record<string, unknown>) => void;
  reject: (err: Error) => void;
  queuedAt: number;
}

export class DevProxy {
  private server: http.Server | null = null;
  private proxyPort: number | null = null;
  private wss: WebSocketServer | null = null;
  private clients = new ClientRegistry();
  private pendingResults = new Map<string, PendingResult>();
  private commandQueue: QueuedCommand[] = [];

  /** Last mirror snapshot — sent to new mirror viewers so they don't wait for the next checkout. */
  private lastMirrorSnapshot: string | null = null;

  /** Upstream dev server health tracking. */
  private upstreamUp = true;
  private healthCheckTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setTimeout> | null = null;

  private static readonly HEALTH_CHECK_INTERVAL = 3_000;
  private static readonly HEALTH_CHECK_INTERVAL_DOWN = 1_000;
  private static readonly HEALTH_CHECK_TIMEOUT = 2_000;
  private static readonly PING_INTERVAL = 30_000;
  private static readonly HELLO_TIMEOUT = 5_000;

  constructor(
    private readonly upstreamPort: number,
    private clientContext: Record<string, unknown>,
    private readonly appId: string,
    private readonly bindAddress: string = '127.0.0.1',
    // Dev override: 'https://seankoji-msba.ngrok.io/index.js'
    private readonly browserAgentUrl?: string,
  ) {}

  updateClientContext(context: Record<string, unknown>): void {
    this.clientContext = context;
  }

  /**
   * Whether any browser agent is actively connected via WebSocket.
   */
  isBrowserConnected(): boolean {
    return this.clients.hasConnected();
  }

  /**
   * Dispatch a command to the preferred browser client and wait for the result.
   * Commands are queued and executed one at a time per client (FIFO).
   */
  dispatchBrowserCommand(
    steps: Array<Record<string, unknown>>,
    timeoutMs = 120_000,
  ): Promise<Record<string, unknown>> {
    if (!this.clients.hasConnected()) {
      return Promise.reject(
        new CommandError('No browser connected', 'NO_BROWSER'),
      );
    }

    const id = randomBytes(4).toString('hex');

    return new Promise((resolve, reject) => {
      this.commandQueue.push({
        id,
        steps,
        timeoutMs,
        resolve,
        reject,
        queuedAt: Date.now(),
      });
      log.debug('proxy', 'Browser command queued', {
        id,
        queueLength: this.commandQueue.length,
        commands: steps.map((s) => s.command),
      });
      this.drainCommandQueue();
    });
  }

  /**
   * Try to send the next queued command to an available client.
   */
  private drainCommandQueue(): void {
    // Reject all queued commands if no clients are connected at all
    if (!this.clients.hasConnected() && this.commandQueue.length > 0) {
      const orphaned = this.commandQueue.splice(0);
      for (const cmd of orphaned) {
        cmd.reject(new CommandError('No browser connected', 'NO_BROWSER'));
      }
      return;
    }

    while (this.commandQueue.length > 0) {
      const target = this.clients.getCommandTarget();
      if (!target) break; // no idle client available

      const queued = this.commandQueue.shift()!;
      const { id, steps, timeoutMs, resolve, reject } = queued;

      log.info('proxy', 'Browser command sent', {
        id,
        clientId: target.id,
        mode: target.mode,
        stepCount: steps.length,
        commands: steps.map((s) => s.command),
        queueWaitMs: Date.now() - queued.queuedAt,
      });

      const timeout = setTimeout(() => {
        this.pendingResults.delete(id);
        const client = this.clients.findByCommandId(id);
        if (client) {
          // Client didn't respond — treat it as dead so subsequent
          // commands don't get dispatched to the same zombie.
          log.warn('proxy', 'Removing unresponsive browser client', { clientId: client.id });
          this.clients.remove(client.id);
          try { client.ws.terminate(); } catch {}
        }
        log.warn('proxy', 'Browser command timed out', {
          id,
          pendingCount: this.pendingResults.size,
        });
        reject(new CommandError('Browser command timed out', 'BROWSER_TIMEOUT'));
        this.drainCommandQueue();
      }, timeoutMs);

      this.pendingResults.set(id, { resolve, reject, timeout, clientId: target.id });
      target.activeCommandId = id;

      try {
        target.ws.send(JSON.stringify({ type: 'command', id, steps }));
      } catch {
        this.pendingResults.delete(id);
        clearTimeout(timeout);
        target.activeCommandId = null;
        log.warn('proxy', 'Browser command send failed', {
          id,
          clientId: target.id,
        });
        reject(new CommandError('Failed to send command to browser', 'BROWSER_SEND_FAILED'));
        // Continue draining — next command might target a different client
      }
    }
  }

  /**
   * Send a broadcast message to all connected browser clients.
   */
  broadcastToClients(action: string, payload?: Record<string, unknown>): void {
    const msg = JSON.stringify({ type: 'broadcast', action, payload });
    const clients = this.clients.getAll();
    log.info('proxy', 'Broadcasting to browser clients', {
      action,
      clientCount: clients.length,
    });
    for (const client of clients) {
      try {
        client.ws.send(msg);
      } catch {
        // Client may be closing — will be cleaned up
      }
    }
  }

  async start(preferredPort?: number): Promise<number> {
    const server = http.createServer((req, res) => {
      this.handleRequest(req, res);
    });

    // Set up WebSocket server in noServer mode
    this.wss = new WebSocketServer({ noServer: true });
    this.wss.on('connection', (ws, req) =>
      this.handleWsConnection(ws, req as http.IncomingMessage),
    );

    // Route upgrade requests: our WS path vs upstream HMR
    server.on('upgrade', (req, socket, head) => {
      if (req.url === '/__mindstudio_dev__/ws') {
        this.wss!.handleUpgrade(req, socket as Socket, head, (ws) => {
          this.wss!.emit('connection', ws, req);
        });
      } else {
        this.handleUpstreamUpgrade(req, socket as Socket, head);
      }
    });

    // Try the preferred port first, fall back to OS-assigned
    const portsToTry = preferredPort ? [preferredPort, 0] : [0];

    for (const port of portsToTry) {
      try {
        const assignedPort = await this.listenOnPort(server, port);
        this.server = server;
        this.proxyPort = assignedPort;
        this.startHealthCheck();
        this.startPingTimer();
        log.info('proxy', 'Dev proxy started', {
          port: assignedPort,
          bind: this.bindAddress,
        });
        return assignedPort;
      } catch {
        log.warn('proxy', 'Proxy port in use, trying next', { port });
        // Port in use — try next
      }
    }

    throw new Error('Failed to start proxy server');
  }

  private listenOnPort(server: http.Server, port: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const onError = (err: Error) => {
        server.removeListener('error', onError);
        reject(err);
      };
      server.on('error', onError);

      server.listen(port, this.bindAddress, () => {
        server.removeListener('error', onError);
        const addr = server.address();
        if (!addr || typeof addr === 'string') {
          reject(new Error('Failed to get proxy server address'));
          return;
        }
        resolve(addr.port);
      });
    });
  }

  stop(): void {
    this.stopHealthCheck();
    this.stopPingTimer();

    // Close all WebSocket connections
    for (const client of this.clients.getAll()) {
      try {
        client.ws.close(1001, 'Proxy stopping');
      } catch {
        client.ws.terminate();
      }
    }

    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    if (this.server) {
      log.info('proxy', 'Dev proxy stopping');
      this.server.close();
      this.server = null;
      this.proxyPort = null;
    }

    // Reject pending commands so callers don't hang
    for (const [, pending] of this.pendingResults) {
      clearTimeout(pending.timeout);
      pending.reject(new CommandError('Proxy stopped', 'INFRASTRUCTURE'));
    }
    this.pendingResults.clear();

    // Reject queued commands
    for (const queued of this.commandQueue) {
      queued.reject(new CommandError('Proxy stopped', 'INFRASTRUCTURE'));
    }
    this.commandQueue.length = 0;
  }

  getPort(): number | null {
    return this.proxyPort;
  }

  // ---------------------------------------------------------------------------
  // WebSocket connection handler
  // ---------------------------------------------------------------------------

  private handleWsConnection(ws: WebSocket, req: http.IncomingMessage): void {
    let clientId: string | null = null;
    const remoteAddr = req.socket.remoteAddress ?? '';
    const isLoopback =
      remoteAddr === '127.0.0.1' ||
      remoteAddr === '::1' ||
      remoteAddr === '::ffff:127.0.0.1';

    // Require hello within 5s
    const helloTimeout = setTimeout(() => {
      if (!clientId) {
        log.warn(
          'proxy',
          'Browser WS client did not send hello in time, closing',
        );
        ws.close(4000, 'Hello timeout');
      }
    }, DevProxy.HELLO_TIMEOUT);

    ws.on('message', (data) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }

      if (!clientId) {
        // First message must be hello
        if (msg.type !== 'hello') {
          ws.close(4001, 'Expected hello');
          return;
        }
        clearTimeout(helloTimeout);

        const helloUrl = String(msg.url || '');
        // A client is the sandbox's headless Chrome when BOTH:
        //   1. the hello comes from loopback (127.0.0.1 / ::1)
        //   2. the agent flagged itself (sessionStorage-backed, survives
        //      `location.href='/'` reloads) OR the URL still has the marker
        const isSandboxBrowser =
          isLoopback &&
          (msg.sandbox === true || helloUrl.includes('ms_sandbox=1'));
        const mode: 'iframe' | 'standalone' | 'mirror' | 'headless' =
          isSandboxBrowser
            ? 'headless'
            : msg.mode === 'iframe'
              ? 'iframe'
              : msg.mode === 'mirror'
                ? 'mirror'
                : 'standalone';

        log.debug('proxy', 'WS hello received', {
          remoteAddr,
          isLoopback,
          helloMode: msg.mode,
          helloSandbox: msg.sandbox,
          helloUrl,
          resolvedMode: mode,
        });
        const viewport = (msg.viewport as { w: number; h: number }) || {
          w: 0,
          h: 0,
        };

        clientId = this.clients.add(ws, {
          mode,
          url: helloUrl,
          viewport,
          mirror: !!msg.mirror,
        });

        ws.send(JSON.stringify({ type: 'ack', clientId }));

        // Send buffered snapshot to new mirror viewers so they render immediately
        if (mode === 'mirror' && this.lastMirrorSnapshot) {
          try {
            ws.send(this.lastMirrorSnapshot);
          } catch {}
        }
        return;
      }

      // Subsequent messages
      switch (msg.type) {
        case 'result':
          this.handleCommandResult(msg);
          break;

        case 'log':
          if (Array.isArray(msg.entries)) {
            appendBrowserLogEntries(msg.entries as Record<string, unknown>[]);
          }
          break;

        case 'mirror': {
          const events = msg.events as Array<{
            type?: number;
            data?: Record<string, unknown>;
          }>;
          if (clientId && Array.isArray(events)) {
            // Buffer the latest full snapshot (type 2) + preceding meta (type 4)
            // so new mirror viewers get it immediately on connect.
            let meta: unknown = null;
            let snapshot: unknown = null;
            for (const evt of events) {
              if (evt.type === 4) meta = evt;
              if (evt.type === 2) snapshot = evt;
              // Update viewport from rrweb meta events for accurate sizing
              if (evt.type === 4 && evt.data?.width && evt.data?.height) {
                const client = this.clients.get(clientId);
                if (client) {
                  client.viewport = {
                    w: evt.data.width as number,
                    h: evt.data.height as number,
                  };
                  client.mirrorReady = true;
                }
              }
            }
            if (snapshot) {
              const snapshotEvents: unknown[] = [];
              if (meta) snapshotEvents.push(meta);
              snapshotEvents.push(snapshot);
              this.lastMirrorSnapshot = JSON.stringify({
                type: 'mirror',
                events: snapshotEvents,
              });
            }
          }
          this.relayMirrorEvents(data.toString());
          break;
        }
      }
    });

    ws.on('pong', () => {
      if (clientId) this.clients.markAlive(clientId);
    });

    ws.on('close', () => {
      clearTimeout(helloTimeout);
      if (clientId) {
        const client = this.clients.remove(clientId);
        // Browser may reconnect after a navigation and deliver the result
        // (stash/resume pattern). Give a short grace period, then reject
        // if no client reconnects — avoids waiting the full command timeout
        // when the browser is truly gone.
        if (client?.activeCommandId) {
          const commandId = client.activeCommandId;
          log.debug('proxy', 'Browser disconnected with active command', { commandId });
          setTimeout(() => {
            // If still pending and no client has picked it up, reject
            if (this.pendingResults.has(commandId) && !this.clients.findByCommandId(commandId)) {
              this.rejectPendingCommand(commandId, new CommandError('Browser disconnected', 'BROWSER_DISCONNECTED'));
              this.drainCommandQueue();
            }
          }, 10_000);
        }
      }
    });

    ws.on('error', () => {
      // Close event will follow and handle cleanup
    });
  }

  private handleCommandResult(msg: Record<string, unknown>): void {
    const id = msg.id as string;
    if (!id) {
      log.warn('proxy', 'Browser command result received with no id');
      return;
    }

    const pending = this.pendingResults.get(id);
    if (pending) {
      log.info('proxy', 'Browser command result received', {
        id,
        stepCount: (msg.steps as unknown[])?.length,
        duration: msg.duration,
      });
      clearTimeout(pending.timeout);
      this.pendingResults.delete(id);

      // Clear activeCommandId
      const client = this.clients.findByCommandId(id);
      if (client) client.activeCommandId = null;

      pending.resolve(msg);

      // Client is now free — dispatch next queued command
      this.drainCommandQueue();
    } else {
      log.warn(
        'proxy',
        'Browser command result received but no pending command found',
        { id, pendingIds: [...this.pendingResults.keys()] },
      );
    }
  }

  private rejectPendingCommand(commandId: string, error: CommandError): void {
    const pending = this.pendingResults.get(commandId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingResults.delete(commandId);
      pending.reject(error);
      log.warn('proxy', 'Pending command rejected', { id: commandId, code: error.code, reason: error.message });

      // Client slot freed — dispatch next queued command
      this.drainCommandQueue();
    }
  }

  // ---------------------------------------------------------------------------
  // Ping/pong liveness
  // ---------------------------------------------------------------------------

  private startPingTimer(): void {
    this.pingTimer = setInterval(() => {
      // Sweep clients that didn't respond to the previous ping
      const removed = this.clients.sweepDead();
      for (const { activeCommandId } of removed) {
        if (activeCommandId) {
          this.rejectPendingCommand(
            activeCommandId,
            new CommandError('Browser client timed out', 'BROWSER_DISCONNECTED'),
          );
        }
      }
      // Send new ping to all remaining clients
      this.clients.pingAll();
    }, DevProxy.PING_INTERVAL);
  }

  private stopPingTimer(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Upstream health check
  // ---------------------------------------------------------------------------

  /**
   * Explicitly mark the upstream dev server as down.
   * Used by the stdin `dev-server-restarting` action when the parent process
   * knows a restart is happening (may be too fast for the health check to catch).
   * The health check will detect recovery and reload the browser.
   */
  markUpstreamDown(): void {
    if (!this.upstreamUp) return;
    this.upstreamUp = false;
    log.info('proxy', 'Upstream dev server marked as down (explicit signal)');
    this.scheduleHealthCheck(DevProxy.HEALTH_CHECK_INTERVAL_DOWN);
  }

  private startHealthCheck(): void {
    this.scheduleHealthCheck(DevProxy.HEALTH_CHECK_INTERVAL);
  }

  private stopHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearTimeout(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  private scheduleHealthCheck(delayMs: number): void {
    this.stopHealthCheck();
    this.healthCheckTimer = setTimeout(() => this.checkUpstream(), delayMs);
  }

  private async checkUpstream(): Promise<void> {
    const wasUp = this.upstreamUp;

    try {
      const res = await fetch(`http://127.0.0.1:${this.upstreamPort}/`, {
        signal: AbortSignal.timeout(DevProxy.HEALTH_CHECK_TIMEOUT),
      });
      // Any response (even 404/500) means the server is alive
      this.upstreamUp = true;
    } catch {
      this.upstreamUp = false;
    }

    // Handle state transitions
    if (wasUp && !this.upstreamUp) {
      log.warn('proxy', 'Upstream dev server is down');
    } else if (!wasUp && this.upstreamUp) {
      log.info('proxy', 'Upstream dev server is back up, reloading browser');
      this.broadcastToClients('reload');
    }

    // Poll faster when down to catch recovery quickly
    const interval = this.upstreamUp
      ? DevProxy.HEALTH_CHECK_INTERVAL
      : DevProxy.HEALTH_CHECK_INTERVAL_DOWN;
    this.scheduleHealthCheck(interval);
  }

  // ---------------------------------------------------------------------------
  // CORS helper
  // ---------------------------------------------------------------------------

  private corsHeaders(req: http.IncomingMessage): Record<string, string> {
    const origin = req.headers.origin;
    if (!origin) return {};
    return {
      'access-control-allow-origin': origin,
      'access-control-allow-private-network': 'true',
    };
  }

  // ---------------------------------------------------------------------------
  // Request routing
  // ---------------------------------------------------------------------------

  private handleRequest(
    clientReq: http.IncomingMessage,
    clientRes: http.ServerResponse,
  ): void {
    // Browser agent endpoints — intercepted locally, never forwarded upstream
    if (clientReq.url?.startsWith('/__mindstudio_dev__/')) {
      // Keep logs endpoint as fallback for sendBeacon on page unload
      if (
        clientReq.url === '/__mindstudio_dev__/logs' &&
        clientReq.method === 'POST'
      ) {
        this.handleBrowserLogs(clientReq, clientRes);
        return;
      }
      if (
        clientReq.url?.startsWith('/__mindstudio_dev__/font-proxy?') &&
        clientReq.method === 'GET'
      ) {
        this.handleFontProxy(clientReq, clientRes);
        return;
      }
      if (
        clientReq.url === '/__mindstudio_dev__/mirror' &&
        clientReq.method === 'GET'
      ) {
        this.serveMirrorPage(clientRes);
        return;
      }
      if (
        clientReq.url === '/__mindstudio_dev__/mirror-status' &&
        clientReq.method === 'GET'
      ) {
        const source = this.clients.getMirrorSource();
        const ready = source?.mirrorReady ?? false;
        const body = JSON.stringify({
          active: ready,
          viewport: ready ? source!.viewport : null,
        });
        clientRes.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          ...this.corsHeaders(clientReq),
        });
        clientRes.end(body);
        return;
      }
    }

    // CORS preflight
    if (clientReq.method === 'OPTIONS' && clientReq.headers.origin) {
      clientRes.writeHead(204, {
        ...this.corsHeaders(clientReq),
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': '*',
      });
      clientRes.end();
      return;
    }

    // Same-origin API routes — forward to MindStudio API server
    if (clientReq.url?.startsWith('/_/')) {
      this.forwardToApi(clientReq, clientRes);
      return;
    }

    // Forward to upstream dev server
    this.forwardToUpstream(clientReq, clientRes);
  }

  // ---------------------------------------------------------------------------
  // API forwarding (/_/ same-origin routes)
  // ---------------------------------------------------------------------------

  private forwardToApi(
    clientReq: http.IncomingMessage,
    clientRes: http.ServerResponse,
  ): void {
    const cors = this.corsHeaders(clientReq);
    const originalPath = clientReq.url!;

    // Rewrite /_/{rest} → /_internal/v2/apps/{appId}/{rest}
    const rest = originalPath.slice(3); // strip "/_/"
    const apiPath = `/_internal/v2/apps/${this.appId}/${rest}`;

    const apiBaseUrl = getApiBaseUrl();
    const target = new URL(apiPath, apiBaseUrl);
    const isHttps = target.protocol === 'https:';
    const httpModule = isHttps ? https : http;

    const headers: Record<string, string | string[] | undefined> = {
      ...clientReq.headers,
      host: target.host,
    };
    // Pass through the browser's Authorization header (ms_iface_... token) as-is
    delete headers['connection'];
    // Don't request compressed responses — Node doesn't auto-decompress, and
    // compressed chunks would break SSE streams piped back to the browser.
    delete headers['accept-encoding'];

    // API routes need the dev release ID so the platform routes execution
    // back through the tunnel's poll queue instead of the live release.
    if (originalPath.startsWith('/_/api/') && this.clientContext.releaseId) {
      headers['x-dev-session'] = this.clientContext.releaseId as string;
    }

    const proxyReq = httpModule.request(
      {
        hostname: target.hostname,
        port: target.port || (isHttps ? 443 : 80),
        path: target.pathname + target.search,
        method: clientReq.method,
        headers,
      },
      (proxyRes) => {
        const responseHeaders = { ...proxyRes.headers, ...cors };
        responseHeaders['cache-control'] = 'no-store';

        // Rewrite Set-Cookie domain/flags for dev so cookies work on the proxy origin.
        if (responseHeaders['set-cookie']) {
          const cookies = Array.isArray(responseHeaders['set-cookie'])
            ? responseHeaders['set-cookie']
            : [responseHeaders['set-cookie']];
          responseHeaders['set-cookie'] = cookies.map((c) =>
            c
              .replace(/;\s*[Dd]omain=[^;]*/g, '')
              .replace(/;\s*[Ss]ame[Ss]ite=[^;]*/g, '; SameSite=None')
              .replace(/;\s*[Hh]ttp[Oo]nly/g, ''),
          ) as any;
        }

        clientRes.writeHead(proxyRes.statusCode ?? 502, responseHeaders);
        proxyRes.pipe(clientRes);
      },
    );

    proxyReq.on('error', (err) => {
      log.warn('proxy', 'API proxy error', {
        path: originalPath,
        error: err.message,
      });
      if (!clientRes.headersSent) {
        clientRes.writeHead(502, cors);
        clientRes.end(`API proxy error: ${err.message}`);
      }
    });

    clientReq.pipe(proxyReq);
  }

  // ---------------------------------------------------------------------------
  // Upstream forwarding
  // ---------------------------------------------------------------------------

  private forwardToUpstream(
    clientReq: http.IncomingMessage,
    clientRes: http.ServerResponse,
  ): void {
    const cors = this.corsHeaders(clientReq);

    const upstreamReq = http.request(
      {
        hostname: '127.0.0.1',
        port: this.upstreamPort,
        path: clientReq.url,
        method: clientReq.method,
        headers: {
          ...clientReq.headers,
          host: `localhost:${this.upstreamPort}`,
        },
      },
      (upstreamRes) => {
        const contentType = upstreamRes.headers['content-type'] ?? '';
        const isHtml = contentType.startsWith('text/html');

        if (isHtml) {
          const chunks: Buffer[] = [];
          upstreamRes.on('data', (chunk) => chunks.push(chunk));
          upstreamRes.on('end', async () => {
            let html = Buffer.concat(chunks).toString('utf-8');

            // Resolve __ms_auth cookie to get authenticated context for injection
            const authCookie = DevProxy.parseAuthCookie(
              clientReq.headers.cookie,
            );
            let contextOverride: Record<string, unknown> | undefined;
            if (authCookie) {
              const resolved = await this.resolveAuthCookie(authCookie);
              if (resolved) {
                contextOverride = {
                  ...this.clientContext,
                  user: resolved.user,
                  token: resolved.token,
                  methods: resolved.methods,
                };
              }
            }

            html = this.injectScripts(html, contextOverride);

            const headers = {
              ...upstreamRes.headers,
              ...cors,
              'content-length': String(Buffer.byteLength(html, 'utf-8')),
              'cache-control': 'no-store, no-cache, must-revalidate',
            };
            delete headers['content-encoding'];
            delete headers['etag'];

            clientRes.writeHead(upstreamRes.statusCode ?? 200, headers);
            clientRes.end(html);
          });
        } else {
          const headers = {
            ...upstreamRes.headers,
            ...cors,
            'cache-control': 'no-store, no-cache, must-revalidate',
          };
          delete headers['etag'];
          clientRes.writeHead(upstreamRes.statusCode ?? 200, headers);
          upstreamRes.pipe(clientRes);
        }
      },
    );

    upstreamReq.on('error', (err) => {
      log.warn('proxy', 'Dev proxy cannot reach dev server', {
        path: clientReq.url,
        error: err.message,
      });
      clientRes.writeHead(502);
      clientRes.end(`Proxy error: ${err.message}`);
    });

    clientReq.pipe(upstreamReq);
  }

  // ---------------------------------------------------------------------------
  // Browser agent HTTP endpoints (fallbacks)
  // ---------------------------------------------------------------------------

  /** Accept log entries via HTTP POST — used by sendBeacon on page unload. */
  private handleBrowserLogs(
    clientReq: http.IncomingMessage,
    clientRes: http.ServerResponse,
  ): void {
    const chunks: Buffer[] = [];
    clientReq.on('data', (chunk) => chunks.push(chunk));
    clientReq.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf-8');
        const entries = JSON.parse(body);
        if (Array.isArray(entries)) {
          appendBrowserLogEntries(entries);
        }
      } catch {
        // Malformed payload — ignore
      }
      clientRes.writeHead(204, this.corsHeaders(clientReq));
      clientRes.end();
    });
  }

  /** Relay a raw mirror message (already JSON-stringified) to all mirror viewers. */
  private relayMirrorEvents(raw: string): void {
    const mirrors = this.clients.getMirrorClients();
    for (const client of mirrors) {
      try {
        client.ws.send(raw);
      } catch {
        // Client will be cleaned up on close
      }
    }
  }

  /** Serve the mirror replay page — an rrweb Replayer in live mode. */
  private serveMirrorPage(res: http.ServerResponse): void {
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Mobile Mirror</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@rrweb/replay@latest/dist/style.css">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { height: 100%; background: #eaeaea; overflow: hidden; }
    #player { width: 100%; height: 100%; }
    .replayer-wrapper { overflow: hidden; transform-origin: center center; visibility: hidden; }
    .replayer-wrapper iframe { border: none; outline: none; }
    .replayer-mouse.touch-device {
      width: 44px; height: 44px; margin-left: -22px; margin-top: -22px;
      border-width: 2px; border-color: rgba(221, 37, 144, 0);
      background: rgba(221, 37, 144, 0.06);
    }
    .replayer-mouse.touch-device.touch-active {
      border-color: rgba(221, 37, 144, 0.8);
      background: rgba(221, 37, 144, 0.12);
    }
    .replayer-mouse.touch-device::after,
    .replayer-mouse.touch-device.active::after { display: none !important; }
    .replayer-mouse:not(.touch-device) { display: none !important; }
  </style>
  <script type="importmap">
  { "imports": { "@rrweb/replay": "https://cdn.jsdelivr.net/npm/@rrweb/replay@latest/+esm" } }
  </script>
</head>
<body>
  <div id="player"></div>
  <script type="module">
    import { Replayer } from '@rrweb/replay';

    const BUFFER_MS = 50;
    const playerRoot = document.getElementById('player');

    let replayer = null;
    let lastMeta = null;
    let notifiedViewport = false;

    function showWrapper() {
      const wrapper = document.querySelector('.replayer-wrapper');
      if (wrapper) wrapper.style.visibility = 'visible';
    }

    function buildReplayer(snapshotEvent) {
      if (replayer) {
        try { replayer.destroy(); } catch(e) {}
        playerRoot.innerHTML = '';
      }
      const initEvents = [];
      if (lastMeta) initEvents.push(lastMeta);
      initEvents.push(snapshotEvent);

      replayer = new Replayer(initEvents, {
        root: playerRoot,
        liveMode: true,
        pauseAnimation: false,
        mouseTail: false,
      });
      replayer.startLive(snapshotEvent.timestamp - BUFFER_MS);
      requestAnimationFrame(showWrapper);
    }

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(proto + '//' + location.host + '/__mindstudio_dev__/ws');

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: 'hello', mode: 'mirror', url: location.href,
        viewport: { w: window.innerWidth, h: window.innerHeight },
      }));
    };

    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.type !== 'mirror' || !Array.isArray(msg.events)) return;

      for (const event of msg.events) {
        if (event.type === 4) {
          lastMeta = event;
          if (!notifiedViewport && event.data && event.data.width && window.parent !== window) {
            notifiedViewport = true;
            window.parent.postMessage({
              channel: 'mindstudio-mirror',
              command: 'viewport',
              width: event.data.width,
              height: event.data.height,
            }, '*');
          }
        }
        if (event.type === 2 && !replayer) {
          buildReplayer(event);
          continue;
        }
        if (replayer) replayer.addEvent(event);
      }
    };

    ws.onclose = () => {
      setTimeout(() => location.reload(), 2000);
    };
  </script>
</body>
</html>`;

    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    });
    res.end(html);
  }

  /**
   * Proxy a cross-origin font stylesheet or font file through our server,
   * adding CORS headers so the browser agent can read the @font-face rules.
   */
  private async handleFontProxy(
    clientReq: http.IncomingMessage,
    clientRes: http.ServerResponse,
  ): Promise<void> {
    const cors = this.corsHeaders(clientReq);
    try {
      const parsed = new URL(clientReq.url!, `http://localhost`);
      const targetUrl = parsed.searchParams.get('url');
      if (!targetUrl) {
        clientRes.writeHead(400, cors);
        clientRes.end('Missing url parameter');
        return;
      }

      const response = await fetch(targetUrl);
      if (!response.ok) {
        clientRes.writeHead(response.status, cors);
        clientRes.end(`Upstream error: ${response.status}`);
        return;
      }

      const contentType = response.headers.get('content-type') || 'text/css';
      let body: string | Buffer;

      if (contentType.includes('css')) {
        // Rewrite font URLs inside CSS to also go through our proxy
        let css = await response.text();
        css = css.replace(
          /url\(\s*(['"]?)(https?:\/\/[^)'"]+)\1\s*\)/g,
          (_, quote, url) =>
            `url(${quote}/__mindstudio_dev__/font-proxy?url=${encodeURIComponent(url)}${quote})`,
        );
        body = css;
      } else {
        // Binary font file — pass through as-is
        const arrayBuf = await response.arrayBuffer();
        body = Buffer.from(arrayBuf);
      }

      clientRes.writeHead(200, {
        ...cors,
        'content-type': contentType,
        'cache-control': 'public, max-age=86400',
      });
      clientRes.end(body);
    } catch (err) {
      clientRes.writeHead(502, cors);
      clientRes.end(
        `Font proxy error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Parse __ms_auth cookie value from a raw Cookie header.
   */
  private static parseAuthCookie(
    cookieHeader: string | undefined,
  ): string | null {
    if (!cookieHeader) return null;
    const match = cookieHeader.match(/(?:^|;\s*)__ms_auth=([^;]+)/);
    return match ? match[1] : null;
  }

  /**
   * Resolve __ms_auth cookie to an authenticated context via the platform.
   * Returns { user, token, methods } or null if not authenticated.
   * Results are cached in memory — invalidated when auth endpoints set new cookies.
   */
  private async resolveAuthCookie(cookie: string): Promise<{
    user: Record<string, unknown>;
    token: string;
    methods: Record<string, string>;
  } | null> {
    const apiBaseUrl = getApiBaseUrl();
    const url = new URL(`/_internal/v2/apps/${this.appId}/auth/me`, apiBaseUrl);
    // Pass the dev release ID so the platform resolves the session against
    // the dev release instead of the live release.
    const releaseId = this.clientContext.releaseId as string | undefined;
    if (releaseId) url.searchParams.set('releaseId', releaseId);
    const isHttps = url.protocol === 'https:';
    const httpModule = isHttps ? https : http;

    return new Promise((resolve) => {
      const req = httpModule.request(
        {
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 80),
          path: url.pathname + url.search,
          method: 'GET',
          headers: {
            cookie: `__ms_auth=${cookie}`,
            host: url.host,
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            try {
              const body = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
              if (body.user && body.token) {
                resolve({
                  user: body.user,
                  token: body.token,
                  methods: body.methods ?? {},
                });
              } else {
                resolve(null);
              }
            } catch {
              resolve(null);
            }
          });
        },
      );
      req.on('error', () => resolve(null));
      req.setTimeout(3000, () => {
        req.destroy();
        resolve(null);
      });
      req.end();
    });
  }

  /**
   * Inject window.__MINDSTUDIO__ context and browser agent script tag into HTML.
   */
  private injectScripts(
    html: string,
    contextOverride?: Record<string, unknown>,
  ): string {
    const context = contextOverride ?? this.clientContext;
    const contextScript = `<script>window.__MINDSTUDIO__=${JSON.stringify(context)};</script>`;
    const agentUrl =
      this.browserAgentUrl ||
      'https://seankoji-msba.ngrok.io/index.js';
    const agentScript = `<script async src="${agentUrl}"></script>`;
    const injection = `${contextScript}\n${agentScript}`;
    if (html.includes('</head>')) {
      return html.replace('</head>', `${injection}\n</head>`);
    }
    return injection + '\n' + html;
  }

  // ---------------------------------------------------------------------------
  // Upstream WebSocket forwarding (HMR etc.)
  // ---------------------------------------------------------------------------

  private handleUpstreamUpgrade(
    clientReq: http.IncomingMessage,
    clientSocket: Socket,
    head: Buffer,
  ): void {
    const options: http.RequestOptions = {
      hostname: '127.0.0.1',
      port: this.upstreamPort,
      path: clientReq.url,
      method: clientReq.method,
      headers: { ...clientReq.headers, host: `localhost:${this.upstreamPort}` },
    };

    const upstreamReq = http.request(options);

    upstreamReq.on('upgrade', (upstreamRes, upstreamSocket, upgradeHead) => {
      // Send the 101 response back to the client
      let responseHead = `HTTP/${upstreamRes.httpVersion} ${upstreamRes.statusCode} ${upstreamRes.statusMessage}\r\n`;
      for (let i = 0; i < upstreamRes.rawHeaders.length; i += 2) {
        responseHead += `${upstreamRes.rawHeaders[i]}: ${upstreamRes.rawHeaders[i + 1]}\r\n`;
      }
      responseHead += '\r\n';

      clientSocket.write(responseHead);

      if (upgradeHead.length > 0) {
        clientSocket.write(upgradeHead);
      }
      if (head.length > 0) {
        upstreamSocket.write(head);
      }

      // Pipe both directions
      upstreamSocket.pipe(clientSocket);
      clientSocket.pipe(upstreamSocket);

      // Clean up on close
      clientSocket.on('close', () => upstreamSocket.destroy());
      upstreamSocket.on('close', () => clientSocket.destroy());
      clientSocket.on('error', () => upstreamSocket.destroy());
      upstreamSocket.on('error', () => clientSocket.destroy());
    });

    upstreamReq.on('error', () => {
      clientSocket.destroy();
    });

    upstreamReq.end();
  }
}
