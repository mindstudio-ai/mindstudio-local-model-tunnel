"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEnvironment = getEnvironment;
exports.setEnvironment = setEnvironment;
exports.getApiKey = getApiKey;
exports.setApiKey = setApiKey;
exports.clearApiKey = clearApiKey;
exports.getApiBaseUrl = getApiBaseUrl;
exports.setApiBaseUrl = setApiBaseUrl;
exports.getOllamaBaseUrl = getOllamaBaseUrl;
exports.setOllamaBaseUrl = setOllamaBaseUrl;
exports.getConfigPath = getConfigPath;
exports.getEnvironmentInfo = getEnvironmentInfo;
const conf_1 = __importDefault(require("conf"));
const config = new conf_1.default({
    projectName: "mindstudio-local",
    defaults: {
        environment: "prod",
        ollamaBaseUrl: "http://localhost:11434",
        environments: {
            prod: {
                apiBaseUrl: "https://api.mindstudio.ai",
            },
            local: {
                apiBaseUrl: "http://localhost:3129",
            },
        },
    },
});
// Environment management
function getEnvironment() {
    return config.get("environment");
}
function setEnvironment(env) {
    config.set("environment", env);
}
// Get config for current environment
function getEnvConfig() {
    const env = getEnvironment();
    return config.get(`environments.${env}`);
}
function setEnvConfig(key, value) {
    const env = getEnvironment();
    config.set(`environments.${env}.${key}`, value);
}
// API Key (per environment)
function getApiKey() {
    return getEnvConfig().apiKey;
}
function setApiKey(key) {
    setEnvConfig("apiKey", key);
}
function clearApiKey() {
    const env = getEnvironment();
    config.delete(`environments.${env}.apiKey`);
}
// API Base URL (per environment)
function getApiBaseUrl() {
    return getEnvConfig().apiBaseUrl;
}
function setApiBaseUrl(url) {
    setEnvConfig("apiBaseUrl", url);
}
// Ollama (shared across environments)
function getOllamaBaseUrl() {
    return config.get("ollamaBaseUrl");
}
function setOllamaBaseUrl(url) {
    config.set("ollamaBaseUrl", url);
}
function getConfigPath() {
    return config.path;
}
// Get all environment info for display
function getEnvironmentInfo() {
    const env = getEnvironment();
    const envConfig = getEnvConfig();
    return {
        current: env,
        apiBaseUrl: envConfig.apiBaseUrl,
        hasApiKey: !!envConfig.apiKey,
    };
}
//# sourceMappingURL=config.js.map