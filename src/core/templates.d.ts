import { Plan } from '../types/workflow';
export declare class TemplateManager {
    private templatesDir;
    constructor(baseDir?: string);
    matchTemplate(goal: string): Plan | null;
}
//# sourceMappingURL=templates.d.ts.map