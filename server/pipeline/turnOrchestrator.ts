import { randomUUID } from 'node:crypto';
import type {
  AudioOutputFormat,
  LumiaServerJsonMessage,
  TurnPerformanceMetrics,
} from '../../shared/protocol/index.js';
import { OUTPUT_CONTAINER, OUTPUT_ENCODING } from '../../shared/protocol/index.js';
import type { ResponseReview } from '../../shared/schemas/cognition.js';
import { CartesiaSpeechStream } from '../cartesia/cartesiaStream.js';
import type { CognitiveBudgetController } from '../cognition/cognitiveBudgetController.js';
import type { CognitiveModeSelector } from '../cognition/cognitiveModeSelector.js';
import { CognitiveStateMachine } from '../cognition/cognitiveStateMachine.js';
import type { DeliberationService } from '../cognition/deliberationService.js';
import type { ResponseGenerator } from '../cognition/responseGenerator.js';
import type { ResponseReviewer } from '../cognition/responseReviewer.js';
import type { SituationInterpreter } from '../cognition/situationInterpreter.js';
import type { TurnConsolidator } from '../cognition/turnConsolidator.js';
import type { ServerConfig } from '../config/env.js';
import type { TurnPromptInput } from '../config/lumiaPromptBuilder.js';
import type { InitiativeService } from '../initiative/initiativeService.js';
import type { KnowledgeProvider } from '../knowledge/knowledgeProvider.js';
import type { MemoryRepository } from '../memory/memoryRepository.js';
import type { OllamaGenerationMetrics, OllamaStreamChunk } from '../ollama/ollamaClient.js';
import { GeneratedSpeechStream, type GeneratedSpeechSegment } from '../speech/generatedSpeechText.js';
import type { SpeechGateway } from '../speech/speechGateway.js';

export type TurnTransport = {
  sendJson(message: LumiaServerJsonMessage): void;
  sendAudio(frame: Uint8Array): void;
};

type ActiveTurn = {
  turnId: string;
  controller: AbortController;
  stateMachine: CognitiveStateMachine;
  speechText: GeneratedSpeechStream;
  tts?: SpeechGateway;
  fullText: string;
  assistantStored: boolean;
  startedAt: number;
  metrics: TurnPerformanceMetrics;
};

type OrchestratorDependencies = {
  config: ServerConfig;
  repository: MemoryRepository;
  interpreter: Pick<SituationInterpreter, 'interpret'>;
  modeSelector: Pick<CognitiveModeSelector, 'select'>;
  budgetController: Pick<CognitiveBudgetController, 'select'>;
  knowledgeProvider: KnowledgeProvider;
  deliberator: Pick<DeliberationService, 'deliberate'>;
  generator: Pick<ResponseGenerator, 'stream'>;
  reviewer: Pick<ResponseReviewer, 'review'>;
  consolidator: Pick<TurnConsolidator, 'consolidate'>;
  initiative: Pick<InitiativeService, 'evaluate'>;
  speechFactory?: (
    turnId: string,
    sampleRate: number,
    handlers: { onStarted: () => void; onFirstAudio: () => void; onAudio: (frame: Uint8Array) => void; onError: (error: Error) => void },
    isCurrent: () => boolean,
  ) => SpeechGateway;
};

export class TurnOrchestrator {
  private active?: ActiveTurn;
  private initiativeController?: AbortController;
  private lastActivityAt = Date.now();

  constructor(private readonly dependencies: OrchestratorDependencies, private readonly transport: TurnTransport) {}

  get isActive(): boolean {
    return Boolean(this.active || this.initiativeController);
  }

  get millisecondsSinceActivity(): number {
    return Date.now() - this.lastActivityAt;
  }

  startUserTurn(input: { turnId: string; message: string; sampleRate: number }): void {
    this.lastActivityAt = Date.now();
    this.initiativeController?.abort(new DOMException('Avaliação interrompida por atividade.', 'AbortError'));
    this.initiativeController = undefined;
    this.cancelActive();
    void this.runTurn({ ...input, origin: 'user' });
  }

  cancel(turnId?: string): void {
    if (!this.active || (turnId && this.active.turnId !== turnId)) return;
    this.lastActivityAt = Date.now();
    this.cancelActive();
  }

