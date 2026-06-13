/**
 * Sandbox — 可选 Docker 沙箱（隔离 shell 执行）
 *
 * 默认关闭：`run_terminal_command` 仍在宿主执行（保留现有体验 + 命令黑名单）。
 * 开启后（sandboxConfig.enabled），每条命令在一次性容器内执行：
 *   docker run --rm -i -v <项目根>:/workspace -w /workspace \
 *     --network <net> --memory <m> --cpus <c> --pids-limit 512 <image> sh -c "<command>"
 *
 * 隔离收益：命令无法访问宿主进程、无法触碰项目目录之外的宿主文件系统、
 * 资源受限、容器用完即焚。项目目录通过 bind mount 共享，所以 Agent 写的
 * 代码会持久化（这是预期的）。
 *
 * 设计取舍（v1）：
 * - 每条命令一个容器（--rm），无状态：cwd/env 不跨命令保留，但文件改动经
 *   挂载持久化。多数 Agent 命令彼此独立（跑测试/lint），可接受。
 * - 安全失败：开启沙箱但 Docker 不可用时直接报错，绝不悄悄回退到宿主执行
 *   （那会让隔离形同虚设）。
 * - 沙箱主要面向 Linux/WSL 部署；Windows Docker Desktop 的盘符路径由其自行转换。
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { GlobalConfig } from './config';

const execAsync = promisify(exec);

export class SandboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SandboxError';
  }
}

export interface ResolvedSandboxConfig {
  enabled: boolean;
  image: string;
  network: string;
  memory: string;
  cpus: string;
}

const DEFAULTS: ResolvedSandboxConfig = {
  enabled: false,
  image: 'ubuntu:24.04',
  network: 'bridge',
  memory: '2g',
  cpus: '2',
};

export function resolveSandboxConfig(): ResolvedSandboxConfig {
  const raw = (GlobalConfig.get() as any).sandboxConfig || {};
  return { ...DEFAULTS, ...raw };
}

export function isSandboxEnabled(): boolean {
  return resolveSandboxConfig().enabled === true;
}

/**
 * 构建 `docker` 的参数数组（纯函数，便于单测）。
 * 命令作为单个字符串传给容器内的 `sh -c`，不做 shell 拼接，避免注入宿主。
 */
export function buildDockerArgs(
  config: ResolvedSandboxConfig,
  command: string,
  cwd: string
): string[] {
  return [
    'run',
    '--rm',
    '-i',
    '-v',
    `${cwd}:/workspace`,
    '-w',
    '/workspace',
    '--network',
    config.network,
    '--memory',
    config.memory,
    '--cpus',
    config.cpus,
    '--pids-limit',
    '512',
    config.image,
    'sh',
    '-c',
    command,
  ];
}

let _dockerAvailable: boolean | null = null;

/** 检测 docker CLI 是否可用（结果缓存）。 */
export async function isDockerAvailable(): Promise<boolean> {
  if (_dockerAvailable !== null) return _dockerAvailable;
  try {
    await execAsync('docker version --format "{{.Server.Version}}"', { timeout: 10_000 });
    _dockerAvailable = true;
  } catch {
    _dockerAvailable = false;
  }
  return _dockerAvailable;
}

/** 测试用：重置 docker 可用性缓存 */
export function _resetDockerCache(): void {
  _dockerAvailable = null;
}

export interface SandboxResult {
  stdout: string;
  stderr: string;
}

/**
 * 在 Docker 沙箱内执行命令。Docker 不可用时抛 SandboxError（安全失败，不回退宿主）。
 */
