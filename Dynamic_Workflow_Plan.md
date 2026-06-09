# Implementation Plan: Claude's Dynamic Workflow

### Goal
Implement a "Dynamic Workflow" system inspired by Claude's recently introduced capability. The system will feature an Orchestrator (written in TypeScript) that takes a complex user prompt, dynamically breaks it down into sub-tasks, and spawns multiple Sub-Agents in parallel to execute those tasks. Finally, a Verifier agent will review and synthesize the results.

### Assumptions
- The project will be developed using Node.js and TypeScript.
- We will interface with an LLM API (e.g., Anthropic Claude API, OpenAI API, or Gemini API) for the agent capabilities.
- The repository `Coding_WorkFlow` is dedicated to this implementation.
- The user's environment has `node`, `npm`, and `git` installed.

### Plan

1. **Project Initialization**
   - Files: `package.json`, `tsconfig.json`, `.gitignore`
   - Change: 
     - Initialize a new Node.js project.
     - Install TypeScript and necessary dependencies (e.g., `dotenv`, `axios` or LLM SDKs).
     - Set up `tsconfig.json` for Node execution.
   - Verify: Run `npm init -y && npx tsc --init` and ensure no errors. Check that `.gitignore` contains `node_modules`.

2. **Implement LLM Client Interface**
   - Files: `src/llm/client.ts`
   - Change: 
     - Create a generic wrapper around the LLM API to handle authentication, retries, and structured outputs (JSON mode or tool calling).
   - Verify: Write a small test script `npx ts-node src/llm/client.ts` that sends a simple prompt and prints the LLM's response.

3. **Build the Orchestrator**
   - Files: `src/core/orchestrator.ts`, `src/types/workflow.ts`
   - Change: 
     - Define types for `Task`, `SubTask`, and `Plan`.
     - Implement the Orchestrator logic: Prompt the LLM to analyze the main goal and output a JSON array of independent sub-tasks.
   - Verify: Run a test prompt through the orchestrator and verify it correctly parses the JSON plan into memory.

4. **Implement Parallel Sub-Agents**
   - Files: `src/core/agent.ts`
   - Change: 
     - Create a Sub-Agent class that takes a specific sub-task and context.
     - In the Orchestrator, use `Promise.all` to launch Sub-Agents concurrently for independent tasks.
   - Verify: Add console logs with timestamps to ensure multiple agents are executing API requests in parallel.

5. **Verification and Synthesis Step**
   - Files: `src/core/verifier.ts`
   - Change: 
     - Implement an Adversarial Verifier that takes the original goal and all Sub-Agent outputs, checking for completeness and errors.
     - Synthesize a final coherent response or code artifact.
   - Verify: Pass a mock set of successful sub-task outputs to the verifier and ensure the final output addresses the original goal.

6. **CLI Entry Point**
   - Files: `src/index.ts`
   - Change: 
     - Implement a CLI interface (using `commander` or raw `process.argv`) to allow users to trigger the workflow from the terminal.
   - Verify: Run `npx ts-node src/index.ts "Write a snake game in Python"` and observe the end-to-end execution.

### Risks & mitigations
- **LLM Hallucinations in Planning**: The orchestrator might generate invalid JSON or illogical plans. 
  - *Mitigation*: Enforce strict JSON schema using function calling/tools and add parsing retry logic.
- **Context Window Overflow / High Costs**: Sub-agents might consume too many tokens. 
  - *Mitigation*: Strictly scope the context passed to each sub-agent. Use smaller, cheaper models for simple sub-tasks if possible.
- **Race Conditions**: Parallel agents modifying the same files.
  - *Mitigation*: Sub-agents should return their changes as proposed diffs or structured data, which the Verifier/Synthesizer applies sequentially.

### Rollback plan
- All changes are version-controlled via Git. If a specific architectural change (e.g., parallel execution) causes instability, we will revert to the previous commit using `git revert` or `git reset` and re-evaluate the approach.
