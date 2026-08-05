import { z } from 'zod';

export const memoryTypeSchema = z.enum([
  'episodic',
  'semantic_personal',
  'procedural',
  'relationship',
  'self_continuity',
]);
export type MemoryType = z.infer<typeof memoryTypeSchema>;

export const cognitiveModeSchema = z.enum([
  'casual_dialogue',
  'factual_explanation',
  'teaching',
  'technical_troubleshooting',
  'decision_support',
  'planning',
  'creative',
  'emotional_support',
  'reflection',
  'debate_or_disagreement',
  'correction',
  'relationship_continuity',
  'meta_cognition',
  'general',
]);
export type CognitiveMode = z.infer<typeof cognitiveModeSchema>;

export const cognitiveFrameSchema = z.object({
  version: z.number().int().min(1),
  turnId: z.string().uuid(),
  interpretation: z.object({
    literalRequest: z.string().min(1).max(2000),
    probableGoal: z.string().min(1).max(1200),
    impliedNeed: z.string().max(1200).nullable(),
    topic: z.string().max(300).nullable(),
    subtopics: z.array(z.string().min(1).max(200)).max(12),
    entities: z.array(z.string().min(1).max(200)).max(20),
  }),
  conversation: z.object({
    mode: cognitiveModeSchema,
    continuationOfPrevious: z.boolean(),
    referencedMessageIds: z.array(z.string()).max(20),
    expectedDepth: z.enum(['brief', 'normal', 'deep']),
  }),
  humanContext: z.object({
    emotionalSignals: z.array(z.string().min(1).max(200)).max(10),
    emotionalConfidence: z.number().min(0).max(1),
    urgency: z.enum(['low', 'medium', 'high']),
    stakes: z.enum(['low', 'medium', 'high']),
    relationshipRelevant: z.boolean(),
  }),
  ambiguity: z.object({
    level: z.enum(['none', 'low', 'high']),
    missingInformation: z.array(z.string().min(1).max(300)).max(12),
    canProvideUsefulPartialAnswer: z.boolean(),
    clarificationNecessary: z.boolean(),
  }),
  knowledge: z.object({
    assessment: z.enum(['known', 'partially_known', 'uncertain', 'unknown']),
    timeSensitive: z.boolean(),
    verificationDesirable: z.boolean(),
    unsupportedAssumptions: z.array(z.string().min(1).max(400)).max(12),
  }),
  memory: z.object({
    retrievalQueries: z.array(z.string().min(1).max(400)).min(1).max(8),
    desiredMemoryTypes: z.array(memoryTypeSchema).max(5),
    previousOpinionRelevant: z.boolean(),
    openLoopsRelevant: z.boolean(),
  }),
});
export type CognitiveFrame = z.infer<typeof cognitiveFrameSchema>;

export const cognitiveDecisionSchema = z.object({
  turnId: z.string().uuid(),
  mode: cognitiveModeSchema,
  understanding: z.object({
    userGoal: z.string().min(1).max(1200),
    mostImportantPoint: z.string().min(1).max(1000),
    assumptions: z.array(z.string().min(1).max(500)).max(12),
  }),
  stance: z.object({
    necessary: z.boolean(),
    position: z.string().min(1).max(1800).nullable(),
    confidence: z.number().min(0).max(1),
    priorOpinionId: z.string().nullable(),
    relationToPrior: z.enum(['not_applicable', 'new', 'consistent', 'refined', 'changed', 'uncertain']),
    changeReason: z.string().max(1000).nullable(),
  }),
  responseStrategy: z.object({
    primaryAction: z.enum([
      'answer',
      'explain',
      'teach',
      'diagnose',
      'advise',
      'plan',
      'challenge',
      'correct',
      'clarify',
      'acknowledge_uncertainty',
      'silence',
    ]),
    answerFirst: z.boolean(),
    depth: z.enum(['brief', 'normal', 'deep']),
    useSteps: z.boolean(),
    mentionUncertainty: z.boolean(),
    askQuestion: z.boolean(),
    questionReason: z.string().max(700).nullable(),
  }),
  knowledgeUse: z.object({
    memoryIds: z.array(z.string()).max(20),
    opinionIds: z.array(z.string()).max(12),
    openLoopIds: z.array(z.string()).max(12),
    lessonIds: z.array(z.string()).max(12),
    claimsNeedingCare: z.array(z.string().min(1).max(500)).max(12),
  }),
  tone: z.object({
    warmth: z.number().min(0).max(1),
    directness: z.number().min(0).max(1),
    seriousness: z.number().min(0).max(1),
    humor: z.number().min(0).max(1),
    challenge: z.number().min(0).max(1),
  }),
  verification: z.object({
    criticalReviewRequired: z.boolean(),
    reason: z.string().max(700).nullable(),
  }),
});
export type CognitiveDecision = z.infer<typeof cognitiveDecisionSchema>;

export const responseReviewSchema = z.object({
  addressesUserGoal: z.boolean(),
  contradictsKnownMemory: z.boolean(),
  unsupportedCertainty: z.boolean(),
  missedCriticalAssumption: z.boolean(),
  unnecessarilyVerbose: z.boolean(),
  requiresRevision: z.boolean(),
  revisionInstruction: z.string().min(1).max(1000).nullable(),
}).superRefine((value, context) => {
  if (value.requiresRevision !== Boolean(value.revisionInstruction)) {
    context.addIssue({ code: 'custom', message: 'requiresRevision exige revisionInstruction, e vice-versa.' });
  }
});
export type ResponseReview = z.infer<typeof responseReviewSchema>;

