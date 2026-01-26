"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pollForRequest = pollForRequest;
exports.submitProgress = submitProgress;
exports.submitResult = submitResult;
exports.verifyApiKey = verifyApiKey;
exports.registerLocalModel = registerLocalModel;
exports.getRegisteredModels = getRegisteredModels;
exports.requestDeviceAuth = requestDeviceAuth;
exports.pollDeviceAuth = pollDeviceAuth;
const config_js_1 = require("./config.js");
function getHeaders() {
    const apiKey = (0, config_js_1.getApiKey)();
    if (!apiKey) {
        throw new Error("Not authenticated. Run: mindstudio-local auth");
    }
    return {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
    };
}
async function pollForRequest(models) {
    const baseUrl = (0, config_js_1.getApiBaseUrl)();
    const modelsParam = models.join(",");
    const response = await fetch(`${baseUrl}/v1/local-models/poll?models=${encodeURIComponent(modelsParam)}`, {
        method: "GET",
        headers: getHeaders(),
    });
    if (response.status === 204) {
        return null;
    }
    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Poll failed: ${response.status} ${error}`);
    }
    const data = (await response.json());
    return data.request;
}
async function submitProgress(requestId, content) {
    const baseUrl = (0, config_js_1.getApiBaseUrl)();
    const response = await fetch(`${baseUrl}/v1/local-models/requests/${requestId}/progress`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ content }),
    });
    if (!response.ok) {
        console.warn(`Progress update failed: ${response.status}`);
    }
}
async function submitResult(requestId, success, result, error) {
    const baseUrl = (0, config_js_1.getApiBaseUrl)();
    const response = await fetch(`${baseUrl}/v1/local-models/requests/${requestId}/result`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ success, result, error }),
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Result submission failed: ${response.status} ${errorText}`);
    }
}
async function verifyApiKey() {
    const baseUrl = (0, config_js_1.getApiBaseUrl)();
    try {
        const response = await fetch(`${baseUrl}/v1/local-models/verify-api-key`, {
            method: "GET",
            headers: getHeaders(),
        });
        return response.status === 204 || response.ok;
    }
    catch {
        return false;
    }
}
async function registerLocalModel(modelName) {
    const baseUrl = (0, config_js_1.getApiBaseUrl)();
    const response = await fetch(`${baseUrl}/v1/local-models/models/create`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ modelName }),
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Register failed: ${response.status} ${errorText}`);
    }
}
async function getRegisteredModels() {
    const baseUrl = (0, config_js_1.getApiBaseUrl)();
    const response = await fetch(`${baseUrl}/v1/local-models/models`, {
        method: "GET",
        headers: getHeaders(),
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch registered models: ${response.status} ${errorText}`);
    }
    const data = (await response.json());
    return data.models;
}
async function requestDeviceAuth() {
    const baseUrl = (0, config_js_1.getApiBaseUrl)();
    const response = await fetch(`${baseUrl}/developer/v2/request-auth-url`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
    });
    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Device auth request failed: ${response.status} ${error}`);
    }
    const data = (await response.json());
    return data;
}
async function pollDeviceAuth(token) {
    const baseUrl = (0, config_js_1.getApiBaseUrl)();
    const response = await fetch(`${baseUrl}/developer/v2/poll-auth-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
    });
    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Device auth poll failed: ${response.status} ${error}`);
    }
    const data = (await response.json());
    return data;
}
//# sourceMappingURL=api.js.map