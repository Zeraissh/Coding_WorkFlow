import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);
export async function gitCreateBranch(branchName, cwd = process.cwd()) {
    try {
        // 确保有未提交的改动时先暂存或抛错，这里简单处理为强制切换并创建
        await execAsync(`git checkout -b ${branchName}`, { cwd });
        return `Successfully created and switched to branch ${branchName}`;
    }
    catch (err) {
        return `Failed to create branch: ${err.message}`;
    }
}
export async function gitCommitAll(commitMessage, cwd = process.cwd()) {
    try {
        await execAsync(`git add .`, { cwd });
        // 对 commit message 进行转义
        const safeMsg = commitMessage.replace(/"/g, '\\"');
        const { stdout } = await execAsync(`git commit -m "${safeMsg}"`, { cwd });
        return `Successfully committed changes:\n${stdout}`;
    }
    catch (err) {
        return `Failed to commit: ${err.message}`;
    }
}
export async function gitDiffCheck(cwd = process.cwd()) {
    try {
        const { stdout } = await execAsync(`git diff HEAD`, { cwd });
        return stdout;
    }
    catch (err) {
        return `Failed to get git diff: ${err.message}`;
    }
}
//# sourceMappingURL=git_tool.js.map