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
import { randomBytes } from 'node:crypto';
import type { Socket } from 'node:net';
import { WebSocketServer, WebSocket } from 'ws';
import { log } from '../logging/logger';
import { appendBrowserLogEntries } from '../logging/browser-log';
import { ClientRegistry } from './ws-clients';

interface PendingResult {
  resolve: (result: Record<string, unknown>) => void;
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
    private readonly bindAddress: string = '127.0.0.1',
    // Dev override: 'https://seankoji-msba.ngrok.io/index.js'
    private readonly browserAgentUrl?: string,
  ) {}

  updateClientContext(context: Record<string, unknown>): void {
    this.clientContext = context;
    log.info('Dev proxy context updated after role change');
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
    timeoutMs = 30_000,
  ): Promise<Record<string, unknown>> {
    if (!this.clients.hasConnected()) {
      return Promise.reject(
        new Error('No browser connected, please refresh the MindStudio preview'),
      );
    }

    const id = randomBytes(4).toString('hex');

    return new Promise((resolve, reject) => {
      this.commandQueue.push({ id, steps, timeoutMs, resolve, reject, queuedAt: Date.now() });
      log.info('Browser command queued', { id, queueLength: this.commandQueue.length, commands: steps.map((s) => s.command) });
      this.drainCommandQueue();
    });
  }

  /**
   * Try to send the next queued command to an available client.
   */
  private drainCommandQueue(): void {
    while (this.commandQueue.length > 0) {
      const target = this.clients.getCommandTarget();
      if (!target) break; // no idle client available

      const queued = this.commandQueue.shift()!;
      const { id, steps, timeoutMs, resolve, reject } = queued;

      log.info('Browser command sent', { id, clientId: target.id, mode: target.mode, stepCount: steps.length, commands: steps.map((s) => s.command) });

      const timeout = setTimeout(() => {
        this.pendingResults.delete(id);
        const client = this.clients.findByCommandId(id);
        if (client) client.activeCommandId = null;
        log.warn('Browser command timed out', { id, pendingCount: this.pendingResults.size });
        reject(new Error('Browser command timed out'));
        this.drainCommandQueue();
      }, timeoutMs);

      this.pendingResults.set(id, { resolve, timeout, clientId: target.id });
      target.activeCommandId = id;

      try {
        target.ws.send(JSON.stringify({ type: 'command', id, steps }));
      } catch {
        this.pendingResults.delete(id);
        clearTimeout(timeout);
        target.activeCommandId = null;
        reject(new Error('Failed to send command to browser'));
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
    log.info('Broadcasting to browser clients', { action, clientCount: clients.length });
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
    this.wss.on('connection', (ws) => this.handleWsConnection(ws));

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
    const portsToTry = preferredPort
      ? [preferredPort, 0]
      : [0];

    for (const port of portsToTry) {
      try {
        const assignedPort = await this.listenOnPort(server, port);
        this.server = server;
        this.proxyPort = assignedPort;
        this.startHealthCheck();
        this.startPingTimer();
        log.info('Dev proxy started', { port: assignedPort, bind: this.bindAddress });
        return assignedPort;
      } catch {
        log.warn('Proxy port in use, trying next', { port });
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
      log.info('Dev proxy stopping');
      this.server.close();
      this.server = null;
      this.proxyPort = null;
    }

    // Reject pending commands so callers don't hang
    for (const [id, pending] of this.pendingResults) {
      clearTimeout(pending.timeout);
      pending.resolve({ id, steps: [], error: 'Proxy stopped' });
    }
    this.pendingResults.clear();

    // Reject queued commands
    for (const queued of this.commandQueue) {
      queued.reject(new Error('Proxy stopped'));
    }
    this.commandQueue.length = 0;
  }

  getPort(): number | null {
    return this.proxyPort;
  }

  // ---------------------------------------------------------------------------
  // WebSocket connection handler
  // ---------------------------------------------------------------------------

  private handleWsConnection(ws: WebSocket): void {
    let clientId: string | null = null;

    // Require hello within 5s
    const helloTimeout = setTimeout(() => {
      if (!clientId) {
        log.warn('Browser WS client did not send hello in time, closing');
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

        const mode = msg.mode === 'iframe' ? 'iframe' : 'standalone';
        const viewport = (msg.viewport as { w: number; h: number }) || { w: 0, h: 0 };

        clientId = this.clients.add(ws, {
          mode,
          url: String(msg.url || ''),
          viewport,
        });

        ws.send(JSON.stringify({ type: 'ack', clientId }));
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
      }
    });

    ws.on('pong', () => {
      if (clientId) this.clients.markAlive(clientId);
    });

    ws.on('close', () => {
      clearTimeout(helloTimeout);
      if (clientId) {
        const client = this.clients.remove(clientId);
        if (client?.activeCommandId) {
          this.rejectPendingCommand(client.activeCommandId, 'Browser disconnected during command execution');
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
      log.warn('Browser command result received with no id');
      return;
    }

    const pending = this.pendingResults.get(id);
    if (pending) {
      log.info('Browser command result received', { id, stepCount: (msg.steps as unknown[])?.length, duration: msg.duration });
      clearTimeout(pending.timeout);
      this.pendingResults.delete(id);

      // Clear activeCommandId
      const client = this.clients.findByCommandId(id);
      if (client) client.activeCommandId = null;

      pending.resolve(msg);

      // Client is now free — dispatch next queued command
      this.drainCommandQueue();
    } else {
      log.warn('Browser command result received but no pending command found', { id, pendingIds: [...this.pendingResults.keys()] });
    }
  }

  private rejectPendingCommand(commandId: string, reason: string): void {
    const pending = this.pendingResults.get(commandId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingResults.delete(commandId);
      pending.resolve({ id: commandId, steps: [], error: reason });
      log.warn('Pending command rejected', { id: commandId, reason });

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
          this.rejectPendingCommand(activeCommandId, 'Browser client timed out');
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
    log.info('Upstream dev server marked as down (explicit signal)');
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
      log.warn('Upstream dev server is down');
    } else if (!wasUp && this.upstreamUp) {
      log.info('Upstream dev server is back up, reloading browser');
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
      if (clientReq.url === '/__mindstudio_dev__/logs' && clientReq.method === 'POST') {
        this.handleBrowserLogs(clientReq, clientRes);
        return;
      }
      if (clientReq.url?.startsWith('/__mindstudio_dev__/font-proxy?') && clientReq.method === 'GET') {
        this.handleFontProxy(clientReq, clientRes);
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

    // Forward to upstream dev server
    this.forwardToUpstream(clientReq, clientRes);
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
        headers: { ...clientReq.headers, host: `localhost:${this.upstreamPort}` },
      },
      (upstreamRes) => {
        const contentType = upstreamRes.headers['content-type'] ?? '';
        const isHtml = contentType.startsWith('text/html');

        if (isHtml) {
          const chunks: Buffer[] = [];
          upstreamRes.on('data', (chunk) => chunks.push(chunk));
          upstreamRes.on('end', () => {
            let html = Buffer.concat(chunks).toString('utf-8');
            html = this.injectScripts(html);

            const headers = {
              ...upstreamRes.headers,
              ...cors,
              'content-length': String(Buffer.byteLength(html, 'utf-8')),
              'cache-control': 'no-store, no-cache, must-revalidate',
            };
            delete headers['content-encoding'];
            delete headers['etag'];

            log.debug('Dev proxy injected context into HTML', { path: clientReq.url, size: html.length });
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
      log.warn('Dev proxy cannot reach dev server', { path: clientReq.url, error: err.message });
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
          (_, quote, url) => `url(${quote}/__mindstudio_dev__/font-proxy?url=${encodeURIComponent(url)}${quote})`,
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
      clientRes.end(`Font proxy error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Inject window.__MINDSTUDIO__ context and browser agent script tag into HTML.
   */
  private injectScripts(html: string): string {
    const contextScript = `<script>window.__MINDSTUDIO__=${JSON.stringify(this.clientContext)};</script>`;
    const agentUrl = this.browserAgentUrl || 'https://unpkg.com/@mindstudio-ai/browser-agent/dist/index.js';
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
    log.debug('Dev proxy WebSocket upgrade (upstream)', { path: clientReq.url });
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
