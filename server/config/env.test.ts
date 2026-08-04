import { describe, expect, it } from 'vitest';
import { loadServerConfig } from './env.js';

describe('configuração do servidor', () => {
  it('aplica os padrões do Cognitive Core', () => {
    const config = loadServerConfig({ env: {}, loadDotEnv: false, cwd: 'C:\\lumia' });
    expect(config.ollamaModel).toBe('qwen3:8b');
    expect(config.ollamaNumCtx).toBe(8192);
    expect(config.initiativeEnabled).toBe(true);
    expect(config.cartesiaApiKey).toBe('');
  });

  it('rejeita valores inválidos sem incluir segredos', () => {
    expect(() =>
      loadServerConfig({ env: { OLLAMA_NUM_CTX: 'zero', CARTESIA_API_KEY: 'segredo' }, loadDotEnv: false }),
    ).toThrow('OLLAMA_NUM_CTX');
  });
});
