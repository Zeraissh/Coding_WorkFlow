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
        };
        required: string[];
    };
})[];
export declare function executeBuiltinTool(name: string, args: any): Promise<string>;
//# sourceMappingURL=builtin.d.ts.map