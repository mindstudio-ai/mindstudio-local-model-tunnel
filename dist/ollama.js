"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createOllamaClient = createOllamaClient;
exports.discoverModels = discoverModels;
exports.isOllamaRunning = isOllamaRunning;
const ollama_1 = require("ollama");
const config_js_1 = require("./config.js");
async function createOllamaClient() {
    return new ollama_1.Ollama({ host: (0, config_js_1.getOllamaBaseUrl)() });
}
async function discoverModels() {
    try {
        const ollama = await createOllamaClient();
        const response = await ollama.list();
        return response.models.map((m) => ({
            name: m.name,
            size: m.size,
            parameterSize: m.details?.parameter_size,
            quantization: m.details?.quantization_level,
        }));
    }
    catch (error) {
        return [];
    }
}
async function isOllamaRunning() {
    try {
        const ollama = await createOllamaClient();
        await ollama.list();
        return true;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=ollama.js.map