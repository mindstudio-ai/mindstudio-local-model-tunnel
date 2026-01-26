#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const open_1 = __importDefault(require("open"));
const commander_1 = require("commander");
const chalk_1 = __importDefault(require("chalk"));
const ora_1 = __importDefault(require("ora"));
const config_js_1 = require("./config.js");
const ollama_js_1 = require("./ollama.js");
const api_js_1 = require("./api.js");
const runner_js_1 = require("./runner.js");
const program = new commander_1.Command();
program
    .name("mindstudio-local")
    .description("Run local AI models with MindStudio")
    .version("0.1.0");
// Global option for environment
program.option("-e, --env <environment>", "Environment to use (prod, local)", undefined);
// Pre-action hook to set environment from global option
program.hook("preAction", (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.env) {
        if (opts.env !== "prod" && opts.env !== "local") {
            console.log(chalk_1.default.red(`Invalid environment: ${opts.env}. Use 'prod' or 'local'.`));
            process.exit(1);
        }
        (0, config_js_1.setEnvironment)(opts.env);
    }
});
// Helper to show environment badge
function envBadge() {
    const env = (0, config_js_1.getEnvironment)();
    if (env === "local") {
        return chalk_1.default.bgYellow.black(" LOCAL ");
    }
    return chalk_1.default.bgGreen.black(" PROD ");
}
const displayModels = (models) => {
    console.log(chalk_1.default.blue("\nAvailable Models\n"));
    models.forEach((m) => {
        console.log(`  ${chalk_1.default.green("*")} ${m.name}`);
    });
    console.log("");
};
// Auth command
program
    .command("auth")
    .description("Authenticate with MindStudio via browser")
    .action(async () => {
    const info = (0, config_js_1.getEnvironmentInfo)();
    console.log(chalk_1.default.blue(`\nMindStudio Authentication ${envBadge()}\n`));
    console.log(chalk_1.default.white(`API: ${info.apiBaseUrl}\n`));
    const spinner = (0, ora_1.default)("Requesting authorization...").start();
    const { url: authUrl, token } = await (0, api_js_1.requestDeviceAuth)();
    spinner.stop();
    console.log(chalk_1.default.white("Opening browser for authentication...\n"));
    console.log(chalk_1.default.white(`  If browser doesn't open, visit:`));
    console.log(chalk_1.default.cyan(`  ${authUrl}\n`));
    await (0, open_1.default)(authUrl);
    const pollSpinner = (0, ora_1.default)("Waiting for browser authorization...").start();
    const pollInterval = 2000;
    const maxAttempts = 30;
    for (let i = 0; i < maxAttempts; i++) {
        await sleep(pollInterval);
        const result = await (0, api_js_1.pollDeviceAuth)(token);
        if (result.status === "completed" && result.apiKey) {
            (0, config_js_1.setApiKey)(result.apiKey);
            pollSpinner.succeed(chalk_1.default.green("Authenticated successfully!"));
            console.log(chalk_1.default.white(`Config saved to: ${(0, config_js_1.getConfigPath)()}\n`));
            return;
        }
        if (result.status === "expired") {
            pollSpinner.fail(chalk_1.default.red("Authorization expired. Please try again."));
            process.exit(1);
        }
        const remaining = Math.floor(((maxAttempts - i) * pollInterval) / 1000);
        pollSpinner.text = `Waiting for browser authorization... (${remaining}s remaining)`;
    }
    pollSpinner.fail(chalk_1.default.red("Authorization timed out. Please try again."));
    process.exit(1);
});
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
// Logout command
program
    .command("logout")
    .description("Remove stored credentials for current environment")
    .action(() => {
    (0, config_js_1.clearApiKey)();
    console.log(chalk_1.default.green(`Logged out from ${(0, config_js_1.getEnvironment)()} environment.\n`));
});
// Status command
program
    .command("status")
    .description("Check connection status")
    .action(async () => {
    const info = (0, config_js_1.getEnvironmentInfo)();
    console.log(chalk_1.default.blue(`\nStatus ${envBadge()}\n`));
    console.log(chalk_1.default.white(`API: ${info.apiBaseUrl}\n`));
    // Check API key
    const apiKey = (0, config_js_1.getApiKey)();
    if (apiKey) {
        const isValid = await (0, api_js_1.verifyApiKey)();
        if (isValid) {
            console.log(chalk_1.default.green("✓ MindStudio: Connected"));
        }
        else {
            console.log(chalk_1.default.red("MindStudio: Invalid API key"));
        }
    }
    else {
        console.log(chalk_1.default.yellow("MindStudio: Not authenticated"));
    }
    // Check Ollama
    const ollamaRunning = await (0, ollama_js_1.isOllamaRunning)();
    if (ollamaRunning) {
        console.log(chalk_1.default.green("✓ Ollama: Running"));
        console.log("");
        const models = await (0, ollama_js_1.discoverModels)();
        displayModels(models);
    }
    else {
        console.log(chalk_1.default.red("Ollama: Not running"));
    }
    console.log("");
});
// Start command
program
    .command("start")
    .description("Start the local model tunnel")
    .option("--ollama-url <url>", "Override Ollama base URL")
    .action(async (options) => {
    if (options.ollamaUrl) {
        (0, config_js_1.setOllamaBaseUrl)(options.ollamaUrl);
    }
    const info = (0, config_js_1.getEnvironmentInfo)();
    console.log(chalk_1.default.white(`Environment: ${info.current} (${info.apiBaseUrl})`));
    const apiKey = (0, config_js_1.getApiKey)();
    if (!apiKey) {
        console.log(chalk_1.default.red(`Not authenticated for ${info.current} environment. Run: mindstudio-local auth\n`));
        process.exit(1);
    }
    // Verify API key
    const spinner = (0, ora_1.default)("Connecting to MindStudio...").start();
    const isValid = await (0, api_js_1.verifyApiKey)();
    if (!isValid) {
        spinner.fail(chalk_1.default.red("Invalid API key. Run: mindstudio-local auth"));
        process.exit(1);
    }
    spinner.succeed(`Connected to MindStudio ${envBadge()}`);
    // Check Ollama
    const ollamaRunning = await (0, ollama_js_1.isOllamaRunning)();
    if (!ollamaRunning) {
        console.log(chalk_1.default.red("\nOllama is not running."));
        console.log(chalk_1.default.white("Start it with: ollama serve\n"));
        process.exit(1);
    }
    // Start the runner
    const runner = new runner_js_1.LocalModelRunner();
    await runner.start();
});
// Models command
program
    .command("models")
    .description("List available local models")
    .action(async () => {
    const ollamaRunning = await (0, ollama_js_1.isOllamaRunning)();
    if (!ollamaRunning) {
        console.log(chalk_1.default.red("\nOllama is not running."));
        console.log(chalk_1.default.white("  Start it with: ollama serve\n"));
        process.exit(1);
    }
    const models = await (0, ollama_js_1.discoverModels)();
    if (models.length === 0) {
        console.log(chalk_1.default.yellow("\nNo models found."));
        console.log(chalk_1.default.white("Pull a model with: ollama pull llama3.2\n"));
        return;
    }
    displayModels(models);
    console.log("");
});
// Config command
program
    .command("config")
    .description("Show configuration")
    .action(() => {
    const info = (0, config_js_1.getEnvironmentInfo)();
    console.log(chalk_1.default.blue(`\nConfiguration ${envBadge()}\n`));
    console.log(`  Config file:  ${chalk_1.default.white((0, config_js_1.getConfigPath)())}`);
    console.log(`  Environment:  ${chalk_1.default.cyan(info.current)}`);
    console.log(`  API URL:      ${chalk_1.default.white(info.apiBaseUrl)}`);
    console.log(`  API key:      ${info.hasApiKey ? chalk_1.default.green("Set") : chalk_1.default.yellow("Not set")}`);
    console.log("");
});
// Env command - switch or show environment
program
    .command("env [environment]")
    .description("[DEVELOPER ONLY] Show or switch environment (prod, local)")
    .action((environment) => {
    if (environment) {
        if (environment !== "prod" && environment !== "local") {
            console.log(chalk_1.default.red(`Invalid environment: ${environment}. Use 'prod' or 'local'.`));
            process.exit(1);
        }
        (0, config_js_1.setEnvironment)(environment);
        console.log(chalk_1.default.green(`\nSwitched to ${environment} environment.\n`));
    }
    const info = (0, config_js_1.getEnvironmentInfo)();
    console.log(chalk_1.default.blue("\nEnvironment\n"));
    console.log(`  Current:     ${envBadge()}`);
    console.log(`  API URL:     ${chalk_1.default.white(info.apiBaseUrl)}`);
    console.log(`  API Key:     ${info.hasApiKey ? chalk_1.default.green("Set") : chalk_1.default.yellow("Not set")}`);
    console.log("");
    console.log(chalk_1.default.white("  Switch with: mindstudio-local env prod"));
    console.log(chalk_1.default.white("          or: mindstudio-local env local"));
    console.log("");
});
// Register command
program
    .command("register")
    .description("Register all local models")
    .action(async () => {
    // Check if authenticated
    const apiKey = (0, config_js_1.getApiKey)();
    if (!apiKey) {
        console.log(chalk_1.default.red("\nNot authenticated. Run 'mindstudio-local auth' first.\n"));
        process.exit(1);
    }
    // Check if Ollama is running
    const ollamaRunning = await (0, ollama_js_1.isOllamaRunning)();
    if (!ollamaRunning) {
        console.log(chalk_1.default.red("\nOllama is not running."));
        console.log(chalk_1.default.white("  Start it with: ollama serve\n"));
        process.exit(1);
    }
    // Get all local models
    const spinner = (0, ora_1.default)("Loading local models...").start();
    const localModels = await (0, ollama_js_1.discoverModels)();
    spinner.succeed();
    if (localModels.length === 0) {
        spinner.fail(chalk_1.default.yellow("No local models found."));
        console.log(chalk_1.default.white("  Pull a model with: ollama pull llama3.2\n"));
        process.exit(1);
    }
    const registeredModels = await (0, api_js_1.getRegisteredModels)();
    const registeredNames = new Set(registeredModels);
    const unregisteredModels = localModels.filter((m) => !registeredNames.has(m.name));
    if (localModels.length > 0 && unregisteredModels.length === 0) {
        console.log(chalk_1.default.green("\n✓ All local models are already registered.\n"));
        process.exit(0);
    }
    const registerSpinner = (0, ora_1.default)(`Registering models...`).start();
    try {
        console.log("\n");
        for (const model of unregisteredModels) {
            await (0, api_js_1.registerLocalModel)(model.name);
            console.log(chalk_1.default.green(`✓ ${model.name}\n`));
        }
        registerSpinner.succeed(chalk_1.default.green("All local models registered successfully.\n"));
        console.log(chalk_1.default.white("Manage models at: https://app.mindstudio.ai/services/self-hosted-models\n"));
        process.exit(0);
    }
    catch (error) {
        registerSpinner.fail(chalk_1.default.red(`Failed to register models`));
        console.log(chalk_1.default.red(`Error: ${error instanceof Error ? error.message : String(error)}\n`));
        process.exit(1);
    }
});
program.parse();
//# sourceMappingURL=cli.js.map