export interface LocalModelRequest {
    id: string;
    organizationId: string;
    modelId: string;
    requestType: "llm_chat" | "image_generation" | "video_generation";
    payload: {
        messages?: Array<{
            role: string;
            content: string;
        }>;
        prompt?: string;
        temperature?: number;
        maxTokens?: number;
        config?: Record<string, unknown>;
    };
    createdAt: number;
}
export declare function pollForRequest(models: string[]): Promise<LocalModelRequest | null>;
export declare function submitProgress(requestId: string, content: string): Promise<void>;
export declare function submitResult(requestId: string, success: boolean, result?: {
    content?: string;
    usage?: {
        promptTokens: number;
        completionTokens: number;
    };
}, error?: string): Promise<void>;
export declare function verifyApiKey(): Promise<boolean>;
export declare function registerLocalModel(modelName: string): Promise<void>;
export declare function getRegisteredModels(): Promise<string[]>;
export declare function requestDeviceAuth(): Promise<{
    url: string;
    token: string;
}>;
export declare function pollDeviceAuth(token: string): Promise<{
    status: "pending" | "completed" | "expired";
    apiKey?: string;
}>;
//# sourceMappingURL=api.d.ts.map