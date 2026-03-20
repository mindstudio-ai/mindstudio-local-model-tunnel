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
// - /__mindstudio_dev__/logs: intercepted locally for browser log capture
//
// The proxy is framework-agnostic — it doesn't know or care what dev server
// is upstream. Detection is by content-type header, not URL patterns.

import http from 'node:http';
import type { Socket } from 'node:net';
import { log } from './logger';
import { appendBrowserLogEntries } from './browser-log';

export class DevProxy {
  private server: http.Server | null = null;
  private proxyPort: number | null = null;

  constructor(
    private readonly upstreamPort: number,
    private clientContext: Record<string, unknown>,
    private readonly bindAddress: string = '127.0.0.1',
  ) {}

  updateClientContext(context: Record<string, unknown>): void {
    this.clientContext = context;
    log.info('Dev proxy context updated after role change');
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

    // Browser log capture endpoint — intercepted locally, never forwarded upstream
    if (clientReq.url === '/__mindstudio_dev__/logs' && clientReq.method === 'POST') {
      this.handleBrowserLogs(clientReq, clientRes);
      return;
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
          html = injectClientContext(html, this.clientContext);

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

/**
 * Inject window.__MINDSTUDIO__ context and browser log capture script into HTML.
 */
function injectClientContext(
  html: string,
  context: Record<string, unknown>,
): string {
  const contextScript = `<script>window.__MINDSTUDIO__=${JSON.stringify(context)};</script>`;
  const captureScript = `<script>${BROWSER_CAPTURE_SCRIPT}</script>`;
  const injection = `${contextScript}\n${captureScript}`;
  if (html.includes('</head>')) {
    return html.replace('</head>', `${injection}\n</head>`);
  }
  return injection + '\n' + html;
}

/**
 * Lightweight browser capture script injected into every HTML response.
 * Captures console output, JS errors, failed network requests, and user clicks.
 * Batches entries and POSTs them to the proxy's /__mindstudio_dev__/logs endpoint.
 */
const BROWSER_CAPTURE_SCRIPT = `
(function() {
  if (window.__MINDSTUDIO_DEV__) return;
  window.__MINDSTUDIO_DEV__ = true;

  var buffer = [];
  var flushTimer = null;
  var FLUSH_INTERVAL = 2000;
  var ENDPOINT = '/__mindstudio_dev__/logs';

  function flush() {
    if (buffer.length === 0) return;
    var entries = buffer;
    buffer = [];
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', ENDPOINT, true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.send(JSON.stringify(entries));
    } catch (e) {}
  }

  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(function() {
      flushTimer = null;
      flush();
    }, FLUSH_INTERVAL);
  }

  function flushNow() {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    flush();
  }

  function push(entry) {
    buffer.push(entry);
    scheduleFlush();
  }

  function pushAndFlush(entry) {
    buffer.push(entry);
    flushNow();
  }

  function serialize(val) {
    if (val === null) return 'null';
    if (val === undefined) return 'undefined';
    if (val instanceof Error) return val.stack || val.message || String(val);
    if (typeof val === 'object') {
      try { return JSON.stringify(val); } catch (e) { return String(val); }
    }
    return String(val);
  }

  function describeElement(el) {
    if (!el || !el.tagName) return '';
    var s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    if (el.className && typeof el.className === 'string') {
      s += '.' + el.className.trim().split(/\\s+/).join('.');
    }
    return s;
  }

  // Console capture
  var levels = ['log', 'info', 'warn', 'error', 'debug'];
  levels.forEach(function(level) {
    var orig = console[level];
    console[level] = function() {
      if (orig) orig.apply(console, arguments);
      var args = [];
      for (var i = 0; i < arguments.length; i++) args.push(serialize(arguments[i]));
      push({ type: 'console', level: level, args: args, url: location.href });
    };
  });

  // Uncaught errors
  window.addEventListener('error', function(e) {
    pushAndFlush({
      type: 'error',
      message: e.message,
      stack: e.error ? (e.error.stack || '') : '',
      source: e.filename,
      line: e.lineno,
      column: e.colno,
      url: location.href
    });
  });

  // Unhandled promise rejections
  window.addEventListener('unhandledrejection', function(e) {
    var reason = e.reason || {};
    pushAndFlush({
      type: 'error',
      message: reason.message || String(reason),
      stack: reason.stack || '',
      url: location.href
    });
  });

  // Network failure capture (fetch only)
  if (window.fetch) {
    var origFetch = window.fetch;
    window.fetch = function(input, init) {
      var method = (init && init.method) || 'GET';
      var url = (typeof input === 'string') ? input : (input && input.url) || String(input);
      return origFetch.apply(this, arguments).then(function(response) {
        if (!response.ok) {
          var entry = { type: 'network', method: method, url: url, status: response.status, statusText: response.statusText };
          try {
            response.clone().text().then(function(body) {
              entry.body = body.slice(0, 1000);
              push(entry);
            }).catch(function() { push(entry); });
          } catch (e) { push(entry); }
        }
        return response;
      }).catch(function(err) {
        push({ type: 'network', method: method, url: url, error: err.message || String(err) });
        throw err;
      });
    };
  }

  // Click capture
  document.addEventListener('click', function(e) {
    var target = e.target;
    var text = (target.textContent || '').trim().slice(0, 100);
    push({
      type: 'interaction',
      event: 'click',
      target: describeElement(target),
      text: text,
      url: location.href
    });
  }, true);

  // Flush on page unload
  window.addEventListener('beforeunload', function() {
    if (buffer.length > 0 && navigator.sendBeacon) {
      navigator.sendBeacon(ENDPOINT, JSON.stringify(buffer));
    }
  });
})();
`.trim();
