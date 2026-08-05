import type { CognitiveFrame, KnowledgeAssessment } from '../../shared/schemas/cognition.js';

export function assessmentsFromFrame(frame: CognitiveFrame): KnowledgeAssessment[] {
  return frame.knowledge.unsupportedAssumptions.map((claim) => ({
    claim,
    source: frame.knowledge.assessment === 'unknown' ? 'unknown' : 'inference',
    confidence: frame.knowledge.assessment === 'unknown' ? 0 : 0.35,
    timeSensitive: frame.knowledge.timeSensitive,
    verificationAvailable: false,
  }));
}
