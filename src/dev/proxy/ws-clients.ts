import { WebSocket } from 'ws';
import { randomBytes } from 'node:crypto';
import { log } from '../logging/logger';

export interface ConnectedClient {
  id: string;
  ws: WebSocket;
  mode: 'iframe' | 'standalone' | 'mirror';
  /** This client is a mirror recording source (phone with ?mirror=true). */
  mirrorSource: boolean;
  /** True once the first rrweb meta event has updated the viewport with accurate dimensions. */
  mirrorReady: boolean;
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
    hello: { mode: 'iframe' | 'standalone' | 'mirror'; url: string; viewport: { w: number; h: number }; mirror?: boolean },
  ): string {
    const id = randomBytes(4).toString('hex');
    this.clients.set(id, {
      id,
      ws,
      mode: hello.mode,
      mirrorSource: !!hello.mirror,
      mirrorReady: false,
      url: hello.url,
      viewport: hello.viewport,
      connectedAt: Date.now(),
      alive: true,
      activeCommandId: null,
    });
    log.info('proxy', 'Browser client connected', { clientId: id, mode: hello.mode, mirror: !!hello.mirror, url: hello.url });
    return id;
  }

  remove(id: string): ConnectedClient | undefined {
    const client = this.clients.get(id);
    if (client) {
      this.clients.delete(id);
      log.info('proxy', 'Browser client disconnected', { clientId: id, mode: client.mode });
    }
    return client;
  }

  get(id: string): ConnectedClient | undefined {
    return this.clients.get(id);
  }

  /**
   * Get the preferred client for C&C commands.
   * Prefers idle iframe clients, falls back to any idle client.
   * Skips clients that are already executing a command.
   */
  getCommandTarget(): ConnectedClient | null {
    let fallback: ConnectedClient | null = null;
    for (const client of this.clients.values()) {
      if (client.activeCommandId) continue; // busy
      if (client.mode === 'mirror') continue; // mirror clients don't execute commands
      if (client.mode === 'iframe') return client;
      if (!fallback) fallback = client;
    }
    return fallback;
  }

  /** Get all connected mirror viewer clients (for relaying mirror events). */
  getMirrorClients(): ConnectedClient[] {
    return [...this.clients.values()].filter((c) => c.mode === 'mirror');
  }

  /** Check if a mirror recording source (phone) is connected. */
  hasMirrorSource(): boolean {
    for (const client of this.clients.values()) {
      if (client.mirrorSource) return true;
    }
    return false;
  }

  /** Get the mirror source client if connected. */
  getMirrorSource(): ConnectedClient | undefined {
    for (const client of this.clients.values()) {
      if (client.mirrorSource) return client;
    }
    return undefined;
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

  /** Remove clients that didn't respond to the last ping. Returns active command IDs that need rejection. */
  sweepDead(): { clientId: string; activeCommandId: string | null }[] {
    const removed: { clientId: string; activeCommandId: string | null }[] = [];
    for (const client of this.clients.values()) {
      if (!client.alive) {
        log.warn('proxy', 'Browser client timed out (no pong)', { clientId: client.id, activeCommandId: client.activeCommandId });
        removed.push({ clientId: client.id, activeCommandId: client.activeCommandId });
        this.clients.delete(client.id);
        client.ws.terminate();
      }
    }
    return removed;
  }
}
