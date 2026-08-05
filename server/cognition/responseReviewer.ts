import { responseReviewJsonSchema, responseReviewSchema, type ResponseReview } from '../../shared/schemas/cognition.js';
import type { TurnPromptInput } from '../config/lumiaPromptBuilder.js';
import { LumiaPromptBuilder } from '../config/lumiaPromptBuilder.js';
import { LumiaServerError } from '../errors.js';
import { OllamaClient } from '../ollama/ollamaClient.js';

export class ResponseReviewer {
  constructor(private readonly ollama: OllamaClient, private readonly prompts: LumiaPromptBuilder) {}

  async review(input: TurnPromptInput, candidateResponse: string, signal: AbortSignal): Promise<ResponseReview> {
    const messages = this.prompts.buildReviewMessages(input, candidateResponse);
    const response = await this.ollama.chatStructured(messages, responseReviewJsonSchema, signal, {
      temperature: 0,
      numPredict: 450,
      timeoutMs: input.budget.timeoutMs,
    });
    try {
      const review = responseReviewSchema.parse(JSON.parse(response.content));
      if (review.requiresRevision !== Boolean(review.revisionInstruction)) {
        throw new Error('requiresRevision e revisionInstruction são incompatíveis');
      }
      return review;
    } catch (error) {
      throw new LumiaServerError(
        'COGNITIVE_SCHEMA_INVALID',
        `A revisão crítica retornou uma estrutura inválida: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
