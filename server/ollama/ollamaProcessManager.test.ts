import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { loadServerConfig } from '../config/env.js';
import { findOllamaExecutable, OllamaProcessManager } from './ollamaProcessManager.js';

describe('OllamaProcessManager', () => {
  it('localiza PATH e local oficial sem aceitar comando do frontend', () => {
    const root = 'C:\\OllamaTest';
    const expected = path.join(root, 'ollama.exe');
    expect(findOllamaExecutable({ PATH: root }, (candidate) => candidate === expected, 'win32')).toBe(expected);
  });

  it('inicia somente ollama serve e aplica backoff limitado', async () => {
    const config = loadServerConfig({ env: { OLLAMA_HEALTH_RETRY_MS: '100' }, loadDotEnv: false });
    const sleeps: number[] = [];
    const calls: Array<{ executable: string; args: string[] }> = [];
    const child = fakeChild();
    const manager = new OllamaProcessManager(config, {
      fileExists: () => true,
      environment: { PATH: 'C:\\safe' },
      platform: 'win32',
      hasRunningProcess: async () => false,
      spawnProcess: (executable, args) => { calls.push({ executable, args }); return child; },
      sleep: async (ms) => { sleeps.push(ms); },
    });
    const health = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const result = await manager.start(health);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual(['serve']);
    expect(sleeps).toEqual([100]);
    expect(result.startedByLumia).toBe(true);
    manager.shutdown();
  });

  it('não abre processo duplicado quando um Ollama já existe', async () => {
    const config = loadServerConfig({ env: { OLLAMA_HEALTH_RETRY_MS: '100' }, loadDotEnv: false });
    const spawnProcess = vi.fn(() => fakeChild());
    const manager = new OllamaProcessManager(config, {
      fileExists: () => true, environment: { PATH: 'C:\\safe' }, platform: 'win32',
      hasRunningProcess: async () => true, spawnProcess, sleep: async () => undefined,
    });
    const health = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const result = await manager.start(health);
    expect(spawnProcess).not.toHaveBeenCalled();
    expect(result.startedByLumia).toBe(false);
  });
});

function fakeChild(): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  Object.assign(child, { pid: 1234, killed: false, stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(() => true) });
  return child;
}
