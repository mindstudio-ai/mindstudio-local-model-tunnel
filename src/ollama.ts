import { Ollama } from "ollama";
import { getOllamaBaseUrl } from "./config.js";

export interface OllamaModel {
  name: string;
  size: number;
  parameterSize?: string;
  quantization?: string;
}

export async function createOllamaClient(): Promise<Ollama> {
  return new Ollama({ host: getOllamaBaseUrl() });
}

export async function discoverModels(): Promise<OllamaModel[]> {
  try {
    const ollama = await createOllamaClient();
    const response = await ollama.list();

    return response.models.map((m) => ({
      name: m.name,
      size: m.size,
      parameterSize: m.details?.parameter_size,
      quantization: m.details?.quantization_level,
    }));
  } catch (error) {
    return [];
  }
}

export async function isOllamaRunning(): Promise<boolean> {
  try {
    const ollama = await createOllamaClient();
    await ollama.list();
    return true;
  } catch {
    return false;
  }
}
