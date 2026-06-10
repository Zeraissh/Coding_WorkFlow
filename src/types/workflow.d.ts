export interface SubTask {
    id: string;
    description: string;
    expectedOutput: string;
}
export interface Plan {
    goal: string;
    tasks: SubTask[];
}
export interface TaskResult {
    taskId: string;
    result: string;
    success: boolean;
    error?: string;
}
//# sourceMappingURL=workflow.d.ts.map