export async function runInSandbox(
  command: string,
  cwd: string,
  timeoutMs: number = 600_000
): Promise<SandboxResult> {
  if (!(await isDockerAvailable())) {
    throw new SandboxError(
      'Sandbox is enabled but Docker is not available. Install/start Docker, ' +
      'or disable sandboxConfig.enabled to run commands on the host.'
    );
  }

  const config = resolveSandboxConfig();
  const args = buildDockerArgs(config, command, cwd);

  // execFile 风格：参数数组，命令不经宿主 shell 解释
  const { execFile } = await import('child_process');
  return await new Promise<SandboxResult>((resolve, reject) => {
    execFile('docker', args, { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && (err as any).killed) {
        reject(new SandboxError(`Sandboxed command timed out after ${timeoutMs}ms`));
        return;
      }
      // 命令本身非零退出不算沙箱错误：把输出交回上层（与宿主路径一致）
      resolve({ stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

// ============================================================================
// Sandbox v2 — 持久容器（一次工作流一个容器，命令经 docker exec 执行）
// ============================================================================
//
// v1 每条命令一个 --rm 容器 = 无状态（cwd/env 不跨命令保留）。
// v2 在工作流开始时起一个常驻容器（sleep infinity），命令用 docker exec 跑进去，
// 工作流结束 docker rm -f 销毁 —— cwd/env/进程在命令之间保留，更贴近真实 shell。

/** 构建"起一个常驻容器"的 docker 参数（纯函数，可测） */
export function buildRunDaemonArgs(
  config: ResolvedSandboxConfig,
  cwd: string,
  containerName: string
): string[] {
  return [
    'run', '-d', '--name', containerName,
    '-v', `${cwd}:/workspace`,
    '-w', '/workspace',
    '--network', config.network,
    '--memory', config.memory,
    '--cpus', config.cpus,
    '--pids-limit', '512',
    config.image,
    'sleep', 'infinity',
  ];
}

/** 构建"在常驻容器内执行命令"的 docker exec 参数（纯函数，可测） */
export function buildExecArgs(containerName: string, command: string): string[] {
  return ['exec', '-w', '/workspace', containerName, 'sh', '-c', command];
}

async function runDocker(args: string[], timeoutMs: number): Promise<SandboxResult> {
  const { execFile } = await import('child_process');
  return await new Promise<SandboxResult>((resolve, reject) => {
    execFile('docker', args, { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && (err as any).killed) {
        reject(new SandboxError(`Sandboxed command timed out after ${timeoutMs}ms`));
        return;
      }
      resolve({ stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

/**
 * 一次工作流的持久沙箱容器。start → exec*… → stop。
 * start 失败（Docker 不可用等）抛 SandboxError（安全失败，不回退宿主）。
 */
export class SandboxSession {
  readonly containerName: string;
  private started = false;

  constructor(private cwd: string) {
    this.containerName = `coding-workflow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  async start(): Promise<void> {
    if (this.started) return;
    if (!(await isDockerAvailable())) {
      throw new SandboxError(
        'Sandbox is enabled but Docker is not available. Install/start Docker, ' +
        'or disable sandboxConfig.enabled to run commands on the host.'
      );
    }
    const config = resolveSandboxConfig();
    await runDocker(buildRunDaemonArgs(config, this.cwd, this.containerName), 120_000);
    this.started = true;
  }

  async exec(command: string, timeoutMs: number = 600_000): Promise<SandboxResult> {
    if (!this.started) throw new SandboxError('Sandbox session not started');
    return runDocker(buildExecArgs(this.containerName, command), timeoutMs);
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    try {
      await runDocker(['rm', '-f', this.containerName], 60_000);
    } catch (e: any) {
      console.warn(`[sandbox] Failed to remove container ${this.containerName}: ${e.message}`);
    }
  }
}

// --- 当前工作流的沙箱会话 scope（仿 abort.ts） ---
let _currentSession: SandboxSession | null = null;

/** 工作流开始时调用（沙箱开启时）：起容器并设为当前会话。失败则抛出。 */
export async function beginSandboxSession(cwd: string = process.cwd()): Promise<SandboxSession> {
  const session = new SandboxSession(cwd);
  await session.start();
  _currentSession = session;
  return session;
}

/** 获取当前工作流的沙箱会话（无则 null） */
export function getSandboxSession(): SandboxSession | null {
  return _currentSession;
}

/** 工作流结束：销毁容器并清理会话 */
export async function endSandboxSession(): Promise<void> {
  if (_currentSession) {
    await _currentSession.stop();
    _currentSession = null;
  }
}
