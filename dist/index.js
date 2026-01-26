"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.submitResult = exports.submitProgress = exports.pollForRequest = exports.verifyApiKey = exports.setEnvironment = exports.getEnvironment = exports.setApiBaseUrl = exports.getApiBaseUrl = exports.clearApiKey = exports.setApiKey = exports.getApiKey = exports.isOllamaRunning = exports.discoverModels = exports.LocalModelRunner = void 0;
// Main exports for programmatic use
var runner_js_1 = require("./runner.js");
Object.defineProperty(exports, "LocalModelRunner", { enumerable: true, get: function () { return runner_js_1.LocalModelRunner; } });
var ollama_js_1 = require("./ollama.js");
Object.defineProperty(exports, "discoverModels", { enumerable: true, get: function () { return ollama_js_1.discoverModels; } });
Object.defineProperty(exports, "isOllamaRunning", { enumerable: true, get: function () { return ollama_js_1.isOllamaRunning; } });
var config_js_1 = require("./config.js");
Object.defineProperty(exports, "getApiKey", { enumerable: true, get: function () { return config_js_1.getApiKey; } });
Object.defineProperty(exports, "setApiKey", { enumerable: true, get: function () { return config_js_1.setApiKey; } });
Object.defineProperty(exports, "clearApiKey", { enumerable: true, get: function () { return config_js_1.clearApiKey; } });
Object.defineProperty(exports, "getApiBaseUrl", { enumerable: true, get: function () { return config_js_1.getApiBaseUrl; } });
Object.defineProperty(exports, "setApiBaseUrl", { enumerable: true, get: function () { return config_js_1.setApiBaseUrl; } });
Object.defineProperty(exports, "getEnvironment", { enumerable: true, get: function () { return config_js_1.getEnvironment; } });
Object.defineProperty(exports, "setEnvironment", { enumerable: true, get: function () { return config_js_1.setEnvironment; } });
var api_js_1 = require("./api.js");
Object.defineProperty(exports, "verifyApiKey", { enumerable: true, get: function () { return api_js_1.verifyApiKey; } });
Object.defineProperty(exports, "pollForRequest", { enumerable: true, get: function () { return api_js_1.pollForRequest; } });
Object.defineProperty(exports, "submitProgress", { enumerable: true, get: function () { return api_js_1.submitProgress; } });
Object.defineProperty(exports, "submitResult", { enumerable: true, get: function () { return api_js_1.submitResult; } });
//# sourceMappingURL=index.js.map