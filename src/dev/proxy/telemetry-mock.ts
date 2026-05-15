// Mocks the SDK-fired /_/telemetry/* endpoints in dev so the platform SDK
// stays happy without sending dev-noise events upstream or holding open a
// real-backend SSE per developer.
//
// The SDK fires three endpoints automatically on every app load:
//  POST /_/telemetry/errors   — frontend error batch
//  POST /_/telemetry/events   — pageview + custom event batch
//  GET  /_/telemetry/presence — long-lived SSE; the connection itself is
//                                the presence signal, no payloads needed
//
// We accept any Authorization: Bearer header without validating the token —
// the tunnel doesn't need to know which session is alive. Missing header
// returns 401 per backend spec.

import type * as http from 'node:http';
import { log } from '../logging/logger';

const MAX_BODY_BYTES = 1_048_576;
const SSE_KEEPALIVE_MS = 25_000;

export function tryHandleTelemetry(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  sseConnections: Set<http.ServerResponse>,
): boolean {
  const url = req.url ?? '';
  if (!url.startsWith('/_/telemetry/')) return false;

  if (!req.headers.authorization) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: 'missing_authorization',
        code: 'missing_authorization',
      }),
    );
    return true;
  }

  if (url === '/_/telemetry/errors' && req.method === 'POST') {
    handleBatchPost(req, res);
    return true;
  }
  if (url === '/_/telemetry/events' && req.method === 'POST') {
    handleBatchPost(req, res);
    return true;
  }
  if (url === '/_/telemetry/presence' && req.method === 'GET') {
    handlePresence(req, res, sseConnections);
    return true;
  }

  // Unknown telemetry sub-path — fall through so the regular /_/ forwarder
  // can handle it. If backend ships a 4th endpoint before us, dev keeps
  // proxying rather than silently swallowing.
  return false;
}

function handleBatchPost(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): void {
  let total = 0;
  const chunks: Buffer[] = [];
  let aborted = false;
  req.on('data', (chunk: Buffer) => {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      aborted = true;
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (aborted) {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ accepted: 0, rejected: 0 }));
      return;
    }
    let accepted = 0;
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
      if (Array.isArray(body?.events)) accepted = body.events.length;
    } catch {
      // Malformed body — backend spec says don't validate, just count.
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ accepted, rejected: 0 }));
  });
  req.on('error', () => {
    // Socket dropped; node will clean up the response.
  });
}

function handlePresence(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  sseConnections: Set<http.ServerResponse>,
): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  sseConnections.add(res);

  const keepalive = setInterval(() => {
    try {
      res.write(': keepalive\n\n');
    } catch {
      // Write after end — cleanup handler will run via close event.
    }
  }, SSE_KEEPALIVE_MS);

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    clearInterval(keepalive);
    sseConnections.delete(res);
    log.debug('telemetry-mock', 'SSE closed', { open: sseConnections.size });
  };
  req.on('close', cleanup);
  res.on('close', cleanup);
  res.on('error', cleanup);

  log.debug('telemetry-mock', 'SSE opened', { open: sseConnections.size });
}
