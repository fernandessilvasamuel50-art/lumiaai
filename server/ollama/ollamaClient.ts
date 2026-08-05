import type { LumiaTechnicalErrorCode } from '../../shared/protocol/index.js';
import type { ServerConfig } from '../config/env.js';
import { isLocalOllamaUrl } from '../config/env.js';
import { parseNdjsonStream } from './ollamaStreamParser.js';

const ollamaStreamChunkBrand: unique symbol = Symbol('OllamaStreamChunk');

export type OllamaMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type OllamaStreamChunk = Readonly<{
  source: 'ollama_stream';
  turnId: string;
  model: string;
  sequence: number;
  text: string;
  [ollamaStreamChunkBrand]: true;
}>;

type OllamaChatChunk = {
  message?: { role: string; content?: string; thinking?: string };
  done?: boolean;
  error?: string;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
};

type OllamaChatResponse = OllamaChatChunk & { message?: { role: string; content?: string } };

export type OllamaGenerationMetrics = {
  totalDurationNs?: number;
  loadDurationNs?: number;
  promptEvalCount?: number;
  evalCount?: number;
  evalDurationNs?: number;
  tokensPerSecond?: number;
};

export type OllamaRequestOptions = {
  temperature?: number;
  numPredict?: number;
  timeoutMs?: number;
};

export class OllamaClientError extends Error {
  constructor(readonly code: LumiaTechnicalErrorCode, message: string, readonly technicalMessage?: string) {
    super(message);
    this.name = 'OllamaClientError';
  }
}

export class OllamaClient {
  constructor(private readonly config: ServerConfig, private readonly fetcher: typeof fetch = fetch) {}

  async chatStructured(
    messages: OllamaMessage[],
    jsonSchema: object,
    signal: AbortSignal,
    options: OllamaRequestOptions = {},
  ): Promise<{ content: string; metrics: OllamaGenerationMetrics }> {
    const response = await this.chatRequest(
      {
        messages,
        stream: false,
        format: jsonSchema,
        think: false,
        options: { temperature: options.temperature ?? 0.1, num_predict: options.numPredict },
      },
      signal,
      options.timeoutMs,
    );
    const payload = (await response.json()) as OllamaChatResponse;
    if (payload.error) throw classifyGenerationError(payload.error);
    return { content: payload.message?.content ?? '', metrics: metricsFrom(payload) };
  }

  async streamChat(
    messages: OllamaMessage[],
    turnId: string,
    signal: AbortSignal,
    onChunk: (chunk: OllamaStreamChunk) => void | Promise<void>,
    options: OllamaRequestOptions = {},
  ): Promise<OllamaGenerationMetrics> {
    const response = await this.chatRequest(
      {
        messages,
        stream: true,
        think: false,
        options: { temperature: options.temperature ?? 0.65, num_predict: options.numPredict },
      },
      signal,
      options.timeoutMs,
    );
    if (!response.body) throw new OllamaClientError('OLLAMA_STREAM_FAILED', 'O Ollama iniciou sem corpo de streaming.');

    let finalMetrics: OllamaGenerationMetrics = {};
    let sequence = 0;
    try {
      for await (const chunk of parseNdjsonStream<OllamaChatChunk>(response.body)) {
        if (signal.aborted) throw signal.reason;
        if (chunk.error) throw classifyGenerationError(chunk.error);
        const content = chunk.message?.content;
        if (content) {
          sequence += 1;
          await onChunk(createAuthenticChunk(turnId, this.config.ollamaModel, sequence, content));
        }
        if (chunk.done) finalMetrics = metricsFrom(chunk);
      }
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      if (error instanceof OllamaClientError) throw error;
      throw new OllamaClientError(
        'OLLAMA_STREAM_FAILED',
        'O stream do Ollama falhou durante a geração.',
        error instanceof Error ? error.message : String(error),
      );
    }
    return finalMetrics;
  }

  async warmUp(signal: AbortSignal): Promise<OllamaGenerationMetrics> {
    const response = await this.chatStructured(
      [{ role: 'user', content: 'Produza somente um objeto JSON vazio conforme o schema.' }],
      { type: 'object', additionalProperties: false },
      signal,
      { temperature: 0, numPredict: 8, timeoutMs: 240_000 },
    );
    return response.metrics;
  }

