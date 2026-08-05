import { describe, expect, it } from 'vitest';
import { loadServerConfig } from '../config/env.js';
import { OllamaClient } from './ollamaClient.js';

describe('OllamaClient', () => {
  const config = loadServerConfig({ env: {}, loadDotEnv: false });

  it('classifica timeout de carga quando o modelo ainda não está em execução', async () => {
    const fetcher = (async () => { throw new DOMException('tempo esgotado', 'TimeoutError'); }) as typeof fetch;
    const client = new OllamaClient(config, fetcher);
    await expect(
      client.chatStructured([{ role: 'user', content: 'fixture' }], { type: 'object' }, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'OLLAMA_MODEL_LOAD_FAILED' });
  });

  it('mantém diagnóstico de indisponibilidade para falha de conexão', async () => {
    const fetcher = (async () => { throw new TypeError('fetch failed'); }) as typeof fetch;
    const client = new OllamaClient(config, fetcher);
    await expect(
      client.chatStructured([{ role: 'user', content: 'fixture' }], { type: 'object' }, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'OLLAMA_SERVICE_OFFLINE' });
  });

  it('classifica timeout como geração quando /api/ps comprova modelo carregado', async () => {
    const fetcher = (async (request) => {
      if (String(request).endsWith('/api/ps')) return Response.json({ models: [{ name: 'qwen3:8b' }] });
      throw new DOMException('tempo esgotado', 'TimeoutError');
    }) as typeof fetch;
    const client = new OllamaClient(config, fetcher);
    await expect(
      client.chatStructured([{ role: 'user', content: 'fixture' }], { type: 'object' }, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'OLLAMA_STREAM_FAILED' });
  });
});
