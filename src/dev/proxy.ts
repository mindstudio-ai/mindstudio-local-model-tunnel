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
// - WebSocket upgrades: forwarded transparently (enables HMR for any framework)
// - CORS/PNA headers: added so the proxy works inside iframes from app.mindstudio.ai
// - Caching disabled on all responses (this is local dev, always fresh)
// - /__mindstudio_dev__/*: intercepted locally for browser agent communication
//
// The proxy is framework-agnostic — it doesn't know or care what dev server
// is upstream. Detection is by content-type header, not URL patterns.

import http from 'node:http';
import { randomBytes } from 'node:crypto';
import type { Socket } from 'node:net';
import { log } from './logger';
import { appendBrowserLogEntries } from './browser-log';

interface PendingCommand {
  id: string;
  steps: Array<Record<string, unknown>>;
}

interface PendingResult {
  resolve: (result: Record<string, unknown>) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class DevProxy {
  private server: http.Server | null = null;
  private proxyPort: number | null = null;
  private commandQueue: PendingCommand[] = [];
  private pendingResults = new Map<string, PendingResult>();
  private lastBrowserPoll = 0;

  constructor(
    private readonly upstreamPort: number,
    private clientContext: Record<string, unknown>,
    private readonly bindAddress: string = '127.0.0.1',
    private readonly browserAgentUrl: string = 'https://seankoji-msba.ngrok.io/index.js',
  ) {}

  updateClientContext(context: Record<string, unknown>): void {
    this.clientContext = context;
    log.info('Dev proxy context updated after role change');
  }

  /**
   * Whether a browser agent is actively polling for commands.
   * Based on whether we've seen a poll within the last 500ms.
   */
  isBrowserConnected(): boolean {
    return Date.now() - this.lastBrowserPoll < 500;
  }

  /**
   * Dispatch a browser command and wait for the result.
   * The command is queued for the browser agent to pick up via polling.
   * Returns a promise that resolves when the browser posts the result back.
   */
  dispatchBrowserCommand(
    steps: Array<Record<string, unknown>>,
    timeoutMs = 30_000,
  ): Promise<Record<string, unknown>> {
    if (!this.isBrowserConnected()) {
      return Promise.reject(
        new Error('No browser connected, please refresh the MindStudio preview'),
      );
    }

    const id = randomBytes(4).toString('hex');

    log.info('Browser command queued', { id, stepCount: steps.length, commands: steps.map((s) => s.command) });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingResults.delete(id);
        log.warn('Browser command timed out', { id, pendingCount: this.pendingResults.size, queueLength: this.commandQueue.length });
        reject(new Error('Browser command timed out'));
      }, timeoutMs);

      this.pendingResults.set(id, { resolve, timeout });
      this.commandQueue.push({ id, steps });
    });
  }

  async start(preferredPort?: number): Promise<number> {
    const server = http.createServer((req, res) => {
      this.handleRequest(req, res);
    });

    // WebSocket upgrade forwarding
    server.on('upgrade', (req, socket, head) => {
      this.handleUpgrade(req, socket as Socket, head);
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
    if (this.server) {
      log.info('Dev proxy stopping');
      this.server.close();
      this.server = null;
      this.proxyPort = null;
    }
  }

  getPort(): number | null {
    return this.proxyPort;
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
      if (clientReq.url === '/__mindstudio_dev__/logs' && clientReq.method === 'POST') {
        this.handleBrowserLogs(clientReq, clientRes);
        return;
      }
      if (clientReq.url === '/__mindstudio_dev__/commands' && clientReq.method === 'GET') {
        this.handleGetCommand(clientReq, clientRes);
        return;
      }
      if (clientReq.url === '/__mindstudio_dev__/results' && clientReq.method === 'POST') {
        this.handlePostResult(clientReq, clientRes);
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
  // Browser agent endpoints
  // ---------------------------------------------------------------------------

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

  private handleGetCommand(
    clientReq: http.IncomingMessage,
    clientRes: http.ServerResponse,
  ): void {
    this.lastBrowserPoll = Date.now();

    const command = this.commandQueue.shift();
    if (command) {
      log.info('Browser command dispatched to agent', { id: command.id, commands: command.steps.map((s) => s.command) });
      clientRes.writeHead(200, {
        ...this.corsHeaders(clientReq),
        'content-type': 'application/json',
        'cache-control': 'no-store',
      });
      clientRes.end(JSON.stringify(command));
    } else {
      clientRes.writeHead(204, {
        ...this.corsHeaders(clientReq),
        'cache-control': 'no-store',
      });
      clientRes.end();
    }
  }

  private handlePostResult(
    clientReq: http.IncomingMessage,
    clientRes: http.ServerResponse,
  ): void {
    const chunks: Buffer[] = [];
    clientReq.on('data', (chunk) => chunks.push(chunk));
    clientReq.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf-8');
        const result = JSON.parse(body);
        if (result?.id) {
          const pending = this.pendingResults.get(result.id);
          if (pending) {
            log.info('Browser command result received', { id: result.id, stepCount: result.steps?.length, duration: result.duration });
            clearTimeout(pending.timeout);
            this.pendingResults.delete(result.id);
            pending.resolve(result);
          } else {
            log.warn('Browser command result received but no pending command found', { id: result.id, pendingIds: [...this.pendingResults.keys()] });
          }
        } else {
          log.warn('Browser command result received with no id', { bodyLength: body.length });
        }
      } catch (err) {
        log.warn('Browser command result parse error', { error: err instanceof Error ? err.message : String(err) });
      }
      clientRes.writeHead(204, this.corsHeaders(clientReq));
      clientRes.end();
    });
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

  private handleUpgrade(
    clientReq: http.IncomingMessage,
    clientSocket: Socket,
    head: Buffer,
  ): void {
    log.debug('Dev proxy WebSocket upgrade', { path: clientReq.url });
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
