import * as fs from 'fs';
import * as path from 'path';
export class StateManager {
    stateFile;
    constructor(cwd = process.cwd()) {
        const workflowDir = path.join(cwd, '.workflow');
        if (!fs.existsSync(workflowDir)) {
            fs.mkdirSync(workflowDir, { recursive: true });
        }
        this.stateFile = path.join(workflowDir, 'state.json');
    }
    saveState(state) {
        fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2), 'utf-8');
    }
    loadState() {
        if (fs.existsSync(this.stateFile)) {
            try {
                const content = fs.readFileSync(this.stateFile, 'utf-8');
                return JSON.parse(content);
            }
            catch (err) {
                console.error('Failed to parse workflow state file.');
            }
        }
        return null;
    }
    clearState() {
        if (fs.existsSync(this.stateFile)) {
            fs.unlinkSync(this.stateFile);
        }
    }
}
//# sourceMappingURL=stateManager.js.map