import { afterEach, describe, expect, it } from 'vitest';
import type { LumiaServerJsonMessage } from '../shared/protocol/index.js';
import type { CognitiveDecision } from '../shared/schemas/cognition.js';
import { loadServerConfig } from '../server/config/env.js';
import { MemoryRepository } from '../server/memory/memoryRepository.js';
import { TurnOrchestrator } from '../server/pipeline/turnOrchestrator.js';
import type { LlmSpeechSegment } from '../server/pipeline/speechSegmenter.js';

const decision: CognitiveDecision = {
  interpretation: 'fixture de integração',
  topic: 'teste',
  stance: { position: 'posição dinâmica', confidence: 0.8, previousOpinionId: null, relationshipToPrevious: 'new', changeReason: null },
  intention: 'responder',
  tone: 'natural',
  relevantMemoryIds: [],
  relevantOpenLoopIds: [],
  publicAction: 'respond',
};

describe('pipeline de turno', () => {
  const repositories: MemoryRepository[] = [];
  afterEach(() => repositories.splice(0).forEach((repository) => repository.close()));

  it('encadeia deliberação, stream do LLM, segmentos com origem e áudio', async () => {
    const repository = new MemoryRepository(':memory:');
    repositories.push(repository);
    const events: LumiaServerJsonMessage[] = [];
    const spoken: LlmSpeechSegment[] = [];
    const completed = deferred<void>();
    const config = loadServerConfig({ env: { CARTESIA_API_KEY: 'test-only' }, loadDotEnv: false });
    const orchestrator = new TurnOrchestrator(
      {
        config,
        repository,
        planner: { deliberate: async () => decision },
        generator: {
          stream: async (_input, _signal, onText) => {
            await onText('Resposta inédita. ');
            await onText('Continuação dinâmica.');
            return { evalCount: 8, evalDurationNs: 1_000_000_000, tokensPerSecond: 8 };
          },
        },
        consolidator: {
          consolidate: async () => ({ memoriesToCreate: [], memoriesToUpdate: [], opinionUpdate: null, openLoopsToCreate: [], openLoopsToResolve: [] }),
        },
        initiative: { evaluate: async () => ({ initiate: false, openLoopId: null, reason: 'fixture' }) },
        speechFactory: (_turnId, sampleRate, handlers) => ({
          outputFormat: { container: 'raw', encoding: 'pcm_f32le', sampleRate },
          open: async () => handlers.onStarted(),
          sendSegment: async (segment) => { spoken.push(segment); },
          finish: async () => undefined,
          waitForDone: async () => undefined,
          cancel: () => undefined,
        }),
      },
      {
        sendJson: (event) => {
          events.push(event);
          if (event.type === 'turn.completed') completed.resolve();
        },
        sendAudio: () => undefined,
      },
    );
    orchestrator.startUserTurn({ turnId: crypto.randomUUID(), message: 'mensagem sintética', sampleRate: 44100 });
    await completed.promise;

    expect(spoken.map((segment) => segment.text).join('')).toBe('Resposta inédita. Continuação dinâmica.');
    expect(spoken.every((segment) => segment.source === 'ollama_stream')).toBe(true);
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining([
      'turn.started', 'cognition.started', 'cognition.completed', 'llm.started', 'llm.first_token', 'llm.segment', 'tts.started', 'turn.completed',
    ]));
  });

  it('cancela geração e impede chunks tardios de chegar ao TTS', async () => {
    const repository = new MemoryRepository(':memory:');
    repositories.push(repository);
    const events: LumiaServerJsonMessage[] = [];
    const spoken: LlmSpeechSegment[] = [];
    const started = deferred<void>();
    const turnId = crypto.randomUUID();
    const config = loadServerConfig({ env: { CARTESIA_API_KEY: 'test-only' }, loadDotEnv: false });
    const orchestrator = new TurnOrchestrator(
      {
        config,
        repository,
        planner: { deliberate: async () => decision },
        generator: {
          stream: async (_input, signal, onText) => {
            started.resolve();
            await onText('Parcial sem término');
            await new Promise<void>((resolve, reject) => {
              signal.addEventListener('abort', () => reject(signal.reason), { once: true });
              setTimeout(resolve, 500);
            });
            await onText(' chunk atrasado.');
            return {};
          },
        },
        consolidator: { consolidate: async () => ({ memoriesToCreate: [], memoriesToUpdate: [], opinionUpdate: null, openLoopsToCreate: [], openLoopsToResolve: [] }) },
        initiative: { evaluate: async () => ({ initiate: false, openLoopId: null, reason: 'fixture' }) },
        speechFactory: (_id, sampleRate, handlers) => ({
          outputFormat: { container: 'raw', encoding: 'pcm_f32le', sampleRate },
          open: async () => handlers.onStarted(), sendSegment: async (segment) => { spoken.push(segment); },
          finish: async () => undefined, waitForDone: async () => undefined, cancel: () => undefined,
        }),
      },
      { sendJson: (event) => events.push(event), sendAudio: () => undefined },
    );
    orchestrator.startUserTurn({ turnId, message: 'cancelar', sampleRate: 44100 });
    await started.promise;
    orchestrator.cancel(turnId);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(events.some((event) => event.type === 'turn.cancelled')).toBe(true);
    expect(spoken.map((segment) => segment.text).join('')).not.toContain('atrasado');
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
