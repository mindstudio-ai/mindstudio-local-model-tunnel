// Event bridge between the DevRunner (backend) and the TUI/headless UI.
//
// The runner emits events as methods execute. The TUI hooks subscribe
// to update the request log. Headless mode subscribes to relay events
// as JSON to stdout. This decoupling means the runner doesn't need to
// know whether it's running in a TUI or headless context.
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

export interface DevScenarioStartEvent {
  id: string;
  name?: string;
  timestamp: number;
}

export interface DevImpersonateEvent {
  roles: string[] | null;
}

export interface DevScenarioCompleteEvent {
  id: string;
  success: boolean;
  duration: number;
  roles: string[];
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

  emitImpersonate(event: DevImpersonateEvent) {
    this.emit('dev:impersonate', event);
  }

  emitScenarioStart(event: DevScenarioStartEvent) {
    this.emit('dev:scenario-start', event);
  }

  emitScenarioComplete(event: DevScenarioCompleteEvent) {
    this.emit('dev:scenario-complete', event);
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

  onImpersonate(handler: (event: DevImpersonateEvent) => void) {
    this.on('dev:impersonate', handler);
    return () => this.off('dev:impersonate', handler);
  }

  onScenarioStart(handler: (event: DevScenarioStartEvent) => void) {
    this.on('dev:scenario-start', handler);
    return () => this.off('dev:scenario-start', handler);
  }

  onScenarioComplete(handler: (event: DevScenarioCompleteEvent) => void) {
    this.on('dev:scenario-complete', handler);
    return () => this.off('dev:scenario-complete', handler);
  }
}

export const devRequestEvents = new DevEventEmitter();
