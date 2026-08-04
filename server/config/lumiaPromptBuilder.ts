import fs from 'node:fs';
import path from 'node:path';
import type { RetrievedContext } from '../../shared/protocol/index.js';
import type { CognitiveDecision } from '../../shared/schemas/cognition.js';
import type { OllamaMessage } from '../ollama/ollamaClient.js';

export type TurnPromptInput = {
  currentMessage: string;
  context: RetrievedContext;
  decision: CognitiveDecision;
  origin: 'user' | 'initiative';
};

export class LumiaPromptBuilder {
  private readonly identity: string;
  private readonly cognition: string;
  private readonly conversation: string;

  constructor(configDirectory = path.resolve(process.cwd(), 'config', 'lumia')) {
    this.identity = readRequired(path.join(configDirectory, 'identity.md'));
    this.cognition = readRequired(path.join(configDirectory, 'cognition.md'));
    this.conversation = readRequired(path.join(configDirectory, 'conversation.md'));
  }

  buildDeliberationMessages(currentMessage: string, context: RetrievedContext, origin: 'user' | 'initiative'): OllamaMessage[] {
    return [
      {
        role: 'system',
        content: `${this.identity}\n\n${this.cognition}\n\nProduza exclusivamente o registro JSON solicitado, sem cadeia de pensamento detalhada. Selecione somente IDs fornecidos.`,
      },
      {
        role: 'user',
        content: JSON.stringify({ origin, currentMessage, recoveredContext: context }),
      },
    ];
  }

  buildResponseMessages(input: TurnPromptInput): OllamaMessage[] {
    const history: OllamaMessage[] = input.context.recentMessages.map((message) => ({
      role: message.role,
      content: message.content,
    }));
    return [
      {
        role: 'system',
        content: `${this.identity}\n\n${this.conversation}\n\nContexto recuperado:\n${JSON.stringify({
          memories: input.context.memories,
          opinions: input.context.opinions,
          openLoops: input.context.openLoops,
        })}\n\nDecisão cognitiva já concluída e obrigatória:\n${JSON.stringify(input.decision)}`,
      },
      ...history,
      {
        role: 'user',
        content:
          input.origin === 'user'
            ? input.currentMessage
            : `Inicie por decisão própria uma continuação natural do assunto pendente descrito neste contexto: ${input.currentMessage}`,
      },
    ];
  }

  buildConsolidationMessages(input: {
    userMessage: string;
    assistantMessage: string;
    userMessageId?: string;
    assistantMessageId: string;
    context: RetrievedContext;
    decision: CognitiveDecision;
  }): OllamaMessage[] {
    return [
      {
        role: 'system',
        content: `${this.cognition}\n\nExtraia apenas informações duráveis com evidência explícita. Não memorize casualidades. Use exclusivamente IDs de mensagens fornecidos. Produza somente o JSON do schema.`,
      },
      {
        role: 'user',
        content: JSON.stringify({
          turn: {
            user: input.userMessageId ? { id: input.userMessageId, content: input.userMessage } : null,
            assistant: { id: input.assistantMessageId, content: input.assistantMessage },
          },
          previousContext: input.context,
          decision: input.decision,
        }),
      },
    ];
  }

  buildInitiativeMessages(openLoops: RetrievedContext['openLoops']): OllamaMessage[] {
    return [
      {
        role: 'system',
        content: `${this.identity}\n\n${this.cognition}\n\nDecida se vale iniciar uma conversa agora. Considere importância, continuidade e risco de repetição. Não escreva a fala pública; produza somente o JSON de decisão.`,
      },
      { role: 'user', content: JSON.stringify({ openLoops }) },
    ];
  }
}

function readRequired(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf8').trim();
  } catch {
    throw new Error(`Arquivo de identidade obrigatório ausente: ${filePath}`);
  }
}
