import type { TurnPromptInput } from '../config/lumiaPromptBuilder.js';
import { LumiaPromptBuilder } from '../config/lumiaPromptBuilder.js';
import { OllamaClient, type OllamaGenerationMetrics, type OllamaStreamChunk } from '../ollama/ollamaClient.js';
import type { ResponseReview } from '../../shared/schemas/cognition.js';

export class ResponseGenerator {
  constructor(private readonly ollama: OllamaClient, private readonly prompts: LumiaPromptBuilder) {}

  stream(
    input: TurnPromptInput,
    signal: AbortSignal,
    onChunk: (chunk: OllamaStreamChunk) => void | Promise<void>,
    revision?: { previousResponse: string; review: ResponseReview },
  ): Promise<OllamaGenerationMetrics> {
    return this.ollama.streamChat(
      this.prompts.buildResponseMessages(input, revision),
      input.turnId,
      signal,
      onChunk,
      {
        temperature: revision ? Math.min(input.budget.responseTemperature, 0.45) : input.budget.responseTemperature,
        numPredict: input.budget.responseTokenLimit,
        timeoutMs: input.budget.timeoutMs,
      },
    );
  }
}
