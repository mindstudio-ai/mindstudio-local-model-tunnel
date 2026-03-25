// Event bridge between the DevRunner (backend) and the TUI/headless UI.
//
// The runner emits events as methods execute. The TUI hooks subscribe
// to update the request log. Headless mode subscribes to relay events
// as JSON to stdout. This decoupling means the runner doesn't need to
// know whether it's running in a TUI or headless context.
//
// Only contains events for the poll loop (platform-triggered methods)
// and connection/auth lifecycle. Scenario and impersonation events are
// handled directly by stdin command handlers.
//
// Singleton — one emitter shared across the process.

import { EventEmitter } from 'events';

export interface DevRequestStartEvent {
  id: string;
  type: 'execute';
  method?: string;
  timestamp: number;
}

export interface DevRequestCompleteEvent {
  id: string;
  success: boolean;
  duration: number;
  error?: string;
}

class DevEventEmitter extends EventEmitter {
  emitStart(event: DevRequestStartEvent) {
    this.emit('dev:start', event);
  }

  emitComplete(event: DevRequestCompleteEvent) {
    this.emit('dev:complete', event);
  }

  emitSessionExpired() {
    this.emit('dev:session-expired');
  }

  emitAuthRefreshStart(url: string) {
    this.emit('dev:auth-refresh-start', url);
  }

  emitAuthRefreshSuccess() {
    this.emit('dev:auth-refresh-success');
  }

  emitAuthRefreshFailed() {
    this.emit('dev:auth-refresh-failed');
  }

  emitConnectionWarning(message: string) {
    this.emit('dev:connection-warning', message);
  }

  emitConnectionRestored() {
    this.emit('dev:connection-restored');
  }

  onStart(handler: (event: DevRequestStartEvent) => void) {
    this.on('dev:start', handler);
    return () => this.off('dev:start', handler);
  }

  onComplete(handler: (event: DevRequestCompleteEvent) => void) {
    this.on('dev:complete', handler);
    return () => this.off('dev:complete', handler);
  }

  onSessionExpired(handler: () => void) {
    this.on('dev:session-expired', handler);
    return () => this.off('dev:session-expired', handler);
  }

  onAuthRefreshStart(handler: (url: string) => void) {
    this.on('dev:auth-refresh-start', handler);
    return () => this.off('dev:auth-refresh-start', handler);
  }

  onAuthRefreshSuccess(handler: () => void) {
    this.on('dev:auth-refresh-success', handler);
    return () => this.off('dev:auth-refresh-success', handler);
  }

  onAuthRefreshFailed(handler: () => void) {
    this.on('dev:auth-refresh-failed', handler);
    return () => this.off('dev:auth-refresh-failed', handler);
  }

  onConnectionWarning(handler: (message: string) => void) {
    this.on('dev:connection-warning', handler);
    return () => this.off('dev:connection-warning', handler);
  }

  onConnectionRestored(handler: () => void) {
    this.on('dev:connection-restored', handler);
    return () => this.off('dev:connection-restored', handler);
  }
}

export const devRequestEvents = new DevEventEmitter();
