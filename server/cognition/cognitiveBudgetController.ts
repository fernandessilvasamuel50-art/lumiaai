import type { CognitiveBudget } from '../../shared/protocol/index.js';
import type { CognitiveFrame } from '../../shared/schemas/cognition.js';
import type { CognitiveModeProfile } from './cognitiveModeSelector.js';

export class CognitiveBudgetController {
  select(frame: CognitiveFrame, profile: CognitiveModeProfile): CognitiveBudget {
    const deep =
      frame.conversation.expectedDepth === 'deep' ||
      frame.humanContext.stakes === 'high' ||
      frame.humanContext.urgency === 'high' ||
      frame.ambiguity.level === 'high';
    const brief =
      !deep &&
      frame.conversation.expectedDepth === 'brief' &&
      frame.humanContext.stakes === 'low' &&
      frame.ambiguity.level !== 'high';
    const retrievalDepth = deep ? 'deep' : brief ? 'minimal' : 'normal';
    const contextTokenBudget = deep ? 5600 : brief ? 1800 : 3600;
    const criticalReview =
      deep ||
      frame.knowledge.timeSensitive ||
      frame.knowledge.assessment === 'uncertain' ||
      profile.criticalReviewBias >= 0.7;

    return {
      contextTokenBudget,
      contextCharacterBudget: contextTokenBudget * 4,
      decisionTokenLimit: deep ? 650 : brief ? 450 : 550,
      responseTokenLimit: deep ? 1200 : brief ? 350 : 800,
      retrievalDepth,
      criticalReview,
      responseTemperature: frame.conversation.mode === 'creative' ? 0.85 : deep ? 0.45 : 0.65,
      timeoutMs: deep ? 240_000 : brief ? 120_000 : 180_000,
    };
  }
}
