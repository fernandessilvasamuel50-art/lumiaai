import type { OllamaStatus } from '../../shared/protocol/index.js';
import type { ServerConfig } from '../config/env.js';
import { parseNdjsonStream } from './ollamaStreamParser.js';

export type OllamaMessage = { role: 'system' | 'user' | 'assistant'; content: string };

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

export class OllamaClientError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'OllamaClientError';
  }
}

export class OllamaClient {
  constructor(private readonly config: ServerConfig, private readonly fetcher: typeof fetch = fetch) {}

  async health(): Promise<OllamaStatus> {
    try {
      const [tagsResponse, psResponse] = await Promise.all([
        this.fetchWithTimeout('/api/tags', { method: 'GET' }, 2500),
        this.fetchWithTimeout('/api/ps', { method: 'GET' }, 2500).catch(() => null),
      ]);
      if (!tagsResponse.ok) throw new Error(`HTTP ${tagsResponse.status}`);
      const tags = (await tagsResponse.json()) as { models?: Array<{ name?: string; model?: string }> };
      const modelInstalled = Boolean(
        tags.models?.some((item) => item.name === this.config.ollamaModel || item.model === this.config.ollamaModel),
      );
      let processor: string | undefined;
      if (psResponse?.ok) {
        const ps = (await psResponse.json()) as { models?: Array<{ name?: string; model?: string; size?: number; size_vram?: number }> };
        const running = ps.models?.find(
          (item) => item.name === this.config.ollamaModel || item.model === this.config.ollamaModel,
        );
        if (running?.size) processor = describeProcessor(running.size, running.size_vram ?? 0);
      }
      return {
        available: true,
        modelInstalled,
        model: this.config.ollamaModel,
        installCommand: modelInstalled ? undefined : `ollama pull ${this.config.ollamaModel}`,
        processor,
      };
    } catch (error) {
      return {
        available: false,
        modelInstalled: false,
        model: this.config.ollamaModel,
        installCommand: `ollama pull ${this.config.ollamaModel}`,
        error: error instanceof Error ? error.message : 'Serviço indisponível',
      };
    }
  }

  async chatStructured(
    messages: OllamaMessage[],
    jsonSchema: object,
    signal: AbortSignal,
    temperature = 0.1,
  ): Promise<{ content: string; metrics: OllamaGenerationMetrics }> {
    const response = await this.chatRequest(
      { messages, stream: false, format: jsonSchema, think: false, options: { temperature } },
      signal,
    );
    const payload = (await response.json()) as OllamaChatResponse;
    if (payload.error) throw new OllamaClientError('ollama_generation_failed', payload.error);
    return { content: payload.message?.content ?? '', metrics: metricsFrom(payload) };
  }

  async streamChat(
    messages: OllamaMessage[],
    signal: AbortSignal,
    onText: (text: string) => void | Promise<void>,
  ): Promise<OllamaGenerationMetrics> {
    const response = await this.chatRequest(
      { messages, stream: true, think: false, options: { temperature: 0.75 } },
      signal,
    );
    if (!response.body) throw new OllamaClientError('ollama_empty_stream', 'Ollama iniciou sem corpo de streaming.');

    let finalMetrics: OllamaGenerationMetrics = {};
    for await (const chunk of parseNdjsonStream<OllamaChatChunk>(response.body)) {
      if (chunk.error) throw new OllamaClientError('ollama_stream_failed', chunk.error);
      const content = chunk.message?.content;
      if (content) await onText(content);
      if (chunk.done) finalMetrics = metricsFrom(chunk);
    }
    return finalMetrics;
  }

  async warmUp(signal: AbortSignal): Promise<void> {
    await this.chatStructured(
      [{ role: 'user', content: 'Retorne um objeto JSON vazio.' }],
      { type: 'object', additionalProperties: false },
      signal,
      0,
    );
  }

  private async chatRequest(body: object, signal: AbortSignal): Promise<Response> {
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
              ...((body as { options?: object }).options ?? {}),
            },
          }),
          signal,
        },
        10000,
      );
    } catch (error) {
      if (signal.aborted) throw error;
      throw new OllamaClientError('ollama_unavailable', 'Ollama indisponível em ' + this.config.ollamaBaseUrl + '.');
    }
    if (!response.ok) {
      const detail = await safeError(response);
      if (response.status === 404 || /model.*not found/i.test(detail)) {
        throw new OllamaClientError(
          'ollama_model_missing',
          `Modelo ${this.config.ollamaModel} ausente. Execute: ollama pull ${this.config.ollamaModel}`,
        );
      }
      throw new OllamaClientError('ollama_http_error', `Ollama retornou HTTP ${response.status}: ${detail}`);
    }
    return response;
  }

  private fetchWithTimeout(pathname: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const signals = [AbortSignal.timeout(timeoutMs)];
    if (init.signal) signals.push(init.signal);
    return this.fetcher(`${this.config.ollamaBaseUrl}${pathname}`, { ...init, signal: AbortSignal.any(signals) });
  }
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

function describeProcessor(size: number, vram: number): string {
  if (vram <= 0) return '100% CPU';
  const gpuPercent = Math.min(100, Math.round((vram / size) * 100));
  if (gpuPercent >= 99) return '100% GPU';
  return `${100 - gpuPercent}% CPU / ${gpuPercent}% GPU`;
}

async function safeError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: string };
    return payload.error || response.statusText;
  } catch {
    return response.statusText;
  }
}
