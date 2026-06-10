"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("./llm/client");
async function run() {
    console.log("Testing LLM Wrapper...");
    if (!process.env.ANTHROPIC_API_KEY) {
        console.warn("No ANTHROPIC_API_KEY found in environment variables. Skipping real API call.");
        return;
    }
    try {
        const response = await (0, client_1.askLLM)("You are a helpful assistant.", [{ role: "user", content: "Say hello and introduce yourself briefly." }]);
        console.log("Response:", JSON.stringify(response.content, null, 2));
    }
    catch (err) {
        console.error("Error calling LLM:", err);
    }
}
run();
//# sourceMappingURL=test_llm.js.map