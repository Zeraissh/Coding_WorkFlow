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
const commander_1 = require("commander");
const orchestrator_1 = require("./core/orchestrator");
const dotenv = __importStar(require("dotenv"));
dotenv.config();
const program = new commander_1.Command();
program
    .name('dynamic-workflow')
    .description('A dynamic workflow orchestrator powered by LLMs')
    .version('1.0.0');
program
    .command('run')
    .description('Run a workflow based on a goal')
    .argument('<goal>', 'The goal to achieve')
    .action(async (goal) => {
    try {
        if (!process.env.ANTHROPIC_API_KEY) {
            console.error("Error: ANTHROPIC_API_KEY is not set in the environment.");
            process.exit(1);
        }
        console.log(`Starting Dynamic Workflow for goal: "${goal}"`);
        const orchestrator = new orchestrator_1.Orchestrator();
        const result = await orchestrator.executeWorkflow(goal);
        console.log(`\n=== Final Synthesized Output ===`);
        console.log(result);
    }
    catch (err) {
        console.error("Workflow execution failed:", err);
        process.exit(1);
    }
});
program.parse();
//# sourceMappingURL=index.js.map