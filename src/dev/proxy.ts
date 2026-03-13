// Transparent HTTP reverse proxy that sits in front of the local dev server.
// Injects window.__MINDSTUDIO__ into HTML responses. Forwards everything else
// (JS, CSS, images, WebSocket upgrades) unmodified. Framework-agnostic.

import http from 'node:http';
import type { Socket } from 'node:net';

export class DevProxy {
  private server: http.Server | null = null;
  private proxyPort: number | null = null;

  constructor(
    private readonly upstreamPort: number,
    private readonly clientContext: Record<string, unknown>,
    private readonly bindAddress: string = '127.0.0.1',
  ) {}

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
        return assignedPort;
      } catch {
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

    // Handle CORS preflight for Private Network Access
    if (clientReq.method === 'OPTIONS' && origin) {
      clientRes.writeHead(204, {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Private-Network': 'true',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
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
          delete headers['content-encoding']; // injection invalidates gzip/br
          delete headers['etag'];
          if (origin) {
            headers['access-control-allow-origin'] = origin;
            headers['access-control-allow-private-network'] = 'true';
          }

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
      clientRes.writeHead(502);
      clientRes.end(`Proxy error: ${err.message}`);
    });

    // Forward request body
    clientReq.pipe(upstreamReq);
  }

  private handleUpgrade(
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

/**
 * Inject window.__MINDSTUDIO__ context into an HTML string.
 * Same logic as the platform's injectSessionContext.
 */
function injectClientContext(
  html: string,
  context: Record<string, unknown>,
): string {
  const script = `<script>window.__MINDSTUDIO__=${JSON.stringify(context)};</script>`;
  if (html.includes('</head>')) {
    return html.replace('</head>', `${script}\n</head>`);
  }
  return script + '\n' + html;
}