export const knowledgeAssessmentSchema = z.object({
  claim: z.string().min(1).max(1000),
  source: z.enum(['model_prior', 'conversation', 'persistent_memory', 'inference', 'unknown']),
  confidence: z.number().min(0).max(1),
  timeSensitive: z.boolean(),
  verificationAvailable: z.boolean(),
});
export type KnowledgeAssessment = z.infer<typeof knowledgeAssessmentSchema>;

const evidenceSchema = z.array(z.string().min(1)).min(1).max(20);

const memoryCandidateSchema = z.object({
  content: z.string().min(1).max(2400),
  type: memoryTypeSchema,
  confidence: z.number().min(0).max(1),
  importance: z.number().min(0).max(1),
  evidenceMessageIds: evidenceSchema,
});

const memoryRevisionSchema = memoryCandidateSchema.extend({
  id: z.string().min(1),
  contradictionKind: z.enum(['update', 'correction', 'real_change', 'ambiguity']),
  reason: z.string().min(1).max(1200),
});

const opinionCandidateSchema = z.object({
  topic: z.string().min(1).max(300),
  position: z.string().min(1).max(2000),
  reason: z.string().min(1).max(2000),
  confidence: z.number().min(0).max(1),
  evidenceMessageIds: evidenceSchema,
});

const opinionRevisionSchema = opinionCandidateSchema.extend({
  id: z.string().min(1),
  relation: z.enum(['refined', 'changed', 'uncertain']),
  changeReason: z.string().min(1).max(1200),
});

const interactionLessonCandidateSchema = z.object({
  scope: z.enum(['global', 'topic', 'project', 'relationship']),
  scopeKey: z.string().max(300).nullable(),
  lesson: z.string().min(1).max(1600),
  evidenceMessageIds: evidenceSchema,
  confidence: z.number().min(0).max(1),
  evidenceStrength: z.enum(['explicit_feedback', 'repeated_pattern', 'correction', 'outcome']),
});

const interactionLessonRevisionSchema = interactionLessonCandidateSchema.extend({
  id: z.string().min(1),
  active: z.boolean(),
  reason: z.string().min(1).max(1000),
});

const openLoopCandidateSchema = z.object({
  topic: z.string().min(1).max(300),
  description: z.string().min(1).max(1600),
  importance: z.number().min(0).max(1),
  evidenceMessageIds: evidenceSchema,
});

export const selfModelTraitSchema = z.enum([
  'preferredVerbosity',
  'warmth',
  'directness',
  'humor',
  'playfulness',
  'willingnessToChallenge',
]);

const selfModelUpdateSchema = z.object({
  traitUpdates: z.array(z.object({
    trait: selfModelTraitSchema,
    value: z.number().min(0).max(1),
    reason: z.string().min(1).max(1000),
    confidence: z.number().min(0).max(1),
    evidenceMessageIds: evidenceSchema,
    evidenceStrength: z.enum(['explicit_feedback', 'repeated_pattern', 'correction', 'self_decision']),
  })).max(6),
}).nullable();

export const turnConsolidationSchema = z.object({
  memoriesToCreate: z.array(memoryCandidateSchema).max(8),
  memoriesToRevise: z.array(memoryRevisionSchema).max(8),
  opinionsToCreate: z.array(opinionCandidateSchema).max(4),
  opinionsToRevise: z.array(opinionRevisionSchema).max(4),
  lessonsToCreate: z.array(interactionLessonCandidateSchema).max(5),
  lessonsToRevise: z.array(interactionLessonRevisionSchema).max(5),
  openLoopsToCreate: z.array(openLoopCandidateSchema).max(6),
  openLoopsToResolve: z.array(z.string()).max(12),
  selfModelUpdate: selfModelUpdateSchema,
});
export type TurnConsolidation = z.infer<typeof turnConsolidationSchema>;

export const initiativeDecisionSchema = z.object({
  initiate: z.boolean(),
  openLoopId: z.string().nullable(),
  reason: z.string().min(1).max(1000),
});
export type InitiativeDecision = z.infer<typeof initiativeDecisionSchema>;

const OLLAMA_SCHEMA_KEYWORDS = new Set([
  'type',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'minItems',
  'maxItems',
  'enum',
  'anyOf',
  'oneOf',
  'allOf',
  '$defs',
  '$ref',
  'const',
]);

export const cognitiveFrameJsonSchema = toOllamaJsonSchema(cognitiveFrameSchema);
export const cognitiveDecisionJsonSchema = toOllamaJsonSchema(cognitiveDecisionSchema);
export const responseReviewJsonSchema = toOllamaJsonSchema(responseReviewSchema);
export const turnConsolidationJsonSchema = toOllamaJsonSchema(turnConsolidationSchema);
export const initiativeDecisionJsonSchema = toOllamaJsonSchema(initiativeDecisionSchema);

function toOllamaJsonSchema(schema: z.ZodType): object {
  return sanitizeJsonSchema(z.toJSONSchema(schema)) as object;
}

function sanitizeJsonSchema(value: unknown, parentKey?: string): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitizeJsonSchema(item));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => parentKey === 'properties' || parentKey === '$defs' || OLLAMA_SCHEMA_KEYWORDS.has(key))
      .map(([key, child]) => [key, sanitizeJsonSchema(child, key)]),
  );
}
