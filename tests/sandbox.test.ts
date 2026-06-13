import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  buildDockerArgs,
  resolveSandboxConfig,
  isSandboxEnabled,
  type ResolvedSandboxConfig,
} from '../src/core/sandbox';
import { GlobalConfig } from '../src/core/config';

const baseConfig: ResolvedSandboxConfig = {
  enabled: true,
  image: 'node:22',
  network: 'bridge',
  memory: '2g',
  cpus: '2',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildDockerArgs', () => {
  it('builds a --rm run that bind-mounts the project and caps resources', () => {
    const args = buildDockerArgs(baseConfig, 'npm test', '/home/me/proj');

    // command is passed as a single argument to sh -c (no host-shell interpolation)
    expect(args.slice(-3)).toEqual(['sh', '-c', 'npm test']);
    expect(args[0]).toBe('run');
    expect(args).toContain('--rm');
    expect(args).toContain('node:22');

    // bind mount + workdir
    const vIdx = args.indexOf('-v');
    expect(args[vIdx + 1]).toBe('/home/me/proj:/workspace');
    expect(args[args.indexOf('-w') + 1]).toBe('/workspace');

    // resource + network limits present
    expect(args[args.indexOf('--network') + 1]).toBe('bridge');
    expect(args[args.indexOf('--memory') + 1]).toBe('2g');
    expect(args[args.indexOf('--cpus') + 1]).toBe('2');
    expect(args).toContain('--pids-limit');
  });

  it('keeps a command with shell metacharacters intact as one arg (no injection)', () => {
    const cmd = 'rm -rf build && echo "done; $(whoami)"';
    const args = buildDockerArgs(baseConfig, cmd, '/p');
    expect(args[args.length - 1]).toBe(cmd);
    // exactly one occurrence of the command, after `sh -c`
    expect(args.filter(a => a === cmd)).toHaveLength(1);
  });

  it('honors network=none for maximum isolation', () => {
    const args = buildDockerArgs({ ...baseConfig, network: 'none' }, 'ls', '/p');
    expect(args[args.indexOf('--network') + 1]).toBe('none');
  });
});

describe('resolveSandboxConfig / isSandboxEnabled', () => {
  it('defaults to disabled with safe defaults when no config present', () => {
    vi.spyOn(GlobalConfig, 'get').mockReturnValue({} as any);
    const cfg = resolveSandboxConfig();
    expect(cfg.enabled).toBe(false);
    expect(cfg.image).toBe('ubuntu:24.04');
    expect(cfg.network).toBe('bridge');
    expect(isSandboxEnabled()).toBe(false);
  });

  it('merges a partial user config over the defaults', () => {
    vi.spyOn(GlobalConfig, 'get').mockReturnValue({
      sandboxConfig: { enabled: true, image: 'python:3.12' },
    } as any);
    const cfg = resolveSandboxConfig();
    expect(cfg.enabled).toBe(true);
    expect(cfg.image).toBe('python:3.12');
    expect(cfg.memory).toBe('2g'); // default preserved
    expect(isSandboxEnabled()).toBe(true);
  });
});
