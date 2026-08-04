import { randomUUID } from 'node:crypto';
import type {
  AudioOutputFormat,
  LumiaServerJsonMessage,
  RetrievedContext,
  TurnPerformanceMetrics,
} from '../../shared/protocol/index.js';
import { OUTPUT_CONTAINER, OUTPUT_ENCODING } from '../../shared/protocol/index.js';
import type { CognitiveDecision } from '../../shared/schemas/cognition.js';
import type { ServerConfig } from '../config/env.js';
import type { CognitivePlanner } from '../cognition/cognitivePlanner.js';
import type { ResponseGenerator } from '../cognition/responseGenerator.js';
import type { TurnConsolidator } from '../cognition/turnConsolidator.js';
import { CartesiaSpeechStream } from '../cartesia/cartesiaStream.js';
import type { InitiativeService } from '../initiative/initiativeService.js';
import type { MemoryRepository } from '../memory/memoryRepository.js';
import { SpeechSegmenter, type LlmSpeechSegment } from './speechSegmenter.js';

export type TurnTransport = {
  sendJson(message: LumiaServerJsonMessage): void;
  sendAudio(frame: Uint8Array): void;
};

type SpeechStream = {
  outputFormat: AudioOutputFormat;
  open(signal: AbortSignal): Promise<void>;
  sendSegment(segment: LlmSpeechSegment): Promise<void>;
  finish(): Promise<void>;
  waitForDone(): Promise<void>;
  cancel(): void;
};

type ActiveTurn = {
  turnId: string;
  controller: AbortController;
  segmenter: SpeechSegmenter;
  tts?: SpeechStream;
  fullText: string;
  assistantStored: boolean;
  startedAt: number;
  metrics: TurnPerformanceMetrics;
};

