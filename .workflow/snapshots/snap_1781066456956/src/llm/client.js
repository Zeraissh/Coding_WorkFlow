"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.askLLM = askLLM;
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const dotenv = __importStar(require("dotenv"));
dotenv.config();
const anthropic = new sdk_1.default({
    apiKey: process.env.ANTHROPIC_API_KEY,
});
async function askLLM(system, messages, tools, onToolCall, temperature = 0.7) {
    const options = {
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 4096,
        system,
        messages,
        temperature,
    };
    if (tools && tools.length > 0) {
        options.tools = tools;
    }
    let response = await anthropic.messages.create(options);
    while (response.stop_reason === 'tool_use' && onToolCall) {
        messages.push({ role: 'assistant', content: response.content });
        const toolResults = [];
        for (const block of response.content) {
            if (block.type === 'tool_use') {
                try {
                    console.log(`[Tool Call] ${block.name}`, JSON.stringify(block.input));
                    const result = await onToolCall(block.name, block.input);
                    toolResults.push({
                        type: 'tool_result',
                        tool_use_id: block.id,
                        content: result
                    });
                }
                catch (err) {
                    toolResults.push({
                        type: 'tool_result',
                        tool_use_id: block.id,
                        content: `Error executing tool: ${err.message}`,
                        is_error: true
                    });
                }
            }
        }
        if (toolResults.length > 0) {
            messages.push({ role: 'user', content: toolResults });
            options.messages = messages;
            response = await anthropic.messages.create(options);
        }
        else {
            break;
        }
    }
    return response;
}
//# sourceMappingURL=client.js.map