import { cognitiveFrameJsonSchema, cognitiveFrameSchema, type CognitiveFrame } from '../../shared/schemas/cognition.js';
import type { RetrievedContext } from '../../shared/protocol/index.js';
import { LumiaPromptBuilder } from '../config/lumiaPromptBuilder.js';
import { LumiaServerError } from '../errors.js';
import { OllamaClient, type OllamaMessage } from '../ollama/ollamaClient.js';

export class SituationInterpreter {
  constructor(private readonly ollama: OllamaClient, private readonly prompts: LumiaPromptBuilder) {}

  async interpret(input: {
    turnId: string;
    currentMessage: string;
    origin: 'user' | 'initiative';
    recentMessages: RetrievedContext['recentMessages'];
  }, signal: AbortSignal): Promise<CognitiveFrame> {
    const messages = this.prompts.buildPerceptionMessages(input);
    let lastError = '';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const attemptMessages = repairMessages(messages, attempt, lastError);
      const response = await this.ollama.chatStructured(attemptMessages, cognitiveFrameJsonSchema, signal, {
        temperature: 0.1,
        numPredict: 520,
      });
      try {
        const frame = cognitiveFrameSchema.parse(JSON.parse(response.content));
        if (frame.turnId !== input.turnId) throw new Error('turnId divergente');
        const recentIds = new Set(input.recentMessages.map((message) => message.id));
        if (frame.conversation.referencedMessageIds.some((id) => !recentIds.has(id))) throw new Error('referência de mensagem desconhecida');
        return frame;
      } catch (error) {
        lastError = error instanceof Error ? error.message.slice(0, 500) : 'JSON inválido';
      }
    }
    throw new LumiaServerError('COGNITIVE_SCHEMA_INVALID', `O frame cognitivo permaneceu inválido após uma regeneração: ${lastError}`);
  }
}

function repairMessages(messages: OllamaMessage[], attempt: number, lastError: string): OllamaMessage[] {
  return attempt === 0
    ? messages
    : [...messages, { role: 'user', content: `O JSON anterior não validou (${lastError}). Regenere uma vez, somente conforme o schema.` }];
}