  touchActivity(): void {
    this.lastActivityAt = Date.now();
  }

  markPlaybackStarted(turnId: string, elapsedMs: number): void {
    if (!this.active || this.active.turnId !== turnId) return;
    this.active.metrics.playbackStartMs = elapsedMs;
    this.emitTurn(turnId, { type: 'playback.started', elapsedMs });
  }

  async evaluateInitiative(requestId: string, sampleRate: number): Promise<void> {
    if (this.active || this.initiativeController) {
      this.transport.sendJson({ type: 'initiative.evaluated', requestId, initiate: false, reason: 'Existe um turno ativo; avaliação adiada.', at: timestamp() });
      return;
    }
    const loops = this.dependencies.repository.getOpenLoops(8, this.dependencies.config.initiativeIdleMinutes);
    if (!loops.length) {
      this.transport.sendJson({ type: 'initiative.evaluated', requestId, initiate: false, reason: 'Não há assuntos pendentes elegíveis.', at: timestamp() });
      return;
    }
    const controller = new AbortController();
    this.initiativeController = controller;
    try {
      const decision = await this.dependencies.initiative.evaluate(loops, controller.signal);
      if (controller.signal.aborted || this.active) return;
      const turnId = decision.initiate ? randomUUID() : undefined;
      this.transport.sendJson({ type: 'initiative.evaluated', requestId, ...decision, turnId, at: timestamp() });
      if (!decision.initiate || !decision.openLoopId || !turnId) return;
      const selected = loops.find((loop) => loop.id === decision.openLoopId);
      if (!selected) return;
      this.lastActivityAt = Date.now();
      this.dependencies.repository.markInitiativeAttempt(selected.id);
      void this.runTurn({ turnId, message: `${selected.topic}: ${selected.description}`, sampleRate, origin: 'initiative' });
    } catch (error) {
      if (!controller.signal.aborted) this.sendError(undefined, 'TURN_FAILED', error);
    } finally {
      if (this.initiativeController === controller) this.initiativeController = undefined;
    }
  }

