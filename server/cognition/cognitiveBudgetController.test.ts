import { describe, expect, it } from 'vitest';
import type { CognitiveFrame } from '../../shared/schemas/cognition.js';
import { CognitiveBudgetController } from './cognitiveBudgetController.js';
import { CognitiveModeSelector } from './cognitiveModeSelector.js';

describe('CognitiveBudgetController', () => {
  const controller = new CognitiveBudgetController();
  const selector = new CognitiveModeSelector();

  it('usa caminho mínimo para conversa simples', () => {
    const frame = fixture('casual_dialogue', 'brief', 'low');
    const budget = controller.select(frame, selector.select(frame));
    expect(budget.retrievalDepth).toBe('minimal');
    expect(budget.criticalReview).toBe(false);
    expect(budget.responseTokenLimit).toBeLessThan(500);
  });

  it('amplia contexto e revisão para problema técnico de risco alto', () => {
    const frame = fixture('technical_troubleshooting', 'deep', 'high');
    const budget = controller.select(frame, selector.select(frame));
    expect(budget.retrievalDepth).toBe('deep');
    expect(budget.criticalReview).toBe(true);
    expect(budget.contextTokenBudget).toBeGreaterThan(5000);
  });
});

function fixture(mode: CognitiveFrame['conversation']['mode'], depth: CognitiveFrame['conversation']['expectedDepth'], stakes: CognitiveFrame['humanContext']['stakes']): CognitiveFrame {
  return {
    version: 1, turnId: crypto.randomUUID(),
    interpretation: { literalRequest: 'x', probableGoal: 'x', impliedNeed: null, topic: null, subtopics: [], entities: [] },
    conversation: { mode, continuationOfPrevious: false, referencedMessageIds: [], expectedDepth: depth },
    humanContext: { emotionalSignals: [], emotionalConfidence: 0, urgency: 'low', stakes, relationshipRelevant: false },
    ambiguity: { level: 'none', missingInformation: [], canProvideUsefulPartialAnswer: true, clarificationNecessary: false },
    knowledge: { assessment: 'known', timeSensitive: false, verificationDesirable: false, unsupportedAssumptions: [] },
    memory: { retrievalQueries: ['contexto'], desiredMemoryTypes: [], previousOpinionRelevant: false, openLoopsRelevant: false },
  };
}
