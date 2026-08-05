import { describe, expect, it } from 'vitest';
import { ContradictionResolver } from './contradictionResolver.js';

describe('ContradictionResolver', () => {
  const resolver = new ContradictionResolver();
  const base = { id: crypto.randomUUID(), content: 'versão nova', type: 'episodic' as const, confidence: 0.7, importance: 0.8, evidenceMessageIds: [crypto.randomUUID()], reason: 'evidência' };

  it('dá peso alto à correção explícita', () => {
    const result = resolver.resolve({ content: 'versão antiga', confidence: 0.8 }, { ...base, contradictionKind: 'correction' });
    expect(result.action).toBe('corrected');
    expect(result.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it('não mistura versões quando há ambiguidade', () => {
    const result = resolver.resolve({ content: 'versão preservada', confidence: 0.8 }, { ...base, contradictionKind: 'ambiguity' });
    expect(result.content).toBe('versão preservada');
    expect(result.status).toBe('uncertain');
  });
});