  private async runTurn(input: { turnId: string; message: string; sampleRate: number; origin: 'user' | 'initiative' }): Promise<void> {
    const controller = new AbortController();
    const stateMachine = new CognitiveStateMachine(input.turnId, input.origin, (transition) => {
      this.emitTurn(input.turnId, { type: 'turn.state', state: transition.state, previousState: transition.previousState });
    });
    const active = {} as ActiveTurn;
    Object.assign(active, {
      turnId: input.turnId,
      controller,
      stateMachine,
      fullText: '',
      assistantStored: false,
      startedAt: performance.now(),
      metrics: {},
    });
    active.speechText = new GeneratedSpeechStream({
      turnId: input.turnId,
      model: this.dependencies.config.ollamaModel,
      signal: controller.signal,
      isCurrent: () => this.active === active,
    });
    this.active = active;
    const outputFormat: AudioOutputFormat = { container: OUTPUT_CONTAINER, encoding: OUTPUT_ENCODING, sampleRate: input.sampleRate };
    this.emitTurn(input.turnId, { type: 'turn.started', origin: input.origin, outputFormat });
    stateMachine.announce();

    let userMessageId: string | undefined;
    try {
      const recentMessages = this.dependencies.repository.getRecentMessages();
      if (input.origin === 'user') {
        userMessageId = this.dependencies.repository.addMessage({ turnId: input.turnId, role: 'user', content: input.message, source: 'typed' });
      }

      stateMachine.transition('PERCEIVING');
      const perceptionStarted = performance.now();
      const frame = await this.dependencies.interpreter.interpret({
        turnId: input.turnId,
        currentMessage: input.message,
        origin: input.origin,
        recentMessages,
      }, controller.signal);
      this.assertCurrent(active);
      active.metrics.perceptionMs = performance.now() - perceptionStarted;
      this.dependencies.repository.storeFrame(input.turnId, frame);
      this.emitTurn(input.turnId, { type: 'cognition.perceived', frame, perceptionMs: active.metrics.perceptionMs });

      const profile = this.dependencies.modeSelector.select(frame);
      const budget = this.dependencies.budgetController.select(frame, profile);
      stateMachine.transition('RETRIEVING');
      const retrievalStarted = performance.now();
      if (!(await this.dependencies.knowledgeProvider.canHandle({
        turnId: input.turnId,
        queries: frame.memory.retrievalQueries,
        memoryTypes: frame.memory.desiredMemoryTypes,
        topic: frame.interpretation.topic,
        frame,
        budget,
      }))) throw new Error('Nenhum provedor local aceitou a recuperação.');
      const knowledge = await this.dependencies.knowledgeProvider.retrieve({
        turnId: input.turnId,
        queries: frame.memory.retrievalQueries,
        memoryTypes: frame.memory.desiredMemoryTypes,
        topic: frame.interpretation.topic,
        frame,
        budget,
      });
      const context = knowledge.context;
      const selfModel = this.dependencies.repository.getSelfModel();
      active.metrics.memoryRetrievalMs = performance.now() - retrievalStarted;

      stateMachine.transition('DELIBERATING');
      const deliberationStarted = performance.now();
      const decision = await this.dependencies.deliberator.deliberate({
        currentMessage: input.message,
        frame,
        context,
        selfModel,
        profile,
        budget,
        origin: input.origin,
      }, controller.signal);
      this.assertCurrent(active);
      active.metrics.deliberationMs = performance.now() - deliberationStarted;
      this.dependencies.repository.storeDecision(input.turnId, decision);
      this.emitTurn(input.turnId, { type: 'cognition.completed', decision, frame, context, selfModel, budget, deliberationMs: active.metrics.deliberationMs });

      if (decision.responseStrategy.primaryAction === 'silence') {
        stateMachine.transition('COMPLETED');
        active.metrics.totalMs = performance.now() - active.startedAt;
        this.dependencies.repository.storeMetrics(input.turnId, active.metrics, 'completed_silence');
        this.emitTurn(input.turnId, { type: 'turn.completed', transcript: '', metrics: active.metrics, durationMs: active.metrics.totalMs });
        this.clearIfCurrent(active);
        return;
      }
      if (decision.responseStrategy.primaryAction === 'clarify' && frame.ambiguity.clarificationNecessary) {
        stateMachine.transition('WAITING_FOR_CLARIFICATION');
      }

      stateMachine.transition('GENERATING');
      const tts = this.createSpeechStream(input.turnId, input.sampleRate, active);
      active.tts = tts;
      await tts.open(controller.signal);
      this.assertCurrent(active);
      this.emitTurn(input.turnId, { type: 'llm.started', model: this.dependencies.config.ollamaModel });

      const promptInput: TurnPromptInput = {
        turnId: input.turnId,
        currentMessage: input.message,
        frame,
        context,
        decision,
        budget,
        selfModel,
        origin: input.origin,
      };
      const criticalReview = budget.criticalReview || decision.verification.criticalReviewRequired;
      const llmMetrics = criticalReview
        ? await this.generateReviewed(active, promptInput)
        : await this.generateStreaming(active, promptInput);
      this.assertCurrent(active);
      for (const segment of active.speechText.flush()) await this.forwardSegment(active, segment);
      if (!active.fullText.trim()) throw new Error('O Ollama concluiu o turno sem produzir fala pública.');
      await tts.finish();

      active.metrics.modelLoadMs = nsToMs(llmMetrics.loadDurationNs);
      active.metrics.tokensPerSecond = llmMetrics.tokensPerSecond;
      active.metrics.evalCount = llmMetrics.evalCount;
      const assistantMessageId = this.dependencies.repository.addMessage({
        turnId: input.turnId,
        role: 'assistant',
        content: active.fullText,
        source: input.origin === 'initiative' ? 'initiative' : 'ollama_stream',
      });
      active.assistantStored = true;

      stateMachine.transition('CONSOLIDATING');
      const consolidationPromise = this.consolidateAfterResponse({
        active, promptInput, userMessageId, assistantMessageId,
      });
      await tts.waitForDone();
      this.assertCurrent(active);
      await consolidationPromise;
      this.assertCurrent(active);
      active.metrics.totalMs = performance.now() - active.startedAt;
      this.dependencies.repository.storeMetrics(input.turnId, active.metrics, 'completed');
      stateMachine.transition('COMPLETED');
      this.emitTurn(input.turnId, { type: 'turn.completed', transcript: active.fullText, metrics: active.metrics, durationMs: active.metrics.totalMs });
      this.clearIfCurrent(active);
    } catch (error) {
      if (controller.signal.aborted && isAbort(controller.signal.reason)) return;
      const effectiveError = controller.signal.aborted ? controller.signal.reason : error;
      active.tts?.cancel();
      active.speechText.cancel();
      if (active.fullText && !active.assistantStored) {
        this.dependencies.repository.addMessage({ turnId: input.turnId, role: 'assistant', content: active.fullText, source: 'ollama_stream', interrupted: true });
      }
      active.metrics.totalMs = performance.now() - active.startedAt;
      this.dependencies.repository.storeMetrics(input.turnId, active.metrics, 'error');
      stateMachine.fail();
      this.sendError(input.turnId, classifyError(effectiveError), effectiveError);
      this.clearIfCurrent(active);
    }
  }

