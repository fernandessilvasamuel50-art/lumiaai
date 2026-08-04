import {
  turnConsolidationJsonSchema,
  turnConsolidationSchema,
  type CognitiveDecision,
  type TurnConsolidation,
} from '../../shared/schemas/cognition.js';
import type { RetrievedContext } from '../../shared/protocol/index.js';
import { LumiaPromptBuilder } from '../config/lumiaPromptBuilder.js';
import { OllamaClient } from '../ollama/ollamaClient.js';

export class TurnConsolidator {
  constructor(private readonly ollama: OllamaClient, private readonly prompts: LumiaPromptBuilder) {}

  async consolidate(
    input: {
      userMessage: string;
      assistantMessage: string;
      userMessageId?: string;
      assistantMessageId: string;
      context: RetrievedContext;
      decision: CognitiveDecision;
    },
    signal: AbortSignal,
  ): Promise<TurnConsolidation> {
    const response = await this.ollama.chatStructured(
      this.prompts.buildConsolidationMessages(input),
      turnConsolidationJsonSchema,
      signal,
      0.1,
    );
    const parsed = turnConsolidationSchema.parse(JSON.parse(response.content));
    const memoryIds = new Set(input.context.memories.map((memory) => memory.id));
    const opinionIds = new Set(input.context.opinions.map((opinion) => opinion.id));
    const openLoopIds = new Set(input.context.openLoops.map((loop) => loop.id));
    return {
      ...parsed,
      memoriesToUpdate: parsed.memoriesToUpdate.filter((memory) => memoryIds.has(memory.id)),
      opinionUpdate:
        parsed.opinionUpdate?.previousOpinionId && !opinionIds.has(parsed.opinionUpdate.previousOpinionId)
          ? null
          : parsed.opinionUpdate,
      openLoopsToResolve: parsed.openLoopsToResolve.filter((id) => openLoopIds.has(id)),
    };
  }
}
