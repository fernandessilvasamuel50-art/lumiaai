import { cognitiveDecisionJsonSchema, cognitiveDecisionSchema, type CognitiveDecision, type CognitiveFrame } from '../../shared/schemas/cognition.js';
import type { CognitiveBudget, LumiaSelfModel, RetrievedContext } from '../../shared/protocol/index.js';
import { LumiaPromptBuilder } from '../config/lumiaPromptBuilder.js';
import { LumiaServerError } from '../errors.js';
import { OllamaClient } from '../ollama/ollamaClient.js';
import type { CognitiveModeProfile } from './cognitiveModeSelector.js';

export class DeliberationService {
  constructor(private readonly ollama: OllamaClient, private readonly prompts: LumiaPromptBuilder) {}

  async deliberate(input: {
    currentMessage: string;
    frame: CognitiveFrame;
    context: RetrievedContext;
    selfModel: LumiaSelfModel;
    profile: CognitiveModeProfile;
    budget: CognitiveBudget;
    origin: 'user' | 'initiative';
  }, signal: AbortSignal): Promise<CognitiveDecision> {
    const base = this.prompts.buildDeliberationMessages(input);
    let lastError = '';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const messages = attempt === 0 ? base : [...base, { role: 'user' as const, content: `A decisão anterior era inválida (${lastError}). Regenere somente o JSON do schema.` }];
      const response = await this.ollama.chatStructured(messages, cognitiveDecisionJsonSchema, signal, {
        temperature: 0.12,
        numPredict: input.budget.decisionTokenLimit,
        timeoutMs: input.budget.timeoutMs,
      });
      try {
        const decision = sanitizeDecisionReferences(cognitiveDecisionSchema.parse(JSON.parse(response.content)), input.context);
        assertDecision(decision, input.frame, input.context, input.origin);
        return decision;
      } catch (error) {
        lastError = error instanceof Error ? error.message.slice(0, 500) : 'JSON inválido';
      }
    }
    throw new LumiaServerError('COGNITIVE_SCHEMA_INVALID', `A decisão cognitiva permaneceu inválida após uma regeneração: ${lastError}`);
  }
}

export function sanitizeDecisionReferences(decision: CognitiveDecision, context: RetrievedContext): CognitiveDecision {
  const memoryIds = new Set(context.memories.map((item) => item.id));
  const opinionIds = new Set(context.opinions.map((item) => item.id));
  const openLoopIds = new Set(context.openLoops.map((item) => item.id));
  const lessonIds = new Set(context.lessons.map((item) => item.id));
  const priorOpinionId = decision.stance.priorOpinionId && opinionIds.has(decision.stance.priorOpinionId)
    ? decision.stance.priorOpinionId
    : null;
  return {
    ...decision,
    stance: {
      ...decision.stance,
      priorOpinionId,
      relationToPrior: priorOpinionId
        ? decision.stance.relationToPrior
        : decision.stance.necessary ? 'new' : 'not_applicable',
    },
    knowledgeUse: {
      ...decision.knowledgeUse,
      memoryIds: decision.knowledgeUse.memoryIds.filter((id) => memoryIds.has(id)),
      opinionIds: decision.knowledgeUse.opinionIds.filter((id) => opinionIds.has(id)),
      openLoopIds: decision.knowledgeUse.openLoopIds.filter((id) => openLoopIds.has(id)),
      lessonIds: decision.knowledgeUse.lessonIds.filter((id) => lessonIds.has(id)),
    },
  };
}

function assertDecision(decision: CognitiveDecision, frame: CognitiveFrame, context: RetrievedContext, origin: 'user' | 'initiative'): void {
  if (decision.turnId !== frame.turnId) throw new Error('turnId divergente');
  if (decision.mode !== frame.conversation.mode) throw new Error('modo divergente do frame');
  if (origin === 'user' && decision.responseStrategy.primaryAction === 'silence') throw new Error('mensagem direta não pode resultar em silêncio');
  const ids = {
    memories: new Set(context.memories.map((item) => item.id)),
    opinions: new Set(context.opinions.map((item) => item.id)),
    loops: new Set(context.openLoops.map((item) => item.id)),
    lessons: new Set(context.lessons.map((item) => item.id)),
  };
  if (decision.knowledgeUse.memoryIds.some((id) => !ids.memories.has(id))) throw new Error('memoryIds contém ID não recuperado');
  if (decision.knowledgeUse.opinionIds.some((id) => !ids.opinions.has(id))) throw new Error('opinionIds contém ID não recuperado');
  if (decision.knowledgeUse.openLoopIds.some((id) => !ids.loops.has(id))) throw new Error('openLoopIds contém ID não recuperado');
  if (decision.knowledgeUse.lessonIds.some((id) => !ids.lessons.has(id))) throw new Error('lessonIds contém ID não recuperado');
  if (decision.stance.priorOpinionId && !ids.opinions.has(decision.stance.priorOpinionId)) throw new Error('priorOpinionId não recuperado');
}
