export type Environment = "prod" | "local";
export declare function getEnvironment(): Environment;
export declare function setEnvironment(env: Environment): void;
export declare function getApiKey(): string | undefined;
export declare function setApiKey(key: string): void;
export declare function clearApiKey(): void;
export declare function getApiBaseUrl(): string;
export declare function setApiBaseUrl(url: string): void;
export declare function getOllamaBaseUrl(): string;
export declare function setOllamaBaseUrl(url: string): void;
export declare function getConfigPath(): string;
export declare function getEnvironmentInfo(): {
    current: Environment;
    apiBaseUrl: string;
    hasApiKey: boolean;
};
//# sourceMappingURL=config.d.ts.map