type OrchestratorDependencies = {
  config: ServerConfig;
  repository: MemoryRepository;
  planner: Pick<CognitivePlanner, 'deliberate'>;
  generator: Pick<ResponseGenerator, 'stream'>;
  consolidator: Pick<TurnConsolidator, 'consolidate'>;
  initiative: Pick<InitiativeService, 'evaluate'>;
  speechFactory?: (
    turnId: string,
    sampleRate: number,
    handlers: { onStarted: () => void; onFirstAudio: (elapsedMs: number) => void; onAudio: (frame: Uint8Array) => void; onError: (error: Error) => void },
  ) => SpeechStream;
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
      this.transport.sendJson({
        type: 'initiative.evaluated', requestId, initiate: false,
        reason: 'Existe um turno ativo; a avaliação foi adiada.', at: timestamp(),
      });
      return;
    }
    const loops = this.dependencies.repository.getOpenLoops(8, this.dependencies.config.initiativeIdleMinutes);
    if (!loops.length) {
      this.transport.sendJson({
        type: 'initiative.evaluated', requestId, initiate: false,
        reason: 'Não há assuntos pendentes elegíveis.', at: timestamp(),
      });
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
      if (!controller.signal.aborted) this.sendError(undefined, 'initiative_failed', error);
    } finally {
      if (this.initiativeController === controller) this.initiativeController = undefined;
    }
  }

  private async runTurn(input: {
    turnId: string;
    message: string;
    sampleRate: number;
    origin: 'user' | 'initiative';
  }): Promise<void> {
    const controller = new AbortController();
    const active: ActiveTurn = {
      turnId: input.turnId,
      controller,
      segmenter: new SpeechSegmenter(input.turnId),
      fullText: '',
      assistantStored: false,
      startedAt: performance.now(),
      metrics: {},
    };
    this.active = active;
    const outputFormat: AudioOutputFormat = { container: OUTPUT_CONTAINER, encoding: OUTPUT_ENCODING, sampleRate: input.sampleRate };
    this.emitTurn(input.turnId, { type: 'turn.started', origin: input.origin, outputFormat });

    let userMessageId: string | undefined;
    let assistantMessageId: string | undefined;
    try {
      const memoryStarted = performance.now();
      const context = this.dependencies.repository.retrieveContext(input.message);
      active.metrics.memoryRetrievalMs = performance.now() - memoryStarted;
      if (input.origin === 'user') {
        userMessageId = this.dependencies.repository.addMessage({
          turnId: input.turnId, role: 'user', content: input.message, source: 'typed',
        });
      }

      this.emitTurn(input.turnId, { type: 'cognition.started' });
      const deliberationStarted = performance.now();
      const decision = await this.dependencies.planner.deliberate(input.message, context, input.origin, controller.signal);
      this.assertCurrent(active);
      active.metrics.deliberationMs = performance.now() - deliberationStarted;
      this.dependencies.repository.storeDecision(input.turnId, decision);
      this.emitTurn(input.turnId, {
        type: 'cognition.completed', decision, context, deliberationMs: active.metrics.deliberationMs,
      });

      if (decision.publicAction === 'silence') {
        active.metrics.totalMs = performance.now() - active.startedAt;
        this.dependencies.repository.storeMetrics(input.turnId, active.metrics, 'completed_silence');
        this.emitTurn(input.turnId, {
          type: 'turn.completed', transcript: '', metrics: active.metrics, durationMs: active.metrics.totalMs,
        });
        this.clearIfCurrent(active);
        return;
      }

      const tts = this.createSpeechStream(input.turnId, input.sampleRate, active);
      active.tts = tts;
      await tts.open(controller.signal);
      this.assertCurrent(active);
      this.emitTurn(input.turnId, { type: 'llm.started', model: this.dependencies.config.ollamaModel });

      let sawFirstToken = false;
      const llmMetrics = await this.dependencies.generator.stream(
        { currentMessage: input.message, context, decision, origin: input.origin },
        controller.signal,
        async (token) => {
          this.assertCurrent(active);
          if (!sawFirstToken) {
            sawFirstToken = true;
            active.metrics.firstTokenMs = performance.now() - active.startedAt;
            this.emitTurn(input.turnId, { type: 'llm.first_token', elapsedMs: active.metrics.firstTokenMs });
          }
          active.fullText += token;
          for (const segment of active.segmenter.push(token)) await this.forwardSegment(active, segment);
        },
      );
      this.assertCurrent(active);
      for (const segment of active.segmenter.flush()) await this.forwardSegment(active, segment);
      if (!active.fullText.trim()) throw new Error('Ollama concluiu o turno sem produzir fala pública.');
      await tts.finish();

      active.metrics.modelLoadMs = nsToMs(llmMetrics.loadDurationNs);
      active.metrics.tokensPerSecond = llmMetrics.tokensPerSecond;
      active.metrics.evalCount = llmMetrics.evalCount;
      assistantMessageId = this.dependencies.repository.addMessage({
        turnId: input.turnId,
        role: 'assistant',
        content: active.fullText,
        source: input.origin === 'initiative' ? 'initiative' : 'ollama_stream',
      });
      active.assistantStored = true;

      void this.consolidateAfterResponse({
        active, input, context, decision, userMessageId, assistantMessageId,
      });

      await tts.waitForDone();
      this.assertCurrent(active);
      active.metrics.totalMs = performance.now() - active.startedAt;
      this.dependencies.repository.storeMetrics(input.turnId, active.metrics, 'completed');
      this.emitTurn(input.turnId, {
        type: 'turn.completed', transcript: active.fullText, metrics: active.metrics, durationMs: active.metrics.totalMs,
      });
      this.clearIfCurrent(active);
    } catch (error) {
      if (controller.signal.aborted && controller.signal.reason instanceof DOMException && controller.signal.reason.name === 'AbortError') return;
      const effectiveError = controller.signal.aborted ? controller.signal.reason : error;
      active.tts?.cancel();
      if (active.fullText && !active.assistantStored) {
        this.dependencies.repository.addMessage({
          turnId: input.turnId, role: 'assistant', content: active.fullText, source: 'ollama_stream', interrupted: true,
        });
      }
      active.metrics.totalMs = performance.now() - active.startedAt;
      this.dependencies.repository.storeMetrics(input.turnId, active.metrics, 'error');
      this.sendError(input.turnId, classifyError(effectiveError), effectiveError);
      this.clearIfCurrent(active);
    }
  }

  private createSpeechStream(turnId: string, sampleRate: number, active: ActiveTurn): SpeechStream {
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
    return this.dependencies.speechFactory
      ? this.dependencies.speechFactory(turnId, sampleRate, handlers)
      : new CartesiaSpeechStream(this.dependencies.config, turnId, sampleRate, handlers);
  }

  private async forwardSegment(active: ActiveTurn, segment: LlmSpeechSegment): Promise<void> {
    if (!active.tts) throw new Error('Canal de voz não inicializado.');
    if (active.metrics.firstSegmentMs === undefined) active.metrics.firstSegmentMs = performance.now() - active.startedAt;
    this.emitTurn(active.turnId, { type: 'llm.segment', text: segment.text, elapsedMs: performance.now() - active.startedAt });
    await active.tts.sendSegment(segment);
  }

  private async consolidateAfterResponse(input: {
    active: ActiveTurn;
    input: { turnId: string; message: string };
    context: RetrievedContext;
    decision: CognitiveDecision;
    userMessageId?: string;
    assistantMessageId: string;
  }): Promise<void> {
    try {
      const consolidation = await this.dependencies.consolidator.consolidate(
        {
          userMessage: input.input.message,
          assistantMessage: input.active.fullText,
          userMessageId: input.userMessageId,
          assistantMessageId: input.assistantMessageId,
          context: input.context,
          decision: input.decision,
        },
        input.active.controller.signal,
      );
      if (input.active.controller.signal.aborted) return;
      const validIds = [input.userMessageId, input.assistantMessageId].filter((id): id is string => Boolean(id));
      const result = this.dependencies.repository.applyConsolidation(consolidation, validIds);
      this.emitTurn(input.input.turnId, { type: 'memory.consolidated', ...result });
    } catch (error) {
      if (!input.active.controller.signal.aborted) this.sendError(input.input.turnId, 'memory_consolidation_failed', error);
    }
  }

  private cancelActive(): void {
    const active = this.active;
    if (!active) return;
    active.controller.abort(new DOMException('Turno interrompido.', 'AbortError'));
    active.segmenter.cancel();
    active.tts?.cancel();
    if (active.fullText && !active.assistantStored) {
      this.dependencies.repository.addMessage({
        turnId: active.turnId, role: 'assistant', content: active.fullText, source: 'ollama_stream', interrupted: true,
      });
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

  private emitTurn<T extends Omit<LumiaServerJsonMessage, 'turnId' | 'at'>>(
    turnId: string,
    message: T,
  ): void {
    this.transport.sendJson({ ...message, turnId, at: timestamp() } as LumiaServerJsonMessage);
  }

  private sendError(turnId: string | undefined, code: string, error: unknown): void {
    const message = error instanceof Error ? error.message : 'Erro técnico desconhecido.';
    this.transport.sendJson({ type: 'error', turnId, code, message, at: timestamp() });
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
  return 'turn_failed';
}
