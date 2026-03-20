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
import { readFileSync } from 'node:fs';
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
  private agentScriptCache: string | null = null;
  private commandQueue: PendingCommand[] = [];
  private pendingResults = new Map<string, PendingResult>();

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
   * Dispatch a browser command and wait for the result.
   * The command is queued for the browser agent to pick up via polling.
   * Returns a promise that resolves when the browser posts the result back.
   */
  dispatchBrowserCommand(
    steps: Array<Record<string, unknown>>,
    timeoutMs = 30_000,
  ): Promise<Record<string, unknown>> {
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

  private handleRequest(
    clientReq: http.IncomingMessage,
    clientRes: http.ServerResponse,
  ): void {
    const origin = clientReq.headers.origin;

    // Browser agent endpoints — intercepted locally, never forwarded upstream
    if (clientReq.url?.startsWith('/__mindstudio_dev__/')) {
      if (clientReq.url === '/__mindstudio_dev__/logs' && clientReq.method === 'POST') {
        this.handleBrowserLogs(clientReq, clientRes);
        return;
      }
      if (clientReq.url === '/__mindstudio_dev__/agent.js' && clientReq.method === 'GET') {
        this.serveBrowserAgent(clientReq, clientRes);
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

    // CORS preflight for Private Network Access (PNA). Chrome blocks
    // public origins (like app.mindstudio.ai) from accessing localhost
    // unless the server explicitly opts in via these headers.
    if (clientReq.method === 'OPTIONS' && origin) {
      clientRes.writeHead(204, {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Private-Network': 'true',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': '*',
      });
      clientRes.end();
      return;
    }

    const options: http.RequestOptions = {
      hostname: '127.0.0.1',
      port: this.upstreamPort,
      path: clientReq.url,
      method: clientReq.method,
      headers: { ...clientReq.headers, host: `localhost:${this.upstreamPort}` },
    };

    const upstreamReq = http.request(options, (upstreamRes) => {
      const contentType = upstreamRes.headers['content-type'] ?? '';
      const isHtml = contentType.startsWith('text/html');

      if (isHtml) {
        // Buffer HTML response, inject context, then send
        const chunks: Buffer[] = [];
        upstreamRes.on('data', (chunk) => chunks.push(chunk));
        upstreamRes.on('end', () => {
          let html = Buffer.concat(chunks).toString('utf-8');
          html = this.injectScripts(html);

          // Copy headers but update content-length and disable caching
          const headers = { ...upstreamRes.headers };
          headers['content-length'] = String(Buffer.byteLength(html, 'utf-8'));
          headers['cache-control'] = 'no-store, no-cache, must-revalidate';
          delete headers['content-encoding']; // buffering + injection invalidates gzip/br
          delete headers['etag'];
          if (origin) {
            headers['access-control-allow-origin'] = origin;
            headers['access-control-allow-private-network'] = 'true';
          }

          log.debug('Dev proxy injected context into HTML', { path: clientReq.url, size: html.length });
          clientRes.writeHead(upstreamRes.statusCode ?? 200, headers);
          clientRes.end(html);
        });
      } else {
        // Non-HTML: pipe through, disable caching
        const headers = { ...upstreamRes.headers };
        headers['cache-control'] = 'no-store, no-cache, must-revalidate';
        delete headers['etag'];
        if (origin) {
          headers['access-control-allow-origin'] = origin;
          headers['access-control-allow-private-network'] = 'true';
        }
        clientRes.writeHead(upstreamRes.statusCode ?? 200, headers);
        upstreamRes.pipe(clientRes);
      }
    });

    upstreamReq.on('error', (err) => {
      log.warn('Dev proxy cannot reach dev server', { path: clientReq.url, error: err.message });
      clientRes.writeHead(502);
      clientRes.end(`Proxy error: ${err.message}`);
    });

    // Forward request body
    clientReq.pipe(upstreamReq);
  }

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

      const origin = clientReq.headers.origin;
      const headers: Record<string, string> = {};
      if (origin) {
        headers['access-control-allow-origin'] = origin;
        headers['access-control-allow-private-network'] = 'true';
      }
      clientRes.writeHead(204, headers);
      clientRes.end();
    });
  }

  /**
   * Return the next pending command for the browser agent, or 204 if empty.
   */
  private handleGetCommand(
    clientReq: http.IncomingMessage,
    clientRes: http.ServerResponse,
  ): void {
    const origin = clientReq.headers.origin;
    const headers: Record<string, string> = {
      'Cache-Control': 'no-store',
    };
    if (origin) {
      headers['access-control-allow-origin'] = origin;
      headers['access-control-allow-private-network'] = 'true';
    }

    const command = this.commandQueue.shift();
    if (command) {
      log.info('Browser command dispatched to agent', { id: command.id, commands: command.steps.map((s) => s.command) });
      headers['content-type'] = 'application/json';
      clientRes.writeHead(200, headers);
      clientRes.end(JSON.stringify(command));
    } else {
      clientRes.writeHead(204, headers);
      clientRes.end();
    }
  }

  /**
   * Receive a command result from the browser agent.
   * Resolves the pending promise from dispatchBrowserCommand().
   */
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

      const origin = clientReq.headers.origin;
      const headers: Record<string, string> = {};
      if (origin) {
        headers['access-control-allow-origin'] = origin;
        headers['access-control-allow-private-network'] = 'true';
      }
      clientRes.writeHead(204, headers);
      clientRes.end();
    });
  }

  /**
   * Serve the browser agent script. If a browserAgentUrl is configured,
   * this endpoint won't be hit (the HTML points to the external URL).
   * This serves the built file for self-hosted mode.
   */
  private serveBrowserAgent(
    _clientReq: http.IncomingMessage,
    clientRes: http.ServerResponse,
  ): void {
    try {
      // Cache the script contents in memory
      if (!this.agentScriptCache) {
        // Try to load from the browser-agent package
        this.agentScriptCache = readFileSync(
          require.resolve('@mindstudio-ai/browser-agent/dist/index.js'),
          'utf-8',
        );
      }
      clientRes.writeHead(200, {
        'Content-Type': 'application/javascript',
        'Cache-Control': 'no-store',
      });
      clientRes.end(this.agentScriptCache);
    } catch {
      // Browser agent not installed — return empty script
      clientRes.writeHead(200, {
        'Content-Type': 'application/javascript',
        'Cache-Control': 'no-store',
      });
      clientRes.end('/* browser agent not available */');
    }
  }

  /**
   * Inject window.__MINDSTUDIO__ context and browser agent script tag into HTML.
   */
  private injectScripts(html: string): string {
    const contextScript = `<script>window.__MINDSTUDIO__=${JSON.stringify(this.clientContext)};</script>`;
    const agentUrl = this.browserAgentUrl || '/__mindstudio_dev__/agent.js';
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
