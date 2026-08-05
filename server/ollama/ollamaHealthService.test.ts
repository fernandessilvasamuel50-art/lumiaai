import { describe, expect, it } from 'vitest';
import { loadServerConfig } from '../config/env.js';
import type { OllamaProcessManager } from './ollamaProcessManager.js';
import { OllamaHealthService } from './ollamaHealthService.js';

describe('OllamaHealthService', () => {
  it('distingue modelo ausente de serviço desligado', async () => {
    const config = loadServerConfig({ env: {}, loadDotEnv: false });
    const service = new OllamaHealthService(config, processManager('C:\\ollama.exe'), fetchRoutes({ models: [] }));
    expect((await service.check()).state).toBe('model_missing');
    const offline = new OllamaHealthService(config, processManager(null), (async () => { throw new TypeError('offline'); }) as typeof fetch);
    expect((await offline.check()).state).toBe('executable_not_found');
  });

  it('classifica CPU, GPU e modo misto somente por size_vram real', async () => {
    const config = loadServerConfig({ env: {}, loadDotEnv: false });
    const cases = [
      { size: 100, size_vram: 0, state: 'ready_cpu' },
      { size: 100, size_vram: 100, state: 'ready_gpu' },
      { size: 100, size_vram: 60, state: 'ready_mixed' },
    ] as const;
    for (const item of cases) {
      const service = new OllamaHealthService(config, processManager('C:\\ollama.exe'), fetchRoutes({
        models: [{ name: 'qwen3:8b', size: 100 }], running: [{ name: 'qwen3:8b', size: item.size, size_vram: item.size_vram }],
      }));
      expect((await service.check()).state).toBe(item.state);
    }
  });

  it('recusa endpoint não local antes da rede', async () => {
    const config = loadServerConfig({ env: { OLLAMA_BASE_URL: 'https://example.com' }, loadDotEnv: false });
    const service = new OllamaHealthService(config, processManager(null), fetchRoutes({ models: [] }));
    expect((await service.check()).state).toBe('endpoint_invalid');
  });
});

function processManager(executable: string | null): OllamaProcessManager {
  return {
    state: { state: 'idle' },
    findExecutable: () => executable,
    start: async () => ({ startedByLumia: false, elapsedMs: 0 }),
    shutdown: () => undefined,
  } as unknown as OllamaProcessManager;
}

function fetchRoutes(input: { models: unknown[]; running?: unknown[] }): typeof fetch {
  return (async (request) => {
    const url = String(request);
    if (url.endsWith('/api/version')) return Response.json({ version: '0.32.5' });
    if (url.endsWith('/api/tags')) return Response.json({ models: input.models });
    if (url.endsWith('/api/ps')) return Response.json({ models: input.running ?? [] });
    return new Response(null, { status: 404 });
  }) as typeof fetch;
}
