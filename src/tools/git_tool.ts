import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function gitCreateBranch(branchName: string, cwd: string = process.cwd()): Promise<string> {
  try {
    // 确保有未提交的改动时先暂存或抛错，这里简单处理为强制切换并创建
    await execAsync(`git checkout -b ${branchName}`, { cwd });
    return `Successfully created and switched to branch ${branchName}`;
  } catch (err: any) {
    return `Failed to create branch: ${err.message}`;
  }
}

export async function gitCommitAll(commitMessage: string, cwd: string = process.cwd()): Promise<string> {
  try {
    await execAsync(`git add .`, { cwd });
    // 对 commit message 进行转义
    const safeMsg = commitMessage.replace(/"/g, '\\"');
    const { stdout } = await execAsync(`git commit -m "${safeMsg}"`, { cwd });
    return `Successfully committed changes:\n${stdout}`;
  } catch (err: any) {
    return `Failed to commit: ${err.message}`;
  }
}

export async function gitDiffCheck(cwd: string = process.cwd()): Promise<string> {
  try {
    const { stdout } = await execAsync(`git diff HEAD`, { cwd });
    return stdout;
  } catch (err: any) {
    return `Failed to get git diff: ${err.message}`;
  }
}
