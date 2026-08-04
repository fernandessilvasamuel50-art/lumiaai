import {
  cognitiveDecisionJsonSchema,
  cognitiveDecisionSchema,
  type CognitiveDecision,
} from '../../shared/schemas/cognition.js';
import type { RetrievedContext } from '../../shared/protocol/index.js';
import { LumiaPromptBuilder } from '../config/lumiaPromptBuilder.js';
import { OllamaClient, type OllamaMessage } from '../ollama/ollamaClient.js';

export class CognitivePlanner {
  constructor(private readonly ollama: OllamaClient, private readonly prompts: LumiaPromptBuilder) {}

  async deliberate(
    currentMessage: string,
    context: RetrievedContext,
    origin: 'user' | 'initiative',
    signal: AbortSignal,
  ): Promise<CognitiveDecision> {
    const messages = this.prompts.buildDeliberationMessages(currentMessage, context, origin);
    return this.requestValidated(messages, context, signal);
  }

  private async requestValidated(messages: OllamaMessage[], context: RetrievedContext, signal: AbortSignal): Promise<CognitiveDecision> {
    let lastError = '';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const attemptMessages =
        attempt === 0
          ? messages
          : [...messages, { role: 'user' as const, content: `A resposta anterior era inválida (${lastError}). Gere novamente somente JSON conforme o schema.` }];
      const response = await this.ollama.chatStructured(attemptMessages, cognitiveDecisionJsonSchema, signal, 0.15);
      try {
        const decision = cognitiveDecisionSchema.parse(JSON.parse(response.content));
        assertKnownReferences(decision, context);
        return decision;
      } catch (error) {
        lastError = error instanceof Error ? error.message.slice(0, 500) : 'JSON inválido';
      }
    }
    throw new Error('A deliberação do Ollama permaneceu inválida após uma regeneração.');
  }
}

function assertKnownReferences(decision: CognitiveDecision, context: RetrievedContext): void {
  const memoryIds = new Set(context.memories.map((memory) => memory.id));
  const loopIds = new Set(context.openLoops.map((loop) => loop.id));
  const opinionIds = new Set(context.opinions.map((opinion) => opinion.id));
  if (decision.relevantMemoryIds.some((id) => !memoryIds.has(id))) throw new Error('relevantMemoryIds contém ID não recuperado');
  if (decision.relevantOpenLoopIds.some((id) => !loopIds.has(id))) throw new Error('relevantOpenLoopIds contém ID não recuperado');
  if (decision.stance?.previousOpinionId && !opinionIds.has(decision.stance.previousOpinionId)) {
    throw new Error('previousOpinionId não corresponde a uma opinião recuperada');
  }
}
