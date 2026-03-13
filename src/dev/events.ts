// Event emitter for dev mode request tracking.
// Follows the same pattern as src/events.ts.

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
