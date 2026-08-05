import { describe, expect, it } from 'vitest';
import { cognitiveDecisionSchema, cognitiveFrameSchema, responseReviewSchema } from './cognition.js';

describe('schemas cognitivos compartilhados', () => {
  it('valida percepção semanticamente estruturada', () => {
    const parsed = cognitiveFrameSchema.parse(frameFixture());
    expect(parsed.conversation.mode).toBe('technical_troubleshooting');
  });

  it('valida decisão observável sem cadeia de pensamento', () => {
    const parsed = cognitiveDecisionSchema.parse(decisionFixture());
    expect(parsed.responseStrategy.primaryAction).toBe('diagnose');
  });

  it('rejeita confiança e revisão incoerentes', () => {
    expect(() => cognitiveDecisionSchema.parse({ ...decisionFixture(), stance: { ...decisionFixture().stance, confidence: 2 } })).toThrow();
    expect(() => responseReviewSchema.parse({
      addressesUserGoal: true,
      contradictsKnownMemory: false,
      unsupportedCertainty: false,
      missedCriticalAssumption: false,
      unnecessarilyVerbose: false,
      requiresRevision: true,
      revisionInstruction: null,
    })).toThrow();
  });
});

function frameFixture() {
  return {
    version: 1,
    turnId: crypto.randomUUID(),
    interpretation: { literalRequest: 'diagnosticar', probableGoal: 'corrigir falha', impliedNeed: null, topic: 'serviço local', subtopics: [], entities: [] },
    conversation: { mode: 'technical_troubleshooting' as const, continuationOfPrevious: false, referencedMessageIds: [], expectedDepth: 'deep' as const },
    humanContext: { emotionalSignals: [], emotionalConfidence: 0, urgency: 'medium' as const, stakes: 'medium' as const, relationshipRelevant: false },
    ambiguity: { level: 'low' as const, missingInformation: [], canProvideUsefulPartialAnswer: true, clarificationNecessary: false },
    knowledge: { assessment: 'partially_known' as const, timeSensitive: false, verificationDesirable: true, unsupportedAssumptions: [] },
    memory: { retrievalQueries: ['falha serviço local'], desiredMemoryTypes: ['procedural' as const], previousOpinionRelevant: false, openLoopsRelevant: false },
  };
}

function decisionFixture() {
  const frame = frameFixture();
  return {
    turnId: frame.turnId,
    mode: frame.conversation.mode,
    understanding: { userGoal: 'corrigir falha', mostImportantPoint: 'identificar causa', assumptions: [] },
    stance: { necessary: false, position: null, confidence: 0.7, priorOpinionId: null, relationToPrior: 'not_applicable' as const, changeReason: null },
    responseStrategy: { primaryAction: 'diagnose' as const, answerFirst: true, depth: 'deep' as const, useSteps: true, mentionUncertainty: true, askQuestion: false, questionReason: null },
    knowledgeUse: { memoryIds: [], opinionIds: [], openLoopIds: [], lessonIds: [], claimsNeedingCare: [] },
    tone: { warmth: 0.5, directness: 0.8, seriousness: 0.7, humor: 0, challenge: 0.2 },
    verification: { criticalReviewRequired: true, reason: 'risco técnico' },
  };
}
