import { describe, expect, it } from 'vitest';
import type { CognitiveDecision } from '../../shared/schemas/cognition.js';
import { sanitizeDecisionReferences } from './deliberationService.js';

describe('sanitizeDecisionReferences', () => {
  it('descarta IDs inventados sem permitir uso ou persistência', () => {
    const validMemoryId = crypto.randomUUID();
    const decision: CognitiveDecision = {
      turnId: crypto.randomUUID(), mode: 'general',
      understanding: { userGoal: 'x', mostImportantPoint: 'x', assumptions: [] },
      stance: { necessary: false, position: null, confidence: 0.5, priorOpinionId: crypto.randomUUID(), relationToPrior: 'consistent', changeReason: null },
      responseStrategy: { primaryAction: 'answer', answerFirst: true, depth: 'brief', useSteps: false, mentionUncertainty: false, askQuestion: false, questionReason: null },
      knowledgeUse: { memoryIds: [validMemoryId, crypto.randomUUID()], opinionIds: [crypto.randomUUID()], openLoopIds: [], lessonIds: [], claimsNeedingCare: [] },
      tone: { warmth: 0.5, directness: 0.5, seriousness: 0.5, humor: 0.5, challenge: 0.5 },
      verification: { criticalReviewRequired: false, reason: null },
    };
    const sanitized = sanitizeDecisionReferences(decision, {
      recentMessages: [],
      memories: [{
        id: validMemoryId, type: 'episodic', content: 'x', sourceMessageIds: [crypto.randomUUID()], confidence: 0.8,
        importance: 0.8, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), relevanceScore: 1, status: 'active',
      }],
      opinions: [], openLoops: [], lessons: [],
    });
    expect(sanitized.knowledgeUse.memoryIds).toEqual([validMemoryId]);
    expect(sanitized.knowledgeUse.opinionIds).toEqual([]);
    expect(sanitized.stance.priorOpinionId).toBeNull();
  });
});
