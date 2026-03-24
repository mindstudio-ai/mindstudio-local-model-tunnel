import { WebSocket } from 'ws';
import { randomBytes } from 'node:crypto';
import { log } from './logger';

export interface ConnectedClient {
  id: string;
  ws: WebSocket;
  mode: 'iframe' | 'standalone';
  url: string;
  viewport: { w: number; h: number };
  connectedAt: number;
  alive: boolean;
  /** Command ID currently being executed by this client, if any. */
  activeCommandId: string | null;
}

export class ClientRegistry {
  private clients = new Map<string, ConnectedClient>();

  add(
    ws: WebSocket,
    hello: { mode: 'iframe' | 'standalone'; url: string; viewport: { w: number; h: number } },
  ): string {
    const id = randomBytes(4).toString('hex');
    this.clients.set(id, {
      id,
      ws,
      mode: hello.mode,
      url: hello.url,
      viewport: hello.viewport,
      connectedAt: Date.now(),
      alive: true,
      activeCommandId: null,
    });
    log.info('Browser client connected', { clientId: id, mode: hello.mode, url: hello.url });
    return id;
  }

  remove(id: string): ConnectedClient | undefined {
    const client = this.clients.get(id);
    if (client) {
      this.clients.delete(id);
      log.info('Browser client disconnected', { clientId: id, mode: client.mode });
    }
    return client;
  }

  get(id: string): ConnectedClient | undefined {
    return this.clients.get(id);
  }

  /**
   * Get the preferred client for C&C commands.
   * Prefers iframe clients, falls back to any connected client.
   */
  getCommandTarget(): ConnectedClient | null {
    let fallback: ConnectedClient | null = null;
    for (const client of this.clients.values()) {
      if (client.mode === 'iframe') return client;
      if (!fallback) fallback = client;
    }
    return fallback;
  }

  getAll(): ConnectedClient[] {
    return [...this.clients.values()];
  }

  hasConnected(): boolean {
    return this.clients.size > 0;
  }

  count(): number {
    return this.clients.size;
  }

  /** Find the client executing a given command. */
  findByCommandId(commandId: string): ConnectedClient | undefined {
    for (const client of this.clients.values()) {
      if (client.activeCommandId === commandId) return client;
    }
    return undefined;
  }

  markAlive(id: string): void {
    const client = this.clients.get(id);
    if (client) client.alive = true;
  }

  /** Mark all clients as not-alive, then ping. Clients that respond set alive=true. */
  pingAll(): void {
    for (const client of this.clients.values()) {
      client.alive = false;
      try {
        client.ws.ping();
      } catch {
        // Will be cleaned up by sweepDead
      }
    }
  }

  /** Remove clients that didn't respond to the last ping. */
  sweepDead(): string[] {
    const removed: string[] = [];
    for (const client of this.clients.values()) {
      if (!client.alive) {
        log.warn('Browser client timed out (no pong)', { clientId: client.id });
        client.ws.terminate();
        this.clients.delete(client.id);
        removed.push(client.id);
      }
    }
    return removed;
  }
}
