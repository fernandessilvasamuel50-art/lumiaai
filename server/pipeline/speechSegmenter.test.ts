import { describe, expect, it } from 'vitest';
import { loadServerConfig } from '../config/env.js';
import { OllamaClient, type OllamaStreamChunk } from '../ollama/ollamaClient.js';
import { GeneratedSpeechStream } from '../speech/generatedSpeechText.js';

describe('GeneratedSpeechStream', () => {
  it('segmenta somente chunks autenticados e preserva proveniência', async () => {
    const turnId = crypto.randomUUID();
    const chunks = await authenticChunks(turnId, ['Primeira frase. ', 'Segunda frase completa.']);
    const controller = new AbortController();
    const stream = new GeneratedSpeechStream({ turnId, model: 'qwen3:8b', signal: controller.signal, isCurrent: () => true });
    const segments = chunks.flatMap((chunk) => stream.push(chunk)).concat(stream.flush());
    expect(segments.map((segment) => segment.text).join('')).toBe('Primeira frase. Segunda frase completa.');
    expect(segments.every((segment) => segment.provenance.source === 'ollama_stream')).toBe(true);
    expect(segments.flatMap((segment) => segment.provenance.chunkSequence)).toEqual(expect.arrayContaining([1, 2]));
  });

  it('rejeita literal forjado e turno cancelado', async () => {
    const turnId = crypto.randomUUID();
    const [chunk] = await authenticChunks(turnId, ['Texto.']);
    const controller = new AbortController();
    const stream = new GeneratedSpeechStream({ turnId, model: 'qwen3:8b', signal: controller.signal, isCurrent: () => true });
    expect(() => stream.push({ source: 'ollama_stream', turnId, model: 'qwen3:8b', sequence: 1, text: 'literal' } as OllamaStreamChunk)).toThrow('autenticação');
    controller.abort();
    expect(() => stream.push(chunk!)).toThrow('cancelado');
  });
});

async function authenticChunks(turnId: string, texts: string[]): Promise<OllamaStreamChunk[]> {
  const lines = [
    ...texts.map((text) => JSON.stringify({ message: { role: 'assistant', content: text }, done: false })),
    JSON.stringify({ done: true, eval_count: 4, eval_duration: 1_000_000_000 }),
  ].join('\n') + '\n';
  const config = loadServerConfig({ env: {}, loadDotEnv: false });
  const client = new OllamaClient(config, (async () => new Response(lines, { status: 200 })) as typeof fetch);
  const chunks: OllamaStreamChunk[] = [];
  await client.streamChat([], turnId, new AbortController().signal, (chunk) => { chunks.push(chunk); });
  return chunks;
}
