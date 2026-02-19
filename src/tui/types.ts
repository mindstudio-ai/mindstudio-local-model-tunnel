import type { Provider, LocalModel } from '../providers/types';

export type ConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'not_authenticated'
  | 'disconnected'
  | 'error';

export type Page = 'dashboard' | 'sync' | 'setup' | 'onboarding';

export interface ProviderStatus {
  provider: Provider;
  running: boolean;
}

export interface RequestLogEntry {
  id: string;
  modelId: string;
  requestType: 'llm_chat' | 'image_generation' | 'video_generation';
  status: 'processing' | 'completed' | 'failed';
  startTime: number;
  endTime?: number;
  duration?: number;
  content?: string;
  step?: number;
  totalSteps?: number;
  result?: {
    chars?: number;
    imageSize?: number;
    videoSize?: number;
  };
  error?: string;
}

export interface AppState {
  connection: ConnectionStatus;
  environment: 'prod' | 'local';
  providers: ProviderStatus[];
  models: LocalModel[];
  requests: RequestLogEntry[];
  activeRequests: number;
  isPolling: boolean;
}
