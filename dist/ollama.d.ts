import { Ollama } from "ollama";
export interface OllamaModel {
    name: string;
    size: number;
    parameterSize?: string;
    quantization?: string;
}
export declare function createOllamaClient(): Promise<Ollama>;
export declare function discoverModels(): Promise<OllamaModel[]>;
export declare function isOllamaRunning(): Promise<boolean>;
//# sourceMappingURL=ollama.d.ts.map