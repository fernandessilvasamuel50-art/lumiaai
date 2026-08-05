import type { CognitiveFrame, CognitiveMode } from '../../shared/schemas/cognition.js';

export type CognitiveModeProfile = {
  mode: CognitiveMode;
  retrieveProceduralMemory: boolean;
  requireAssumptionCheck: boolean;
  preferOrderedActions: boolean;
  considerPriorOpinion: boolean;
  relationshipWeight: number;
  criticalReviewBias: number;
};

const BASE: Omit<CognitiveModeProfile, 'mode'> = {
  retrieveProceduralMemory: false,
  requireAssumptionCheck: false,
  preferOrderedActions: false,
  considerPriorOpinion: false,
  relationshipWeight: 0.3,
  criticalReviewBias: 0.2,
};

const PROFILES: Record<CognitiveMode, Omit<CognitiveModeProfile, 'mode'>> = {
  casual_dialogue: { ...BASE, relationshipWeight: 0.55, criticalReviewBias: 0 },
  factual_explanation: { ...BASE, requireAssumptionCheck: true, criticalReviewBias: 0.45 },
  teaching: { ...BASE, retrieveProceduralMemory: true, preferOrderedActions: true, criticalReviewBias: 0.35 },
  technical_troubleshooting: { ...BASE, retrieveProceduralMemory: true, requireAssumptionCheck: true, preferOrderedActions: true, criticalReviewBias: 0.75 },
  decision_support: { ...BASE, requireAssumptionCheck: true, considerPriorOpinion: true, criticalReviewBias: 0.7 },
  planning: { ...BASE, retrieveProceduralMemory: true, requireAssumptionCheck: true, preferOrderedActions: true, criticalReviewBias: 0.55 },
  creative: { ...BASE, retrieveProceduralMemory: true, criticalReviewBias: 0.05 },
  emotional_support: { ...BASE, relationshipWeight: 0.9, criticalReviewBias: 0.25 },
  reflection: { ...BASE, considerPriorOpinion: true, relationshipWeight: 0.8, criticalReviewBias: 0.35 },
  debate_or_disagreement: { ...BASE, requireAssumptionCheck: true, considerPriorOpinion: true, criticalReviewBias: 0.65 },
  correction: { ...BASE, requireAssumptionCheck: true, considerPriorOpinion: true, criticalReviewBias: 0.8 },
  relationship_continuity: { ...BASE, considerPriorOpinion: true, relationshipWeight: 1, criticalReviewBias: 0.3 },
  meta_cognition: { ...BASE, requireAssumptionCheck: true, considerPriorOpinion: true, criticalReviewBias: 0.55 },
  general: BASE,
};

export class CognitiveModeSelector {
  select(frame: CognitiveFrame): CognitiveModeProfile {
    const mode = frame.conversation.mode;
    return { mode, ...PROFILES[mode] };
  }
}