  private async generateStreaming(active: ActiveTurn, input: TurnPromptInput, revision?: { previousResponse: string; review: ResponseReview }): Promise<OllamaGenerationMetrics> {
    let sawFirstToken = false;
    return this.dependencies.generator.stream(input, active.controller.signal, async (chunk) => {
      this.assertCurrent(active);
      if (!sawFirstToken) {
        sawFirstToken = true;
        active.metrics.firstTokenMs = performance.now() - active.startedAt;
        this.emitTurn(active.turnId, { type: 'llm.first_token', elapsedMs: active.metrics.firstTokenMs });
      }
      active.fullText += chunk.text;
      for (const segment of active.speechText.push(chunk)) await this.forwardSegment(active, segment);
    }, revision);
  }

  private async generateReviewed(active: ActiveTurn, input: TurnPromptInput): Promise<OllamaGenerationMetrics> {
    const buffered: OllamaStreamChunk[] = [];
    let candidate = '';
    const candidateMetrics = await this.dependencies.generator.stream(input, active.controller.signal, (chunk) => {
      this.assertCurrent(active);
      buffered.push(chunk);
      candidate += chunk.text;
    });
    this.assertCurrent(active);
    const reviewStarted = performance.now();
    const review = await this.dependencies.reviewer.review(input, candidate, active.controller.signal);
    active.metrics.reviewMs = performance.now() - reviewStarted;
    this.dependencies.repository.storeReview(active.turnId, review, review.requiresRevision);
    this.emitTurn(active.turnId, { type: 'response.reviewed', review, reviewMs: active.metrics.reviewMs, revised: review.requiresRevision });
    if (review.requiresRevision) {
      return this.generateStreaming(active, input, { previousResponse: candidate, review });
    }
    active.metrics.firstTokenMs = performance.now() - active.startedAt;
    this.emitTurn(active.turnId, { type: 'llm.first_token', elapsedMs: active.metrics.firstTokenMs });
    active.fullText = candidate;
    for (const chunk of buffered) {
      for (const segment of active.speechText.push(chunk)) await this.forwardSegment(active, segment);
    }
    return candidateMetrics;
  }

  private createSpeechStream(turnId: string, sampleRate: number, active: ActiveTurn): SpeechGateway {
    const handlers = {
      onStarted: () => this.emitTurn(turnId, { type: 'tts.started' }),
      onFirstAudio: () => {
        if (this.active !== active) return;
        active.metrics.firstAudioMs = performance.now() - active.startedAt;
        this.emitTurn(turnId, { type: 'tts.first_audio', elapsedMs: active.metrics.firstAudioMs });
      },
      onAudio: (frame: Uint8Array) => {
        if (this.active === active) this.transport.sendAudio(frame);
      },
      onError: (error: Error) => {
        if (this.active === active && !active.controller.signal.aborted) active.controller.abort(error);
      },
    };
    const isCurrent = () => this.active === active && !active.controller.signal.aborted;
    return this.dependencies.speechFactory
      ? this.dependencies.speechFactory(turnId, sampleRate, handlers, isCurrent)
      : new CartesiaSpeechStream(this.dependencies.config, turnId, sampleRate, handlers, isCurrent);
  }

