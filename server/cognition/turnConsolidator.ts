import { turnConsolidationJsonSchema, turnConsolidationSchema, type TurnConsolidation } from '../../shared/schemas/cognition.js';
import type { TurnPromptInput } from '../config/lumiaPromptBuilder.js';
import { LumiaPromptBuilder } from '../config/lumiaPromptBuilder.js';
import { LumiaServerError } from '../errors.js';
import { OllamaClient } from '../ollama/ollamaClient.js';

export class TurnConsolidator {
  constructor(private readonly ollama: OllamaClient, private readonly prompts: LumiaPromptBuilder) {}

  async consolidate(
    input: TurnPromptInput & { userMessageId?: string; assistantMessageId: string; assistantMessage: string },
    signal: AbortSignal,
  ): Promise<TurnConsolidation> {
    const base = this.prompts.buildConsolidationMessages(input);
    let lastError = '';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const messages = attempt === 0
        ? base
        : [...base, { role: 'user' as const, content: `A consolidação anterior era inválida (${lastError}). Regenere somente JSON conforme o schema.` }];
      const response = await this.ollama.chatStructured(messages, turnConsolidationJsonSchema, signal, {
        temperature: 0.05,
        numPredict: input.budget.retrievalDepth === 'deep' ? 1100 : 800,
        timeoutMs: input.budget.timeoutMs,
      });
      try {
        return sanitize(turnConsolidationSchema.parse(JSON.parse(response.content)), input);
      } catch (error) {
        lastError = error instanceof Error ? error.message.slice(0, 500) : 'JSON inválido';
      }
    }
    throw new LumiaServerError('COGNITIVE_SCHEMA_INVALID', `A consolidação permaneceu inválida após uma regeneração: ${lastError}`);
  }
}

function sanitize(consolidation: TurnConsolidation, input: TurnPromptInput): TurnConsolidation {
  const memoryIds = new Set(input.context.memories.map((item) => item.id));
  const opinionIds = new Set(input.context.opinions.map((item) => item.id));
  const lessonIds = new Set(input.context.lessons.map((item) => item.id));
  const loopIds = new Set(input.context.openLoops.map((item) => item.id));
  return {
    ...consolidation,
    memoriesToRevise: consolidation.memoriesToRevise.filter((item) => memoryIds.has(item.id)),
    opinionsToRevise: consolidation.opinionsToRevise.filter((item) => opinionIds.has(item.id)),
    lessonsToRevise: consolidation.lessonsToRevise.filter((item) => lessonIds.has(item.id)),
    openLoopsToResolve: consolidation.openLoopsToResolve.filter((id) => loopIds.has(id)),
  };
}
