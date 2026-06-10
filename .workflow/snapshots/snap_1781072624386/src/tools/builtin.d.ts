export declare const builtinTools: ({
    name: string;
    description: string;
    input_schema: {
        type: string;
        properties: {
            command: {
                type: string;
                description: string;
            };
            path?: never;
            content?: never;
            query?: never;
            dirPath?: never;
            depth?: never;
            topK?: never;
            pattern?: never;
        };
        required: string[];
    };
} | {
    name: string;
    description: string;
    input_schema: {
        type: string;
        properties: {
            path: {
                type: string;
                description: string;
            };
            command?: never;
            content?: never;
            query?: never;
            dirPath?: never;
            depth?: never;
            topK?: never;
            pattern?: never;
        };
        required: string[];
    };
} | {
    name: string;
    description: string;
    input_schema: {
        type: string;
        properties: {
            path: {
                type: string;
                description: string;
            };
            content: {
                type: string;
                description: string;
            };
            command?: never;
            query?: never;
            dirPath?: never;
            depth?: never;
            topK?: never;
            pattern?: never;
        };
        required: string[];
    };
} | {
    name: string;
    description: string;
    input_schema: {
        type: string;
        properties: {
            query: {
                type: string;
                description: string;
            };
            command?: never;
            path?: never;
            content?: never;
            dirPath?: never;
            depth?: never;
            topK?: never;
            pattern?: never;
        };
        required: string[];
    };
} | {
    name: string;
    description: string;
    input_schema: {
        type: string;
        properties: {
            dirPath: {
                type: string;
                description: string;
            };
            depth: {
                type: string;
                description: string;
            };
            command?: never;
            path?: never;
            content?: never;
            query?: never;
            topK?: never;
            pattern?: never;
        };
        required: string[];
    };
} | {
    name: string;
    description: string;
    input_schema: {
        type: string;
        properties: {
            query: {
                type: string;
                description: string;
            };
            topK: {
                type: string;
                description: string;
            };
            command?: never;
            path?: never;
            content?: never;
            dirPath?: never;
            depth?: never;
            pattern?: never;
        };
        required: string[];
    };
} | {
    name: string;
    description: string;
    input_schema: {
        type: string;
        properties: {
            pattern: {
                type: string;
                description: string;
            };
            dirPath: {
                type: string;
                description: string;
            };
            command?: never;
            path?: never;
            content?: never;
            query?: never;
            depth?: never;
            topK?: never;
        };
        required: string[];
    };
})[];
export declare function safeListDir(dir: string, maxDepth: number, currentDepth?: number): string[];
export declare function executeBuiltinTool(name: string, args: any, agentId?: string): Promise<string>;
//# sourceMappingURL=builtin.d.ts.map