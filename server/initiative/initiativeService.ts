import {
  initiativeDecisionJsonSchema,
  initiativeDecisionSchema,
  type InitiativeDecision,
} from '../../shared/schemas/cognition.js';
import type { RetrievedOpenLoop } from '../../shared/protocol/index.js';
import { LumiaPromptBuilder } from '../config/lumiaPromptBuilder.js';
import { OllamaClient } from '../ollama/ollamaClient.js';

export class InitiativeService {
  constructor(private readonly ollama: OllamaClient, private readonly prompts: LumiaPromptBuilder) {}

  async evaluate(openLoops: RetrievedOpenLoop[], signal: AbortSignal): Promise<InitiativeDecision> {
    const response = await this.ollama.chatStructured(
      this.prompts.buildInitiativeMessages(openLoops),
      initiativeDecisionJsonSchema,
      signal,
      0.15,
    );
    const decision = initiativeDecisionSchema.parse(JSON.parse(response.content));
    if (decision.openLoopId && !openLoops.some((loop) => loop.id === decision.openLoopId)) {
      throw new Error('A avaliação de iniciativa selecionou um assunto inexistente.');
    }
    if (decision.initiate && !decision.openLoopId) {
      throw new Error('A avaliação de iniciativa decidiu falar sem selecionar um assunto pendente.');
    }
    return decision;
  }
}
