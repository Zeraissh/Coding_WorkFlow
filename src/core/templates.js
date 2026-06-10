import fs from 'fs';
import path from 'path';
export class TemplateManager {
    templatesDir;
    constructor(baseDir = process.cwd()) {
        this.templatesDir = path.join(baseDir, '.workflow', 'templates');
    }
    matchTemplate(goal) {
        if (!goal.startsWith('Template:') && !goal.startsWith('template:'))
            return null;
        const templateName = goal.split(':')[1]?.trim();
        if (!templateName)
            return null;
        const templatePath = path.join(this.templatesDir, `${templateName}.json`);
        if (!fs.existsSync(templatePath)) {
            console.warn(`Template "${templateName}" not found at ${templatePath}`);
            return null;
        }
        try {
            const data = fs.readFileSync(templatePath, 'utf-8');
            const parsed = JSON.parse(data);
            return {
                goal: goal,
                tasks: parsed.subtasks.map((t) => ({
                    id: t.id || `task-${Math.random().toString(36).slice(2, 6)}`,
                    description: t.description,
                    expectedOutput: t.expectedOutput,
                    estimatedComplexity: t.estimatedComplexity || 3,
                    dependencies: t.dependencies || [],
                    isolatedFiles: t.isolatedFiles,
                    sharedFiles: t.sharedFiles,
                })),
            };
        }
        catch (e) {
            console.error(`Failed to parse template ${templateName}:`, e.message);
            return null;
        }
    }
}
//# sourceMappingURL=templates.js.map