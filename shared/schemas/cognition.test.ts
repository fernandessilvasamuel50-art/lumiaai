import { describe, expect, it } from 'vitest';
import { cognitiveDecisionSchema } from './cognition.js';

describe('cognitiveDecisionSchema', () => {
  it('valida um registro compacto', () => {
    expect(
      cognitiveDecisionSchema.parse({
        interpretation: 'interpretação', topic: 'tema',
        stance: { position: 'posição', confidence: 0.8, previousOpinionId: null, relationshipToPrevious: 'new', changeReason: null },
        intention: 'responder', tone: 'direto', relevantMemoryIds: [], relevantOpenLoopIds: [], publicAction: 'challenge',
      }).publicAction,
    ).toBe('challenge');
  });

  it('rejeita confiança fora do intervalo', () => {
    expect(() =>
      cognitiveDecisionSchema.parse({
        interpretation: 'x', topic: null,
        stance: { position: 'x', confidence: 2, previousOpinionId: null, relationshipToPrevious: 'new', changeReason: null },
        intention: 'x', tone: 'x', relevantMemoryIds: [], relevantOpenLoopIds: [], publicAction: 'respond',
      }),
    ).toThrow();
  });
});
