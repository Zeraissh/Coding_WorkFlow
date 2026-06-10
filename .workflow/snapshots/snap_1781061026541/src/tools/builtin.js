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
Object.defineProperty(exports, "__esModule", { value: true });
exports.builtinTools = void 0;
exports.executeBuiltinTool = executeBuiltinTool;
const child_process_1 = require("child_process");
const util_1 = require("util");
const fs = __importStar(require("fs"));
const duck_duck_scrape_1 = require("duck-duck-scrape");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
exports.builtinTools = [
    {
        name: 'run_terminal_command',
        description: 'Execute a bash or powershell command on the local machine.',
        input_schema: {
            type: 'object',
            properties: {
                command: { type: 'string', description: 'The command to execute' }
            },
            required: ['command']
        }
    },
    {
        name: 'read_file',
        description: 'Read contents of a file on the local machine.',
        input_schema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Absolute or relative file path' }
            },
            required: ['path']
        }
    },
    {
        name: 'write_file',
        description: 'Write content to a local file.',
        input_schema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'File path' },
                content: { type: 'string', description: 'Content to write' }
            },
            required: ['path', 'content']
        }
    },
    {
        name: 'search_web',
        description: 'Search the web for information.',
        input_schema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'The search query' }
            },
            required: ['query']
        }
    }
];
async function executeBuiltinTool(name, args) {
    try {
        switch (name) {
            case 'run_terminal_command':
                const { stdout, stderr } = await execAsync(args.command);
                return `STDOUT:\n${stdout}\nSTDERR:\n${stderr}`;
            case 'read_file':
                return fs.readFileSync(args.path, 'utf-8');
            case 'write_file':
                fs.writeFileSync(args.path, args.content, 'utf-8');
                return `Successfully wrote to ${args.path}`;
            case 'search_web':
                const searchResults = await (0, duck_duck_scrape_1.search)(args.query);
                return JSON.stringify(searchResults.results.slice(0, 5), null, 2);
            default:
                throw new Error(`Unknown builtin tool: ${name}`);
        }
    }
    catch (err) {
        return `Tool execution failed: ${err.message}`;
    }
}
//# sourceMappingURL=builtin.js.map