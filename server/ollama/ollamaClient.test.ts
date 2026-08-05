import { describe, expect, it } from 'vitest';
import { loadServerConfig } from '../config/env.js';
import { OllamaClient } from './ollamaClient.js';

describe('OllamaClient', () => {
  const config = loadServerConfig({ env: {}, loadDotEnv: false });

  it('distingue timeout de geração de serviço indisponível', async () => {
    const fetcher = (async () => {
      throw new DOMException('tempo esgotado', 'TimeoutError');
    }) as typeof fetch;
    const client = new OllamaClient(config, fetcher);

    await expect(
      client.chatStructured([{ role: 'user', content: 'fixture' }], { type: 'object' }, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'ollama_timeout' });
  });

  it('mantém diagnóstico de indisponibilidade para falha de conexão', async () => {
    const fetcher = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    const client = new OllamaClient(config, fetcher);

    await expect(
      client.chatStructured([{ role: 'user', content: 'fixture' }], { type: 'object' }, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'ollama_unavailable' });
  });
});
