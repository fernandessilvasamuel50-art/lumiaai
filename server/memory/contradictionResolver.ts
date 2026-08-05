import type { TurnConsolidation } from '../../shared/schemas/cognition.js';

type MemoryRevision = TurnConsolidation['memoriesToRevise'][number];

export type ContradictionResolution = {
  content: string;
  confidence: number;
  status: 'active' | 'uncertain';
  action: 'updated' | 'corrected' | 'changed' | 'marked_uncertain';
};

export class ContradictionResolver {
  resolve(existing: { content: string; confidence: number }, revision: MemoryRevision): ContradictionResolution {
    if (revision.contradictionKind === 'ambiguity') {
      return {
        content: existing.content,
        confidence: Math.min(existing.confidence, revision.confidence, 0.55),
        status: 'uncertain',
        action: 'marked_uncertain',
      };
    }
    if (revision.contradictionKind === 'correction') {
      return {
        content: revision.content,
        confidence: Math.max(0.85, revision.confidence),
        status: 'active',
        action: 'corrected',
      };
    }
    return {
      content: revision.content,
      confidence: revision.confidence,
      status: 'active',
      action: revision.contradictionKind === 'real_change' ? 'changed' : 'updated',
    };
  }
}
