import { EventEmitter } from "events";

export interface RequestStartEvent {
  id: string;
  modelId: string;
  requestType: "llm_chat" | "image_generation" | "video_generation";
  timestamp: number;
}

export interface RequestProgressEvent {
  id: string;
  content?: string;
  step?: number;
  totalSteps?: number;
}

export interface RequestCompleteEvent {
  id: string;
  success: boolean;
  duration: number;
  result?: {
    chars?: number;
    imageSize?: number;
  };
  error?: string;
}

class RequestEventEmitter extends EventEmitter {
  emitStart(event: RequestStartEvent) {
    this.emit("request:start", event);
  }

  emitProgress(event: RequestProgressEvent) {
    this.emit("request:progress", event);
  }

  emitComplete(event: RequestCompleteEvent) {
    this.emit("request:complete", event);
  }

  onStart(handler: (event: RequestStartEvent) => void) {
    this.on("request:start", handler);
    return () => this.off("request:start", handler);
  }

  onProgress(handler: (event: RequestProgressEvent) => void) {
    this.on("request:progress", handler);
    return () => this.off("request:progress", handler);
  }

  onComplete(handler: (event: RequestCompleteEvent) => void) {
    this.on("request:complete", handler);
    return () => this.off("request:complete", handler);
  }
}

export const requestEvents = new RequestEventEmitter();