  private async chatRequest(body: object, signal: AbortSignal, timeoutMs = 180_000): Promise<Response> {
    if (!isLocalOllamaUrl(this.config.ollamaBaseUrl)) {
      throw new OllamaClientError('OLLAMA_ENDPOINT_INVALID', 'O endpoint configurado para o Ollama não é um endereço local válido.');
    }
    let response: Response;
    try {
      response = await this.fetchWithTimeout(
        '/api/chat',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: this.config.ollamaModel,
            keep_alive: this.config.ollamaKeepAlive,
            ...body,
            options: {
              num_ctx: this.config.ollamaNumCtx,
              ...compactOptions((body as { options?: Record<string, unknown> }).options ?? {}),
            },
          }),
          signal,
        },
        timeoutMs,
      );
    } catch (error) {
      if (signal.aborted) throw signal.reason ?? error;
      if (isTimeoutError(error)) {
        const modelRunning = await this.isModelRunning();
        throw modelRunning
          ? new OllamaClientError('OLLAMA_STREAM_FAILED', `O Ollama excedeu ${Math.round(timeoutMs / 1000)} segundos durante a geração.`)
          : new OllamaClientError('OLLAMA_MODEL_LOAD_FAILED', `O Ollama excedeu ${Math.round(timeoutMs / 1000)} segundos ao carregar o modelo.`);
      }
      throw new OllamaClientError(
        'OLLAMA_SERVICE_OFFLINE',
        `O serviço Ollama não respondeu em ${this.config.ollamaBaseUrl}.`,
        error instanceof Error ? error.message : String(error),
      );
    }
    if (!response.ok) {
      const detail = await safeError(response);
      if (response.status === 404 || /model.*not found/i.test(detail)) {
        throw new OllamaClientError(
          'OLLAMA_MODEL_MISSING',
          `O modelo ${this.config.ollamaModel} não está instalado. Execute ollama pull ${this.config.ollamaModel}.`,
          detail,
        );
      }
      throw classifyGenerationError(detail || `HTTP ${response.status}`);
    }
    return response;
  }

  private fetchWithTimeout(pathname: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const signals = [AbortSignal.timeout(timeoutMs)];
    if (init.signal) signals.push(init.signal);
    return this.fetcher(`${this.config.ollamaBaseUrl}${pathname}`, { ...init, signal: AbortSignal.any(signals) });
  }

  private async isModelRunning(): Promise<boolean> {
    try {
      const response = await this.fetchWithTimeout('/api/ps', { method: 'GET' }, 2500);
      if (!response.ok) return false;
      const payload = (await response.json()) as { models?: Array<{ name?: string; model?: string }> };
      return Boolean(payload.models?.some((item) => (item.name ?? item.model) === this.config.ollamaModel));
    } catch {
      return false;
    }
  }
}

export function isAuthenticOllamaStreamChunk(value: unknown): value is OllamaStreamChunk {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (value as Record<PropertyKey, unknown>)[ollamaStreamChunkBrand] === true &&
      (value as { source?: unknown }).source === 'ollama_stream',
  );
}

function createAuthenticChunk(turnId: string, model: string, sequence: number, text: string): OllamaStreamChunk {
  return Object.freeze({ source: 'ollama_stream', turnId, model, sequence, text, [ollamaStreamChunkBrand]: true as const });
}

function compactOptions(options: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined));
}

function classifyGenerationError(detail: string): OllamaClientError {
  if (/load|runner|vulkan|gpu|memory|model/i.test(detail)) {
    return new OllamaClientError('OLLAMA_MODEL_LOAD_FAILED', 'O Ollama não conseguiu carregar o modelo configurado.', detail);
  }
  return new OllamaClientError('OLLAMA_STREAM_FAILED', 'O Ollama falhou durante a geração.', detail);
}

function isTimeoutError(error: unknown): boolean {
  if (error instanceof Error && error.name === 'TimeoutError') return true;
  if (error instanceof Error && 'cause' in error) {
    const cause = error.cause;
    return cause instanceof Error && cause.name === 'TimeoutError';
  }
  return false;
}

function metricsFrom(payload: OllamaChatChunk): OllamaGenerationMetrics {
  const evalDurationNs = payload.eval_duration;
  const evalCount = payload.eval_count;
  return {
    totalDurationNs: payload.total_duration,
    loadDurationNs: payload.load_duration,
    promptEvalCount: payload.prompt_eval_count,
    evalCount,
    evalDurationNs,
    tokensPerSecond: evalCount && evalDurationNs ? evalCount / (evalDurationNs / 1_000_000_000) : undefined,
  };
}

async function safeError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: string };
    return payload.error || response.statusText;
  } catch {
    return response.statusText;
  }
}