  private async forwardSegment(active: ActiveTurn, segment: GeneratedSpeechSegment): Promise<void> {
    if (!active.tts) throw new Error('Canal de voz não inicializado.');
    this.assertCurrent(active);
    if (active.stateMachine.state === 'GENERATING') active.stateMachine.transition('SPEAKING');
    if (active.metrics.firstSegmentMs === undefined) active.metrics.firstSegmentMs = performance.now() - active.startedAt;
    this.emitTurn(active.turnId, { type: 'llm.segment', text: segment.text, elapsedMs: performance.now() - active.startedAt });
    this.emitTurn(active.turnId, { type: 'speech.provenance', provenance: segment.provenance });
    await active.tts.sendSegment(segment);
  }

  private async consolidateAfterResponse(input: {
    active: ActiveTurn;
    promptInput: TurnPromptInput;
    userMessageId?: string;
    assistantMessageId: string;
  }): Promise<void> {
    const started = performance.now();
    try {
      const consolidation = await this.dependencies.consolidator.consolidate({
        ...input.promptInput,
        userMessageId: input.userMessageId,
        assistantMessageId: input.assistantMessageId,
        assistantMessage: input.active.fullText,
      }, input.active.controller.signal);
      if (input.active.controller.signal.aborted) return;
      const validIds = [input.userMessageId, input.assistantMessageId].filter((id): id is string => Boolean(id));
      this.dependencies.repository.storeConsolidation(input.active.turnId, consolidation);
      const summary = this.dependencies.repository.applyConsolidation(consolidation, validIds);
      input.active.metrics.consolidationMs = performance.now() - started;
      this.emitTurn(input.active.turnId, { type: 'memory.consolidated', summary, consolidationMs: input.active.metrics.consolidationMs });
    } catch (error) {
      if (!input.active.controller.signal.aborted) this.sendError(input.active.turnId, 'MEMORY_RETRIEVAL_FAILED', error);
    }
  }

  private cancelActive(): void {
    const active = this.active;
    if (!active) return;
    active.stateMachine.cancel();
    active.controller.abort(new DOMException('Turno interrompido.', 'AbortError'));
    active.speechText.cancel();
    active.tts?.cancel();
    if (active.fullText && !active.assistantStored) {
      this.dependencies.repository.addMessage({ turnId: active.turnId, role: 'assistant', content: active.fullText, source: 'ollama_stream', interrupted: true });
      active.assistantStored = true;
    }
    active.metrics.totalMs = performance.now() - active.startedAt;
    this.dependencies.repository.storeMetrics(active.turnId, active.metrics, 'cancelled');
    this.emitTurn(active.turnId, { type: 'turn.cancelled' });
    this.active = undefined;
  }

  private assertCurrent(active: ActiveTurn): void {
    if (active.controller.signal.aborted || this.active !== active) {
      throw active.controller.signal.reason ?? new DOMException('Turno obsoleto.', 'AbortError');
    }
  }

  private clearIfCurrent(active: ActiveTurn): void {
    if (this.active === active) this.active = undefined;
  }

  private emitTurn<T extends Omit<LumiaServerJsonMessage, 'turnId' | 'at'>>(turnId: string, message: T): void {
    this.transport.sendJson({ ...message, turnId, at: timestamp() } as LumiaServerJsonMessage);
  }

  private sendError(turnId: string | undefined, code: string, error: unknown): void {
    const message = error instanceof Error ? error.message : 'Erro técnico desconhecido.';
    const details = error instanceof Error && 'technicalMessage' in error && typeof error.technicalMessage === 'string'
      ? error.technicalMessage
      : undefined;
    this.transport.sendJson({ type: 'error', turnId, code, message, details, at: timestamp() });
  }
}

function timestamp(): string {
  return new Date().toISOString();
}

function nsToMs(value: number | undefined): number | undefined {
  return value === undefined ? undefined : value / 1_000_000;
}

function classifyError(error: unknown): string {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') return error.code;
  return 'TURN_FAILED';
}

function isAbort(value: unknown): boolean {
  return value instanceof DOMException && value.name === 'AbortError';
}
