import { afterEach, describe, expect, it } from 'vitest';
import type { CognitiveBudget, LumiaServerJsonMessage } from '../shared/protocol/index.js';
import type { CognitiveDecision, CognitiveFrame, TurnConsolidation } from '../shared/schemas/cognition.js';
import { CognitiveModeSelector } from '../server/cognition/cognitiveModeSelector.js';
import { loadServerConfig } from '../server/config/env.js';
import { LocalKnowledgeProvider } from '../server/knowledge/localKnowledgeProvider.js';
import { MemoryRepository } from '../server/memory/memoryRepository.js';
import { OllamaClient, type OllamaStreamChunk } from '../server/ollama/ollamaClient.js';
import { TurnOrchestrator } from '../server/pipeline/turnOrchestrator.js';
import type { GeneratedSpeechSegment } from '../server/speech/generatedSpeechText.js';

const budget: CognitiveBudget = {
  contextTokenBudget: 1800,
  contextCharacterBudget: 7200,
  decisionTokenLimit: 500,
  responseTokenLimit: 300,
  retrievalDepth: 'minimal',
  criticalReview: false,
  responseTemperature: 0.5,
  timeoutMs: 120000,
};

describe('pipeline cognitivo completo', () => {
  const repositories: MemoryRepository[] = [];
  afterEach(() => repositories.splice(0).forEach((repository) => repository.close()));

  it('usa caminho rápido, estados válidos, proveniência e consolidação', async () => {
    const repository = new MemoryRepository(':memory:');
    repositories.push(repository);
    const events: LumiaServerJsonMessage[] = [];
    const spoken: GeneratedSpeechSegment[] = [];
    const completed = deferred<void>();
    const turnId = crypto.randomUUID();
    const chunks = await authenticChunks(turnId, ['Resposta inédita. ', 'Continuação dinâmica.']);
    const orchestrator = createOrchestrator(repository, turnId, chunks, events, spoken, completed);
    orchestrator.startUserTurn({ turnId, message: 'mensagem sintética', sampleRate: 44100 });
    await completed.promise;

    expect(spoken.map((segment) => segment.text).join('')).toBe('Resposta inédita. Continuação dinâmica.');
    expect(spoken.every((segment) => segment.provenance.source === 'ollama_stream')).toBe(true);
    const states = events.filter((event) => event.type === 'turn.state').map((event) => event.state);
    expect(states).toEqual(['RECEIVED', 'PERCEIVING', 'RETRIEVING', 'DELIBERATING', 'GENERATING', 'SPEAKING', 'CONSOLIDATING', 'COMPLETED']);
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining([
      'cognition.perceived', 'cognition.completed', 'llm.first_token', 'speech.provenance', 'tts.started', 'memory.consolidated', 'turn.completed',
    ]));
  });

  it('cancela durante geração e rejeita chunk tardio', async () => {
    const repository = new MemoryRepository(':memory:');
    repositories.push(repository);
    const events: LumiaServerJsonMessage[] = [];
    const spoken: GeneratedSpeechSegment[] = [];
    const started = deferred<void>();
    const turnId = crypto.randomUUID();
    const chunks = await authenticChunks(turnId, ['Parcial sem término', ' chunk atrasado.']);
    const config = loadServerConfig({ env: { CARTESIA_API_KEY: 'test-only' }, loadDotEnv: false });
    const frame = frameFixture(turnId);
    const orchestrator = new TurnOrchestrator(
      baseDependencies(repository, config, frame, decisionFixture(turnId), {
        stream: async (_input, signal, onChunk) => {
          await onChunk(chunks[0]!);
          started.resolve();
          await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
          await onChunk(chunks[1]!);
          return {};
        },
      }),
      { sendJson: (event) => events.push(event), sendAudio: () => undefined },
    );
    orchestrator.startUserTurn({ turnId, message: 'cancelar', sampleRate: 44100 });
    await started.promise;
    orchestrator.cancel(turnId);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(events.some((event) => event.type === 'turn.cancelled')).toBe(true);
    expect(events.filter((event) => event.type === 'turn.state').at(-1)).toMatchObject({ state: 'CANCELLED' });
    expect(spoken.map((segment) => segment.text).join('')).not.toContain('atrasado');
  });

  it('usa caminho profundo e libera somente a versão revisada', async () => {
    const repository = new MemoryRepository(':memory:');
    repositories.push(repository);
    const events: LumiaServerJsonMessage[] = [];
    const spoken: GeneratedSpeechSegment[] = [];
    const completed = deferred<void>();
    const turnId = crypto.randomUUID();
    const candidate = await authenticChunks(turnId, ['Candidato técnico.']);
    const revised = await authenticChunks(turnId, ['Versão tecnicamente revisada.']);
    const config = loadServerConfig({ env: { CARTESIA_API_KEY: 'test-only' }, loadDotEnv: false });
    let generation = 0;
    const dependencies = baseDependencies(repository, config, frameFixture(turnId), decisionFixture(turnId), {
      stream: async (_input, _signal, onChunk) => {
        generation += 1;
        for (const chunk of generation === 1 ? candidate : revised) await onChunk(chunk);
        return {};
      },
    });
    const orchestrator = new TurnOrchestrator({
      ...dependencies,
      budgetController: { select: () => ({ ...budget, criticalReview: true, retrievalDepth: 'deep' as const }) },
      reviewer: { review: async () => ({
        addressesUserGoal: true, contradictsKnownMemory: false, unsupportedCertainty: true,
        missedCriticalAssumption: false, unnecessarilyVerbose: false, requiresRevision: true,
        revisionInstruction: 'Remover a certeza não sustentada.',
      }) },
      speechFactory: (_id, sampleRate, handlers) => ({
        outputFormat: { container: 'raw', encoding: 'pcm_f32le', sampleRate }, open: async () => handlers.onStarted(),
        sendSegment: async (segment) => { spoken.push(segment); }, finish: async () => undefined,
        waitForDone: async () => undefined, cancel: () => undefined,
      }),
    }, {
      sendJson: (event) => { events.push(event); if (event.type === 'turn.completed') completed.resolve(); },
      sendAudio: () => undefined,
    });
    orchestrator.startUserTurn({ turnId, message: 'problema técnico sintético', sampleRate: 44100 });
    await completed.promise;
    expect(generation).toBe(2);
    expect(spoken.map((segment) => segment.text).join('')).toContain('revisada');
    expect(spoken.map((segment) => segment.text).join('')).not.toContain('Candidato');
    expect(events.some((event) => event.type === 'response.reviewed')).toBe(true);
  });

  function createOrchestrator(
    repository: MemoryRepository,
    turnId: string,
    chunks: OllamaStreamChunk[],
    events: LumiaServerJsonMessage[],
    spoken: GeneratedSpeechSegment[],
    completed: ReturnType<typeof deferred<void>>,
  ) {
    const config = loadServerConfig({ env: { CARTESIA_API_KEY: 'test-only' }, loadDotEnv: false });
    return new TurnOrchestrator(
      {
        ...baseDependencies(repository, config, frameFixture(turnId), decisionFixture(turnId), {
          stream: async (_input, _signal, onChunk) => {
            for (const chunk of chunks) await onChunk(chunk);
            return { evalCount: 8, evalDurationNs: 1_000_000_000, tokensPerSecond: 8 };
          },
        }),
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
  }
});

function baseDependencies(
  repository: MemoryRepository,
  config: ReturnType<typeof loadServerConfig>,
  frame: CognitiveFrame,
  decision: CognitiveDecision,
  generator: { stream: (input: unknown, signal: AbortSignal, onChunk: (chunk: OllamaStreamChunk) => void | Promise<void>) => Promise<Record<string, number | undefined>> },
) {
  return {
    config,
    repository,
    interpreter: { interpret: async () => frame },
    modeSelector: new CognitiveModeSelector(),
    budgetController: { select: () => budget },
    knowledgeProvider: new LocalKnowledgeProvider(repository),
    deliberator: { deliberate: async () => decision },
    generator,
    reviewer: { review: async () => ({ addressesUserGoal: true, contradictsKnownMemory: false, unsupportedCertainty: false, missedCriticalAssumption: false, unnecessarilyVerbose: false, requiresRevision: false, revisionInstruction: null }) },
    consolidator: { consolidate: async () => emptyConsolidation() },
    initiative: { evaluate: async () => ({ initiate: false, openLoopId: null, reason: 'fixture técnica' }) },
    speechFactory: (_turnId: string, sampleRate: number, handlers: { onStarted: () => void }) => ({
      outputFormat: { container: 'raw' as const, encoding: 'pcm_f32le' as const, sampleRate },
      open: async () => handlers.onStarted(), sendSegment: async () => undefined, finish: async () => undefined,
      waitForDone: async () => undefined, cancel: () => undefined,
    }),
  };
}

function frameFixture(turnId: string): CognitiveFrame {
  return {
    version: 1,
    turnId,
    interpretation: { literalRequest: 'conversar', probableGoal: 'obter resposta', impliedNeed: null, topic: 'teste', subtopics: [], entities: [] },
    conversation: { mode: 'casual_dialogue', continuationOfPrevious: false, referencedMessageIds: [], expectedDepth: 'brief' },
    humanContext: { emotionalSignals: [], emotionalConfidence: 0, urgency: 'low', stakes: 'low', relationshipRelevant: false },
    ambiguity: { level: 'none', missingInformation: [], canProvideUsefulPartialAnswer: true, clarificationNecessary: false },
    knowledge: { assessment: 'known', timeSensitive: false, verificationDesirable: false, unsupportedAssumptions: [] },
    memory: { retrievalQueries: ['teste'], desiredMemoryTypes: [], previousOpinionRelevant: false, openLoopsRelevant: false },
  };
}

function decisionFixture(turnId: string): CognitiveDecision {
  return {
    turnId,
    mode: 'casual_dialogue',
    understanding: { userGoal: 'obter resposta', mostImportantPoint: 'responder diretamente', assumptions: [] },
    stance: { necessary: false, position: null, confidence: 0.8, priorOpinionId: null, relationToPrior: 'not_applicable', changeReason: null },
    responseStrategy: { primaryAction: 'answer', answerFirst: true, depth: 'brief', useSteps: false, mentionUncertainty: false, askQuestion: false, questionReason: null },
    knowledgeUse: { memoryIds: [], opinionIds: [], openLoopIds: [], lessonIds: [], claimsNeedingCare: [] },
    tone: { warmth: 0.5, directness: 0.6, seriousness: 0.4, humor: 0.2, challenge: 0.1 },
    verification: { criticalReviewRequired: false, reason: null },
  };
}

function emptyConsolidation(): TurnConsolidation {
  return {
    memoriesToCreate: [], memoriesToRevise: [], opinionsToCreate: [], opinionsToRevise: [], lessonsToCreate: [],
    lessonsToRevise: [], openLoopsToCreate: [], openLoopsToResolve: [], selfModelUpdate: null,
  };
}

async function authenticChunks(turnId: string, texts: string[]): Promise<OllamaStreamChunk[]> {
  const body = [...texts.map((text) => JSON.stringify({ message: { role: 'assistant', content: text } })), JSON.stringify({ done: true })].join('\n') + '\n';
  const config = loadServerConfig({ env: {}, loadDotEnv: false });
  const client = new OllamaClient(config, (async () => new Response(body, { status: 200 })) as typeof fetch);
  const chunks: OllamaStreamChunk[] = [];
  await client.streamChat([], turnId, new AbortController().signal, (chunk) => { chunks.push(chunk); });
  return chunks;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
