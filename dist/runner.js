"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalModelRunner = void 0;
const chalk_1 = __importDefault(require("chalk"));
const ora_1 = __importDefault(require("ora"));
const ollama_js_1 = require("./ollama.js");
const api_js_1 = require("./api.js");
class LocalModelRunner {
    isRunning = false;
    spinner = null;
    activeRequests = 0;
    async start() {
        console.clear();
        console.log(chalk_1.default.blue("\nMindStudio Local Model Tunnel\n"));
        // Discover available models
        const models = await (0, ollama_js_1.discoverModels)();
        if (models.length === 0) {
            console.log(chalk_1.default.yellow("No Ollama models found."));
            console.log(chalk_1.default.white("   Make sure Ollama is running: ollama serve"));
            console.log(chalk_1.default.white("   Pull a model: ollama pull llama3.2\n"));
            return;
        }
        console.log(chalk_1.default.green("✓ Found models:"));
        models.forEach((m) => {
            const size = m.parameterSize || `${Math.round(m.size / 1e9)}GB`;
            console.log(chalk_1.default.white(`  • ${m.name} (${size})`));
        });
        console.log("");
        const modelNames = models.map((m) => m.name);
        this.isRunning = true;
        this.spinner = (0, ora_1.default)({
            text: "Waiting for requests...",
            color: "cyan",
        }).start();
        // Handle graceful shutdown
        process.on("SIGINT", () => this.stop());
        process.on("SIGTERM", () => this.stop());
        while (this.isRunning) {
            try {
                await this.poll(modelNames);
            }
            catch (error) {
                if (this.isRunning) {
                    const message = error instanceof Error ? error.message : "Unknown error";
                    this.spinner?.fail(chalk_1.default.red(`Error: ${message}`));
                    // Wait before retrying
                    await this.sleep(5000);
                    if (this.isRunning) {
                        this.spinner = (0, ora_1.default)({
                            text: "Reconnecting...",
                            color: "cyan",
                        }).start();
                    }
                }
            }
        }
    }
    async poll(models) {
        const request = await (0, api_js_1.pollForRequest)(models);
        if (!request) {
            return; // Long-poll returned with no request, continue polling
        }
        this.activeRequests++;
        this.updateSpinner();
        // Process request in background (don't await)
        this.processRequest(request).finally(() => {
            this.activeRequests--;
            this.updateSpinner();
        });
    }
    async processRequest(request) {
        const startTime = Date.now();
        this.spinner?.stop();
        console.log(chalk_1.default.cyan(`\n⚡ Processing: ${request.modelId}`));
        try {
            const ollama = await (0, ollama_js_1.createOllamaClient)();
            // Build messages for Ollama
            const messages = request.payload.messages || [];
            // Stream the response
            const stream = await ollama.chat({
                model: request.modelId,
                messages: messages.map((m) => ({
                    role: m.role,
                    content: m.content,
                })),
                stream: true,
                options: {
                    temperature: request.payload.temperature,
                    num_predict: request.payload.maxTokens,
                },
            });
            let fullContent = "";
            let lastProgressUpdate = 0;
            const progressInterval = 100; // Update progress every 100ms max
            for await (const chunk of stream) {
                fullContent += chunk.message.content;
                // Throttle progress updates
                const now = Date.now();
                if (now - lastProgressUpdate > progressInterval) {
                    await (0, api_js_1.submitProgress)(request.id, fullContent);
                    lastProgressUpdate = now;
                }
                // Show streaming indicator
                process.stdout.write(chalk_1.default.white("."));
            }
            // Submit final progress
            await (0, api_js_1.submitProgress)(request.id, fullContent);
            // Submit result
            await (0, api_js_1.submitResult)(request.id, true, {
                content: fullContent,
                usage: {
                    promptTokens: 0, // Ollama doesn't always provide this
                    completionTokens: 0,
                },
            });
            const duration = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(chalk_1.default.green(`\n✓ Completed in ${duration}s (${fullContent.length} chars)\n`));
        }
        catch (error) {
            if (error instanceof Error && error.status_code === 404) {
                const message = `Model ${request.modelId} not found. Is it registered on your local server?`;
                console.log(chalk_1.default.red(`\nFailed: ${message}\n`));
                await (0, api_js_1.submitResult)(request.id, false, undefined, message);
                return;
            }
            let message = error instanceof Error ? error.message : "Unknown error";
            if (message === "fetch failed") {
                message =
                    "Failed to connect to the API. Please make sure your local model server is running.";
            }
            console.log(error);
            console.log(chalk_1.default.red(`\n✗ Failed: ${message}\n`));
            await (0, api_js_1.submitResult)(request.id, false, undefined, message);
        }
        if (this.isRunning) {
            this.spinner = (0, ora_1.default)({
                text: "Waiting for requests...",
                color: "cyan",
            }).start();
            this.updateSpinner();
        }
    }
    updateSpinner() {
        if (this.spinner && this.isRunning) {
            if (this.activeRequests > 0) {
                this.spinner.text = `Processing ${this.activeRequests} request(s)...`;
            }
            else {
                this.spinner.text = "Waiting for requests...";
            }
        }
    }
    stop() {
        console.log(chalk_1.default.yellow("\n\nShutting down...\n"));
        this.isRunning = false;
        this.spinner?.stop();
        process.exit(0);
    }
    sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
exports.LocalModelRunner = LocalModelRunner;
//# sourceMappingURL=runner.js.map