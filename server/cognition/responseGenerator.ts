import type { RetrievedContext } from '../../shared/protocol/index.js';
import type { CognitiveDecision } from '../../shared/schemas/cognition.js';
import { LumiaPromptBuilder } from '../config/lumiaPromptBuilder.js';
import { OllamaClient, type OllamaGenerationMetrics } from '../ollama/ollamaClient.js';

export class ResponseGenerator {
  constructor(private readonly ollama: OllamaClient, private readonly prompts: LumiaPromptBuilder) {}

  stream(
    input: { currentMessage: string; context: RetrievedContext; decision: CognitiveDecision; origin: 'user' | 'initiative' },
    signal: AbortSignal,
    onText: (text: string) => void | Promise<void>,
  ): Promise<OllamaGenerationMetrics> {
    return this.ollama.streamChat(this.prompts.buildResponseMessages(input), signal, onText);
  }
}
